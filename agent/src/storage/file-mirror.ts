import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DOC_INDEX,
  isNoteDoc,
  isBoardDoc,
  getEntityIdFromDocName,
  getNoteDocName,
  getBoardDocName,
  getIndexMaps,
  getBoardMaps,
  nodeMapToData,
  boardToJSONCanvas,
  type BoardNodeData,
  type BoardEdgeData
} from '@doks/shared';
import { DocManager } from './doc-manager.js';
import { logger } from '../logger.js';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeFileName(name: string): string {
  // Replace Windows illegal characters: < > : " / \ | ? *
  let safe = name.replace(/[<>:"/\\|?*]/g, '_').trim();
  // Strip trailing dots and spaces
  safe = safe.replace(/[. ]+$/, '');
  // Windows reserved device names
  if (WINDOWS_RESERVED.test(safe)) {
    safe = `_${safe}`;
  }
  // Max length
  if (safe.length > 80) {
    safe = safe.slice(0, 80).trim();
  }
  return safe || 'Untitled';
}

interface MirrorRegistry {
  notes: Record<string, string>; // noteId -> relativePath
  boards: Record<string, string>; // boardId -> relativePath
}

export class FileMirror {
  private vaultPath: string;
  private boardsPath: string;
  private mirrorJsonPath: string;
  private docManager: DocManager;
  private debounceMs: number;
  private pendingTimeouts = new Map<string, NodeJS.Timeout>();
  private lastWrittenHashes = new Map<string, string>(); // normalizedFilePath -> sha256
  private registry: MirrorRegistry = { notes: {}, boards: {} };

  constructor(vaultPath: string, docManager: DocManager, debounceMs = 3000) {
    this.vaultPath = vaultPath;
    this.boardsPath = path.join(vaultPath, 'boards');
    const doksDir = path.join(path.dirname(vaultPath), '.doks');
    this.mirrorJsonPath = path.join(doksDir, 'mirror.json');
    const legacyMirrorJson = path.join(path.dirname(vaultPath), '.eluma', 'mirror.json');
    if (!fs.existsSync(this.mirrorJsonPath) && fs.existsSync(legacyMirrorJson)) {
      try {
        fs.cpSync(legacyMirrorJson, this.mirrorJsonPath);
      } catch {}
    }
    this.docManager = docManager;
    this.debounceMs = debounceMs;

    fs.mkdirSync(this.vaultPath, { recursive: true });
    fs.mkdirSync(this.boardsPath, { recursive: true });
    fs.mkdirSync(doksDir, { recursive: true });

    this.loadRegistry();

    // Listen to document updates
    this.docManager.on('update', ({ docName, origin }) => {
      if (origin !== 'external-file') {
        this.scheduleWrite(docName);
      }
    });
  }

  private loadRegistry(): void {
    if (fs.existsSync(this.mirrorJsonPath)) {
      try {
        this.registry = JSON.parse(fs.readFileSync(this.mirrorJsonPath, 'utf8'));
      } catch {
        this.registry = { notes: {}, boards: {} };
      }
    }
  }

  private saveRegistry(): void {
    try {
      fs.writeFileSync(this.mirrorJsonPath, JSON.stringify(this.registry, null, 2), 'utf8');
    } catch (err) {
      console.error('[FileMirror] Failed to save mirror.json:', err);
    }
  }

  public getLastWrittenHash(filePath: string): string | undefined {
    return this.lastWrittenHashes.get(path.normalize(filePath));
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
  private resolveFolderPath(folderId: string | null): { absDir: string; relDir: string } {
    if (!folderId) return { absDir: this.vaultPath, relDir: '' };
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

    const relDir = path.join(...parts);
    return {
      absDir: path.join(this.vaultPath, relDir),
      relDir
    };
  }

  /**
   * Writes content atomically using temp file and rename.
   * Tracks content hash to avoid feedback loops with FileWatcher.
   */
  private atomicWriteFile(targetPath: string, content: string): void {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const normalized = path.normalize(targetPath);
    this.lastWrittenHashes.set(normalized, hash);

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

  private safelyDeleteOldFile(relPath: string | undefined): void {
    if (!relPath) return;
    const absPath = path.join(this.vaultPath, relPath);
    if (fs.existsSync(absPath)) {
      try {
        fs.unlinkSync(absPath);
        // Clean up empty parent folder if not root vault
        const parentDir = path.dirname(absPath);
        if (parentDir !== this.vaultPath && parentDir !== this.boardsPath) {
          const files = fs.readdirSync(parentDir);
          if (files.length === 0) {
            fs.rmdirSync(parentDir);
          }
        }
      } catch {}
    }
  }

  public flushDoc(docName: string): void {
    try {
      if (docName === DOC_INDEX) {
        this.flushAll();
        return;
      }

      const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
      const { notes, boards } = getIndexMaps(indexDoc);

      if (isNoteDoc(docName)) {
        const noteId = getEntityIdFromDocName(docName);
        const meta = notes.get(noteId);
        const oldRelPath = this.registry.notes[noteId];

        if (!meta || meta.deleted) {
          this.safelyDeleteOldFile(oldRelPath);
          delete this.registry.notes[noteId];
          this.saveRegistry();
          return;
        }

        const { absDir, relDir } = this.resolveFolderPath(meta.folder || null);
        let baseFileName = sanitizeFileName(meta.title || noteId);

        // Check for collision with other active notes in the same folder
        let hasCollision = false;
        notes.forEach((otherMeta, otherId) => {
          if (otherId !== noteId && !otherMeta.deleted && (otherMeta.folder || null) === (meta.folder || null)) {
            if (sanitizeFileName(otherMeta.title) === baseFileName) {
              // Collision exists! Check which one gets suffix (the one with larger ID)
              if (noteId > otherId) {
                hasCollision = true;
              }
            }
          }
        });

        if (hasCollision) {
          baseFileName = `${baseFileName}-${noteId.slice(0, 4)}`;
        }

        const fileName = `${baseFileName}.md`;
        const targetAbsPath = path.join(absDir, fileName);
        const newRelPath = path.join(relDir, fileName);

        // If path changed (renamed or moved to another folder), delete old file!
        if (oldRelPath && oldRelPath !== newRelPath) {
          this.safelyDeleteOldFile(oldRelPath);
        }

        const noteDoc = this.docManager.getOrCreateDoc(docName);
        const text = noteDoc.getText('text').toString();

        // Frontmatter: exactly one newline after closing delimiter
        const frontmatter = [
          '---',
          `id: ${noteId}`,
          `title: "${(meta.title || '').replace(/"/g, '\\"')}"`,
          `updatedAt: ${meta.updatedAt || Date.now()}`,
          '---',
          ''
        ].join('\n');

        this.atomicWriteFile(targetAbsPath, frontmatter + text);

        this.registry.notes[noteId] = newRelPath;
        this.saveRegistry();

      } else if (isBoardDoc(docName)) {
        const boardId = getEntityIdFromDocName(docName);
        const meta = boards.get(boardId);
        const oldRelPath = this.registry.boards[boardId];

        if (!meta || meta.deleted) {
          this.safelyDeleteOldFile(oldRelPath);
          delete this.registry.boards[boardId];
          this.saveRegistry();
          return;
        }

        const baseFileName = sanitizeFileName(meta.title || boardId);
        const fileName = `${baseFileName}.canvas`;
        const targetAbsPath = path.join(this.boardsPath, fileName);
        const newRelPath = path.join('boards', fileName);

        if (oldRelPath && oldRelPath !== newRelPath) {
          this.safelyDeleteOldFile(oldRelPath);
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

        this.atomicWriteFile(targetAbsPath, jsonContent);

        this.registry.boards[boardId] = newRelPath;
        this.saveRegistry();
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
      this.flushDoc(getNoteDocName(noteId));
    });

    boards.forEach((_, boardId) => {
      this.flushDoc(getBoardDocName(boardId));
    });
  }

  public destroy(): void {
    this.flushAll();
  }
}
