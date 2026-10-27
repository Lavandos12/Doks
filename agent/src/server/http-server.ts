import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { streamDirectoryAsZip } from '../storage/zip-stream.js';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { AgentConfig } from '@doks/shared';
import {
  type PeerMessage,
  encodeMessage,
  decodeMessage,
  uint8ArrayToBase64,
  base64ToUint8Array,
  csvToMarkdown,
  htmlToMarkdown,
  docxXmlToMarkdown,
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteText,
  nodeMapToData,
  getNoteDocName,
  getBoardDocName,
  getScopedIndexDocName,
  getScopedNoteDocName,
  getScopedBoardDocName,
  applyTextDelta,
  type WorkspaceScope,
  generateAiContext,
  type AiExportOptions
} from '@doks/shared';
import { DocManager } from '../storage/doc-manager.js';
import { PeerService } from '../peer/peer-service.js';
import { AttachmentManager } from '../storage/attachments.js';
import { extractTextFromDocxBuffer } from '../storage/docx-extractor.js';
import { generateSessionToken } from '../security.js';
import {
  findAvailablePort,
  findRadminIp,
  detectRadminIp,
  detectPreferredMeshIp,
  listOverlayInterfaces,
  detectNetworkOverview
} from '../network.js';
import { saveConfig } from '../config.js';

