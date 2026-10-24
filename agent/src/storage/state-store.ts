import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';

export class StateStore {
  private stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  private getDocPath(docName: string): string {
    const safeName = docName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.stateDir, `${safeName}.bin`);
  }

  /**
   * Loads persisted Yjs document updates into the provided doc.
   */
  public loadDoc(docName: string, doc: Y.Doc): boolean {
    const filePath = this.getDocPath(docName);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    try {
      const buffer = fs.readFileSync(filePath);
      if (buffer.length > 0) {
        Y.applyUpdate(doc, new Uint8Array(buffer), 'state-store-load');
        return true;
      }
    } catch (err) {
      console.error(`[StateStore] Failed to load doc ${docName}:`, err);
    }
    return false;
  }

  /**
   * Appends an incremental update to the document's state file, or rewrites atomically.
   */
  public saveUpdate(docName: string, update: Uint8Array): void {
    const filePath = this.getDocPath(docName);
    try {
      // Append update to the binary log
      fs.appendFileSync(filePath, Buffer.from(update));
    } catch (err) {
      console.error(`[StateStore] Failed to save update for ${docName}:`, err);
    }
  }

  /**
   * Performs compaction by saving the entire document state as a single compact update.
   * Uses atomic write (temp file + rename) to survive crashes.
   */
  public compactDoc(docName: string, doc: Y.Doc): void {
    const filePath = this.getDocPath(docName);
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    try {
      const fullUpdate = Y.encodeStateAsUpdate(doc);
      fs.writeFileSync(tempPath, Buffer.from(fullUpdate));
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.error(`[StateStore] Failed to compact doc ${docName}:`, err);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }

  /**
   * Compacts all active docs or files in stateDir.
   */
  public compactAll(docs: Map<string, Y.Doc>): void {
    for (const [docName, doc] of docs.entries()) {
      this.compactDoc(docName, doc);
    }
  }

  /**
   * Lists all document names currently saved in state store.
   */
  public listSavedDocs(): string[] {
    try {
      const files = fs.readdirSync(this.stateDir);
      return files
        .filter(f => f.endsWith('.bin'))
        .map(f => f.slice(0, -4));
    } catch {
      return [];
    }
  }
}
