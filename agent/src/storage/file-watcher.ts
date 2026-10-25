import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import DiffMatchPatch from 'diff-match-patch';
import * as Y from 'yjs';
import {
  DOC_INDEX,
  getNoteDocName,
  getBoardDocName,
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

    this.watcher.on('add', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleFileDelete(filePath));
  }

  private handleFileChange(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      // If content hash matches the last written hash from FileMirror, skip!
      if (this.fileMirror?.getLastWrittenHash(filePath) === hash) {
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

  private handleMarkdownChange(filePath: string, rawContent: string): void {
    // Parse YAML frontmatter: exactly one newline after closing ---
    const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!frontmatterMatch) return;

    const yamlBlock = frontmatterMatch[1];
    const markdownBody = frontmatterMatch[2];

    const idMatch = yamlBlock.match(/id:\s*([a-zA-Z0-9_-]+)/);
    if (!idMatch) return;

    const noteId = idMatch[1];
    const docName = getNoteDocName(noteId);
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
    }, 'external-file');
  }

  private handleCanvasChange(filePath: string, rawContent: string): void {
    try {
      const data: JSONCanvasData = JSON.parse(rawContent);
      const { nodes, edges } = jsonCanvasToBoard(data);

      const fileName = path.basename(filePath, '.canvas');
      // Look up boardId from index doc or match by title
      const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
      const boardsMap = indexDoc.getMap<any>('boards');

      let boardId: string | undefined;
      boardsMap.forEach((meta, id) => {
        if (!meta.deleted && meta.title === fileName) {
          boardId = id;
        }
      });

      if (!boardId) return;

      const boardDoc = this.docManager.getOrCreateDoc(getBoardDocName(boardId));
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
      }, 'external-file');
    } catch (err) {
      console.error(`[FileWatcher] Error syncing canvas from ${filePath}:`, err);
    }
  }

  private handleFileDelete(filePath: string): void {
    // Unlink handled if needed
  }

  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }
}
