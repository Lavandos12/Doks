import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import DiffMatchPatch from 'diff-match-patch';
import { getNoteDocName } from '@doks/shared';
import { DocManager } from './doc-manager.js';

export class FileWatcher {
  private vaultPath: string;
  private docManager: DocManager;
  private watcher?: FSWatcher;
  private dmp: DiffMatchPatch;
  private isIgnored = new Set<string>();

  constructor(vaultPath: string, docManager: DocManager) {
    this.vaultPath = vaultPath;
    this.docManager = docManager;
    this.dmp = new DiffMatchPatch();

    this.startWatching();
  }

  private startWatching(): void {
    this.watcher = chokidar.watch(this.vaultPath, {
      ignoreInitial: true,
      persistent: true,
      ignored: /(^|[\/\\])\../ // ignore dotfiles
    });

    this.watcher.on('change', (filePath) => {
      this.handleFileChange(filePath);
    });
  }

  public ignoreNextChange(filePath: string): void {
    this.isIgnored.add(path.normalize(filePath));
    setTimeout(() => {
      this.isIgnored.delete(path.normalize(filePath));
    }, 1000);
  }

  private handleFileChange(filePath: string): void {
    const normalized = path.normalize(filePath);
    if (this.isIgnored.has(normalized)) {
      this.isIgnored.delete(normalized);
      return;
    }

    if (filePath.endsWith('.md')) {
      this.handleMarkdownChange(filePath);
    }
  }

  private handleMarkdownChange(filePath: string): void {
    try {
      const rawContent = fs.readFileSync(filePath, 'utf8');

      // Parse YAML frontmatter: --- id: ... ---
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
      if (currentText === markdownBody) return; // No change

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
    } catch (err) {
      console.error(`[FileWatcher] Error handling change for ${filePath}:`, err);
    }
  }

  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }
}
