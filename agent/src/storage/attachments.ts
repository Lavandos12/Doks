import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  extractTextFromDocx,
  extractTextFromXlsx,
  extractTextFromPptx,
  extractTextFromOdf,
  extractTextFromRtf,
  extractMatrixFromCsv
} from './office-extractor.js';
import { extractTextFromPdfBuffer } from './pdf-extractor.js';

export interface AttachmentInfo {
  hash: string;
  fileName: string;
  size: number;
  filePath: string;
  mimeType: string;
  humanReadableName?: string;
  extractedText?: string;
}

export interface AttachmentMetadataRecord {
  id: string; // sha256
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  fileName: string;
  humanReadableName: string;
  extractedText?: string;
}

const MIME_TYPES: Record<string, string> = {
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
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.rtf': 'application/rtf',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
};

export class AttachmentManager {
  private attachmentsDir: string;
  private blobsDir: string;
  private metadataPath: string;
  private metadata = new Map<string, AttachmentMetadataRecord>();
  private incomingChunks = new Map<string, { totalChunks: number; chunks: Map<number, Buffer>; originalName: string; lastActivity: number }>();

  constructor(vaultPath: string, blobsDir?: string) {
    this.attachmentsDir = path.join(vaultPath, 'attachments');
    this.blobsDir = blobsDir || path.join(path.dirname(vaultPath), '.doks', 'blobs');
    this.metadataPath = path.join(path.dirname(this.blobsDir), 'attachments-meta.json');

    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    fs.mkdirSync(this.blobsDir, { recursive: true });

    this.loadMetadata();
  }

