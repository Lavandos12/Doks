import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  DOC_INDEX,
  parseScopedDocName,
  getScopedDocName,
  isSoloDoc,
  isTeamDoc,
  getScopedIndexDocName,
  getScopedBoardDocName,
  getScopedNoteDocName,
  getIndexMaps,
  getBoardMaps,
  getNoteText,
  nodeMapToData,
  createNodeMap,
  setNodeProperties,
  type WorkspaceScope,
  type BoardSummary,
  type BridgeTransferRequest,
  type BridgeTransferResponse
} from '@doks/shared';
import { StateStore } from './state-store.js';

export interface DocUpdateEvent {
  scope: WorkspaceScope;
  docName: string;
  update: Uint8Array;
  origin: any;
}

export interface ScopeContainer {
  scope: WorkspaceScope;
  stateStore: StateStore;
  docs: Map<string, Y.Doc>;
  awareness: awarenessProtocol.Awareness;
}

export interface DocManagerOptions {
  soloStateStore?: StateStore;
  vaultPath?: string;
  statePath?: string;
}

export class DocManager extends EventEmitter {
  private soloContainer: ScopeContainer;
  private teamContainer: ScopeContainer;
  private autoCompactionTimer?: NodeJS.Timeout;

  constructor(teamStateStore: StateStore, options: DocManagerOptions = {}) {
    super();

    // 1. Team scope container
    const teamIndexDoc = new Y.Doc();
    this.teamContainer = {
      scope: 'team',
      stateStore: teamStateStore,
      docs: new Map<string, Y.Doc>([[DOC_INDEX, teamIndexDoc]]),
      awareness: new awarenessProtocol.Awareness(teamIndexDoc)
    };

    // 2. Solo scope container
    let soloStore = options.soloStateStore;
    if (!soloStore) {
      const baseStateDir = options.statePath || teamStateStore.getStateDir();
      const soloStateDir = path.join(path.dirname(baseStateDir), 'state_solo');
      soloStore = new StateStore(soloStateDir);
    }

    const soloIndexDoc = new Y.Doc();
    this.soloContainer = {
      scope: 'solo',
      stateStore: soloStore,
      docs: new Map<string, Y.Doc>([[DOC_INDEX, soloIndexDoc]]),
      awareness: new awarenessProtocol.Awareness(soloIndexDoc)
    };

    // Wire up index docs
    this.setupDocUpdates('team', DOC_INDEX, teamIndexDoc);
    this.setupDocUpdates('solo', DOC_INDEX, soloIndexDoc);

    // Auto-load existing saved docs for both scopes
    this.loadSavedScopeDocs(this.teamContainer);
    this.loadSavedScopeDocs(this.soloContainer);

    // Auto-compaction every 60s
    this.autoCompactionTimer = setInterval(() => {
      this.compactAll();
    }, 60000);
    if (this.autoCompactionTimer.unref) {
      this.autoCompactionTimer.unref();
    }
  }

  private loadSavedScopeDocs(container: ScopeContainer): void {
    const saved = container.stateStore.listSavedDocs();
    for (const name of saved) {
      if (name !== DOC_INDEX) {
        this.getOrCreateDocInContainer(container, name);
      }
    }
  }

  private setupDocUpdates(scope: WorkspaceScope, entityName: string, doc: Y.Doc): void {
    const container = scope === 'solo' ? this.soloContainer : this.teamContainer;
    container.stateStore.loadDoc(entityName, doc);

    doc.on('update', (update: Uint8Array, origin: any) => {
      container.stateStore.saveUpdate(entityName, update);
      if (container.stateStore.getUpdateCount(entityName) >= 500) {
        container.stateStore.compactDoc(entityName, doc);
      }

      // External docName for event consumers (e.g. "solo:doks-note-123" or "team:doks-note-123")
      const externalDocName = `${scope}:${entityName}`;
      const event: DocUpdateEvent = {
        scope,
        docName: externalDocName,
        update,
        origin
      };
      this.emit('update', event);
    });
  }

  public getScopeContainer(scope: WorkspaceScope): ScopeContainer {
    return scope === 'solo' ? this.soloContainer : this.teamContainer;
  }

  private getOrCreateDocInContainer(container: ScopeContainer, entityName: string): Y.Doc {
    let doc = container.docs.get(entityName);
    if (!doc) {
      doc = new Y.Doc();
      container.docs.set(entityName, doc);
      this.setupDocUpdates(container.scope, entityName, doc);
    }
    return doc;
  }

  /**
   * Resolves or creates a document according to its scope prefix:
   * "solo:doks-note-123" -> solo container
   * "team:doks-note-123" -> team container
   * "doks-note-123"      -> team container (default)
   */
  public getOrCreateDoc(docName: string): Y.Doc {
    const { scope, entityName } = parseScopedDocName(docName);
    const container = this.getScopeContainer(scope);
    return this.getOrCreateDocInContainer(container, entityName);
  }

