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
import type { AgentConfig } from '@doks/shared';

describe('Doks v13: Complete UI Polish, Bridge Mode & Release Verification', () => {
  describe('Part 1: BridgeService & Read-Only Enforcement', () => {
    let tempDir: string;
    let bridgeService: BridgeService;
    let server: AgentHttpServer;
    let docManager: DocManager;
    let peerService: PeerService;
    const webPort = 13850;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-v13-test-'));
      const vaultPath = path.join(tempDir, 'vault');
      const statePath = path.join(tempDir, 'state');
      fs.mkdirSync(vaultPath, { recursive: true });
      fs.mkdirSync(statePath, { recursive: true });

      const teamStore = new StateStore(statePath);
      docManager = new DocManager(teamStore);

      const config: AgentConfig = {
        agentId: 'agent-v13',
        memberName: 'Tester v13',
        memberColor: '#6366f1',
        peerPort: 14850,
        webPort,
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

      bridgeService = server.getBridgeService();
    });

    afterEach(async () => {
      if (server) await (server as any).fastify.close();
      if (peerService) await peerService.stop();
      if (docManager) docManager.destroy();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('manages bridge state, generates 24-hex token and localUrl', async () => {
      const statusInitial = bridgeService.getStatus();
      expect(statusInitial.enabled).toBe(false);

      const status = await bridgeService.enableBridge({ allowSolo: true, useCloudflare: false });
      expect(status.enabled).toBe(true);
      expect(status.localUrl).toContain(':13850/?b=');

      const token = new URL(status.localUrl!).searchParams.get('b');
      expect(token).toBeDefined();
      expect(token!.length).toBe(24);
      expect(bridgeService.isValidBridgeToken(token)).toBe(true);

      bridgeService.disableBridge();
      expect(bridgeService.getStatus().enabled).toBe(false);
      expect(bridgeService.isValidBridgeToken(token)).toBe(false);
    });

    it('enforces 403 Forbidden for POST and DELETE requests from bridge viewer', async () => {
      const status = await bridgeService.enableBridge({ allowSolo: false, useCloudflare: false });
      const token = new URL(status.localUrl!).searchParams.get('b')!;

      // 1. GET is permitted for viewer
      const getRes = await (server as any).fastify.inject({
        method: 'GET',
        url: `/api/status?b=${token}`,
        headers: { host: `127.0.0.1:${webPort}` }
      });
      expect(getRes.statusCode).toBe(200);
      const statusData = JSON.parse(getRes.body);
      expect(statusData.viewerMode).toBe(true);
      expect(statusData.teamKey).toBeUndefined();
      expect(statusData.token).toBeUndefined();

      // 2. POST is blocked with 403
      const postRes = await (server as any).fastify.inject({
        method: 'POST',
        url: `/api/team-key?b=${token}`,
        headers: {
          host: `127.0.0.1:${webPort}`,
          'content-type': 'application/json'
        },
        payload: { teamKey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }
      });
      expect(postRes.statusCode).toBe(403);
      expect(JSON.parse(postRes.body).error).toContain('Read-Only Bridge Mode');

      // 3. DELETE is blocked with 403
      const delRes = await (server as any).fastify.inject({
        method: 'DELETE',
        url: `/api/boards/test-board?b=${token}`,
        headers: { host: `127.0.0.1:${webPort}` }
      });
      expect(delRes.statusCode).toBe(403);
      expect(JSON.parse(delRes.body).error).toContain('Read-Only Bridge Mode');
    });
  });

  describe('Part 2: Pure TypeScript ISO/IEC 18004 QR Code Generation', () => {
    it('generates valid matrix for local LAN URL', () => {
      const url = 'http://192.168.1.100:3000/?b=0123456789abcdef01234567';
      const matrix = generateQrMatrix(url);
      expect(Array.isArray(matrix)).toBe(true);
      expect(matrix.length).toBeGreaterThanOrEqual(21);
      expect(matrix[0].length).toBe(matrix.length);

      // Verify finder patterns (top-left)
      expect(matrix[0][0]).toBe(true);
      expect(matrix[3][3]).toBe(true);
    });

    it('renders crisp SVG path with correct dimensions', () => {
      const matrix = generateQrMatrix('http://doks.local:3000/?b=test');
      const margin = 4;
      const { size, path: svgPath } = renderQrSvgPath(matrix, margin);
      expect(size).toBe(matrix.length + margin * 2);
      expect(svgPath).toContain('M');
      expect(svgPath).toContain('h1v1h-1z');
    });
  });

  describe('Part 3: UI Polish CSS Verification', () => {
    it('verifies all required V13 CSS classes and reset rules are present in style.css', () => {
      const cssPath = path.resolve(process.cwd(), 'web/src/style.css');
      expect(fs.existsSync(cssPath)).toBe(true);
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      const requiredSelectors = [
        ':where(button, input, select, textarea)',
        ':where(button):hover:not(:disabled)',
        '.btn-primary-xs',
        '.btn-ghost-xs',
        '.btn-danger',
        '.miro-export-toggle-btn',
        '.miro-widgets-flyout',
        '.triangle-preview',
        '.hexagon-preview',
        '.drawing-color-swatch',
        '.ai-export-checkbox-label',
        '.checkbox-row-label'
      ];

      for (const sel of requiredSelectors) {
        expect(cssContent).toContain(sel);
      }
    });
  });
});
