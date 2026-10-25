import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { AgentConfig, PeerStatus } from '@doks/shared';
import {
  uint8ArrayToBase64,
  base64ToUint8Array,
  DOC_INDEX,
  getIndexMaps,
  getBoardDocName,
  getNoteDocName,
  isSoloDoc
} from '@doks/shared';
import { DocManager } from '../storage/doc-manager.js';
import { AttachmentManager } from '../storage/attachments.js';
import { PeerConnection } from './peer-connection.js';
import { PeerDiscoveryService, type DiscoveredPeer } from './peer-discovery.js';
import { getOrGenerateNodeIdentity, type NodeIdentity } from '../security.js';
import { findAvailablePort, findRadminIp } from '../network.js';
import { logger } from '../logger.js';

interface OutboundPeerState {
  address: string;
  reconnectAttempts: number;
  reconnectTimeout?: NodeJS.Timeout;
  connection?: PeerConnection;
}

export class PeerService extends EventEmitter {
  private config: AgentConfig;
  private docManager: DocManager;
  private attachmentManager?: AttachmentManager;
  private nodeIdentity: NodeIdentity;
  private discoveryService?: PeerDiscoveryService;
  private wss?: WebSocketServer;
  private connections = new Map<string, PeerConnection>(); // key: peerId
  private outboundPeers = new Map<string, OutboundPeerState>(); // key: address
  private isDestroyed = false;

  // B20: LRU cache for relayed messages to prevent loops
  private seenRelays = new Set<string>();
  private seenRelaysQueue: string[] = [];
  private static readonly MAX_SEEN_RELAYS = 2000;

  private hasSeenRelay(msgHash: string): boolean {
    return this.seenRelays.has(msgHash);
  }

  private markRelaySeen(msgHash: string): void {
    if (this.seenRelays.has(msgHash)) return;
    if (this.seenRelaysQueue.length >= PeerService.MAX_SEEN_RELAYS) {
      const oldest = this.seenRelaysQueue.shift();
      if (oldest) this.seenRelays.delete(oldest);
    }
    this.seenRelays.add(msgHash);
    this.seenRelaysQueue.push(msgHash);
  }

  constructor(config: AgentConfig, docManager: DocManager, attachmentManager?: AttachmentManager) {
    super();
    this.config = config;
    this.docManager = docManager;
    this.attachmentManager = attachmentManager;
    this.nodeIdentity = getOrGenerateNodeIdentity(this.config.statePath);

    // Listen to local document updates to broadcast to peers
    this.docManager.on('update', ({ docName, update, origin }) => {
      // Step 2 & 1.2: Hard network isolation - solo documents NEVER emit network packets!
      if (isSoloDoc(docName)) {
        return;
      }
      if (origin !== 'peer' && origin !== 'relay') {
        const syncMsg = this.docManager.createUpdateSyncMessage(update);
        this.broadcastSync(docName, syncMsg);
      }
    });

    // Section 7.2: Automatically sync documents listed in indexDoc
    const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes, boards } = getIndexMaps(indexDoc);
    notes.observeDeep(() => this.syncDocsFromIndex());
    boards.observeDeep(() => this.syncDocsFromIndex());

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

    const radminIp = findRadminIp();
    const host = (this.config.bindAddress === 'auto' || !this.config.bindAddress)
      ? (radminIp || '0.0.0.0')
      : this.config.bindAddress;
    const freePort = await findAvailablePort(this.config.peerPort, host);
    if (freePort !== this.config.peerPort) {
      console.warn(`[PeerService] Peer port ${this.config.peerPort} is busy, auto-switching to free port ${freePort}`);
      this.config.peerPort = freePort;
    }

