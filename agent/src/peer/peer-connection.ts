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
import {
  computeHmacProof,
  verifyHmacProof,
  generateNonce,
  signChallenge,
  verifyChallengeSignature,
  deriveTrafficKey,
  encryptAeadFrame,
  decryptAeadFrame,
  createMonotonicNonce,
  type NodeIdentity
} from '../security.js';

export interface PeerConnectionOptions {
  socket: WebSocket;
  isOutbound: boolean;
  remoteAddress: string;
  localPeerId: string;
  localMemberName: string;
  teamKey: string;
  nodeIdentity?: NodeIdentity;
}

export class PeerConnection extends EventEmitter {
  public socket: WebSocket;
  public isOutbound: boolean;
  public remoteAddress: string;
  public remotePeerId?: string;
  public remoteMemberName?: string;
  public remotePublicKey?: string;
  public isAuthenticated = false;
  public isClosed = false;

  private localPeerId: string;
  private localMemberName: string;
  private teamKey: string;
  private nodeIdentity?: NodeIdentity;
  private localNonce?: string;
  private remoteNonce?: string;
  private pingTimer?: NodeJS.Timeout;

  // AEAD Encryption & Counters
  private trafficKey?: Buffer;
  private outboundCounter = 0n;
  private inboundCounter = 0n;

  // Dual-Queue WebSocket Backpressure
  private highPriorityQueue: PeerMessage[] = [];
  private bulkQueue: PeerMessage[] = [];
  private isDraining = false;
  private static readonly MAX_BUFFERED_AMOUNT = 262144; // 256 KB

  constructor(options: PeerConnectionOptions) {
    super();
    this.socket = options.socket;
    this.isOutbound = options.isOutbound;
    this.remoteAddress = options.remoteAddress;
    this.localPeerId = options.localPeerId;
    this.localMemberName = options.localMemberName;
    this.teamKey = options.teamKey;
    this.nodeIdentity = options.nodeIdentity;

    this.setupSocket();
  }