  public getDoc(docName: string): Y.Doc | undefined {
    const { scope, entityName } = parseScopedDocName(docName);
    const container = this.getScopeContainer(scope);
    return container.docs.get(entityName);
  }

  public getAllDocNames(scope?: WorkspaceScope): string[] {
    if (scope) {
      const container = this.getScopeContainer(scope);
      return Array.from(container.docs.keys()).map((k) => `${scope}:${k}`);
    }
    const teamNames = Array.from(this.teamContainer.docs.keys()).map((k) => `team:${k}`);
    const soloNames = Array.from(this.soloContainer.docs.keys()).map((k) => `solo:${k}`);
    return [...teamNames, ...soloNames];
  }

  public getAllDocs(scope?: WorkspaceScope): Map<string, Y.Doc> {
    if (scope) {
      return this.getScopeContainer(scope).docs;
    }
    const merged = new Map<string, Y.Doc>();
    for (const [k, v] of this.teamContainer.docs.entries()) {
      merged.set(`team:${k}`, v);
    }
    for (const [k, v] of this.soloContainer.docs.entries()) {
      merged.set(`solo:${k}`, v);
    }
    return merged;
  }

  public getAwareness(scope: WorkspaceScope = 'team'): awarenessProtocol.Awareness {
    return this.getScopeContainer(scope).awareness;
  }