  private loadMetadata(): void {
    if (fs.existsSync(this.metadataPath)) {
      try {
        const raw = fs.readFileSync(this.metadataPath, 'utf8');
        const list: AttachmentMetadataRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.metadata.set(item.id, item);
        }
      } catch {}
    }
  }

  private saveMetadata(): void {
    try {
      const list = Array.from(this.metadata.values());
      fs.writeFileSync(this.metadataPath, JSON.stringify(list, null, 2), 'utf8');
    } catch {}
  }

  public getAttachmentsDir(): string {
    return this.attachmentsDir;
  }

  public getBlobsDir(): string {
    return this.blobsDir;
  }

  public getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Sanitizes a filename for Windows/cross-platform filesystem rules.
   */
  public sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'attachment';
  }

  /**
   * Saves buffer into .doks/blobs/<sha256> (source of truth)
   * and mirrors into vault/attachments/<name> and <name>-<short-hash8>.<ext>.
   */
  public saveAttachment(buffer: Buffer, originalName = 'attachment.bin'): AttachmentInfo {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const shortHash = hash.slice(0, 8);

    // 1. Source of truth: .doks/blobs/<sha256> (without extension)
    const blobPath = path.join(this.blobsDir, hash);
    if (!fs.existsSync(blobPath)) {
      fs.writeFileSync(blobPath, buffer);
    }

    // 2. Readable mirror: vault/attachments/<sanitized originalName>
    const cleanName = this.sanitizeFileName(originalName);
    const ext = path.extname(cleanName);
    const base = path.basename(cleanName, ext);

    let candidateName = cleanName;
    let counter = 1;

    while (fs.existsSync(path.join(this.attachmentsDir, candidateName))) {
      try {
        const existingBuf = fs.readFileSync(path.join(this.attachmentsDir, candidateName));
        const existingHash = crypto.createHash('sha256').update(existingBuf).digest('hex');
        if (existingHash === hash) {
          // Exactly the same file already mirrored
          break;
        }
      } catch {}
      counter++;
      candidateName = `${base} (${counter})${ext}`;
    }

    const mirrorPath = path.join(this.attachmentsDir, candidateName);
    if (!fs.existsSync(mirrorPath)) {
      fs.writeFileSync(mirrorPath, buffer);
    }

    // 3. Human-readable hash-tagged mirror for collision-free Obsidian links: <base>-<hash8><ext>
    const humanReadableName = `${base}-${shortHash}${ext}`;
    const hashMirrorPath = path.join(this.attachmentsDir, humanReadableName);
    if (!fs.existsSync(hashMirrorPath)) {
      try {
        fs.writeFileSync(hashMirrorPath, buffer);
      } catch {}
    }

    // 3.5 Extract text for Office, LibreOffice, PDF, and text/code files
    let extractedText: string | undefined = undefined;
    const lowerName = candidateName.toLowerCase();
    if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
      extractedText = extractTextFromDocx(buffer);
    } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      extractedText = extractTextFromXlsx(buffer);
    } else if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
      extractedText = extractMatrixFromCsv(buffer);
    } else if (lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt')) {
      extractedText = extractTextFromPptx(buffer);
    } else if (lowerName.endsWith('.odt') || lowerName.endsWith('.ods') || lowerName.endsWith('.odp')) {
      extractedText = extractTextFromOdf(buffer);
    } else if (lowerName.endsWith('.rtf')) {
      extractedText = extractTextFromRtf(buffer);
    } else if (lowerName.endsWith('.pdf')) {
      extractedText = extractTextFromPdfBuffer(buffer);
    } else if (
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.json') ||
      lowerName.endsWith('.xml') ||
      lowerName.endsWith('.yaml') ||
      lowerName.endsWith('.yml') ||
      lowerName.endsWith('.js') ||
      lowerName.endsWith('.ts') ||
      lowerName.endsWith('.py') ||
      lowerName.endsWith('.html') ||
      lowerName.endsWith('.css') ||
      lowerName.endsWith('.sh') ||
      lowerName.endsWith('.bat')
    ) {
      try {
        extractedText = buffer.toString('utf8');
      } catch {}
    }

    // 4. Save metadata record
    const metaRecord: AttachmentMetadataRecord = {
      id: hash,
      originalName,
      mimeType: this.getMimeType(candidateName),
      size: buffer.length,
      createdAt: Date.now(),
      fileName: candidateName,
      humanReadableName,
      extractedText
    };
    this.metadata.set(hash, metaRecord);
    this.saveMetadata();

    return {
      hash,
      fileName: candidateName,
      humanReadableName,
      size: buffer.length,
      filePath: blobPath,
      mimeType: metaRecord.mimeType,
      extractedText
    };
  }

  public updateExtractedText(hash: string, text: string): void {
    const record = this.metadata.get(hash);
    if (record) {
      record.extractedText = text;
      this.saveMetadata();
    }
  }

  /**
   * Resolves attachment by SHA-256 hash or filename.
   */
  public getAttachment(hashOrName: string): AttachmentInfo | null {
    if (!hashOrName || typeof hashOrName !== 'string') return null;

    // 1.4 Path Traversal Containment Check
    const resolvedBlobsDir = path.resolve(this.blobsDir);
    const resolvedCandidate = path.resolve(this.blobsDir, hashOrName);
    if (!resolvedCandidate.startsWith(resolvedBlobsDir + path.sep) && resolvedCandidate !== resolvedBlobsDir) {
      return null;
    }

    // 0. Check metadata map first
    const record = this.metadata.get(hashOrName);
    if (record) {
      const blobPath = path.join(this.blobsDir, record.id);
      if (fs.existsSync(blobPath)) {
        return {
          hash: record.id,
          fileName: record.fileName,
          humanReadableName: record.humanReadableName,
          size: record.size,
          filePath: blobPath,
          mimeType: record.mimeType,
          extractedText: record.extractedText
        };
      }
    }

    // 1. Check primary blob store (.doks/blobs/<sha256>)
    const directBlob = path.join(this.blobsDir, hashOrName);
    if (fs.existsSync(directBlob) && !fs.statSync(directBlob).isDirectory()) {
      const stat = fs.statSync(directBlob);
      let foundName = hashOrName;
      for (const rec of this.metadata.values()) {
        if (rec.id === hashOrName || rec.fileName === hashOrName || rec.humanReadableName === hashOrName) {
          foundName = rec.fileName;
          break;
        }
      }
      return {
        hash: hashOrName,
        fileName: foundName,
        size: stat.size,
        filePath: directBlob,
        mimeType: this.getMimeType(foundName)
      };
    }

    // 2. Check mirror directory (vault/attachments/)
    if (fs.existsSync(this.attachmentsDir)) {
      const resolvedAttDir = path.resolve(this.attachmentsDir);
      const safeMirrorPath = path.resolve(this.attachmentsDir, hashOrName);
      if (safeMirrorPath.startsWith(resolvedAttDir + path.sep) && fs.existsSync(safeMirrorPath) && !fs.statSync(safeMirrorPath).isDirectory()) {
        const stat = fs.statSync(safeMirrorPath);
        let foundHash = hashOrName;
        for (const rec of this.metadata.values()) {
          if (rec.fileName === hashOrName || rec.humanReadableName === hashOrName) {
            foundHash = rec.id;
            break;
          }
        }
        return {
          hash: foundHash,
          fileName: path.basename(safeMirrorPath),
          size: stat.size,
          filePath: safeMirrorPath,
          mimeType: this.getMimeType(safeMirrorPath)
        };
      }
    }

    return null;
  }

  public getMetadataRecord(hash: string): AttachmentMetadataRecord | undefined {
    return this.metadata.get(hash);
  }

  /**
   * Splits attachment into 256 KB chunks for P2P mesh sync.
   */
  public getChunk(hash: string, chunkIndex: number, chunkSize = 256 * 1024): { data: Buffer; totalChunks: number } | null {
    const att = this.getAttachment(hash);
    if (!att || !fs.existsSync(att.filePath)) return null;

    const fd = fs.openSync(att.filePath, 'r');
    const totalChunks = Math.ceil(att.size / chunkSize) || 1;
    const buffer = Buffer.alloc(chunkSize);
    const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, chunkIndex * chunkSize);
    fs.closeSync(fd);

    return {
      data: buffer.subarray(0, bytesRead),
      totalChunks
    };
  }

  /**
   * Receives a chunk and reconstructs the file when all chunks arrive.
   */
  public receiveChunk(
    hash: string,
    chunkIndex: number,
    totalChunks: number,
    chunkData: Buffer,
    originalName = 'attachment.bin'
  ): AttachmentInfo | null {
    // Validate inputs to prevent memory abuse
    if (totalChunks <= 0 || totalChunks > 500) {
      return null;
    }
    if (chunkIndex < 0 || chunkIndex >= totalChunks) {
      return null;
    }
    if (!chunkData || chunkData.length > 512 * 1024) {
      return null;
    }

    const now = Date.now();
    // Prune stale transfers older than 60s
    for (const [key, item] of this.incomingChunks.entries()) {
      if (now - item.lastActivity > 60_000) {
        this.incomingChunks.delete(key);
      }
    }

    let entry = this.incomingChunks.get(hash);
    if (!entry) {
      if (this.incomingChunks.size >= 20) {
        return null;
      }
      entry = { totalChunks, chunks: new Map(), originalName, lastActivity: now };
      this.incomingChunks.set(hash, entry);
    } else {
      entry.lastActivity = now;
      if (entry.totalChunks !== totalChunks) {
        return null;
      }
    }

    entry.chunks.set(chunkIndex, chunkData);

    if (entry.chunks.size === totalChunks) {
      const parts: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const p = entry.chunks.get(i);
        if (p) parts.push(p);
      }
      const fullBuffer = Buffer.concat(parts);
      const computedHash = crypto.createHash('sha256').update(fullBuffer).digest('hex');

      this.incomingChunks.delete(hash);

      if (computedHash === hash) {
        return this.saveAttachment(fullBuffer, entry.originalName);
      } else {
        console.error(`[AttachmentManager] SHA-256 mismatch for ${hash}, computed: ${computedHash}`);
        return null;
      }
    }

    return null;
  }
}
