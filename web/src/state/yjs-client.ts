import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { signal } from '@preact/signals';
import {
  type PeerMessage,
  encodeMessage,
  decodeMessage,
  uint8ArrayToBase64,
  base64ToUint8Array,
  DOC_INDEX,
  type WorkspaceScope,
  getScopedIndexDocName
} from '@doks/shared';
import { api, type AgentStatusResponse } from '../api/client.js';
import { loadDocFromIndexedDb, saveDocToIndexedDb } from './indexeddb-cache.js';

export type AgentStatusInfo = AgentStatusResponse;

export const connectionState = signal<'connected' | 'connecting' | 'disconnected'>('connecting');
export const agentStatus = signal<AgentStatusInfo | null>(null);

export class YjsClient {
  private socket?: WebSocket;
  private docs = new Map<string, Y.Doc>();
  private awarenessMap = new Map<string, awarenessProtocol.Awareness>();
  private activeSubscriptions = new Set<string>([DOC_INDEX]);
  private isConnected = false;
  private reconnectTimer?: number;
  private statusPollTimer?: number;
  private pingInterval?: number;
  private currentScope: WorkspaceScope = 'team';

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('doks_scope') as WorkspaceScope;
      if (saved === 'solo' || saved === 'team') {
        this.currentScope = saved;
      }
    }
    this.initSocket();
    this.startStatusPolling();
  }

  private startStatusPolling(): void {
    if (typeof window === 'undefined') return;
    const fetchStatus = async () => {
      try {
        const data = await api.getStatus();
        agentStatus.value = data;
      } catch {}
    };
    fetchStatus();
    this.statusPollTimer = window.setInterval(fetchStatus, 4000);
  }

  public switchScope(newScope: WorkspaceScope): void {
    if (this.currentScope === newScope) return;
    this.currentScope = newScope;
    // Zero-reconnect dual-scope: keep socket open and ensure the new scope's index is subscribed
    const indexDocName = getScopedIndexDocName(newScope);
    this.subscribeDoc(indexDocName);
  }

  public reconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
    }
    this.initSocket();
  }

  private async initSocket(): Promise<void> {
    if (typeof window === 'undefined') return;
    connectionState.value = 'connecting';

    try {
      await api.ensureAuthenticated();
      const wsUrl = api.getWsUrl(this.currentScope);

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.isConnected = true;
        connectionState.value = 'connected';
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = window.setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);

        for (const docName of this.activeSubscriptions) {
          this.subscribeDoc(docName);
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
          } else if (msg.type === 'awareness') {
            const awareness = this.getOrCreateAwareness(msg.docName);
            const data = base64ToUint8Array(msg.data);
            awarenessProtocol.applyAwarenessUpdate(awareness, data, 'agent');
          }
        } catch (err) {
          console.error('[YjsClient] WS message error:', err);
        }
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        connectionState.value = 'disconnected';
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = undefined;
        }
        this.scheduleReconnect();
      };

      this.socket.onerror = () => {
        // Error triggers onclose
      };
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.initSocket();
    }, 1500);
  }

  public registerDoc(docName: string, doc: Y.Doc): void {
    if (!this.docs.has(docName)) {
      this.docs.set(docName, doc);
    }
  }

    public getDoc(docName: string): Y.Doc | undefined {
    return this.docs.get(docName);
  }

  public getOrCreateDoc(docName: string): Y.Doc {
    let doc = this.docs.get(docName);
    if (!doc) {
      doc = new Y.Doc();
      this.docs.set(docName, doc);
      this.activeSubscriptions.add(docName);

      // Hydrate immediately from browser storage
      loadDocFromIndexedDb(docName, doc);

      // Save on updates with debounce
      let saveTimeout: any = null;
      doc.on('update', (update: Uint8Array, origin: any) => {
        if (origin !== 'indexeddb') {
          clearTimeout(saveTimeout);
          saveTimeout = setTimeout(() => {
            saveDocToIndexedDb(docName, doc!);
          }, 500);
        }
        if (origin !== 'agent') {
          const encoder = encoding.createEncoder();
          syncProtocol.writeUpdate(encoder, update);
          this.sendSync(docName, encoding.toUint8Array(encoder));
        }
      });

      this.subscribeDoc(docName);
    }
    return doc;
  }

  public getOrCreateAwareness(docName: string): awarenessProtocol.Awareness {
    let aw = this.awarenessMap.get(docName);
    if (!aw) {
      const doc = this.getOrCreateDoc(docName);
      aw = new awarenessProtocol.Awareness(doc);
      this.awarenessMap.set(docName, aw);

      aw.on('update', ({ added, updated, removed }: any, origin: any) => {
        if (origin !== 'agent') {
          const changedClients = added.concat(updated).concat(removed);
          const update = awarenessProtocol.encodeAwarenessUpdate(aw!, changedClients);
          this.sendAwareness(docName, update);
        }
      });
    }
    return aw;
  }

  public subscribeDoc(docName: string): void {
    this.activeSubscriptions.add(docName);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeMessage({ type: 'subscribe', docName }));
      const doc = this.getOrCreateDoc(docName);
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, doc);
      this.sendSync(docName, encoding.toUint8Array(encoder));
    }
  }

  public unsubscribeDoc(docName: string): void {
    if (docName === DOC_INDEX) return; // Keep index subscribed
    this.activeSubscriptions.delete(docName);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeMessage({ type: 'unsubscribe', docName }));
    }
  }

  public requestSync(docName: string): void {
    this.subscribeDoc(docName);
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

  private sendAwareness(docName: string, data: Uint8Array): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const msg: PeerMessage = {
        type: 'awareness',
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
