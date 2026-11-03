import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';

export class StateStore {
  private stateDir: string;
  private updateCounts = new Map<string, number>();
  private compactionTimer?: NodeJS.Timeout;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    fs.mkdirSync(this.stateDir, { recursive: true });

    // Clean up any stale .tmp files from previous crashes
    this.cleanupTempFiles();
  }

  public getStateDir(): string {
    return this.stateDir;
  }

  private cleanupTempFiles(): void {
    try {
      const files = fs.readdirSync(this.stateDir);
      for (const f of files) {
        if (f.includes('.tmp.')) {
          try { fs.unlinkSync(path.join(this.stateDir, f)); } catch {}
        }
      }
    } catch {}
  }

  private encodeDocName(docName: string): string {
    return docName.replace(/[^a-zA-Z0-9_-]/g, (c) => '+' + Buffer.from(c, 'utf8').toString('hex'));
  }

  private decodeDocName(safeName: string): string {
    return safeName.replace(/\+([0-9a-fA-F]{2})/g, (_, hex) => Buffer.from(hex, 'hex').toString('utf8'));
  }

  private getDocPath(docName: string): string {
    const safeName = this.encodeDocName(docName);
    const primaryPath = path.join(this.stateDir, `${safeName}.bin`);
    if (!fs.existsSync(primaryPath)) {
      // Backward compatibility check for legacy underscored file names
      const legacyName = docName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const legacyPath = path.join(this.stateDir, `${legacyName}.bin`);
      if (fs.existsSync(legacyPath)) {
        return legacyPath;
      }
    }
    return primaryPath;
  }

  /**
   * Loads persisted Yjs document updates using length-prefixed WAL records.
   * Tolerates truncated trailing writes from crashes.
   */
  public loadDoc(docName: string, doc: Y.Doc): boolean {
    const filePath = this.getDocPath(docName);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    try {
      const buffer = fs.readFileSync(filePath);
      if (buffer.length === 0) return false;

      let offset = 0;
      let applied = 0;

      while (offset + 4 <= buffer.length) {
        const len = buffer.readUInt32BE(offset);
        if (len === 0 || offset + 4 + len > buffer.length) {
          // Incomplete write (power failure or crash mid-write), stop safely at last complete record
          break;
        }

        const chunk = buffer.subarray(offset + 4, offset + 4 + len);
        try {
          Y.applyUpdate(doc, new Uint8Array(chunk), 'state-store-load');
          applied++;
        } catch (err) {
          console.error(`[StateStore] Error applying chunk at offset ${offset} for ${docName}:`, err);
          break;
        }

        offset += 4 + len;
      }

      // Backward compatibility: if no length-prefixed records were decoded, try legacy raw buffer
      if (applied === 0 && buffer.length > 0) {
        try {
          Y.applyUpdate(doc, new Uint8Array(buffer), 'state-store-load');
          applied = 1;
        } catch {}
      }

      return applied > 0;
    } catch (err) {
      console.error(`[StateStore] Failed to load doc ${docName}:`, err);
    }
    return false;
  }

  /**
   * Appends an incremental update as a framed WAL record [uint32be length][data].
   */
  public saveUpdate(docName: string, update: Uint8Array): void {
    const filePath = this.getDocPath(docName);
    try {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(update.byteLength, 0);
      const record = Buffer.concat([header, Buffer.from(update)]);
      fs.appendFileSync(filePath, record);

      const count = (this.updateCounts.get(docName) || 0) + 1;
      this.updateCounts.set(docName, count);
    } catch (err) {
      console.error(`[StateStore] Failed to save update for ${docName}:`, err);
    }
  }

  /**
   * Performs compaction by saving the entire document state as a single compact update
   * using atomic rename to survive crashes.
   */
  public compactDoc(docName: string, doc: Y.Doc): void {
    const filePath = this.getDocPath(docName);
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    try {
      const fullUpdate = Y.encodeStateAsUpdate(doc);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(fullUpdate.byteLength, 0);
      const record = Buffer.concat([header, Buffer.from(fullUpdate)]);

      fs.writeFileSync(tempPath, record);
      fs.renameSync(tempPath, filePath);
      this.updateCounts.set(docName, 0);
    } catch (err) {
      console.error(`[StateStore] Failed to compact doc ${docName}:`, err);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }

  public getUpdateCount(docName: string): number {
    return this.updateCounts.get(docName) || 0;
  }

  /**
   * Compacts all active docs.
   */
  public compactAll(docs: Map<string, Y.Doc>): void {
    for (const [docName, doc] of docs.entries()) {
      this.compactDoc(docName, doc);
    }
  }

  public listSavedDocs(): string[] {
    try {
      const files = fs.readdirSync(this.stateDir);
      return files
        .filter(f => f.endsWith('.bin'))
        .map(f => this.decodeDocName(f.slice(0, -4)));
    } catch {
      return [];
    }
  }

  public destroy(): void {
    if (this.compactionTimer) {
      clearInterval(this.compactionTimer);
      this.compactionTimer = undefined;
    }
  }
}
