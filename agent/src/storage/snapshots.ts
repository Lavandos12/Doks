import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  isBoardDoc,
  isNoteDoc,
  nodeMapToData,
  setNodeProperties,
  type SnapshotMeta
} from '@doks/shared';
import { DocManager } from './doc-manager.js';

export class SnapshotManager {
  private snapshotsDir: string;
  private docManager: DocManager;
  private snapshotInterval?: NodeJS.Timeout;

  constructor(snapshotsDir: string, docManager: DocManager, autoIntervalMs = 600000) {
    this.snapshotsDir = snapshotsDir;
    this.docManager = docManager;

    fs.mkdirSync(this.snapshotsDir, { recursive: true });

    // Clean up trash on startup
    this.cleanupTrash();

    // Start auto-snapshots if interval > 0
    if (autoIntervalMs > 0) {
      this.snapshotInterval = setInterval(() => {
        this.createSnapshot();
      }, autoIntervalMs);
    }
  }

  /**
   * Creates a full state snapshot of all documents in .eluma/snapshots/<timestamp>/
   */
  public createSnapshot(): SnapshotMeta {
    const timestamp = Date.now();
    const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
    const snapId = `${timestamp}_${dateStr}`;
    const snapDir = path.join(this.snapshotsDir, snapId);

    fs.mkdirSync(snapDir, { recursive: true });

    let totalBytes = 0;
    const docs = this.docManager.getAllDocs();

    for (const [docName, doc] of docs.entries()) {
      const update = Y.encodeStateAsUpdate(doc);
      const safeName = docName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(snapDir, `${safeName}.bin`);
      fs.writeFileSync(filePath, Buffer.from(update));
      totalBytes += update.byteLength;
    }

    const meta: SnapshotMeta = {
      id: snapId,
      timestamp,
      dateStr: new Date(timestamp).toLocaleString('ru-RU'),
      docsCount: docs.size,
      sizeBytes: totalBytes
    };

    fs.writeFileSync(
      path.join(snapDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf8'
    );

    this.rotateSnapshots();
    return meta;
  }

  /**
   * Lists all existing snapshots sorted from newest to oldest.
   */
  public listSnapshots(): SnapshotMeta[] {
    try {
      const dirs = fs.readdirSync(this.snapshotsDir);
      const list: SnapshotMeta[] = [];

      for (const dir of dirs) {
        const metaPath = path.join(this.snapshotsDir, dir, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            list.push(meta);
          } catch {}
        }
      }

      return list.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * Restores a document (or all documents) from a snapshot.
   */
  public restoreSnapshot(snapshotId: string, targetDocName?: string): boolean {
    const snapDir = path.join(this.snapshotsDir, snapshotId);
    if (!fs.existsSync(snapDir)) return false;

    try {
      const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.bin'));

      for (const f of files) {
        const docName = f.slice(0, -4);
        if (targetDocName && docName !== targetDocName) {
          continue;
        }

        const filePath = path.join(snapDir, f);
        const buffer = fs.readFileSync(filePath);
        if (buffer.length > 0) {
          const snapDoc = new Y.Doc();
          Y.applyUpdate(snapDoc, new Uint8Array(buffer));

          const currentDoc = this.docManager.getOrCreateDoc(docName);

          if (isNoteDoc(docName)) {
            const currentText = currentDoc.getText('text');
            const snapText = snapDoc.getText('text').toString();
            currentDoc.transact(() => {
              if (currentText.length > 0) {
                currentText.delete(0, currentText.length);
              }
              currentText.insert(0, snapText);
            }, 'restore');
          } else if (isBoardDoc(docName)) {
            const { nodes: currNodes, edges: currEdges } = getBoardMaps(currentDoc);
            const { nodes: snapNodes, edges: snapEdges } = getBoardMaps(snapDoc);

            currentDoc.transact(() => {
              currNodes.clear();
              snapNodes.forEach((nodeMap, id) => {
                const newMap = new Y.Map();
                currNodes.set(id, newMap);
                setNodeProperties(newMap, nodeMapToData(id, nodeMap));
              });

              currEdges.clear();
              snapEdges.forEach((edge, id) => {
                currEdges.set(id, edge);
              });
            }, 'restore');
          } else {
            Y.applyUpdate(currentDoc, new Uint8Array(buffer), 'restore');
          }
        }
      }
      return true;
    } catch (err) {
      console.error(`[SnapshotManager] Failed to restore snapshot ${snapshotId}:`, err);
      return false;
    }
  }

  /**
   * Cleans up objects marked deleted = true older than maxAgeDays (default 30 days).
   */
  public cleanupTrash(maxAgeDays = 30): void {
    const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes, boards, folders } = getIndexMaps(indexDoc);

    indexDoc.transact(() => {
      // Clean up notes
      notes.forEach((meta, id) => {
        if (meta.deleted && meta.deletedAt && meta.deletedAt < cutoffTime) {
          notes.delete(id);
        }
      });

      // Clean up boards
      boards.forEach((meta, id) => {
        if (meta.deleted && meta.deletedAt && meta.deletedAt < cutoffTime) {
          boards.delete(id);
        }
      });

      // Clean up folders
      folders.forEach((meta, id) => {
        if (meta.deleted && meta.deletedAt && meta.deletedAt < cutoffTime) {
          folders.delete(id);
        }
      });
    });

    // Clean up nodes in boards
    for (const docName of this.docManager.getAllDocNames()) {
      if (isBoardDoc(docName)) {
        const boardDoc = this.docManager.getOrCreateDoc(docName);
        const { nodes, edges } = getBoardMaps(boardDoc);

        boardDoc.transact(() => {
          nodes.forEach((nodeMap, id) => {
            const deleted = nodeMap.get('deleted');
            const deletedAt = nodeMap.get('deletedAt');
            if (deleted && deletedAt && deletedAt < cutoffTime) {
              nodes.delete(id);
            }
          });

          edges.forEach((edge, id) => {
            if (edge.deleted && edge.deletedAt && edge.deletedAt < cutoffTime) {
              edges.delete(id);
            }
          });
        });
      }
    }
  }

  /**
   * Snapshot rotation: keeps last 100 snapshots + 1 per day for 30 days.
   */
  public rotateSnapshots(): void {
    const snapshots = this.listSnapshots(); // already sorted descending
    if (snapshots.length <= 100) return;

    const toKeep = new Set<string>();
    const seenDays = new Set<string>();

    // Keep the most recent 100
    for (let i = 0; i < Math.min(100, snapshots.length); i++) {
      toKeep.add(snapshots[i].id);
      const day = new Date(snapshots[i].timestamp).toDateString();
      seenDays.add(day);
    }

    // Keep 1 per day for remaining up to 30 days
    const cutoff30Days = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (let i = 100; i < snapshots.length; i++) {
      const snap = snapshots[i];
      if (snap.timestamp > cutoff30Days) {
        const day = new Date(snap.timestamp).toDateString();
        if (!seenDays.has(day)) {
          seenDays.add(day);
          toKeep.add(snap.id);
        }
      }
    }

    // Delete snapshots not in toKeep
    for (const snap of snapshots) {
      if (!toKeep.has(snap.id)) {
        const snapDir = path.join(this.snapshotsDir, snap.id);
        try {
          fs.rmSync(snapDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }

  public destroy(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = undefined;
    }
  }
}
