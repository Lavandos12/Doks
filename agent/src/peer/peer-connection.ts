import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import {
  type PeerMessage,
  type HandshakeChallenge,
  type HandshakeResponse,
  encodeMessage,
  decodeMessage,
  uint8ArrayToBase64,
  base64ToUint8Array,
  DOC_INDEX
} from '@doks/shared';
import { computeHmacProof, verifyHmacProof, generateNonce } from '../security.js';

export interface PeerConnectionOptions {
  socket: WebSocket;
  isOutbound: boolean;
  remoteAddress: string;
  localPeerId: string;
  localMemberName: string;
  teamKey: string;
}

export class PeerConnection extends EventEmitter {
  public socket: WebSocket;
  public isOutbound: boolean;
  public remoteAddress: string;
  public remotePeerId?: string;
  public remoteMemberName?: string;
  public isAuthenticated = false;
  public isClosed = false;

  private localPeerId: string;
  private localMemberName: string;
  private teamKey: string;
  private localNonce?: string;
  private remoteNonce?: string;
  private pingTimer?: NodeJS.Timeout;

  constructor(options: PeerConnectionOptions) {
    super();
    this.socket = options.socket;
    this.isOutbound = options.isOutbound;
    this.remoteAddress = options.remoteAddress;
    this.localPeerId = options.localPeerId;
    this.localMemberName = options.localMemberName;
    this.teamKey = options.teamKey;

    this.setupSocket();
  }

  private setupSocket(): void {
    this.socket.on('message', (raw: Buffer | string) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = decodeMessage(text);
        this.handleMessage(msg);
      } catch (err) {
        console.error(`[PeerConnection] Failed to parse message from ${this.remoteAddress}:`, err);
      }
    });

    this.socket.on('close', () => {
      this.cleanup();
      this.emit('close');
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    // If outbound, start handshake when socket is open
    if (this.isOutbound) {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.startHandshake();
      } else {
        this.socket.once('open', () => {
          this.startHandshake();
        });
      }
    }
  }

  public startHandshake(): void {
    this.localNonce = generateNonce();
    const challenge: HandshakeChallenge = {
      type: 'challenge',
      nonce: this.localNonce,
      peerId: this.localPeerId,
      memberName: this.localMemberName,
      version: '1.0'
    };
    this.send(challenge);
  }

  private handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case 'challenge': {
        this.remoteNonce = msg.nonce;
        this.remotePeerId = msg.peerId;
        this.remoteMemberName = msg.memberName;

        // Inbound: respond with HMAC proof
        this.localNonce = generateNonce();
        const payload = this.remoteNonce + this.localNonce + this.localPeerId;
        const proof = computeHmacProof(this.teamKey, payload);

        const response: HandshakeResponse = {
          type: 'response',
          nonce: this.localNonce,
          proof,
          peerId: this.localPeerId,
          memberName: this.localMemberName
        };
        this.send(response);
        break;
      }

      case 'response': {
        if (!this.localNonce) return this.close();
        this.remoteNonce = msg.nonce;
        this.remotePeerId = msg.peerId;
        this.remoteMemberName = msg.memberName;

        // Outbound: verify peer's response
        const expectedPayload = this.localNonce + this.remoteNonce + this.remotePeerId;
        if (!verifyHmacProof(this.teamKey, expectedPayload, msg.proof)) {
          console.warn(`[PeerConnection] Invalid handshake HMAC from ${this.remoteAddress}`);
          return this.close();
        }

        // Send accepted message with our proof
        const acceptedPayload = this.remoteNonce + this.localNonce + this.localPeerId;
        const acceptedProof = computeHmacProof(this.teamKey, acceptedPayload);

        this.send({
          type: 'accepted',
          peerId: this.localPeerId,
          proof: acceptedProof
        } as any);

        this.onAuthenticated();
        break;
      }

      case 'accepted': {
        if (!this.localNonce || !this.remoteNonce || !this.remotePeerId) return this.close();
        const candidateProof = (msg as any).proof;
        const expectedPayload = this.localNonce + this.remoteNonce + this.remotePeerId;
        if (!verifyHmacProof(this.teamKey, expectedPayload, candidateProof)) {
          console.warn(`[PeerConnection] Invalid accepted HMAC from ${this.remoteAddress}`);
          return this.close();
        }

        this.onAuthenticated();
        break;
      }

      case 'sync': {
        if (!this.isAuthenticated) return;
        const bytes = base64ToUint8Array(msg.data);
        this.emit('sync', { docName: msg.docName, data: bytes });
        break;
      }

      case 'awareness': {
        if (!this.isAuthenticated) return;
        const bytes = base64ToUint8Array(msg.data);
        this.emit('awareness', { docName: msg.docName, data: bytes });
        break;
      }

      case 'relay': {
        if (!this.isAuthenticated) return;
        const bytes = base64ToUint8Array(msg.data);
        this.emit('relay', {
          originPeerId: msg.originPeerId,
          docName: msg.docName,
          data: bytes,
          hopCount: msg.hopCount
        });
        break;
      }

      case 'ping': {
        this.send({ type: 'pong', timestamp: Date.now() });
        break;
      }

      case 'pong': {
        this.emit('pong', Date.now() - msg.timestamp);
        break;
      }

      case 'attachment-list': {
        if (!this.isAuthenticated) return;
        this.emit('attachment-list', msg.hashes);
        break;
      }

      case 'attachment-request': {
        if (!this.isAuthenticated) return;
        this.emit('attachment-request', { hash: msg.hash, chunkIndex: msg.chunkIndex });
        break;
      }

      case 'attachment-chunk': {
        if (!this.isAuthenticated) return;
        this.emit('attachment-chunk', {
          hash: msg.hash,
          chunkIndex: msg.chunkIndex,
          totalChunks: msg.totalChunks,
          data: base64ToUint8Array(msg.data),
          ext: msg.ext
        });
        break;
      }
    }
  }

  private onAuthenticated(): void {
    if (this.isAuthenticated) return;
    this.isAuthenticated = true;

    // Start periodic heartbeat
    this.pingTimer = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, 10000);

    this.emit('authenticated');
  }

  public send(msg: PeerMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeMessage(msg));
    }
  }

  public sendSync(docName: string, data: Uint8Array): void {
    this.send({
      type: 'sync',
      docName,
      data: uint8ArrayToBase64(data)
    });
  }

  public sendAwareness(docName: string, data: Uint8Array): void {
    this.send({
      type: 'awareness',
      docName,
      data: uint8ArrayToBase64(data)
    });
  }

  public sendRelay(originPeerId: string, docName: string, data: Uint8Array, hopCount: number): void {
    this.send({
      type: 'relay',
      originPeerId,
      docName,
      data: uint8ArrayToBase64(data),
      hopCount
    });
  }

  public close(): void {
    if (!this.isClosed) {
      this.isClosed = true;
      try {
        this.socket.close();
      } catch {}
      this.cleanup();
    }
  }

  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }
}