  /**
   * Hard network isolation check: throws if any remote peer requests a solo document.
   */
  public assertNotSoloForPeer(docName: string): void {
    if (isSoloDoc(docName)) {
      throw new Error(`Hard network isolation violated: attempt to access solo document "${docName}" across peer transport`);
    }
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
   * Flushes and compacts all documents to disk across both scopes.
   */
  public compactAll(): void {
    this.teamContainer.stateStore.compactAll(this.teamContainer.docs);
    this.soloContainer.stateStore.compactAll(this.soloContainer.docs);
  }

  /**
   * Cross-scope Bridge API: transfers selected nodes, connected notes, and edges
   * between Solo Scope and Team Scope.
   */
  public transferNodes(req: BridgeTransferRequest): BridgeTransferResponse {
    try {
      const sourceScope = req.fromScope;
      const targetScope = req.toScope;

      const sourceBoardDoc = this.getOrCreateDoc(getScopedBoardDocName(sourceScope, req.boardId));
      const targetBoardDoc = this.getOrCreateDoc(getScopedBoardDocName(targetScope, req.targetBoardId));

      const sourceIndexDoc = this.getOrCreateDoc(getScopedIndexDocName(sourceScope));
      const targetIndexDoc = this.getOrCreateDoc(getScopedIndexDocName(targetScope));

      const { nodes: sourceNodes, edges: sourceEdges } = getBoardMaps(sourceBoardDoc);
      const { nodes: targetNodes, edges: targetEdges } = getBoardMaps(targetBoardDoc);

      const sourceIndex = getIndexMaps(sourceIndexDoc);
      const targetIndex = getIndexMaps(targetIndexDoc);

      const targetNodeIds = new Set(req.nodeIds);
      const nodesToTransfer: any[] = [];

      sourceNodes.forEach((nodeMap, id) => {
        if (targetNodeIds.has(id)) {
          nodesToTransfer.push(nodeMapToData(id, nodeMap));
        }
      });

      if (nodesToTransfer.length === 0) {
        return { success: false, transferredNodeCount: 0, transferredNoteCount: 0, error: 'No matching nodes found' };
      }

      // Compute bounding box for offset and frame
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const n of nodesToTransfer) {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + n.w > maxX) maxX = n.x + n.w;
        if (n.y + n.h > maxY) maxY = n.y + n.h;
      }

      // Find non-overlapping placement offset on target board
      let targetMaxX = 0;
      targetNodes.forEach((nodeMap) => {
        const x = nodeMap.get('x') || 0;
        const w = nodeMap.get('w') || 200;
        if (x + w > targetMaxX) targetMaxX = x + w;
      });

      const offsetX = targetMaxX > 0 ? targetMaxX - minX + 100 : 0;
      const offsetY = 0;

      const idMap = new Map<string, string>(); // oldNodeId -> newNodeId
      let transferredNoteCount = 0;
      let frameId: string | undefined;

      targetBoardDoc.transact(() => {
        // Create frame on target board
        frameId = crypto.randomUUID();
        const dateStr = new Date().toLocaleDateString();
        const frameTitle = targetScope === 'team'
          ? `Публикация из Соло (${dateStr})`
          : `Копия из Команды (${dateStr})`;

        const frameMap = createNodeMap({
          id: frameId,
          type: 'frame',
          x: minX + offsetX - 30,
          y: minY + offsetY - 50,
          w: maxX - minX + 60,
          h: maxY - minY + 80,
          text: frameTitle,
          color: '5',
          author: 'Bridge',
          z: 0,
          scope: targetScope,
          deleted: false
        });
        targetNodes.set(frameId, frameMap);

        // Transfer each node
        for (const nodeData of nodesToTransfer) {
          const newNodeId = crypto.randomUUID();
          idMap.set(nodeData.id, newNodeId);

          let transferredNoteId = nodeData.noteId;

          // If linked note transfer requested
          if (req.includeLinkedNotes && nodeData.noteId) {
            const sourceNoteMeta = sourceIndex.notes.get(nodeData.noteId);
            if (sourceNoteMeta && !sourceNoteMeta.deleted) {
              const sourceNoteDoc = this.getOrCreateDoc(getScopedNoteDocName(sourceScope, nodeData.noteId));
              const sourceText = getNoteText(sourceNoteDoc).toString();

              const newNoteId = crypto.randomUUID();
              transferredNoteId = newNoteId;

              // Write to target note doc
              const targetNoteDoc = this.getOrCreateDoc(getScopedNoteDocName(targetScope, newNoteId));
              const targetText = getNoteText(targetNoteDoc);
              targetText.delete(0, targetText.length);
              targetText.insert(0, sourceText);

              // Update target index
              targetIndex.notes.set(newNoteId, {
                ...sourceNoteMeta,
                id: newNoteId,
                scope: targetScope,
                originId: nodeData.noteId,
                promotedAt: Date.now()
              });

              transferredNoteCount++;

              if (req.mode === 'move') {
                sourceIndex.notes.set(nodeData.noteId, {
                  ...sourceNoteMeta,
                  deleted: true,
                  deletedAt: Date.now()
                });
              }
            }
          }

          const newNodeMap = createNodeMap({
            ...nodeData,
            id: newNodeId,
            x: nodeData.x + offsetX,
            y: nodeData.y + offsetY,
            noteId: transferredNoteId,
            scope: targetScope,
            originId: nodeData.id,
            promotedAt: Date.now(),
            promotedBy: 'User'
          });

          targetNodes.set(newNodeId, newNodeMap);

          // If move mode, soft-delete source node
          if (req.mode === 'move') {
            const srcMap = sourceNodes.get(nodeData.id);
            if (srcMap) {
              srcMap.set('deleted', true);
              srcMap.set('deletedAt', Date.now());
            }
          }
        }

        // Transfer internal edges between transferred nodes
        sourceEdges.forEach((edge, edgeId) => {
          if (!edge.deleted && idMap.has(edge.from) && idMap.has(edge.to)) {
            const newEdgeId = crypto.randomUUID();
            targetEdges.set(newEdgeId, {
              ...edge,
              id: newEdgeId,
              from: idMap.get(edge.from)!,
              to: idMap.get(edge.to)!,
              scope: targetScope
            });

            if (req.mode === 'move') {
              sourceEdges.set(edgeId, { ...edge, deleted: true, deletedAt: Date.now() });
            }
          }
        });
      }, 'bridge-transfer');

      return {
        success: true,
        transferredNodeCount: nodesToTransfer.length,
        transferredNoteCount,
        frameId
      };
    } catch (err: any) {
      return {
        success: false,
        transferredNodeCount: 0,
        transferredNoteCount: 0,
        error: err.message
      };
    }
  }

  public listBoards(scope: WorkspaceScope = 'team'): BoardSummary[] {
    const indexDoc = this.getOrCreateDoc(getScopedIndexDocName(scope));
    const { boards } = getIndexMaps(indexDoc);
    const list: BoardSummary[] = [];

    boards.forEach((b, id) => {
      if (!b.deleted) {
        const boardDocName = getScopedBoardDocName(scope, id);
        const boardDoc = this.getOrCreateDoc(boardDocName);
        const { nodes } = getBoardMaps(boardDoc);
        let nodeCount = 0;
        nodes.forEach((n) => {
          if (!n.get('deleted')) nodeCount++;
        });

        list.push({
          id,
          scope,
          title: b.title || 'Untitled Board',
          updatedAt: b.updatedAt || b.createdAt || Date.now(),
          nodeCount
        });
      }
    });

    return list;
  }

  public destroy(): void {
    if (this.autoCompactionTimer) {
      clearInterval(this.autoCompactionTimer);
      this.autoCompactionTimer = undefined;
    }
    this.compactAll();
    this.teamContainer.stateStore.destroy();
    this.soloContainer.stateStore.destroy();
    this.teamContainer.awareness.destroy();
    this.soloContainer.awareness.destroy();

    for (const doc of this.teamContainer.docs.values()) {
      doc.destroy();
    }
    this.teamContainer.docs.clear();

    for (const doc of this.soloContainer.docs.values()) {
      doc.destroy();
    }
    this.soloContainer.docs.clear();
  }
}