  private setupSocket(): void {
    this.socket.on('message', (raw: Buffer | string) => {
      try {
        let text: string;

        // Check if message is an AEAD encrypted frame (Magic: 0x44 0x4F 0x4B 0x53 "DOKS")
        if (
          Buffer.isBuffer(raw) &&
          raw.length >= 32 &&
          raw[0] === 0x44 &&
          raw[1] === 0x4F &&
          raw[2] === 0x4B &&
          raw[3] === 0x53 &&
          this.trafficKey
        ) {
          const nonce = raw.subarray(4, 16);
          const seq = nonce.readBigUInt64BE(4);
          if (seq <= this.inboundCounter) {
            throw new Error(`Replay attack detected or duplicate frame: seq=${seq} <= current=${this.inboundCounter}`);
          }
          this.inboundCounter = seq;

          const frame = raw.subarray(16);
          const decrypted = decryptAeadFrame(this.trafficKey, nonce, frame);
          text = decrypted.toString('utf8');
        } else {
          if (this.isAuthenticated && this.trafficKey) {
            throw new Error('Unencrypted or invalid frame received on authenticated AEAD channel');
          }
          text = typeof raw === 'string' ? raw : raw.toString('utf8');
        }

        const msg = decodeMessage(text);
        this.handleMessage(msg);
      } catch (err) {
        console.warn(`[PeerConnection] Tampered frame or parse error from ${this.remoteAddress}:`, err);
        this.close();
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
    let signature: string | undefined;

    if (this.nodeIdentity) {
      try {
        signature = signChallenge(this.nodeIdentity.privateKeyPem, this.localNonce);
      } catch {}
    }

    const challenge: HandshakeChallenge = {
      type: 'challenge',
      nonce: this.localNonce,
      peerId: this.localPeerId,
      memberName: this.localMemberName,
      version: '2.0',
      publicKey: this.nodeIdentity?.publicKeyPem,
      signature
    } as any;

    this.sendImmediate(challenge);
  }

  private handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case 'challenge': {
        this.remoteNonce = msg.nonce;
        this.remotePeerId = msg.peerId;
        this.remoteMemberName = msg.memberName;
        const candidatePublicKey = (msg as any).publicKey;
        const candidateSig = (msg as any).signature;

        // If Ed25519 signature provided, verify identity
        if (candidatePublicKey && candidateSig) {
          if (!verifyChallengeSignature(candidatePublicKey, msg.nonce, candidateSig)) {
            console.warn(`[PeerConnection] Invalid Ed25519 signature in challenge from ${this.remoteAddress}`);
            return this.close();
          }
          this.remotePublicKey = candidatePublicKey;
        }

        // Inbound: respond with HMAC proof and Ed25519 signature
        this.localNonce = generateNonce();
        const payload = this.remoteNonce + this.localNonce + this.localPeerId;
        const proof = computeHmacProof(this.teamKey, payload);

        let responseSig: string | undefined;
        if (this.nodeIdentity) {
          try {
            responseSig = signChallenge(this.nodeIdentity.privateKeyPem, payload);
          } catch {}
        }

        const response: HandshakeResponse = {
          type: 'response',
          nonce: this.localNonce,
          proof,
          peerId: this.localPeerId,
          memberName: this.localMemberName,
          publicKey: this.nodeIdentity?.publicKeyPem,
          signature: responseSig
        } as any;

        this.sendImmediate(response);
        break;
      }

      case 'response': {
        if (!this.localNonce) return this.close();
        this.remoteNonce = msg.nonce;
        this.remotePeerId = msg.peerId;
        this.remoteMemberName = msg.memberName;
        const candidatePublicKey = (msg as any).publicKey;
        const candidateSig = (msg as any).signature;

        // Outbound: verify peer's HMAC response
        const expectedPayload = this.localNonce + this.remoteNonce + this.remotePeerId;
        if (!verifyHmacProof(this.teamKey, expectedPayload, msg.proof)) {
          console.warn(`[PeerConnection] Invalid handshake HMAC from ${this.remoteAddress}`);
          return this.close();
        }

        if (candidatePublicKey && candidateSig) {
          if (!verifyChallengeSignature(candidatePublicKey, expectedPayload, candidateSig)) {
            console.warn(`[PeerConnection] Invalid Ed25519 response signature from ${this.remoteAddress}`);
            return this.close();
          }
          this.remotePublicKey = candidatePublicKey;
        }

        // Send accepted message with our proof
        const acceptedPayload = this.remoteNonce + this.localNonce + this.localPeerId;
        const acceptedProof = computeHmacProof(this.teamKey, acceptedPayload);

        this.sendImmediate({
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

    // Derive AEAD traffic key from teamKey + salt (sorted nonces for symmetric derivation)
    const salt = [this.localNonce || '', this.remoteNonce || ''].sort().join(':');
    this.trafficKey = deriveTrafficKey(this.teamKey, salt);
    this.outboundCounter = 0n;
    this.inboundCounter = 0n;

    // Start periodic heartbeat
    this.pingTimer = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, 10000);
    if (this.pingTimer.unref) {
      this.pingTimer.unref();
    }

    this.emit('authenticated');
    this.drainQueues();
  }

  /**
   * Dual-Queue Enqueue: high-priority vs bulk (attachments)
   */
  public send(msg: PeerMessage): void {
    if (this.isClosed || this.socket.readyState !== WebSocket.OPEN) return;

    if (msg.type === 'attachment-chunk') {
      this.bulkQueue.push(msg);
    } else {
      this.highPriorityQueue.push(msg);
    }

    this.drainQueues();
  }

  private drainQueues(): void {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      // 1. Drain high priority queue completely
      while (this.highPriorityQueue.length > 0 && this.socket.readyState === WebSocket.OPEN) {
        const msg = this.highPriorityQueue.shift();
        if (msg) this.sendImmediate(msg);
      }

      // 2. Drain bulk queue respecting backpressure threshold (256 KB)
      while (
        this.bulkQueue.length > 0 &&
        this.socket.readyState === WebSocket.OPEN &&
        this.socket.bufferedAmount < PeerConnection.MAX_BUFFERED_AMOUNT
      ) {
        const msg = this.bulkQueue.shift();
        if (msg) this.sendImmediate(msg);
      }

      // 3. If bulk items remain, schedule continuation check
      if (this.bulkQueue.length > 0 && this.socket.readyState === WebSocket.OPEN) {
        setTimeout(() => {
          this.isDraining = false;
          this.drainQueues();
        }, 20);
        return;
      }
    } finally {
      this.isDraining = false;
    }
  }

  private sendImmediate(msg: any): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    // Encrypt frame using AEAD AES-256-GCM once authenticated
    if (this.isAuthenticated && this.trafficKey) {
      try {
        const plaintext = Buffer.from(encodeMessage(msg), 'utf8');
        const prefix = this.isOutbound ? 1 : 2;
        this.outboundCounter++;
        const nonce = createMonotonicNonce(prefix, this.outboundCounter);
        const encrypted = encryptAeadFrame(this.trafficKey, nonce, plaintext);

        // Frame header: [0x44, 0x4F, 0x4B, 0x53][12-byte nonce][16-byte tag + ciphertext]
        const magic = Buffer.from([0x44, 0x4F, 0x4B, 0x53]);
        this.socket.send(Buffer.concat([magic, nonce, encrypted]));
        return;
      } catch (err) {
        console.error(`[PeerConnection] Failed to encrypt frame for ${this.remoteAddress}:`, err);
      }
    }

    // Default plaintext encoding for pre-auth / fallback
    this.socket.send(encodeMessage(msg));
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
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.close();
        } else {
          this.socket.terminate();
        }
      } catch {}
      this.cleanup();
    }
  }

  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    this.highPriorityQueue = [];
    this.bulkQueue = [];
  }
}
