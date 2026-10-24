import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  type PeerMessage,
  encodeMessage,
  decodeMessage,
  uint8ArrayToBase64,
  base64ToUint8Array,
  DOC_INDEX
} from '@doks/shared';

export class YjsClient {
  private socket?: WebSocket;
  private docs = new Map<string, Y.Doc>();
  private activeSubscriptions = new Set<string>();
  private isConnected = false;
  private reconnectTimer?: number;

  constructor() {
    this.initSocket();
  }

  private initSocket(): void {
    if (typeof window === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || '127.0.0.1:3000';
    const wsUrl = `${protocol}//${host}/ws`;

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.isConnected = true;
      console.log('[YjsClient] Connected to local agent');
      // Resync all active documents
      for (const docName of this.activeSubscriptions) {
        this.requestSync(docName);
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = decodeMessage(event.data);
        if (msg.type === 'sync') {
          const doc = this.getOrCreateDoc(msg.docName);
          const data = base64ToUint8Array(msg.data);
          const decoder = decoding.createDecoder(data);
          const encoder = encoding.createEncoder();

          syncProtocol.readSyncMessage(decoder, encoder, doc, 'agent');

          if (encoding.length(encoder) > 0) {
            this.sendSync(msg.docName, encoding.toUint8Array(encoder));
          }
        }
      } catch (err) {
        console.error('[YjsClient] WS message error:', err);
      }
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // Error triggers onclose
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.initSocket();
    }, 1500);
  }

  public getOrCreateDoc(docName: string): Y.Doc {
    let doc = this.docs.get(docName);
    if (!doc) {
      doc = new Y.Doc();
      this.docs.set(docName, doc);
      this.activeSubscriptions.add(docName);

      doc.on('update', (update: Uint8Array, origin: any) => {
        if (origin !== 'agent') {
          const encoder = encoding.createEncoder();
          syncProtocol.writeUpdate(encoder, update);
          this.sendSync(docName, encoding.toUint8Array(encoder));
        }
      });

      this.requestSync(docName);
    }
    return doc;
  }

  public requestSync(docName: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const doc = this.getOrCreateDoc(docName);
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, doc);
      this.sendSync(docName, encoding.toUint8Array(encoder));
    }
  }

  private sendSync(docName: string, data: Uint8Array): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const msg: PeerMessage = {
        type: 'sync',
        docName,
        data: uint8ArrayToBase64(data)
      };
      this.socket.send(encodeMessage(msg));
    }
  }

  public getIndexDoc(): Y.Doc {
    return this.getOrCreateDoc(DOC_INDEX);
  }
}

export const yjsClient = new YjsClient();