    // Start UDP discovery service for automated LAN/VPN peer discovery
    try {
      this.discoveryService = new PeerDiscoveryService({
        teamKey: this.config.teamKey,
        wsPort: this.config.peerPort,
        peerId: this.nodeIdentity.peerId,
        bindAddress: host
      });
      this.discoveryService.on('peer', (peer: DiscoveredPeer) => {
        // If already connected to this peer, skip redundant connection
        if (this.connections.has(peer.peerId)) return;
        logger.info(`[PeerDiscovery] Discovered peer beacon at ${peer.address}:${peer.wsPort} (${peer.peerId})`);
        this.addPeer(`${peer.address}:${peer.wsPort}`);
      });
      await this.discoveryService.start();
    } catch (err: any) {
      logger.warn(`[PeerDiscovery] Discovery service startup failed: ${err.message}`);
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
      localPeerId: this.nodeIdentity.peerId || this.config.agentId,
      localMemberName: this.config.memberName,
      teamKey: this.config.teamKey,
      nodeIdentity: this.nodeIdentity
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
        localPeerId: this.nodeIdentity.peerId || this.config.agentId,
        localMemberName: this.config.memberName,
        teamKey: this.config.teamKey,
        nodeIdentity: this.nodeIdentity
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
    conn.on('error', (_err) => {
      // Socket / connection error handled in close event
    });

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
        const myId = this.nodeIdentity.peerId || this.config.agentId;
        const keepOutbound = myId > remotePeerId;
        if (keepOutbound === conn.isOutbound) {
          (existing as any).isDeduplicated = true;
          existing.close();
        } else {
          (conn as any).isDeduplicated = true;
          conn.close();
          return;
        }
      }

      this.connections.set(remotePeerId, conn);
      this.emit('peer-connected', { peerId: remotePeerId, name: conn.remoteMemberName });

      // Anti-entropy: initiate sync step 1 for all known active documents
      this.syncAllDocsWithPeer(conn);

