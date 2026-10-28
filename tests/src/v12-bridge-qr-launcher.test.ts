import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateQrMatrix, renderQrSvgPath } from '../../web/src/utils/qr-svg.js';
import { BridgeService } from '../../agent/src/server/bridge-service.js';
import { AgentHttpServer } from '../../agent/src/server/http-server.js';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';
import { PeerService } from '../../agent/src/peer/peer-service.js';
import { generateSessionToken } from '../../agent/src/security.js';
import type { AgentConfig } from '@doks/shared';

describe('Doks v12: QR Generator ISO/IEC 18004 & Bridge Service', () => {
  describe('Part 1: Pure TypeScript QR Code Generator (Reed-Solomon GF(256))', () => {
    it('generates valid matrix for short URL (Version 1, 21x21)', () => {
      const text = 'http://127.0.0.1:3000/?b=abc123';
      const matrix = generateQrMatrix(text);
      expect(Array.isArray(matrix)).toBe(true);
      expect(matrix.length).toBeGreaterThanOrEqual(21);
      expect(matrix[0].length).toBe(matrix.length);

      // Verify finder patterns at top-left, top-right, bottom-left
      // Top-left center (3,3) is dark
      expect(matrix[3][3]).toBe(true);
      // Top-left corner (0,0) is dark
      expect(matrix[0][0]).toBe(true);
    });

    it('generates valid matrix for longer Cloudflare tunnel URL', () => {
      const longUrl = 'https://rapid-collab-workspace-test.trycloudflare.com/?b=abcdef0123456789abcdef01';
      const matrix = generateQrMatrix(longUrl);
      expect(matrix.length).toBeGreaterThanOrEqual(29);
      expect(matrix[0].length).toBe(matrix.length);
    });

    it('renders clean SVG path with correct dimensions and margin', () => {
      const matrix = generateQrMatrix('http://doks.local');
      const margin = 4;
      const svg = renderQrSvgPath(matrix, margin);
      expect(svg.size).toBe(matrix.length + margin * 2);
      expect(svg.path).toContain('M');
      expect(svg.path).toContain('h1v1h-1z');
    });
  });

  describe('Part 2: Bridge Service & Token Security', () => {
    let tempDir: string;
    let bridgeService: BridgeService;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-bridge-test-'));
      const statePath = path.join(tempDir, 'state');
      fs.mkdirSync(statePath, { recursive: true });
      bridgeService = new BridgeService(3000, statePath);
    });

    afterEach(() => {
      bridgeService.disableBridge();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('is disabled by default', () => {
      const status = bridgeService.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.localUrl).toBeNull();
      expect(status.publicUrl).toBeNull();
      expect(status.tunnelStatus).toBe('off');
    });

    it('enables bridge with compact cryptographic token and valid localUrl', async () => {
      const status = await bridgeService.enableBridge({ allowSolo: true, useCloudflare: false });
      expect(status.enabled).toBe(true);
      expect(status.localUrl).toContain('http://');
      expect(status.localUrl).toContain(':3000/?b=');
      expect(status.allowSolo).toBe(true);
      expect(status.expiresAt).toBeGreaterThan(Date.now());

      const url = new URL(status.localUrl!);
      const token = url.searchParams.get('b');
      expect(token).toBeDefined();
      expect(token!.length).toBe(24); // 12 bytes hex

      expect(bridgeService.isValidBridgeToken(token)).toBe(true);
      expect(bridgeService.isValidBridgeToken('wrong-token')).toBe(false);
      expect(bridgeService.isValidBridgeToken(null)).toBe(false);
    });

    it('disables bridge and invalidates previous tokens', async () => {
      const status = await bridgeService.enableBridge();
      const url = new URL(status.localUrl!);
      const token = url.searchParams.get('b');

      bridgeService.disableBridge();
      const statusAfter = bridgeService.getStatus();
      expect(statusAfter.enabled).toBe(false);
      expect(statusAfter.localUrl).toBeNull();
      expect(bridgeService.isValidBridgeToken(token)).toBe(false);
    });
  });

  describe('Part 3: Read-Only Bridge Mode Enforcement in HTTP & WS', () => {
    let tempDir: string;
    let server: AgentHttpServer;
    let docManager: DocManager;
    let peerService: PeerService;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-bridge-server-test-'));
      const vaultPath = path.join(tempDir, 'vault');
      const statePath = path.join(tempDir, 'state');
      fs.mkdirSync(vaultPath, { recursive: true });
      fs.mkdirSync(statePath, { recursive: true });

      const teamStore = new StateStore(statePath);
      docManager = new DocManager(teamStore);
      const config: AgentConfig = {
        agentId: 'test-agent',
        memberName: 'Tester',
        memberColor: '#3b82f6',
        peerPort: 14755,
        webPort: 13055,
        teamKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        peers: [],
        statePath,
        vaultPath
      };

      peerService = new PeerService(config, docManager);

      server = new AgentHttpServer({
        config,
        docManager,
        peerService
      });
    });

    afterEach(async () => {
      if (server) await (server as any).fastify.close();
      if (peerService) await peerService.stop();
      if (docManager) docManager.destroy();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('enforces 403 Forbidden for state-mutating requests from bridge viewer session', async () => {
      const bridge = server.getBridgeService();
      const status = await bridge.enableBridge();
      const token = new URL(status.localUrl!).searchParams.get('b')!;

      // GET is allowed for viewer
      const getRes = await (server as any).fastify.inject({
        method: 'GET',
        url: `/api/status?b=${token}`,
        headers: { host: '127.0.0.1:13055' }
      });
      expect(getRes.statusCode).toBe(200);
      const statusData = JSON.parse(getRes.body);
      expect(statusData.viewerMode).toBe(true);

      // POST / DELETE / PUT must be rejected with 403 Read-Only Bridge Mode
      const postRes = await (server as any).fastify.inject({
        method: 'POST',
        url: `/api/team-key?b=${token}`,
        headers: {
          host: '127.0.0.1:13055',
          'content-type': 'application/json'
        },
        payload: { teamKey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }
      });
      expect(postRes.statusCode).toBe(403);
      const postData = JSON.parse(postRes.body);
      expect(postData.error).toContain('Read-Only Bridge Mode');
    });
  });
});
