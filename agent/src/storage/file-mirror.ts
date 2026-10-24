import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import {
  DOC_INDEX,
  isNoteDoc,
  isBoardDoc,
  getEntityIdFromDocName,
  getIndexMaps,
  getBoardMaps,
  nodeMapToData,
  boardToJSONCanvas,
  type BoardNodeData,
  type BoardEdgeData
} from '@doks/shared';
import { DocManager } from './doc-manager.js';

export function sanitizeFileName(name: string): string {
  // Replace Windows illegal characters: < > : " / \ | ? *
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled';
}

export class FileMirror {
  private vaultPath: string;
  private boardsPath: string;
  private docManager: DocManager;
  private debounceMs: number;
  private pendingTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(vaultPath: string, docManager: DocManager, debounceMs = 3000) {
    this.vaultPath = vaultPath;
    this.boardsPath = path.join(vaultPath, 'boards');
    this.docManager = docManager;
    this.debounceMs = debounceMs;

    fs.mkdirSync(this.vaultPath, { recursive: true });
    fs.mkdirSync(this.boardsPath, { recursive: true });

    // Listen to all document updates
    this.docManager.on('update', ({ docName, origin }) => {
      // Do not mirror back updates coming from external file watcher
      if (origin !== 'external-file') {
        this.scheduleWrite(docName);
      }
    });
  }

  public scheduleWrite(docName: string): void {
    const existing = this.pendingTimeouts.get(docName);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingTimeouts.delete(docName);
      this.flushDoc(docName);
    }, this.debounceMs);

    this.pendingTimeouts.set(docName, timer);
  }

  /**
   * Resolves folder path relative to vault root.
   */
  private resolveFolderPath(folderId: string | null): string {
    if (!folderId) return this.vaultPath;
    const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
    const { folders } = getIndexMaps(indexDoc);

    const parts: string[] = [];
    let currId: string | null = folderId;
    const visited = new Set<string>();

    while (currId && !visited.has(currId)) {
      visited.add(currId);
      const f = folders.get(currId);
      if (f && !f.deleted) {
        parts.unshift(sanitizeFileName(f.name));
        currId = f.parent;
      } else {
        break;
      }
    }

    return path.join(this.vaultPath, ...parts);
  }

  /**
   * Writes data to disk atomically using temp file and rename.
   */
  private atomicWriteFile(targetPath: string, content: string): void {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      console.error(`[FileMirror] Failed to write atomically to ${targetPath}:`, err);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }

  public flushDoc(docName: string): void {
    try {
      if (docName === DOC_INDEX) {
        // Sync index structure
        this.flushAll();
        return;
      }

      const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
      const { notes, boards } = getIndexMaps(indexDoc);

      if (isNoteDoc(docName)) {
        const noteId = getEntityIdFromDocName(docName);
        const meta = notes.get(noteId);
        const folderDir = this.resolveFolderPath(meta?.folder || null);
        const fileName = `${sanitizeFileName(meta?.title || noteId)}.md`;
        const filePath = path.join(folderDir, fileName);

        if (!meta || meta.deleted) {
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
          }
          return;
        }

        const noteDoc = this.docManager.getOrCreateDoc(docName);
        const text = noteDoc.getText('text').toString();

        const frontmatter = [
          '---',
          `id: ${noteId}`,
          `title: "${(meta.title || '').replace(/"/g, '\\"')}"`,
          `updatedAt: ${meta.updatedAt || Date.now()}`,
          '---',
          '',
          ''
        ].join('\n');

        this.atomicWriteFile(filePath, frontmatter + text);
      } else if (isBoardDoc(docName)) {
        const boardId = getEntityIdFromDocName(docName);
        const meta = boards.get(boardId);
        const fileName = `${sanitizeFileName(meta?.title || boardId)}.canvas`;
        const filePath = path.join(this.boardsPath, fileName);

        if (!meta || meta.deleted) {
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
          }
          return;
        }

        const boardDoc = this.docManager.getOrCreateDoc(docName);
        const { nodes: yNodes, edges: yEdges } = getBoardMaps(boardDoc);

        const nodes: BoardNodeData[] = [];
        yNodes.forEach((nodeMap, id) => {
          nodes.push(nodeMapToData(id, nodeMap));
        });

        const edges: BoardEdgeData[] = [];
        yEdges.forEach((edge) => {
          edges.push(edge);
        });

        const canvasData = boardToJSONCanvas(nodes, edges);
        const jsonContent = JSON.stringify(canvasData, null, 2);

        this.atomicWriteFile(filePath, jsonContent);
      }
    } catch (err) {
      console.error(`[FileMirror] Error flushing doc ${docName}:`, err);
    }
  }

  public flushAll(): void {
    for (const [docName, timer] of this.pendingTimeouts.entries()) {
      clearTimeout(timer);
      this.pendingTimeouts.delete(docName);
      this.flushDoc(docName);
    }

    const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes, boards } = getIndexMaps(indexDoc);

    notes.forEach((_, noteId) => {
      this.flushDoc(`eluma-note-${noteId}`);
    });

    boards.forEach((_, boardId) => {
      this.flushDoc(`eluma-board-${boardId}`);
    });
  }

  public destroy(): void {
    this.flushAll();
  }
}
