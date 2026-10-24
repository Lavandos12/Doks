import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type { AgentConfig, PeerStatus } from '@doks/shared';
import { DocManager } from '../storage/doc-manager.js';
import { PeerConnection } from './peer-connection.js';
import { findAvailablePort } from '../network.js';

interface OutboundPeerState {
  address: string;
  reconnectAttempts: number;
  reconnectTimeout?: NodeJS.Timeout;
  connection?: PeerConnection;
}

export class PeerService extends EventEmitter {
  private config: AgentConfig;
  private docManager: DocManager;
  private wss?: WebSocketServer;
  private connections = new Map<string, PeerConnection>(); // key: peerId
  private outboundPeers = new Map<string, OutboundPeerState>(); // key: address
  private isDestroyed = false;

  constructor(config: AgentConfig, docManager: DocManager) {
    super();
    this.config = config;
    this.docManager = docManager;

    // Listen to local document updates to broadcast to peers
    this.docManager.on('update', ({ docName, update, origin }) => {
      if (origin !== 'peer' && origin !== 'relay') {
        const syncMsg = this.docManager.createUpdateSyncMessage(update);
        this.broadcastSync(docName, syncMsg);
      }
    });

    // Populate initial outbound peers
    for (const address of this.config.peers) {
      this.outboundPeers.set(address, {
        address,
        reconnectAttempts: 0
      });
    }
  }