      // Exchange attachments list
      if (this.attachmentManager) {
        try {
          const attDir = this.attachmentManager.getAttachmentsDir();
          if (fs.existsSync(attDir)) {
            const files = fs.readdirSync(attDir);
            const hashes = files
              .map((f) => path.basename(f, path.extname(f)))
              .filter((h) => h.length === 64);
            if (hashes.length > 0) {
              conn.send({ type: 'attachment-list', hashes });
            }
          }
        } catch (e) {
          console.error('[PeerService] Error sending attachment list:', e);
        }
      }
    });

    conn.on('attachment-list', (hashes: string[]) => {
      if (!this.attachmentManager) return;
      for (const h of hashes) {
        if (!this.attachmentManager.getAttachment(h)) {
          conn.send({ type: 'attachment-request', hash: h, chunkIndex: 0 });
        }
      }
    });

    conn.on('attachment-request', ({ hash, chunkIndex }: { hash: string; chunkIndex: number }) => {
      if (!this.attachmentManager) return;
      const att = this.attachmentManager.getAttachment(hash);
      if (!att) return;
      const chunk = this.attachmentManager.getChunk(hash, chunkIndex);
      if (!chunk) return;
      conn.send({
        type: 'attachment-chunk',
        hash,
        chunkIndex,
        totalChunks: chunk.totalChunks,
        data: uint8ArrayToBase64(chunk.data),
        ext: path.extname(att.fileName)
      });
    });

    conn.on('attachment-chunk', ({ hash, chunkIndex, totalChunks, data, ext }: any) => {
      if (!this.attachmentManager) return;
      const res = this.attachmentManager.receiveChunk(hash, chunkIndex, totalChunks, Buffer.from(data), ext);
      if (!res && chunkIndex + 1 < totalChunks) {
        conn.send({ type: 'attachment-request', hash, chunkIndex: chunkIndex + 1 });
      } else if (res) {
        this.emit('attachment-received', res);
      }
    });

    conn.on('sync', ({ docName, data }) => {
      // Step 2 & 1.2: Hard network isolation - peers cannot sync solo documents
      if (isSoloDoc(docName)) {
        console.warn(`[PeerService] Blocked peer sync attempt for solo doc: ${docName}`);
        return;
      }

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
      const myId = this.nodeIdentity.peerId || this.config.agentId;
      if (originPeerId === myId || originPeerId === this.config.agentId) return; // avoid looping back to origin

      // Step 2 & 1.2: Hard network isolation
      if (isSoloDoc(docName)) {
        console.warn(`[PeerService] Blocked relayed solo doc: ${docName}`);
        return;
      }

      // B20: Hash check to avoid re-processing or infinite relay loops
      const msgHash = crypto.createHash('sha256')
        .update(originPeerId)
        .update(docName)
        .update(data)
        .digest('hex');

      if (this.hasSeenRelay(msgHash)) return;
      this.markRelaySeen(msgHash);

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

    conn.on('awareness', ({ docName, data }) => {
      if (isSoloDoc(docName)) return;

      try {
        awarenessProtocol.applyAwarenessUpdate(this.docManager.getAwareness(), data, conn.remotePeerId);
      } catch (err) {
        console.error('[PeerService] Error applying peer awareness update:', err);
      }

      this.emit('awareness', { docName, data });

      // Relay awareness to other peers (avoiding echo back)
      for (const [peerId, peerConn] of this.connections.entries()) {
        if (peerId !== conn.remotePeerId && peerConn.isAuthenticated) {
          peerConn.sendAwareness(docName, data);
        }
      }
    });

    conn.on('close', () => {
      if (conn.remotePeerId && this.connections.get(conn.remotePeerId) === conn) {
        this.connections.delete(conn.remotePeerId);
        this.emit('peer-disconnected', { peerId: conn.remotePeerId });
      }

      if (outboundAddress && !(conn as any).isDeduplicated) {
        this.scheduleReconnect(outboundAddress);
      }
    });
  }

  private syncAllDocsWithPeer(conn: PeerConnection): void {
    const docNames = this.docManager.getAllDocNames();
    for (const docName of docNames) {
      if (isSoloDoc(docName)) continue; // STRICT ISOLATION
      const step1 = this.docManager.createSyncStep1Message(docName);
      conn.sendSync(docName, step1);
    }
    this.syncDocsFromIndex();
  }

  public syncDocsFromIndex(): void {
    const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes, boards } = getIndexMaps(indexDoc);

    const docNamesToSync: string[] = [];
    boards.forEach((b, id) => {
      if (!b.deleted && b.scope !== 'solo') docNamesToSync.push(getBoardDocName(id));
    });
    notes.forEach((n, id) => {
      if (!n.deleted && n.scope !== 'solo') docNamesToSync.push(getNoteDocName(id));
    });

    for (const docName of docNamesToSync) {
      if (isSoloDoc(docName)) continue;
      this.docManager.getOrCreateDoc(docName);
      for (const conn of this.connections.values()) {
        if (conn.isAuthenticated) {
          const step1 = this.docManager.createSyncStep1Message(docName);
          conn.sendSync(docName, step1);
        }
      }
    }
  }

  public broadcastSync(docName: string, update: Uint8Array): void {
    if (isSoloDoc(docName)) return; // STRICT ISOLATION
    for (const conn of this.connections.values()) {
      if (conn.isAuthenticated) {
        conn.sendSync(docName, update);
      }
    }
  }

  public broadcastAwareness(docName: string, data: Uint8Array): void {
    if (isSoloDoc(docName)) return; // STRICT ISOLATION
    for (const conn of this.connections.values()) {
      if (conn.isAuthenticated) {
        conn.sendAwareness(docName, data);
      }
    }
  }

  private relayToOthers(
    excludePeerId: string,
    docName: string,
    data: Uint8Array,
    hopCount: number
  ): void {
    if (isSoloDoc(docName)) return; // STRICT ISOLATION
    for (const [peerId, conn] of this.connections.entries()) {
      if (peerId !== excludePeerId && conn.isAuthenticated) {
        conn.sendRelay(excludePeerId, docName, data, hopCount);
      }
    }
  }

  public addPeer(rawAddress: string): void {
    let clean = rawAddress.trim();
    if (clean.startsWith('doks://')) {
      clean = clean.slice(7);
    }

    let teamKeyFromInvite: string | undefined;
    if (clean.includes('#')) {
      const parts = clean.split('#');
      clean = parts[0].trim();
      teamKeyFromInvite = parts[1]?.trim();
    }

    if (teamKeyFromInvite && teamKeyFromInvite.length === 64) {
      this.config.teamKey = teamKeyFromInvite;
      const doksDir = path.dirname(this.config.statePath);
      const configPath = path.join(doksDir, 'config.json');
      try {
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf8');
      } catch {}
      logger.info('[PeerService] Adopted teamKey from invite for peer mesh');
    }

    const addresses = clean.split(',').map((a) => a.trim()).filter(Boolean);
    for (const address of addresses) {
      if (!this.outboundPeers.has(address)) {
        this.outboundPeers.set(address, {
          address,
          reconnectAttempts: 0
        });
        if (!this.config.peers.includes(address)) {
          this.config.peers.push(address);
        }
        this.connectToPeer(address);
      }
    }
    this.emit('peers-changed', this.getPeersStatus());
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

    if (this.discoveryService) {
      await this.discoveryService.stop();
      this.discoveryService = undefined;
    }

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
