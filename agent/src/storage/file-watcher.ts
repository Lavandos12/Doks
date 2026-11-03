import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import DiffMatchPatch from 'diff-match-patch';
import * as Y from 'yjs';
import {
  DOC_INDEX,
  getIndexMaps,
  getNoteDocName,
  getBoardDocName,
  getScopedIndexDocName,
  getScopedNoteDocName,
  getScopedBoardDocName,
  type WorkspaceScope,
  getBoardMaps,
  jsonCanvasToBoard,
  setNodeProperties,
  type JSONCanvasData
} from '@doks/shared';
import { DocManager } from './doc-manager.js';
import type { FileMirror } from './file-mirror.js';
import { logger } from '../logger.js';

export class FileWatcher {
  private vaultPath: string;
  private docManager: DocManager;
  private fileMirror?: FileMirror;
  private watcher?: FSWatcher;
  private dmp: DiffMatchPatch;
  private pendingChanges = new Map<string, NodeJS.Timeout>();

  constructor(vaultPath: string, docManager: DocManager, fileMirror?: FileMirror) {
    this.vaultPath = vaultPath;
    this.docManager = docManager;
    this.fileMirror = fileMirror;
    this.dmp = new DiffMatchPatch();

    this.startWatching();
  }

  private startWatching(): void {
    this.watcher = chokidar.watch(this.vaultPath, {
      ignoreInitial: true,
      persistent: true,
      ignored: /(^|[\/\\])\../ // ignore dotfiles
    });

    this.watcher.on('add', (filePath) => this.queueFileChange(filePath));
    this.watcher.on('change', (filePath) => this.queueFileChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleFileDelete(filePath));
  }

