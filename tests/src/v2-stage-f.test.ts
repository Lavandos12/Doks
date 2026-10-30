import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  csvToMarkdown,
  htmlToMarkdown,
  docxXmlToMarkdown,
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteText,
  getNoteDocName,
  getBoardDocName
} from '@doks/shared';
import { AttachmentManager } from '@doks/agent';
import { Agent } from '@doks/agent';

describe('Stage F: Attachments, Chunked P2P Sync & Import/Export Wizard', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-stage-f-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    } catch {}
  });

  describe('AttachmentManager Unit Tests', () => {
    it('saves files with SHA-256 hash and determines mime types', () => {
      const manager = new AttachmentManager(tempDir);
      const content = Buffer.from('Hello Doks Attachment Content');
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      const info = manager.saveAttachment(content, 'test-image.png');
      expect(info.hash).toBe(expectedHash);
      expect(info.fileName).toBe('test-image.png');
      expect(info.size).toBe(content.length);
      expect(info.mimeType).toBe('image/png');

      const retrieved = manager.getAttachment(expectedHash);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.hash).toBe(expectedHash);
      expect(retrieved?.size).toBe(content.length);
    });

    it('splits large files into 256KB chunks and reassembles with verification', () => {
      const managerSender = new AttachmentManager(path.join(tempDir, 'sender'));
      const managerReceiver = new AttachmentManager(path.join(tempDir, 'receiver'));

      // Create a 600 KB buffer
      const largeBuffer = Buffer.alloc(600 * 1024, 0x42);
      const hash = crypto.createHash('sha256').update(largeBuffer).digest('hex');
      managerSender.saveAttachment(largeBuffer, 'large-doc.pdf');

      const chunkSize = 256 * 1024;
      const expectedTotalChunks = Math.ceil(largeBuffer.length / chunkSize); // 3 chunks
      expect(expectedTotalChunks).toBe(3);

      let assembledInfo: any = null;
      for (let i = 0; i < expectedTotalChunks; i++) {
        const chunk = managerSender.getChunk(hash, i, chunkSize);
        expect(chunk).not.toBeNull();
        expect(chunk?.totalChunks).toBe(expectedTotalChunks);

        const res = managerReceiver.receiveChunk(hash, i, expectedTotalChunks, chunk!.data, '.pdf');
        if (i < expectedTotalChunks - 1) {
          expect(res).toBeNull();
        } else {
          assembledInfo = res;
        }
      }

      expect(assembledInfo).not.toBeNull();
      expect(assembledInfo.hash).toBe(hash);
      expect(assembledInfo.size).toBe(largeBuffer.length);
      expect(fs.readFileSync(assembledInfo.filePath)).toEqual(largeBuffer);
    });

    it('rejects tampered chunks on reassembly', () => {
      const managerSender = new AttachmentManager(path.join(tempDir, 'sender2'));
      const managerReceiver = new AttachmentManager(path.join(tempDir, 'receiver2'));

      const buffer = Buffer.from('Secret data payload that must not be corrupted');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      managerSender.saveAttachment(buffer, 'secret.txt');

      const chunk = managerSender.getChunk(hash, 0);
      const corruptedData = Buffer.from('Corrupted payload');

      const res = managerReceiver.receiveChunk(hash, 0, 1, corruptedData, '.txt');
      expect(res).toBeNull(); // Should fail hash verification
    });
  });

  describe('Importers Unit Tests', () => {
    it('converts CSV to Markdown tables with comma, semicolon and quotes', () => {
      const csv = 'Name,Role,Status\n"Ivan Ivanov",Developer,"Done"\n"Anna Petrova",Designer,"In Progress"';
      const md = csvToMarkdown(csv);
      expect(md).toContain('| Name | Role | Status |');
      expect(md).toContain('| --- | --- | --- |');
      expect(md).toContain('| Ivan Ivanov | Developer | Done |');
      expect(md).toContain('| Anna Petrova | Designer | In Progress |');

      const semicolonCsv = 'ID;Title;Value\n1;Task 1;100\n2;Task 2;200';
      const semiMd = csvToMarkdown(semicolonCsv);
      expect(semiMd).toContain('| ID | Title | Value |');
      expect(semiMd).toContain('| 1 | Task 1 | 100 |');
    });

    it('converts HTML content to clean Markdown', () => {
      const html = `
        <h1>Title Header</h1>
        <p>This is a <b>bold</b> and <i>italic</i> paragraph with <a href="https://example.com">link</a>.</p>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <table>
          <tr><th>Col 1</th><th>Col 2</th></tr>
          <tr><td>Val A</td><td>Val B</td></tr>
        </table>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('# Title Header');
      expect(md).toContain('**bold**');
      expect(md).toContain('*italic*');
      expect(md).toContain('[link](https://example.com)');
      expect(md).toContain('- First item');
      expect(md).toContain('| Col 1 | Col 2 |');
    });

    it('converts DOCX XML to clean Markdown', () => {
      const docxXml = `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
              <w:r><w:t>Project Specification</w:t></w:r>
            </w:p>
            <w:p>
              <w:r><w:rPr><w:b/></w:rPr><w:t>Important:</w:t></w:r>
              <w:r><w:t> Implementation details follow.</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>
      `;
      const md = docxXmlToMarkdown(docxXml);
      expect(md).toContain('# Project Specification');
      expect(md).toContain('**Important:** Implementation details follow.');
    });
  });

  describe('HTTP Endpoints: Attachments, Import & Export', () => {
    let agent: Agent;
    let baseUrl: string;
    let sessionCookie: string;

    beforeEach(async () => {
      agent = new Agent({
        baseDir: tempDir,
        memberName: 'Tester',
        webPort: 3200 + Math.floor(Math.random() * 500),
        peerPort: 4800 + Math.floor(Math.random() * 500)
      });
      await agent.start();
      baseUrl = `http://127.0.0.1:${agent.config.webPort}`;
      sessionCookie = `doks_session=${agent.httpServer['sessionToken']}`;
    });

    afterEach(async () => {
      await agent.stop();
    });

    it('uploads and downloads binary attachments via HTTP', async () => {
      const fileData = Buffer.from('Binary image content 123456');
      const uploadRes = await fetch(`${baseUrl}/api/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': 'sample.png',
          Cookie: sessionCookie
        },
        body: fileData
      });

      expect(uploadRes.status).toBe(200);
      const uploadJson = await uploadRes.json();
      expect(uploadJson.success).toBe(true);
      expect(uploadJson.hash).toBeDefined();
      expect(uploadJson.mimeType).toBe('image/png');

      // Verify indexed in Yjs
      const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
      const { attachments } = getIndexMaps(indexDoc);
      const indexed = attachments.get(uploadJson.hash);
      expect(indexed).toBeDefined();
      expect(indexed?.name).toContain('.png');

      // GET full attachment
      const getRes = await fetch(`${baseUrl}/api/attachments/${uploadJson.hash}`, {
        headers: { Cookie: sessionCookie }
      });
      expect(getRes.status).toBe(200);
      const arrayBuf = await getRes.arrayBuffer();
      expect(Buffer.from(arrayBuf)).toEqual(fileData);

      // GET with Range header
      const rangeRes = await fetch(`${baseUrl}/api/attachments/${uploadJson.hash}`, {
        headers: {
          Range: 'bytes=0-5',
          Cookie: sessionCookie
        }
      });
      expect(rangeRes.status).toBe(206);
      const rangeBuf = await rangeRes.arrayBuffer();
      expect(rangeBuf.byteLength).toBe(6);
    });

    it('imports CSV as note and as board', async () => {
      const csv = 'Task,Owner,Status\nSetup,Nikita,Done\nDesign,Kolya,Todo';

      // Import as Note
      const importNoteRes = await fetch(`${baseUrl}/api/import/file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          fileName: 'tasks.csv',
          content: csv,
          asBoard: false
        })
      });
      const noteJson = await importNoteRes.json();
      expect(noteJson.success).toBe(true);
      expect(noteJson.type).toBe('note');

      const noteDoc = agent.docManager.getOrCreateDoc(getNoteDocName(noteJson.id));
      const text = getNoteText(noteDoc).toString();
      expect(text).toContain('| Task | Owner | Status |');

      // Import as Board
      const importBoardRes = await fetch(`${baseUrl}/api/import/file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          fileName: 'tasks-board.csv',
          content: csv,
          asBoard: true
        })
      });
      const boardJson = await importBoardRes.json();
      expect(boardJson.success).toBe(true);
      expect(boardJson.type).toBe('board');

      const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardJson.id));
      const { nodes } = getBoardMaps(boardDoc);
      expect(nodes.size).toBeGreaterThan(0);
    });

    it('exports note as .md, board as .canvas, and vault as .zip', async () => {
      // Create a test note
      const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
      const { notes, boards } = getIndexMaps(indexDoc);

      const noteId = 'exp-note-1';
      notes.set(noteId, {
        id: noteId,
        title: 'Export Test Note',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false
      });
      const noteDoc = agent.docManager.getOrCreateDoc(getNoteDocName(noteId));
      getNoteText(noteDoc).insert(0, '# Hello from Export Test');

      // Export note
      const exportNoteRes = await fetch(`${baseUrl}/api/export/note/${noteId}`, {
        headers: { Cookie: sessionCookie }
      });
      expect(exportNoteRes.status).toBe(200);
      const noteContent = await exportNoteRes.text();
      expect(noteContent).toBe('# Hello from Export Test');

      // Create a test board
      const boardId = 'exp-board-1';
      boards.set(boardId, {
        id: boardId,
        title: 'Export Test Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false
      });

      // Export board
      const exportBoardRes = await fetch(`${baseUrl}/api/export/board/${boardId}`, {
        headers: { Cookie: sessionCookie }
      });
      expect(exportBoardRes.status).toBe(200);
      const boardCanvas = await exportBoardRes.json();
      expect(boardCanvas.nodes).toBeDefined();

      // Export Vault as .zip
      const exportVaultRes = await fetch(`${baseUrl}/api/export/vault`, {
        headers: { Cookie: sessionCookie }
      });
      expect(exportVaultRes.status).toBe(200);
      expect(exportVaultRes.headers.get('content-type')).toBe('application/zip');
      const zipBuffer = Buffer.from(await exportVaultRes.arrayBuffer());
      expect(zipBuffer.length).toBeGreaterThan(0);

      // Verify that zip is valid without external binary dependencies
      const tempZipPath = path.join(tempDir, 'downloaded-vault.zip');
      fs.writeFileSync(tempZipPath, zipBuffer);
      // Valid ZIP format: starts with PK (0x50, 0x4B) and contains End of Central Directory signature (PK\x05\x06)
      expect(zipBuffer[0]).toBe(0x50);
      expect(zipBuffer[1]).toBe(0x4b);
      expect(zipBuffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    });
  });
});
