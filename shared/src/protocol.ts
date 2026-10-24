export type PeerMessageType =
  | 'challenge'
  | 'response'
  | 'accepted'
  | 'sync'
  | 'awareness'
  | 'relay'
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'pong';

export interface HandshakeChallenge {
  type: 'challenge';
  nonce: string;
  peerId: string;
  memberName: string;
  version: string;
}

export interface HandshakeResponse {
  type: 'response';
  nonce: string;
  proof: string;
  peerId: string;
  memberName: string;
}

export interface HandshakeAccepted {
  type: 'accepted';
  peerId: string;
}

export interface SyncMessage {
  type: 'sync';
  docName: string;
  data: string; // base64 encoded binary Yjs update / sync message
}

export interface AwarenessMessage {
  type: 'awareness';
  docName: string;
  data: string; // base64 encoded awareness update
}

export interface RelayMessage {
  type: 'relay';
  originPeerId: string;
  docName: string;
  data: string; // base64 encoded Yjs update
  hopCount: number;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export interface SubscribeMessage {
  type: 'subscribe';
  docName: string;
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  docName: string;
}

export type PeerMessage =
  | HandshakeChallenge
  | HandshakeResponse
  | HandshakeAccepted
  | SyncMessage
  | AwarenessMessage
  | RelayMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage
  | PongMessage;

export function encodeMessage(msg: PeerMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string): PeerMessage {
  return JSON.parse(raw);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