  private queueFileChange(filePath: string): void {
    const existing = this.pendingChanges.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingChanges.delete(filePath);
      this.handleFileChange(filePath);
    }, 150);
    this.pendingChanges.set(filePath, timer);
  }

  private handleFileChange(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const isAttachment = filePath.includes(path.sep + 'attachments' + path.sep) || filePath.includes('/attachments/');
      if (isAttachment) {
        this.handleAttachmentChange(filePath);
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      // If content was recently written by FileMirror (< 300ms) or hash matches, skip echo!
      if (this.fileMirror?.isRecentlyWritten(filePath, 300) || this.fileMirror?.getLastWrittenHash(filePath) === hash) {
        return;
      }

      if (filePath.endsWith('.md')) {
        this.handleMarkdownChange(filePath, content);
      } else if (filePath.endsWith('.canvas')) {
        this.handleCanvasChange(filePath, content);
      }
    } catch (err) {
      console.error(`[FileWatcher] Error handling change for ${filePath}:`, err);
    }
  }

  private handleAttachmentChange(filePath: string): void {
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return;
      const buffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');

      // 1. Ensure blob is stored in .doks/blobs/<sha256>
      const blobsDir = path.join(path.dirname(this.vaultPath), '.doks', 'blobs');
      fs.mkdirSync(blobsDir, { recursive: true });
      const blobPath = path.join(blobsDir, hash);
      if (!fs.existsSync(blobPath)) {
        fs.writeFileSync(blobPath, buffer);
      }

      // 2. Index in Yjs indexDoc
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.md': 'text/markdown',
        '.canvas': 'application/json',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.zip': 'application/zip',
        '.txt': 'text/plain'
      };
      const mime = mimeMap[ext] || 'application/octet-stream';

      const rel = path.relative(this.vaultPath, filePath);
      const isSolo = rel === 'solo' || rel.startsWith('solo' + path.sep) || rel.startsWith('solo/');
      const scope: WorkspaceScope = isSolo ? 'solo' : 'team';
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { attachments } = getIndexMaps(indexDoc);
      const existing = attachments.get(hash);
      if (!existing || existing.deleted) {
        attachments.set(hash, {
          hash,
          name: fileName,
          size: buffer.length,
          mime,
          addedBy: 'Obsidian / External',
          addedAt: Date.now(),
          deleted: false
        });
      }
    } catch (err) {
      console.error(`[FileWatcher] Error handling external attachment ${filePath}:`, err);
    }
  }

  private handleMarkdownChange(filePath: string, rawContent: string): void {
    const rel = path.relative(this.vaultPath, filePath).replace(/\\/g, '/');
    const isSolo = rel === 'solo' || rel.startsWith('solo/');
    const scope: WorkspaceScope = isSolo ? 'solo' : 'team';

    // Parse YAML frontmatter: exactly one newline after closing ---
    const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    let noteId: string | undefined;
    let markdownBody = rawContent;

    if (frontmatterMatch) {
      const yamlBlock = frontmatterMatch[1];
      markdownBody = frontmatterMatch[2];
      const idMatch = yamlBlock.match(/id:\s*([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        noteId = idMatch[1];
      }
    }

    if (!noteId) {
      // 2.4: Obsidian Vault Markdown Compatibility - generate deterministic stable ID
      noteId = 'note_' + crypto.createHash('sha256').update(rel).digest('hex').slice(0, 16);
      const title = path.basename(filePath, path.extname(filePath));
      const dir = path.dirname(rel);
      const folder = (dir === '.' || dir === 'solo') ? null : dir.replace(/^solo\//, '');
      const frontmatter = `---\nid: ${noteId}\ntitle: ${JSON.stringify(title)}\ncreated: ${Date.now()}\nupdated: ${Date.now()}\n---\n`;
      const bodyOnly = frontmatterMatch ? frontmatterMatch[2] : rawContent;
      const newFileContent = frontmatter + bodyOnly;

      try {
        fs.writeFileSync(filePath, newFileContent, 'utf8');
      } catch (err) {
        console.error(`[FileWatcher] Failed to prepend frontmatter for ${filePath}:`, err);
      }

      // Sync metadata into indexDoc
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const maps = getIndexMaps(indexDoc);
      if (!maps.notes.has(noteId)) {
        indexDoc.transact(() => {
          maps.notes.set(noteId!, {
            id: noteId!,
            title,
            folder,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deleted: false,
            scope
          });
        }, 'fs-watcher');
      }
    }

    const docName = getScopedNoteDocName(scope, noteId);
    const noteDoc = this.docManager.getOrCreateDoc(docName);
    const yText = noteDoc.getText('text');

    const currentText = yText.toString();
    if (currentText === markdownBody) return; // Exact match, no change

    // Calculate diff and apply as granular CRDT operations
    const diffs = this.dmp.diff_main(currentText, markdownBody);
    this.dmp.diff_cleanupSemantic(diffs);

    noteDoc.transact(() => {
      let index = 0;
      for (const [op, text] of diffs) {
        if (op === 0) {
          index += text.length;
        } else if (op === -1) {
          yText.delete(index, text.length);
        } else if (op === 1) {
          yText.insert(index, text);
          index += text.length;
        }
      }
    }, 'fs-watcher');
  }

  private handleCanvasChange(filePath: string, rawContent: string): void {
    try {
      const data: JSONCanvasData = JSON.parse(rawContent);
      const { nodes, edges } = jsonCanvasToBoard(data);

      const rel = path.relative(this.vaultPath, filePath);
      const isSolo = rel === 'solo' || rel.startsWith('solo' + path.sep) || rel.startsWith('solo/');
      const scope: WorkspaceScope = isSolo ? 'solo' : 'team';

      const fileName = path.basename(filePath, '.canvas');
      // Look up boardId from index doc or match by title
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const boardsMap = indexDoc.getMap<any>('boards');

      let boardId: string | undefined;
      boardsMap.forEach((meta, id) => {
        if (!meta.deleted && meta.title === fileName) {
          boardId = id;
        }
      });

      if (!boardId) return;

      const boardDoc = this.docManager.getOrCreateDoc(getScopedBoardDocName(scope, boardId));
      const { nodes: yNodes, edges: yEdges } = getBoardMaps(boardDoc);

      boardDoc.transact(() => {
        // Update nodes
        const externalNodeIds = new Set(nodes.map(n => n.id));
        for (const n of nodes) {
          let nodeMap = yNodes.get(n.id);
          if (!nodeMap) {
            nodeMap = new Y.Map();
            yNodes.set(n.id, nodeMap);
          }
          const targetMap = yNodes.get(n.id);
          if (targetMap) {
            setNodeProperties(targetMap, n);
          }
        }

        // Soft-delete nodes removed in Obsidian
        yNodes.forEach((nodeMap, id) => {
          if (!externalNodeIds.has(id)) {
            nodeMap.set('deleted', true);
            nodeMap.set('deletedAt', Date.now());
          }
        });

        // Update edges
        const externalEdgeIds = new Set(edges.map(e => e.id));
        for (const e of edges) {
          yEdges.set(e.id, e);
        }
        yEdges.forEach((edge, id) => {
          if (!externalEdgeIds.has(id)) {
            yEdges.set(id, { ...edge, deleted: true });
          }
        });
      }, 'fs-watcher');
    } catch (err) {
      console.error(`[FileWatcher] Error syncing canvas from ${filePath}:`, err);
    }
  }

  private handleFileDelete(filePath: string): void {
    try {
      const rel = path.relative(this.vaultPath, filePath);
      const isSolo = rel === 'solo' || rel.startsWith('solo' + path.sep) || rel.startsWith('solo/');
      const scope: WorkspaceScope = isSolo ? 'solo' : 'team';

      // 1. Check registry from FileMirror
      const entity = this.fileMirror?.getEntityByRelativePath(rel);
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { notes, boards } = getIndexMaps(indexDoc);

      if (entity) {
        if (entity.type === 'note') {
          const meta = notes.get(entity.id);
          if (meta && !meta.deleted) {
            notes.set(entity.id, { ...meta, deleted: true, updatedAt: Date.now() });
          }
        } else if (entity.type === 'board') {
          const meta = boards.get(entity.id);
          if (meta && !meta.deleted) {
            boards.set(entity.id, { ...meta, deleted: true, updatedAt: Date.now() });
          }
        }
        return;
      }

      // 2. Fallback: match by title / filename if not found in registry
      const baseName = path.basename(filePath);
      if (filePath.endsWith('.md')) {
        const noteTitle = baseName.replace(/\.md$/, '');
        notes.forEach((meta, id) => {
          if (!meta.deleted && meta.title === noteTitle) {
            notes.set(id, { ...meta, deleted: true, updatedAt: Date.now() });
          }
        });
      } else if (filePath.endsWith('.canvas')) {
        const boardTitle = baseName.replace(/\.canvas$/, '');
        boards.forEach((meta, id) => {
          if (!meta.deleted && meta.title === boardTitle) {
            boards.set(id, { ...meta, deleted: true, updatedAt: Date.now() });
          }
        });
      }
    } catch (err) {
      console.error(`[FileWatcher] Error handling delete for ${filePath}:`, err);
    }
  }

  public async stop(): Promise<void> {
    for (const timer of this.pendingChanges.values()) {
      clearTimeout(timer);
    }
    this.pendingChanges.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }
}
