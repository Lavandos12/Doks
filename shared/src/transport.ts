export type TransportPeerMessageType = 'sync' | 'awareness' | 'attachment' | 'relay';

export interface TransportPeerMessage {
  type: TransportPeerMessageType;
  docName?: string;
  payload: Uint8Array;
}

export type PeerMessage = TransportPeerMessage;
export type PeerMessageType = TransportPeerMessageType;

export interface TransportConnection {
  readonly peerId: string;
  readonly remoteAddress?: string;
  send(message: TransportPeerMessage): Promise<void>;
  close(): Promise<void>;
  onMessage(handler: (message: TransportPeerMessage) => void): void;
  onClose(handler: (reason?: string) => void): void;
}

export interface TransportConfig {
  bindAddress?: string;
  port?: number;
  teamKey?: string;
  peers?: string[];
}

export interface Transport {
  readonly name: string;
  start(config: TransportConfig): Promise<void>;
  stop(): Promise<void>;
  connect(target: string): Promise<TransportConnection>;
  onConnection(handler: (conn: TransportConnection) => void): void;
}