  public async start(): Promise<void> {
    this.isDestroyed = false;
    for (const state of this.outboundPeers.values()) {
      state.reconnectAttempts = 0;
    }

    const host = this.config.bindAddress || '127.0.0.1';
    const freePort = await findAvailablePort(this.config.peerPort, host);
    if (freePort !== this.config.peerPort) {
      console.warn(`[PeerService] Peer port ${this.config.peerPort} is busy, auto-switching to free port ${freePort}`);
      this.config.peerPort = freePort;
    }

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          host,
          port: this.config.peerPort
        });

        this.wss.on('listening', () => {
          console.log(`[PeerService] Listening for peers on ${host}:${this.config.peerPort}`);
          this.connectAllOutbound();
          resolve();
        });

        this.wss.on('connection', (socket: WebSocket, req) => {
          const remoteIp = req.socket.remoteAddress || 'unknown';
          const remotePort = req.socket.remotePort || 0;
          const remoteAddress = `${remoteIp}:${remotePort}`;
          this.handleIncomingConnection(socket, remoteAddress);
        });

        this.wss.on('error', (err) => {
          console.error('[PeerService] Server error:', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleIncomingConnection(socket: WebSocket, remoteAddress: string): void {
    const conn = new PeerConnection({
      socket,
      isOutbound: false,
      remoteAddress,
      localPeerId: this.config.agentId,
      localMemberName: this.config.memberName,
      teamKey: this.config.teamKey
    });

    this.setupConnectionEvents(conn);
  }

  private connectToPeer(address: string): void {
    if (this.isDestroyed) return;
    const peerState = this.outboundPeers.get(address);
    if (!peerState) return;

    // Clean address format: strip doks:// or ws:// if present
    let target = address;
    if (target.startsWith('doks://')) {
      target = target.slice(7);
      if (target.includes('#')) {
        target = target.split('#')[0];
      }
    }
    const wsUrl = target.startsWith('ws://') ? target : `ws://${target}`;

    try {
      const socket = new WebSocket(wsUrl);
      const conn = new PeerConnection({
        socket,
        isOutbound: true,
        remoteAddress: address,
        localPeerId: this.config.agentId,
        localMemberName: this.config.memberName,
        teamKey: this.config.teamKey
      });

      peerState.connection = conn;
      this.setupConnectionEvents(conn, address);

      socket.on('error', (err) => {
        // Socket error handled in conn close
      });
    } catch (err) {
      this.scheduleReconnect(address);
    }
  }

  private connectAllOutbound(): void {
    for (const address of this.outboundPeers.keys()) {
      this.connectToPeer(address);
    }
  }

  private scheduleReconnect(address: string): void {
    if (this.isDestroyed) return;
    const peerState = this.outboundPeers.get(address);
    if (!peerState) return;

    if (peerState.reconnectTimeout) {
      clearTimeout(peerState.reconnectTimeout);
    }

    const attempts = peerState.reconnectAttempts;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
    peerState.reconnectAttempts++;

    peerState.reconnectTimeout = setTimeout(() => {
      peerState.reconnectTimeout = undefined;
      this.connectToPeer(address);
    }, delay);
  }

  private setupConnectionEvents(conn: PeerConnection, outboundAddress?: string): void {
    conn.on('authenticated', () => {
      const remotePeerId = conn.remotePeerId!;
      console.log(`[PeerService] Peer authenticated: ${conn.remoteMemberName} (${remotePeerId})`);

      // Reset reconnect attempts for outbound
      if (outboundAddress) {
        const peerState = this.outboundPeers.get(outboundAddress);
        if (peerState) peerState.reconnectAttempts = 0;
      }

      // Deduplication check
      const existing = this.connections.get(remotePeerId);
      if (existing && existing !== conn) {
        const keepOutbound = this.config.agentId > remotePeerId;
        if (keepOutbound === conn.isOutbound) {
          existing.close();
        } else {
          conn.close();
          return;
        }
      }

      this.connections.set(remotePeerId, conn);
      this.emit('peer-connected', { peerId: remotePeerId, name: conn.remoteMemberName });

      // Anti-entropy: initiate sync step 1 for all known active documents
      this.syncAllDocsWithPeer(conn);
    });

    conn.on('sync', ({ docName, data }) => {
      // Apply sync message to docManager
      const response = this.docManager.handleSyncMessage(docName, data, 'peer');
      if (response) {
        conn.sendSync(docName, response);
      }

      // Relay only updates (step 2 or incremental update) to other peers
      if (data.length > 0 && (data[0] === 1 || data[0] === 2)) {
        this.relayToOthers(conn.remotePeerId!, docName, data, 1);
      }
    });

    conn.on('relay', ({ originPeerId, docName, data, hopCount }) => {
      if (originPeerId === this.config.agentId) return; // avoid looping back to origin

      const response = this.docManager.handleSyncMessage(docName, data, 'relay');
      if (response) {
        conn.sendSync(docName, response);
      }

      // Forward if hopCount < 5
      if (hopCount < 5) {
        for (const [peerId, peerConn] of this.connections.entries()) {
          if (peerId !== originPeerId && peerId !== conn.remotePeerId && peerConn.isAuthenticated) {
            peerConn.sendRelay(originPeerId, docName, data, hopCount + 1);
          }
        }
      }
    });

    conn.on('close', () => {
      if (conn.remotePeerId && this.connections.get(conn.remotePeerId) === conn) {
        this.connections.delete(conn.remotePeerId);
        this.emit('peer-disconnected', { peerId: conn.remotePeerId });
      }

      if (outboundAddress) {
        this.scheduleReconnect(outboundAddress);
      }
    });
  }

  private syncAllDocsWithPeer(conn: PeerConnection): void {
    const docNames = this.docManager.getAllDocNames();
    for (const docName of docNames) {
      const step1 = this.docManager.createSyncStep1Message(docName);
      conn.sendSync(docName, step1);
    }
  }

  public broadcastSync(docName: string, update: Uint8Array): void {
    for (const conn of this.connections.values()) {
      if (conn.isAuthenticated) {
        conn.sendSync(docName, update);
      }
    }
  }

  private relayToOthers(
    excludePeerId: string,
    docName: string,
    data: Uint8Array,
    hopCount: number
  ): void {
    for (const [peerId, conn] of this.connections.entries()) {
      if (peerId !== excludePeerId && conn.isAuthenticated) {
        conn.sendRelay(excludePeerId, docName, data, hopCount);
      }
    }
  }

  public addPeer(address: string): void {
    if (!this.outboundPeers.has(address)) {
      this.outboundPeers.set(address, {
        address,
        reconnectAttempts: 0
      });
      if (!this.config.peers.includes(address)) {
        this.config.peers.push(address);
      }
      this.connectToPeer(address);
      this.emit('peers-changed', this.getPeersStatus());
    }
  }

  public removePeer(address: string): void {
    const peerState = this.outboundPeers.get(address);
    if (peerState) {
      if (peerState.reconnectTimeout) {
        clearTimeout(peerState.reconnectTimeout);
      }
      if (peerState.connection) {
        peerState.connection.close();
      }
      this.outboundPeers.delete(address);
      this.config.peers = this.config.peers.filter((p) => p !== address);
      this.emit('peers-changed', this.getPeersStatus());
    }
  }

  public getPeersStatus(): PeerStatus[] {
    const list: PeerStatus[] = [];

    // Outbound peers
    for (const [addr, state] of this.outboundPeers.entries()) {
      const conn = state.connection;
      list.push({
        address: addr,
        peerId: conn?.remotePeerId,
        name: conn?.remoteMemberName,
        connected: conn?.isAuthenticated || false,
        isOutbound: true
      });
    }

    // Inbound connections not already in list
    for (const [peerId, conn] of this.connections.entries()) {
      if (!conn.isOutbound) {
        list.push({
          address: conn.remoteAddress,
          peerId,
          name: conn.remoteMemberName,
          connected: conn.isAuthenticated,
          isOutbound: false
        });
      }
    }

    return list;
  }

  public getConnectedCount(): number {
    return this.connections.size;
  }

  public async stop(): Promise<void> {
    this.isDestroyed = true;

    for (const state of this.outboundPeers.values()) {
      if (state.reconnectTimeout) {
        clearTimeout(state.reconnectTimeout);
      }
      if (state.connection) {
        state.connection.close();
      }
    }

    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss?.close(() => resolve());
      });
      this.wss = undefined;
    }
  }
}
