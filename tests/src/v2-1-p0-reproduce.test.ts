import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setNodeProperties } from '@doks/shared';
import { Agent } from '@doks/agent';

describe('Stage B: P0 Reproductions (F1, F2)', () => {
  describe('F1: Concurrent sticky text edits without duplication', () => {
    it('applies granular diff so concurrent edits preserve both changes without repeating the prefix', () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();

      const initialText = 'Купить домен';
      const nodeMapA = docA.getMap('node-1');
      const nodeMapB = docB.getMap('node-1');

      // Initialize both with initial text
      const initialYTextA = new Y.Text(initialText);
      nodeMapA.set('text', initialYTextA);

      // Sync state from A to B
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

      // Peer A appends " сегодня"
      setNodeProperties(nodeMapA, { text: 'Купить домен сегодня' });

      // Peer B concurrently appends " и VPS"
      setNodeProperties(nodeMapB, { text: 'Купить домен и VPS' });

      // Exchange updates
      const updateA = Y.encodeStateAsUpdate(docA);
      const updateB = Y.encodeStateAsUpdate(docB);
      Y.applyUpdate(docB, updateA);
      Y.applyUpdate(docA, updateB);

      const resultTextA = (nodeMapA.get('text') as Y.Text).toString();
      const resultTextB = (nodeMapB.get('text') as Y.Text).toString();

      // Convergence
      expect(resultTextA).toBe(resultTextB);

      // Must NOT contain duplicate "Купить домен" prefix!
      const occurrences = (resultTextA.match(/Купить домен/g) || []).length;
      expect(occurrences).toBe(1);
      expect(resultTextA).toContain('сегодня');
      expect(resultTextA).toContain('и VPS');
    });
  });

  describe('F2: HTTP and Attachment Security', () => {
    let tempDir: string;
    let agent: Agent;
    let baseUrl: string;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-f2-'));
      agent = new Agent({
        baseDir: tempDir,
        memberName: 'SecurityTester',
        webPort: 3900 + Math.floor(Math.random() * 500),
        peerPort: 5500 + Math.floor(Math.random() * 500)
      });
      await agent.start();
      baseUrl = `http://127.0.0.1:${agent.config.webPort}`;
    });

    afterEach(async () => {
      await agent.stop();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects malicious Origin headers with 403', async () => {
      const evilRes = await fetch(`${baseUrl}/api/status`, {
        headers: {
          Origin: 'http://localhost.evil.test'
        }
      });
      expect(evilRes.status).toBe(403);
    });

    it('requires session cookie for API requests returning 401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        headers: {
          // No cookies sent
        }
      });
      expect(res.status).toBe(401);
    });

    it('serves SVG with nosniff, sandbox CSP, and Content-Disposition attachment', async () => {
      // First obtain session cookie
      const authRes = await fetch(`${baseUrl}/`);
      const setCookie = authRes.headers.get('set-cookie') || '';
      const cookieMatch = setCookie.match(/doks_session=[^;]+/);
      const sessionCookie = cookieMatch ? cookieMatch[0] : '';

      // Upload SVG attachment
      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5"/></svg>';
      const uploadRes = await fetch(`${baseUrl}/api/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': 'icon.svg',
          Cookie: sessionCookie
        },
        body: Buffer.from(svgContent)
      });
      const uploadJson = await uploadRes.json();
      expect(uploadJson.success).toBe(true);

      // GET SVG attachment
      const getRes = await fetch(`${baseUrl}/api/attachments/${uploadJson.hash}`, {
        headers: { Cookie: sessionCookie }
      });
      expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(getRes.headers.get('Content-Security-Policy')).toContain('sandbox');
      expect(getRes.headers.get('Content-Disposition')).toContain('attachment');
      await getRes.text();
    });

    it('returns 416 for invalid Range requests', async () => {
      const authRes = await fetch(`${baseUrl}/`);
      const setCookie = authRes.headers.get('set-cookie') || '';
      const cookieMatch = setCookie.match(/doks_session=[^;]+/);
      const sessionCookie = cookieMatch ? cookieMatch[0] : '';

      const uploadRes = await fetch(`${baseUrl}/api/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': 'doc.txt',
          Cookie: sessionCookie
        },
        body: Buffer.from('Short document')
      });
      const uploadJson = await uploadRes.json();

      // Invalid range: start > end
      const rangeRes = await fetch(`${baseUrl}/api/attachments/${uploadJson.hash}`, {
        headers: {
          Cookie: sessionCookie,
          Range: 'bytes=100-50'
        }
      });
      expect(rangeRes.status).toBe(416);
      await rangeRes.text();
    });
  });
});
