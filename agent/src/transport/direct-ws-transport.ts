import { WebSocketServer, WebSocket } from 'ws';
import type {
  Transport,
  TransportConfig,
  TransportConnection,
  TransportPeerMessage,
  TransportPeerMessageType
} from '@doks/shared';

type PeerMessage = TransportPeerMessage;
type PeerMessageType = TransportPeerMessageType;

function encodePeerMessage(msg: PeerMessage): Buffer {
  const typeMap: Record<PeerMessageType, number> = {
    sync: 1,
    awareness: 2,
    attachment: 3,
    relay: 4
  };
  const typeByte = typeMap[msg.type] || 1;
  const docNameBuf = msg.docName ? Buffer.from(msg.docName, 'utf-8') : Buffer.alloc(0);
  const header = Buffer.alloc(3 + docNameBuf.length);
  header[0] = typeByte;
  header.writeUInt16BE(docNameBuf.length, 1);
  if (docNameBuf.length > 0) {
    docNameBuf.copy(header, 3);
  }
  return Buffer.concat([header, Buffer.from(msg.payload)]);
}

function decodePeerMessage(buf: Buffer): PeerMessage {
  const typeByte = buf[0];
  const type: PeerMessageType =
    typeByte === 2 ? 'awareness' : typeByte === 3 ? 'attachment' : typeByte === 4 ? 'relay' : 'sync';
  const docNameLen = buf.readUInt16BE(1);
  const docName = docNameLen > 0 ? buf.subarray(3, 3 + docNameLen).toString('utf-8') : undefined;
  const payload = new Uint8Array(buf.subarray(3 + docNameLen));
  return { type, docName, payload };
}

export class DirectWsConnection implements TransportConnection {
  readonly peerId: string;
  readonly remoteAddress?: string;
  private ws: WebSocket;
  private messageHandlers: Array<(message: PeerMessage) => void> = [];
  private closeHandlers: Array<(reason?: string) => void> = [];

  constructor(peerId: string, ws: WebSocket, remoteAddress?: string) {
    this.peerId = peerId;
    this.ws = ws;
    this.remoteAddress = remoteAddress;

    this.ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      let buf: Buffer;
      if (Buffer.isBuffer(data)) {
        buf = data;
      } else if (data instanceof ArrayBuffer) {
        buf = Buffer.from(data);
      } else if (Array.isArray(data)) {
        buf = Buffer.concat(data);
      } else {
        return;
      }

      try {
        const msg = decodePeerMessage(buf);
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
      } catch (err) {
        // Drop malformed frame
      }
    });

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : `Closed with code ${code}`;
      for (const handler of this.closeHandlers) {
        handler(reasonStr);
      }
    });

    this.ws.on('error', (err) => {
      for (const handler of this.closeHandlers) {
        handler(err.message);
      }
    });
  }

  async send(message: PeerMessage): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const buf = encodePeerMessage(message);
    return new Promise((resolve, reject) => {
      this.ws.send(buf, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  onMessage(handler: (message: PeerMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandlers.push(handler);
  }
}

export class DirectWsTransport implements Transport {
  readonly name = 'direct-ws';
  readonly localPeerId: string;
  readonly teamKey: string;

  private wss: WebSocketServer | null = null;
  private connectionHandlers: Array<(conn: TransportConnection) => void> = [];
  private activeConnections: Set<DirectWsConnection> = new Set();

  constructor(localPeerId: string, teamKey: string) {
    this.localPeerId = localPeerId;
    this.teamKey = teamKey;
  }

  async start(config: TransportConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          host: config.bindAddress || '127.0.0.1',
          port: config.port || 0
        });

        this.wss.on('listening', () => {
          resolve();
        });

        this.wss.on('error', (err) => {
          reject(err);
        });

        this.wss.on('connection', (ws, req) => {
          const remoteAddr = req.socket.remoteAddress;
          const conn = new DirectWsConnection(`peer-${Math.random().toString(36).substring(2, 9)}`, ws, remoteAddr);
          this.activeConnections.add(conn);

          conn.onClose(() => {
            this.activeConnections.delete(conn);
          });

          for (const handler of this.connectionHandlers) {
            handler(conn);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(): Promise<void> {
    for (const conn of Array.from(this.activeConnections)) {
      await conn.close().catch(() => {});
    }
    this.activeConnections.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
  }

  async connect(target: string): Promise<TransportConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target);

      ws.on('open', () => {
        const conn = new DirectWsConnection(`peer-${Math.random().toString(36).substring(2, 9)}`, ws, target);
        this.activeConnections.add(conn);

        conn.onClose(() => {
          this.activeConnections.delete(conn);
        });

        resolve(conn);
      });

      ws.on('error', (err) => {
        reject(err);
      });
    });
  }

  onConnection(handler: (conn: TransportConnection) => void): void {
    this.connectionHandlers.push(handler);
  }
}