function resolveWebDist(custom?: string): string {
  if (custom && fs.existsSync(custom)) return custom;
  const candidates = [
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../web/dist'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/dist'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../web/dist')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), 'web/dist');
}

export interface HttpServerOptions {
  config: AgentConfig;
  docManager: DocManager;
  peerService: PeerService;
  snapshotManager?: any;
  attachmentManager?: AttachmentManager;
  webDistPath?: string;
}

export class AgentHttpServer {
  private fastify: FastifyInstance;
  private config: AgentConfig;
  private docManager: DocManager;
  private peerService: PeerService;
  private snapshotManager?: any;
  private attachmentManager?: AttachmentManager;
  private sessionToken: string;
  private webDistPath: string;
  private p2pMeshEnabled = true;

  constructor(options: HttpServerOptions) {
    this.config = options.config;
    this.docManager = options.docManager;
    this.peerService = options.peerService;
    this.snapshotManager = options.snapshotManager;
    this.attachmentManager = options.attachmentManager;
    this.sessionToken = generateSessionToken();
    this.webDistPath = resolveWebDist(options.webDistPath);

    this.fastify = Fastify({
      logger: false,
      bodyLimit: 100 * 1024 * 1024 // 100MB for attachments (B22)
    });

    this.setupPlugins();
    this.setupRoutes();
  }

  private setupPlugins(): void {
    this.fastify.register(fastifyCookie);
    this.fastify.register(fastifyWebsocket);

    // B22 & Attachments: Allow raw buffer uploads for files & attachments
    this.fastify.addContentTypeParser(
      [
        'application/octet-stream',
        'application/pdf',
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/csv',
        'text/html',
        'text/markdown'
      ],
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body);
      }
    );
    this.fastify.addContentTypeParser(/^image\/.*/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    this.fastify.addContentTypeParser(/^video\/.*/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    this.fastify.addContentTypeParser(/^audio\/.*/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    // Serve static files if webDistPath exists
    if (fs.existsSync(this.webDistPath)) {
      this.fastify.register(fastifyStatic, {
        root: this.webDistPath,
        prefix: '/'
      });
    } else {
      // Fallback root endpoint to set session cookie even when web dist is not built
      this.fastify.get('/', async (_req, reply) => {
        reply.type('text/html').send('<!doctype html><html><body><h1>Doks</h1></body></html>');
      });
    }

    // Global security headers on all responses
    this.fastify.addHook('onSend', async (_req, reply) => {
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Frame-Options', 'DENY');
      if (!reply.hasHeader('Content-Security-Policy')) {
        reply.header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' ws: wss:;"
        );
      }
    });

    // Security hook: Host & Origin verification & Session Authentication
    this.fastify.addHook('onRequest', async (req, reply) => {
      const host = req.headers.host || '';
      const [hostName, hostPortStr] = host.split(':');
      const radminIp = detectRadminIp();
      const allowedHostNames = ['127.0.0.1', 'localhost', '[::1]'];
      if (radminIp) allowedHostNames.push(radminIp);
      if (this.config.bindAddress && this.config.bindAddress !== 'auto' && this.config.bindAddress !== '0.0.0.0') {
        allowedHostNames.push(this.config.bindAddress);
      }
      const hostPort = hostPortStr ? parseInt(hostPortStr, 10) : 80;

      const isHostAllowed =
        allowedHostNames.includes(hostName) ||
        hostName.startsWith('26.') ||
        hostName.startsWith('192.168.') ||
        hostName.startsWith('10.');

      if (!isHostAllowed || (hostPortStr && hostPort !== this.config.webPort)) {
        reply.code(403).send({ error: 'Forbidden: Invalid Host header' });
        return;
      }

      const origin = req.headers.origin;
      if (origin) {
        try {
          const originUrl = new URL(origin);
          const allowedOriginHosts = ['127.0.0.1', 'localhost', '[::1]'];
          if (radminIp) allowedOriginHosts.push(radminIp);
          if (this.config.bindAddress && this.config.bindAddress !== 'auto') {
            allowedOriginHosts.push(this.config.bindAddress);
          }
          const isAllowedOriginHost =
            allowedOriginHosts.includes(originUrl.hostname) ||
            originUrl.hostname.startsWith('26.') ||
            originUrl.hostname.startsWith('192.168.') ||
            originUrl.hostname.startsWith('10.');

          const originPort = originUrl.port
            ? parseInt(originUrl.port, 10)
            : originUrl.protocol === 'https:'
              ? 443
              : 80;
          const isAllowedOriginPort =
            originPort === this.config.webPort ||
            originPort === 5173 ||
            originPort === 5174 ||
            originPort === 3000 ||
            (!originUrl.port && (this.config.webPort === 80 || this.config.webPort === 443));

          if (!isAllowedOriginHost || !isAllowedOriginPort) {
            reply.code(403).send({ error: 'Forbidden: Invalid Origin header' });
            return;
          }
        } catch {
          reply.code(403).send({ error: 'Forbidden: Invalid Origin header' });
          return;
        }
      }

      // Check route authentication
      const urlPath = req.url.split('?')[0];
      const isApiOrWs = urlPath.startsWith('/api') || urlPath.startsWith('/ws');

      if (isApiOrWs) {
        if (!this.isValidSession(req)) {
          reply.code(401).send({ error: 'Unauthorized: Valid doks_session cookie required' });
          return;
        }
      } else {
        // Issue session cookie for static routes if missing
        if (!req.cookies?.doks_session) {
          reply.setCookie('doks_session', this.sessionToken, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax'
          });
        }
      }
    });
  }

  private isValidSession(req: any): boolean {
    const cookieToken = req.cookies?.doks_session;
    const authHeader = req.headers?.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const xDoksToken = req.headers?.['x-doks-token'];
    const queryToken = (req.query as any)?.token;
    const token = cookieToken || bearerToken || xDoksToken || queryToken;
    if (!token || typeof token !== 'string') return false;

    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(this.sessionToken);
    if (tokenBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(tokenBuf, expectedBuf);
  }

  private setupRoutes(): void {
    // API: Config & Peer status
    this.fastify.get('/api/status', async (req) => {
      const radminIp = detectRadminIp();
      const preferred = detectPreferredMeshIp();
      const hasAuth = this.isValidSession(req);
      const isLoopback = req.ip === '127.0.0.1' || req.ip === '::1' || req.hostname === 'localhost' || req.hostname === '127.0.0.1';
      const isAuthorized = hasAuth || isLoopback;

      const networkOverview = detectNetworkOverview({
        p2pEnabled: this.p2pMeshEnabled,
        teamKey: this.config.teamKey,
        port: this.config.peerPort,
        peerId: this.config.agentId
      });

      return {
        agentId: this.config.agentId,
        memberName: this.config.memberName,
        memberColor: this.config.memberColor,
        peerPort: this.config.peerPort,
        webPort: this.config.webPort,
        bindAddress: this.config.bindAddress,
        effectiveIp: networkOverview.effectiveIp,
        radminFound: Boolean(networkOverview.detectedRadminIp),
        radminIp: networkOverview.detectedRadminIp,
        lanIp: networkOverview.lanIp,
        p2pEnabled: this.p2pMeshEnabled,
        preferredMeshIp: preferred.ip,
        meshInterfaceKind: preferred.kind,
        interfaces: networkOverview.interfaces,
        peers: this.peerService.getPeersStatus(),
        connectedCount: this.peerService.getConnectedCount(),
        discoveredLanRooms: this.peerService.getDiscoveredLanRooms(),
        token: isAuthorized ? this.sessionToken : undefined,
        // B17: Do not expose raw teamKey without session authentication
        teamKey: isAuthorized ? this.config.teamKey : undefined,
        keyFingerprint:
          isAuthorized && this.config.teamKey
            ? crypto
                .createHash('sha256')
                .update(this.config.teamKey)
                .digest('hex')
                .slice(0, 8)
                .replace(/^(.{4})(.{4})$/, '$1-$2')
            : undefined,
        inviteLink: networkOverview.inviteUri,
        inviteUri: networkOverview.inviteUri
      };
    });

    // GET /api/network: Guaranteed non-null inviteUri and P2P overview
    this.fastify.get('/api/network', async (req) => {
      const overview = detectNetworkOverview({
        p2pEnabled: this.p2pMeshEnabled,
        teamKey: this.config.teamKey,
        port: this.config.peerPort,
        peerId: this.config.agentId
      });
      return {
        ...overview,
        peers: this.peerService.getPeersStatus(),
        connectedCount: this.peerService.getConnectedCount(),
        discoveredLanRooms: this.peerService.getDiscoveredLanRooms()
      };
    });

    // POST /api/network/toggle: Master switch for P2P synchronization
    this.fastify.post('/api/network/toggle', async (req) => {
      const body = req.body as { enabled?: boolean } | undefined;
      if (typeof body?.enabled === 'boolean') {
        this.p2pMeshEnabled = body.enabled;
      } else {
        this.p2pMeshEnabled = !this.p2pMeshEnabled;
      }
      return {
        success: true,
        p2pEnabled: this.p2pMeshEnabled
      };
    });

    // API: Change team key (with automatic backup snapshot)
    this.fastify.post('/api/team-key', async (req, reply) => {
      const body = req.body as { teamKey?: string };
      if (!body?.teamKey || body.teamKey.trim().length !== 64) {
        return reply.code(400).send({ error: 'Valid 64-character hex team key is required' });
      }

      // Automatically create snapshot before changing team key
      if (this.snapshotManager) {
        try {
          this.snapshotManager.createSnapshot('Before team key change');
        } catch {}
      }

      this.config.teamKey = body.teamKey.trim();
      saveConfig(this.config);

      const fp = crypto
        .createHash('sha256')
        .update(this.config.teamKey)
        .digest('hex')
        .slice(0, 8)
        .replace(/^(.{4})(.{4})$/, '$1-$2');

      return {
        success: true,
        teamKey: this.config.teamKey,
        keyFingerprint: fp
      };
    });

    // API: Update member profile (B10)
    this.fastify.patch('/api/profile', async (req, reply) => {
      const body = req.body as { memberName?: string; memberColor?: string };
      if (body.memberName) {
        this.config.memberName = body.memberName.trim().slice(0, 32);
      }
      if (body.memberColor) {
        this.config.memberColor = body.memberColor.trim();
      }
      saveConfig(this.config);
      return {
        success: true,
        memberName: this.config.memberName,
        memberColor: this.config.memberColor
      };
    });

    // API: List peers & discovered LAN rooms
    this.fastify.get('/api/peers', async () => {
      return {
        peers: this.peerService.getPeersStatus(),
        connectedCount: this.peerService.getConnectedCount(),
        discoveredLanRooms: this.peerService.getDiscoveredLanRooms()
      };
    });

    // API: Add peer
    this.fastify.post('/api/peers', async (req, reply) => {
      const body = req.body as { address?: string; peer?: string };
      const target = body?.address || body?.peer;
      if (!target) {
        return reply.code(400).send({ error: 'address or peer is required' });
      }
      this.peerService.addPeer(target);
      return {
        success: true,
        peers: this.peerService.getPeersStatus(),
        discoveredLanRooms: this.peerService.getDiscoveredLanRooms()
      };
    });

    // API: Remove peer
    this.fastify.delete('/api/peers', async (req, reply) => {
      const body = req.body as { address?: string };
      if (!body?.address) {
        return reply.code(400).send({ error: 'address is required' });
      }
      this.peerService.removePeer(body.address);
      return { success: true, peers: this.peerService.getPeersStatus() };
    });

    // API: Snapshots list
    this.fastify.get('/api/snapshots', async () => {
      if (!this.snapshotManager) return [];
      return this.snapshotManager.listSnapshots();
    });

    // API: List boards with scope metadata
    this.fastify.get('/api/boards', async (req) => {
      const scopeQuery = (req.query as any)?.scope;
      const soloBoards = this.docManager.listBoards('solo');
      const teamBoards = this.docManager.listBoards('team');
      if (scopeQuery === 'solo') return soloBoards;
      if (scopeQuery === 'team') return teamBoards;
      return [...soloBoards, ...teamBoards];
    });

    // API: Create board
    this.fastify.post('/api/boards', async (req) => {
      const body = (req.body as any) || {};
      const scope = (body.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const title = (body.title || 'Новая доска').trim();
      const folder = body.folder || null;
      const boardId = crypto.randomUUID();
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { boards } = getIndexMaps(indexDoc);
      const now = Date.now();
      const meta = {
        id: boardId,
        title,
        folder,
        createdAt: now,
        updatedAt: now,
        deleted: false,
        scope
      };
      indexDoc.transact(() => {
        boards.set(boardId, meta);
      });
      return meta;
    });

    // API: Rename/update board
    this.fastify.put('/api/boards/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body as any) || {};
      const scope = (body.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { boards } = getIndexMaps(indexDoc);
      const existing = boards.get(id);
      if (!existing || existing.deleted) {
        return reply.code(404).send({ error: 'Board not found' });
      }
      indexDoc.transact(() => {
        boards.set(id, {
          ...existing,
          title: body.title !== undefined ? body.title : existing.title,
          folder: body.folder !== undefined ? body.folder : existing.folder,
          updatedAt: Date.now()
        });
      });
      return { success: true };
    });

    // API: Delete board
    this.fastify.delete('/api/boards/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const scopeQuery = (req.query as any)?.scope;
      const scope = (scopeQuery === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { boards } = getIndexMaps(indexDoc);
      const existing = boards.get(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Board not found' });
      }
      indexDoc.transact(() => {
        boards.set(id, {
          ...existing,
          deleted: true,
          deletedAt: Date.now(),
          updatedAt: Date.now()
        });
      });
      return { success: true };
    });

    // API: List notes
    this.fastify.get('/api/notes', async (req) => {
      const scopeQuery = (req.query as any)?.scope;
      const scope = (scopeQuery === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { notes } = getIndexMaps(indexDoc);
      const list: any[] = [];
      notes.forEach((meta) => {
        if (!meta.deleted) list.push({ ...meta, scope });
      });
      return list;
    });

    // API: Create note
    this.fastify.post('/api/notes', async (req) => {
      const body = (req.body as any) || {};
      const scope = (body.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const title = (body.title || 'Новая заметка').trim();
      const folder = body.folder || null;
      const noteId = crypto.randomUUID();
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { notes } = getIndexMaps(indexDoc);
      const now = Date.now();
      const meta = {
        id: noteId,
        title,
        folder,
        createdAt: now,
        updatedAt: now,
        deleted: false,
        scope
      };
      indexDoc.transact(() => {
        notes.set(noteId, meta);
      });
      return meta;
    });

    // API: Update note
    this.fastify.put('/api/notes/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body as any) || {};
      const scope = (body.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { notes } = getIndexMaps(indexDoc);
      const existing = notes.get(id);
      if (!existing || existing.deleted) {
        return reply.code(404).send({ error: 'Note not found' });
      }
      indexDoc.transact(() => {
        notes.set(id, {
          ...existing,
          title: body.title !== undefined ? body.title : existing.title,
          folder: body.folder !== undefined ? body.folder : existing.folder,
          updatedAt: Date.now()
        });
      });
      if (body.content !== undefined) {
        const noteDoc = this.docManager.getOrCreateDoc(getScopedNoteDocName(scope, id));
        const yText = getNoteText(noteDoc);
        applyTextDelta(yText, body.content);
      }
      return { success: true };
    });

    // API: Delete note
    this.fastify.delete('/api/notes/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const scopeQuery = (req.query as any)?.scope;
      const scope = (scopeQuery === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { notes } = getIndexMaps(indexDoc);
      const existing = notes.get(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Note not found' });
      }
      indexDoc.transact(() => {
        notes.set(id, {
          ...existing,
          deleted: true,
          deletedAt: Date.now(),
          updatedAt: Date.now()
        });
      });
      return { success: true };
    });

    // API: Cross-scope bridge transfer (Promote to Team / Fork to Solo)
    this.fastify.post('/api/bridge/transfer', async (req, reply) => {
      const body = req.body as any;
      if (!body || !body.fromScope || !body.toScope || !body.boardId || !body.targetBoardId || !Array.isArray(body.nodeIds)) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required fields: fromScope, toScope, boardId, targetBoardId, nodeIds'
        });
      }

      try {
        const result = this.docManager.transferNodes({
          fromScope: body.fromScope,
          toScope: body.toScope,
          boardId: body.boardId,
          targetBoardId: body.targetBoardId,
          nodeIds: body.nodeIds,
          includeLinkedNotes: body.includeLinkedNotes !== false,
          mode: body.mode || 'copy'
        });
        return result;
      } catch (err: any) {
        return reply.code(500).send({
          success: false,
          error: err.message || 'Transfer failed'
        });
      }
    });

    // API: Create snapshot
    this.fastify.post('/api/snapshots', async () => {
      if (!this.snapshotManager) return { error: 'Snapshots disabled' };
      const meta = this.snapshotManager.createSnapshot();
      return { success: true, snapshot: meta };
    });

    // API: Restore snapshot
    this.fastify.post('/api/snapshots/restore', async (req, reply) => {
      if (!this.snapshotManager) return reply.code(400).send({ error: 'Snapshots disabled' });
      const body = req.body as { snapshotId?: string; docName?: string };
      if (!body?.snapshotId) {
        return reply.code(400).send({ error: 'snapshotId is required' });
      }
      const success = this.snapshotManager.restoreSnapshot(body.snapshotId, body.docName);
      return { success };
    });

    this.fastify.post('/api/snapshots/:id/restore', async (req, reply) => {
      if (!this.snapshotManager) return reply.code(400).send({ error: 'Snapshots disabled' });
      const { id } = req.params as { id: string };
      const body = (req.body as any) || {};
      const success = this.snapshotManager.restoreSnapshot(id, body.docName);
      return { success };
    });

    // API: Upload attachment (B22)
    this.fastify.post('/api/attachments', async (req, reply) => {
      if (!this.attachmentManager) {
        return reply.code(500).send({ error: 'Attachment manager not available' });
      }

      let buffer: Buffer;
      let originalName = 'attachment.bin';

      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        const body = req.body as { fileName?: string; data?: string };
        if (!body?.data) {
          return reply.code(400).send({ error: 'No data provided' });
        }
        buffer = Buffer.from(body.data, 'base64');
        if (body.fileName) originalName = body.fileName;
      } else if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
        const customName = req.headers['x-file-name'] as string;
        if (customName) {
          try {
            originalName = decodeURIComponent(customName);
          } catch {
            originalName = customName;
          }
        }
      } else {
        return reply.code(400).send({ error: 'Unsupported payload or empty body' });
      }

      const info = this.attachmentManager.saveAttachment(buffer, originalName);

      try {
        const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
        const { attachments } = getIndexMaps(indexDoc);
        attachments.set(info.hash, {
          hash: info.hash,
          name: info.fileName,
          size: info.size,
          mime: info.mimeType,
          addedBy: this.config.memberName,
          addedAt: Date.now(),
          deleted: false
        });
      } catch (err) {
        console.error('[HttpServer] Failed to index attachment in Yjs:', err);
      }

      return {
        success: true,
        hash: info.hash,
        fileName: info.fileName,
        size: info.size,
        mimeType: info.mimeType,
        extractedText: info.extractedText
      };
    });

    // API: Get attachment metadata and extracted text
    this.fastify.get('/api/attachments/:hash/content', async (req, reply) => {
      if (!this.attachmentManager) {
        return reply.code(500).send({ error: 'Attachment manager not available' });
      }
      const { hash } = req.params as { hash: string };
      const att = this.attachmentManager.getAttachment(hash);
      if (!att) {
        return reply.code(404).send({ error: 'Attachment not found' });
      }

      let text = att.extractedText;
      if (!text && fs.existsSync(att.filePath)) {
        try {
          const buf = fs.readFileSync(att.filePath);
          const lowerName = (att.fileName || '').toLowerCase();
          if (lowerName.endsWith('.docx')) {
            text = extractTextFromDocxBuffer(buf);
          } else if (
            lowerName.endsWith('.txt') ||
            lowerName.endsWith('.md') ||
            lowerName.endsWith('.csv') ||
            lowerName.endsWith('.json') ||
            lowerName.endsWith('.js') ||
            lowerName.endsWith('.ts')
          ) {
            text = buf.toString('utf8');
          }
          if (text) {
            this.attachmentManager.updateExtractedText(att.hash, text);
          }
        } catch {}
      }

      return {
        id: att.hash,
        originalName: att.fileName,
        fileName: att.fileName,
        mimeType: att.mimeType,
        size: att.size,
        extractedText: text || ''
      };
    });

    // API: Get attachment (Supports Range requests, Security Headers & CSP Sandbox)
    this.fastify.get('/api/attachments/:hash', async (req, reply) => {
      if (!this.attachmentManager) {
        return reply.code(500).send({ error: 'Attachment manager not available' });
      }
      const { hash } = req.params as { hash: string };
      const HASH_REGEX = /^[a-f0-9]{64}$/;
      if (!HASH_REGEX.test(hash)) {
        return reply.code(400).send({ error: 'Invalid attachment hash format' });
      }

      const att = this.attachmentManager.getAttachment(hash);
      if (!att || !fs.existsSync(att.filePath)) {
        return reply.code(404).send({ error: 'Attachment not found' });
      }

      // Security headers for attachments
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");

      // Whitelisted inline safe types: png, jpg, webp, gif, pdf, audio/*, video/* (never SVG, HTML, or JS inline)
      const ext = path.extname(att.fileName || '').toLowerCase();
      const FORCED_ATTACHMENT_EXTS = new Set(['.svg', '.html', '.htm', '.xml', '.js', '.mjs', '.exe', '.bat', '.cmd', '.sh', '.vbs', '.ps1']);
      const INLINE_SAFE_EXACT = new Set([
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'application/pdf'
      ]);
      const isInlineSafe =
        !FORCED_ATTACHMENT_EXTS.has(ext) &&
        (INLINE_SAFE_EXACT.has(att.mimeType) ||
        ((att.mimeType.startsWith('audio/') || att.mimeType.startsWith('video/')) && !att.mimeType.includes('svg') && !att.mimeType.includes('xml')));

      const safeFileName = (att.fileName || 'attachment.bin').replace(/["\r\n\t\\]/g, '_');
      if (isInlineSafe) {
        reply.header('Content-Disposition', 'inline');
      } else {
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFileName)}"`);
      }

      const range = req.headers.range;
      if (range) {
        if (!range.startsWith('bytes=')) {
          reply.header('Content-Range', `bytes */${att.size}`);
          return reply.code(416).send({ error: 'Range Not Satisfiable' });
        }
        const rangeSpec = range.slice(6).trim();
        let start: number;
        let end: number;

        if (rangeSpec.startsWith('-')) {
          const suffixLen = parseInt(rangeSpec.slice(1), 10);
          if (isNaN(suffixLen) || suffixLen <= 0) {
            reply.header('Content-Range', `bytes */${att.size}`);
            return reply.code(416).send({ error: 'Range Not Satisfiable' });
          }
          start = Math.max(0, att.size - suffixLen);
          end = att.size - 1;
        } else {
          const parts = rangeSpec.split('-');
          if (parts.length !== 2) {
            reply.header('Content-Range', `bytes */${att.size}`);
            return reply.code(416).send({ error: 'Range Not Satisfiable' });
          }
          start = parseInt(parts[0], 10);
          end = parts[1] === '' ? att.size - 1 : parseInt(parts[1], 10);
        }

        if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= att.size || att.size === 0) {
          reply.header('Content-Range', `bytes */${att.size}`);
          return reply.code(416).send({ error: 'Range Not Satisfiable' });
        }

        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(att.filePath, { start, end });
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${att.size}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', chunkSize);
        reply.header('Content-Type', att.mimeType);
        return reply.send(stream);
      } else {
        reply.header('Content-Type', att.mimeType);
        reply.header('Content-Length', att.size);
        return reply.send(fs.createReadStream(att.filePath));
      }
    });

    // API: Import file into vault
    this.fastify.post('/api/import/file', async (req, reply) => {
      let fileName = 'imported-note.md';
      let content = '';
      let asBoard = false;

      const customName = req.headers['x-file-name'] as string;
      if (customName) {
        try {
          fileName = decodeURIComponent(customName);
        } catch {
          fileName = customName;
        }
      }

      if (Buffer.isBuffer(req.body)) {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.docx') {
          const tempPath = path.join(os.tmpdir(), `doks-import-${Date.now()}.docx`);
          fs.writeFileSync(tempPath, req.body);
          try {
            const xml = execSync(`tar -xf "${tempPath}" -O word/document.xml`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            content = docxXmlToMarkdown(xml);
          } catch (e) {
            content = req.body.toString('utf8');
          } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          }
        } else {
          content = req.body.toString('utf8');
        }
      } else if (typeof req.body === 'object' && req.body !== null) {
        const body = req.body as any;
        if (body.fileName) fileName = body.fileName;
        if (body.asBoard !== undefined) asBoard = Boolean(body.asBoard);
        if (body.content) content = body.content;
      }

      const ext = path.extname(fileName).toLowerCase();
      const baseName = path.basename(fileName, ext);
      const indexDoc = this.docManager.getOrCreateDoc(DOC_INDEX);
      const { notes, boards } = getIndexMaps(indexDoc);

      if (ext === '.csv' || ext === '.tsv') {
        if (asBoard) {
          const boardId = crypto.randomUUID();
          boards.set(boardId, {
            id: boardId,
            title: baseName,
            folder: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deleted: false
          });
          const boardDoc = this.docManager.getOrCreateDoc(getBoardDocName(boardId));
          const { nodes } = getBoardMaps(boardDoc);
          const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
          lines.slice(0, 100).forEach((line, i) => {
            const nodeId = crypto.randomUUID();
            const nodeMap = new Y.Map();
            nodeMap.set('id', nodeId);
            nodeMap.set('type', 'sticky');
            nodeMap.set('x', 100 + (i % 5) * 220);
            nodeMap.set('y', 100 + Math.floor(i / 5) * 160);
            nodeMap.set('w', 200);
            nodeMap.set('h', 140);
            nodeMap.set('text', new Y.Text(line));
            nodeMap.set('color', '1');
            nodeMap.set('author', this.config.memberName);
            nodeMap.set('done', false);
            nodeMap.set('z', i + 1);
            nodeMap.set('deleted', false);
            nodes.set(nodeId, nodeMap);
          });
          return { success: true, created: 1, skipped: 0, errors: [], type: 'board', id: boardId };
        } else {
          const md = csvToMarkdown(content);
          const noteId = crypto.randomUUID();
          notes.set(noteId, {
            id: noteId,
            title: baseName,
            folder: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deleted: false
          });
          const noteDoc = this.docManager.getOrCreateDoc(getNoteDocName(noteId));
          getNoteText(noteDoc).insert(0, md);
          return { success: true, created: 1, skipped: 0, errors: [], type: 'note', id: noteId };
        }
      } else if (ext === '.html') {
        const md = htmlToMarkdown(content);
        const noteId = crypto.randomUUID();
        notes.set(noteId, {
          id: noteId,
          title: baseName,
          folder: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deleted: false
        });
        const noteDoc = this.docManager.getOrCreateDoc(getNoteDocName(noteId));
        getNoteText(noteDoc).insert(0, md);
        return { success: true, created: 1, skipped: 0, errors: [], type: 'note', id: noteId };
      } else if (ext === '.canvas') {
        try {
          const canvasData = JSON.parse(content);
          const boardId = crypto.randomUUID();
          boards.set(boardId, {
            id: boardId,
            title: baseName,
            folder: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deleted: false
          });
          const boardDoc = this.docManager.getOrCreateDoc(getBoardDocName(boardId));
          const { nodes, edges } = getBoardMaps(boardDoc);
          if (Array.isArray(canvasData.nodes)) {
            for (const n of canvasData.nodes) {
              const nodeMap = new Y.Map();
              nodeMap.set('id', n.id);
              nodeMap.set('type', n.type || 'text');
              nodeMap.set('x', n.x ?? 0);
              nodeMap.set('y', n.y ?? 0);
              nodeMap.set('w', n.width ?? 200);
              nodeMap.set('h', n.height ?? 120);
              nodeMap.set('text', new Y.Text(n.text || ''));
              nodeMap.set('color', n.color || '1');
              nodeMap.set('author', n.author || this.config.memberName);
              nodeMap.set('done', Boolean(n.done));
              nodeMap.set('z', 1);
              nodeMap.set('deleted', false);
              nodes.set(n.id, nodeMap);
            }
          }
          if (Array.isArray(canvasData.edges)) {
            for (const e of canvasData.edges) {
              edges.set(e.id, {
                id: e.id,
                from: e.fromNode,
                to: e.toNode,
                fromSide: e.fromSide,
                toSide: e.toSide,
                label: e.label,
                deleted: false
              });
            }
          }
          return { success: true, created: 1, skipped: 0, errors: [], type: 'board', id: boardId };
        } catch (e: any) {
          return reply.code(400).send({ error: `Invalid canvas JSON: ${e.message}` });
        }
      } else {
        const noteId = crypto.randomUUID();
        notes.set(noteId, {
          id: noteId,
          title: baseName,
          folder: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deleted: false
        });
        const noteDoc = this.docManager.getOrCreateDoc(getNoteDocName(noteId));
        getNoteText(noteDoc).insert(0, content);
        return { success: true, created: 1, skipped: 0, errors: [], type: 'note', id: noteId };
      }
    });

    // API: Export Vault as .zip (Streaming ZIP without execSync - F10)
    const handleVaultZipExport = async (req: any, reply: any) => {
      const scope = (req.query as any)?.scope;
      let vaultDir = this.config.vaultPath;
      if (scope === 'solo') {
        const soloDir = path.join(vaultDir, 'solo');
        if (fs.existsSync(soloDir)) vaultDir = soloDir;
      }
      if (!fs.existsSync(vaultDir)) {
        return reply.code(404).send({ error: 'Vault directory does not exist' });
      }

      try {
        reply.raw.setHeader('Content-Type', 'application/zip');
        reply.raw.setHeader('Content-Disposition', 'attachment; filename="doks-vault.zip"');
        await streamDirectoryAsZip(vaultDir, reply.raw);
        reply.raw.end();
      } catch (err: any) {
        if (!reply.raw.headersSent) {
          return reply.code(500).send({ error: `Export failed: ${err.message}` });
        }
      }
    };
    this.fastify.get('/api/export/vault', handleVaultZipExport);
    this.fastify.get('/api/export/zip', handleVaultZipExport);

    // API: Export single note
    this.fastify.get('/api/export/note/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const scope = ((req.query as any)?.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { notes } = getIndexMaps(indexDoc);
      const meta = notes.get(id);
      if (!meta || meta.deleted) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      const noteDoc = this.docManager.getOrCreateDoc(getScopedNoteDocName(scope, id));
      const content = getNoteText(noteDoc).toString();
      const safeTitle = encodeURIComponent(meta.title || 'note');
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      return reply.send(content);
    });

    // API: Export single board
    this.fastify.get('/api/export/board/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const scope = ((req.query as any)?.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { boards } = getIndexMaps(indexDoc);
      const meta = boards.get(id);
      if (!meta || meta.deleted) {
        return reply.code(404).send({ error: 'Board not found' });
      }

      const boardDoc = this.docManager.getOrCreateDoc(getScopedBoardDocName(scope, id));
      const { nodes, edges } = getBoardMaps(boardDoc);
      const canvasNodes: any[] = [];
      const canvasEdges: any[] = [];

      nodes.forEach((nodeMap, nodeId) => {
        const data = nodeMapToData(nodeId, nodeMap);
        if (!data.deleted) {
          canvasNodes.push({
            id: data.id,
            type: data.type === 'note' ? 'file' : data.type,
            x: data.x,
            y: data.y,
            width: data.w,
            height: data.h,
            text: data.text,
            color: data.color,
            author: data.author,
            done: data.done
          });
        }
      });

      edges.forEach((edgeData, edgeId) => {
        if (!edgeData.deleted) {
          canvasEdges.push({
            id: edgeId,
            fromNode: edgeData.from,
            toNode: edgeData.to,
            fromSide: edgeData.fromSide,
            toSide: edgeData.toSide,
            label: edgeData.label
          });
        }
      });

      const canvasJson = JSON.stringify({ nodes: canvasNodes, edges: canvasEdges }, null, 2);
      const safeTitle = encodeURIComponent(meta.title || 'board');
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${safeTitle}.canvas"`);
      return reply.send(canvasJson);
    });

    // API: Export AI Context (Section 5)
    this.fastify.get('/api/export/ai', async (req, reply) => {
      const query = (req.query as any) || {};
      if (!query.boardId) {
        return reply.code(400).send({ error: 'boardId is required' });
      }
      const options: any = {
        boardId: query.boardId,
        scope: query.scope || 'all',
        includeNotes: query.includeNotes || 'cards',
        includeAttachments: query.includeAttachments || 'list',
        workspaceScope: query.workspaceScope || 'team'
      };
      return generateAiContext(this.docManager, options);
    });

    this.fastify.post('/api/export/ai', async (req, reply) => {
      const body = req.body as AiExportOptions;
      if (!body?.boardId) {
        return reply.code(400).send({ error: 'boardId is required' });
      }

      const result = generateAiContext(this.docManager, body);
      return result;
    });

    // WebSocket bridge for browser client
    this.fastify.register(async (fastify) => {
      fastify.get('/ws', { websocket: true }, (socket, req) => {
        const queryScope = ((req.query as any)?.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
        // B21: Selective doc subscription set per socket
        const subscribedDocs = new Set<string>();

        const isDocSubscribed = (docName: string) => {
          return (
            subscribedDocs.size === 0 ||
            subscribedDocs.has(docName) ||
            docName === DOC_INDEX ||
            docName === `${queryScope}:${DOC_INDEX}`
          );
        };

        // Handle sync and awareness between local web UI and docManager
        socket.on('message', (raw: Buffer | string) => {
          try {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            const msg = decodeMessage(text);

            if (msg.type === 'sync') {
              const data = base64ToUint8Array(msg.data);
              const response = this.docManager.handleSyncMessage(
                msg.docName,
                data,
                'client'
              );
              if (response) {
                socket.send(
                  encodeMessage({
                    type: 'sync',
                    docName: msg.docName,
                    data: uint8ArrayToBase64(response)
                  })
                );
              }
            } else if (msg.type === 'awareness') {
              // Apply browser awareness state and broadcast to mesh if not solo
              const data = base64ToUint8Array(msg.data);
              try {
                awarenessProtocol.applyAwarenessUpdate(this.docManager.getAwareness(queryScope), data, 'client');
              } catch (err) {
                console.error('[HttpServer] Awareness error:', err);
              }
              if (queryScope !== 'solo') {
                this.peerService.broadcastAwareness(msg.docName, data);
              }
            } else if (msg.type === 'subscribe') {
              // B21: selective subscription
              subscribedDocs.add(msg.docName);
            } else if (msg.type === 'unsubscribe') {
              subscribedDocs.delete(msg.docName);
            } else if (msg.type === 'ping') {
              socket.send(encodeMessage({ type: 'pong', timestamp: Date.now() }));
            }
          } catch (err) {
            console.error('[HttpServer] WS error:', err);
          }
        });

        // Forward doc updates to the browser
        const updateListener = ({ scope: docScope, docName, update, origin }: any) => {
          if (origin === 'client' || socket.readyState !== socket.OPEN) return;
          if (docScope && docScope !== queryScope && !docName.startsWith(queryScope)) {
            return;
          }

          if (isDocSubscribed(docName)) {
            const syncMsg = this.docManager.createUpdateSyncMessage(update);
            socket.send(
              encodeMessage({
                type: 'sync',
                docName,
                data: uint8ArrayToBase64(syncMsg)
              })
            );
          }
        };

        // Forward peer awareness updates to the browser (only for team scope)
        const peerAwarenessListener = ({ docName, data }: { docName: string; data: Uint8Array }) => {
          if (queryScope === 'solo') return;
          if (socket.readyState === socket.OPEN && isDocSubscribed(docName)) {
            socket.send(
              encodeMessage({
                type: 'awareness',
                docName,
                data: uint8ArrayToBase64(data)
              })
            );
          }
        };

        this.docManager.on('update', updateListener);
        this.peerService.on('awareness', peerAwarenessListener);

        socket.on('close', () => {
          this.docManager.off('update', updateListener);
          this.peerService.off('awareness', peerAwarenessListener);
        });
      });
    });

    // Fallback for SPA routing if dist exists
    if (fs.existsSync(this.webDistPath)) {
      this.fastify.setNotFoundHandler((req, reply) => {
        if (!req.raw.url?.startsWith('/api')) {
          reply.sendFile('index.html');
        } else {
          reply.code(404).send({ error: 'Not found' });
        }
      });
    }
  }

  public async start(): Promise<void> {
    const hostToBind = (this.config.bindAddress && this.config.bindAddress !== 'auto' && this.config.bindAddress !== '127.0.0.1')
      ? this.config.bindAddress
      : (process.env.DOKS_HOST || '0.0.0.0');
    const freePort = await findAvailablePort(
      this.config.webPort,
      hostToBind
    );
    if (freePort !== this.config.webPort) {
      console.warn(`[HttpServer] Port ${this.config.webPort} is busy, auto-switching to free port ${freePort}`);
      this.config.webPort = freePort;
    }

    await this.fastify.listen({
      port: this.config.webPort,
      host: hostToBind
    });
    console.log(
      `[HttpServer] Local UI & API listening at http://${hostToBind}:${this.config.webPort}`
    );
  }

  public async stop(): Promise<void> {
    try {
      if (this.fastify.server) {
        if (typeof (this.fastify.server as any).closeAllConnections === 'function') {
          (this.fastify.server as any).closeAllConnections();
        } else if (typeof (this.fastify.server as any).closeIdleConnections === 'function') {
          (this.fastify.server as any).closeIdleConnections();
        }
      }
    } catch {}
    await this.fastify.close();
  }
}
