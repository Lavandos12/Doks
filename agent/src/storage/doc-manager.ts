import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { EventEmitter } from 'node:events';
import { DOC_INDEX } from '@doks/shared';
import { StateStore } from './state-store.js';

export interface DocUpdateEvent {
  docName: string;
  update: Uint8Array;
  origin: any;
}

export class DocManager extends EventEmitter {
  private docs = new Map<string, Y.Doc>();
  private stateStore: StateStore;
  private awareness: awarenessProtocol.Awareness;
  private autoCompactionTimer?: NodeJS.Timeout;

  constructor(stateStore: StateStore) {
    super();
    this.stateStore = stateStore;

    // Load or initialize index doc immediately
    const indexDoc = this.getOrCreateDoc(DOC_INDEX);
    this.awareness = new awarenessProtocol.Awareness(indexDoc);

    // Auto-load all docs that exist in state store
    const savedDocs = this.stateStore.listSavedDocs();
    for (const docName of savedDocs) {
      if (docName !== DOC_INDEX) {
        this.getOrCreateDoc(docName);
      }
    }

    // Auto-compaction every 60s
    this.autoCompactionTimer = setInterval(() => {
      this.compactAll();
    }, 60000);
  }

  public getOrCreateDoc(docName: string): Y.Doc {
    let doc = this.docs.get(docName);
    if (!doc) {
      const createdDoc = new Y.Doc();
      this.docs.set(docName, createdDoc);
      doc = createdDoc;

      // Load state from disk
      this.stateStore.loadDoc(docName, createdDoc);

      // Wire update listener
      createdDoc.on('update', (update: Uint8Array, origin: any) => {
        // Save to binary state store
        this.stateStore.saveUpdate(docName, update);
        if (this.stateStore.getUpdateCount(docName) >= 500) {
          this.stateStore.compactDoc(docName, createdDoc);
        }

        // Emit update event for peer broadcasting and web clients
        const event: DocUpdateEvent = { docName, update, origin };
        this.emit('update', event);
      });
    }
    return doc;
  }

  public getDoc(docName: string): Y.Doc | undefined {
    return this.docs.get(docName);
  }

  public getAllDocNames(): string[] {
    return Array.from(this.docs.keys());
  }

  public getAllDocs(): Map<string, Y.Doc> {
    return this.docs;
  }

  public getAwareness(): awarenessProtocol.Awareness {
    return this.awareness;
  }

  /**
   * Applies an incremental update to a document.
   */
  public applyUpdate(docName: string, update: Uint8Array, origin: any = 'peer'): void {
    const doc = this.getOrCreateDoc(docName);
    Y.applyUpdate(doc, update, origin);
  }

  /**
   * Generates Yjs Sync Step 1 message (local state vector) for a document.
   */
  public createSyncStep1Message(docName: string): Uint8Array {
    const doc = this.getOrCreateDoc(docName);
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    return encoding.toUint8Array(encoder);
  }

  /**
   * Wraps an incremental Yjs update into a standard Yjs sync update message.
   */
  public createUpdateSyncMessage(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  /**
   * Handles incoming Yjs sync message (step 1, step 2, or update).
   * Returns response message if needed (e.g. sync step 2 in response to step 1).
   */
  public handleSyncMessage(
    docName: string,
    message: Uint8Array,
    origin: any = 'peer'
  ): Uint8Array | null {
    const doc = this.getOrCreateDoc(docName);
    const decoder = decoding.createDecoder(message);
    const encoder = encoding.createEncoder();

    syncProtocol.readSyncMessage(decoder, encoder, doc, origin);

    if (encoding.length(encoder) > 0) {
      return encoding.toUint8Array(encoder);
    }
    return null;
  }

  /**
   * Flushes and compacts all documents to disk.
   */
  public compactAll(): void {
    this.stateStore.compactAll(this.docs);
  }

  /**
   * Destroys all documents and awareness.
   */
  public destroy(): void {
    if (this.autoCompactionTimer) {
      clearInterval(this.autoCompactionTimer);
      this.autoCompactionTimer = undefined;
    }
    this.compactAll();
    this.stateStore.destroy();
    this.awareness.destroy();
    for (const doc of this.docs.values()) {
      doc.destroy();
    }
    this.docs.clear();
  }
}
