import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
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
  type AiExportOptions,
  boardToJSONCanvas
} from '@doks/shared';
import { DocManager } from '../storage/doc-manager.js';
import { PeerService } from '../peer/peer-service.js';
import { AttachmentManager } from '../storage/attachments.js';
import { extractTextFromDocxBuffer } from '../storage/docx-extractor.js';
import { extractTextFromPdfBuffer } from '../storage/pdf-extractor.js';
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
import { BridgeService } from './bridge-service.js';

function resolveWebDist(custom?: string): string {
  if (custom && fs.existsSync(custom)) return custom;
  let currentDir = process.cwd();
  if (typeof __dirname !== 'undefined') {
    currentDir = __dirname;
  } else {
    try {
      if (typeof import.meta !== 'undefined' && import.meta?.url) {
        currentDir = path.dirname(fileURLToPath(import.meta.url));
      }
    } catch {}
  }
  const candidates = [
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), 'release/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../web/dist'),
    path.resolve(currentDir, './web/dist'),
    path.resolve(currentDir, '../web/dist'),
    path.resolve(currentDir, '../../web/dist'),
    path.resolve(currentDir, '../../../web/dist'),
    path.resolve(currentDir, '../../../../web/dist')
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
  private peerSessionToken: string = generateSessionToken();
  private webDistPath: string;
  private p2pMeshEnabled = true;
  private bridgeService: BridgeService;

  constructor(options: HttpServerOptions) {
    this.config = options.config;
    this.docManager = options.docManager;
    this.peerService = options.peerService;
    this.snapshotManager = options.snapshotManager;
    this.attachmentManager = options.attachmentManager;
    this.sessionToken = generateSessionToken();
    this.webDistPath = resolveWebDist(options.webDistPath);
    this.bridgeService = new BridgeService(this.config.webPort || 3000, this.config.statePath);

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
    this.fastify.addHook('onSend', async (req, reply) => {
      reply.header('Referrer-Policy', 'no-referrer');
      if (req.url.startsWith('/api/attachments/')) {
        reply.header('X-Frame-Options', 'SAMEORIGIN');
      } else {
        reply.header('X-Frame-Options', 'DENY');
      }
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
            originPort === 4780 ||
            originPort === 5173 ||
            originPort === 5174 ||
            originPort === 3000 ||
            (!originUrl.port && (this.config.webPort === 80 || this.config.webPort === 443));

          const isCloudflareOrigin = this.bridgeService.getStatus().enabled && originUrl.hostname.endsWith('.trycloudflare.com');
          if (isCloudflareOrigin) {
            // Allowed origin for active Cloudflare tunnel
          } else if (!isAllowedOriginHost || !isAllowedOriginPort) {
            reply.code(403).send({ error: 'Forbidden: Invalid Origin header' });
            return;
          }
        } catch {
          reply.code(403).send({ error: 'Forbidden: Invalid Origin header' });
          return;
        }
      }

      // Check query parameter for bridge token /?b=... or /?bridge=...
      const queryBridgeToken = (req.query as any)?.b || (req.query as any)?.bridge;
      if (queryBridgeToken && typeof queryBridgeToken === 'string' && this.bridgeService.isValidBridgeToken(queryBridgeToken)) {
        reply.setCookie('doks_bridge', queryBridgeToken, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax'
        });
      }

      // Check route authentication
      const urlPath = req.url.split('?')[0];
      const isApiOrWs = urlPath.startsWith('/api') || urlPath.startsWith('/ws');
      const isAttachmentContentGet = req.method === 'GET' && urlPath.endsWith('/content');
      const isAttachmentGet = req.method === 'GET' && urlPath.startsWith('/api/attachments/') && !isAttachmentContentGet;

      const isViewer = this.isViewerSession(req);

      // If client is in Bridge Viewer Mode:
      if (isViewer) {
        // Enforce STRICT Read-Only on bridge viewer: reject any state mutation
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
          reply.code(403).send({ error: 'Read-Only Bridge Mode' });
          return;
        }
      }

      if (isApiOrWs && !isAttachmentGet) {
        const isBridgeViewerAllowed =
          isViewer &&
          req.method === 'GET' &&
          !urlPath.startsWith('/api/bridge/enable') &&
          !urlPath.startsWith('/api/bridge/disable');

        if (!this.isValidSession(req) && !isBridgeViewerAllowed) {
          reply.code(401).send({ error: 'Unauthorized: Valid doks_session or doks_peer cookie required' });
          return;
        }
      } else {
        // Issue session cookie for static routes if missing and not in viewer mode
        if (!isViewer) {
          if (this.isLoopbackRequest(req) && !req.cookies?.doks_session) {
            reply.setCookie('doks_session', this.sessionToken, {
              path: '/',
              httpOnly: true,
              sameSite: 'lax'
            });
          } else if (this.isPrivateNetworkRequest(req) && !req.cookies?.doks_peer) {
            reply.setCookie('doks_peer', this.peerSessionToken, {
              path: '/',
              httpOnly: true,
              sameSite: 'lax'
            });
          }
        }
      }
    });
  }

  public getBridgeService(): BridgeService {
    return this.bridgeService;
  }

  private isLoopbackRequest(req: any): boolean {
    const ip = (req.ip || req.raw?.socket?.remoteAddress || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1';
  }

  private isPrivateNetworkRequest(req: any): boolean {
    const ip = (req.ip || req.raw?.socket?.remoteAddress || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (ip.startsWith('26.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('10.')) return true;
    const match = ip.match(/^172\.(\d+)\./);
    if (match) {
      const octet = parseInt(match[1], 10);
      if (octet >= 16 && octet <= 31) return true;
    }
    return false;
  }

  private isHostSession(req: any): boolean {
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

  private isPeerCollabSession(req: any): boolean {
    const cookieToken = req.cookies?.doks_peer;
    const xDoksToken = req.headers?.['x-doks-token'];
    const queryToken = (req.query as any)?.token;
    const token = cookieToken || xDoksToken || queryToken;
    if (!token || typeof token !== 'string') return false;

    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(this.peerSessionToken);
    if (tokenBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(tokenBuf, expectedBuf);
  }

  private isViewerSession(req: any): boolean {
    const bridgeCookie = req.cookies?.doks_bridge;
    const bridgeHeader = req.headers?.['x-doks-bridge'];
    const queryBridgeToken = (req.query as any)?.b || (req.query as any)?.bridge;
    const token = bridgeCookie || bridgeHeader || queryBridgeToken;
    return typeof token === 'string' && this.bridgeService.isValidBridgeToken(token);
  }

  private isValidSession(req: any): boolean {
    return this.isHostSession(req) || this.isPeerCollabSession(req);
  }

  private isValidPeerOrigin(originStr: string): boolean {
    try {
      const parsed = new URL(originStr);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      const hostname = parsed.hostname.toLowerCase();

      // Block metadata / cloud internals / link-local / wildcards
      if (
        hostname === '169.254.169.254' ||
        hostname === 'metadata.google.internal' ||
        hostname === '0.0.0.0'
      ) {
        return false;
      }

      // Check port
      const portNum = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

      // Localhost / Loopback is valid
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return true;
      }

      // Allow known peers & LAN rooms from peer service
      if (this.peerService) {
        for (const p of this.peerService.getPeersStatus()) {
          if (p.address && p.address.split(':')[0].toLowerCase() === hostname) {
            return true;
          }
        }
        for (const room of this.peerService.getDiscoveredLanRooms()) {
          if (room.host && room.host.toLowerCase() === hostname) {
            return true;
          }
        }
      }

      // Allow RFC1918 private IPv4 and Radmin VPN (26.0.0.0/8)
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const m = hostname.match(ipv4Regex);
      if (m) {
        const o1 = parseInt(m[1], 10);
        const o2 = parseInt(m[2], 10);
        const o3 = parseInt(m[3], 10);
        const o4 = parseInt(m[4], 10);
        if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
        if (o1 === 10) return true;
        if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
        if (o1 === 192 && o2 === 168) return true;
        if (o1 === 26) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private setupRoutes(): void {
    // API: Config & Peer status
    this.fastify.get('/api/status', async (req) => {
      const radminIp = detectRadminIp();
      const preferred = detectPreferredMeshIp();
      const isViewer = this.isViewerSession(req);
      const isHost = !isViewer && (this.isHostSession(req) || this.isLoopbackRequest(req));
      const isPeer = !isViewer && !isHost && (this.isPeerCollabSession(req) || this.isPrivateNetworkRequest(req));

      const networkOverview = detectNetworkOverview({
        p2pEnabled: this.p2pMeshEnabled,
        teamKey: this.config.teamKey,
        port: this.config.peerPort,
        peerId: this.config.agentId
      });

      let token: string | undefined = undefined;
      if (isHost) {
        token = this.sessionToken;
      } else if (isPeer) {
        token = this.peerSessionToken;
      }

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
        token,
        isHost,
        isPeer,
        // B17: Do not expose raw teamKey without session authentication (host only)
        teamKey: isHost ? this.config.teamKey : undefined,
        keyFingerprint:
          isHost && this.config.teamKey
            ? crypto
                .createHash('sha256')
                .update(this.config.teamKey)
                .digest('hex')
                .slice(0, 8)
                .replace(/^(.{4})(.{4})$/, '$1-$2')
            : undefined,
        inviteLink: networkOverview.inviteUri,
        inviteUri: networkOverview.inviteUri,
        viewerMode: isViewer,
        allowSolo: isViewer ? this.bridgeService.isSoloAllowed() : isHost,
        bridge: this.bridgeService.getStatus()
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

    // API: Bridge Service Status & Control
    this.fastify.get('/api/bridge/status', async () => {
      return this.bridgeService.getStatus();
    });

    this.fastify.post('/api/bridge/enable', async (req, reply) => {
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Bridge management requires host privileges' });
      }
      const body = (req.body as any) || {};
      return await this.bridgeService.enableBridge(body);
    });

    this.fastify.post('/api/bridge/disable', async (req, reply) => {
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Bridge management requires host privileges' });
      }
      return this.bridgeService.disableBridge();
    });

    // API: Change team key (with automatic backup snapshot)
    this.fastify.post('/api/team-key', async (req, reply) => {
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Team key configuration requires host privileges' });
      }
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
    this.fastify.get('/api/boards', async (req, reply) => {
      const scopeQuery = (req.query as any)?.scope;
      const isHost = this.isHostSession(req);
      if (scopeQuery === 'solo' && !isHost) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
      const soloBoards = isHost ? this.docManager.listBoards('solo') : [];
      const teamBoards = this.docManager.listBoards('team');
      if (scopeQuery === 'solo') return soloBoards;
      if (scopeQuery === 'team') return teamBoards;
      return [...soloBoards, ...teamBoards];
    });

    // API: Create board
    this.fastify.post('/api/boards', async (req, reply) => {
      const body = (req.body as any) || {};
      const scope = (body.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
    this.fastify.get('/api/notes', async (req, reply) => {
      const scopeQuery = (req.query as any)?.scope;
      const isHost = this.isHostSession(req);
      if (scopeQuery === 'solo' && !isHost) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
    this.fastify.post('/api/notes', async (req, reply) => {
      const body = (req.body as any) || {};
      const scope = (body.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (!this.isHostSession(req)) {
        return reply.code(403).send({
          success: false,
          error: 'Forbidden: Cross-scope bridge transfer requires host privileges'
        });
      }
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
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Restoring snapshots requires host privileges' });
      }
      if (!this.snapshotManager) return reply.code(400).send({ error: 'Snapshots disabled' });
      const body = req.body as { snapshotId?: string; docName?: string };
      if (!body?.snapshotId) {
        return reply.code(400).send({ error: 'snapshotId is required' });
      }
      const success = this.snapshotManager.restoreSnapshot(body.snapshotId, body.docName);
      return { success };
    });

    this.fastify.post('/api/snapshots/:id/restore', async (req, reply) => {
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Restoring snapshots requires host privileges' });
      }
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
        const scope = ((req.query as any)?.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
        const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
        const { attachments } = getIndexMaps(indexDoc);
        attachments.set(info.hash, {
          hash: info.hash,
          name: info.fileName,
          size: info.size,
          mime: info.mimeType,
          addedBy: this.config.memberName,
          addedAt: Date.now(),
          deleted: false,
          scope
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
      if (!this.isValidSession(req)) {
        return reply.code(401).send({ error: 'Unauthorized: Valid doks_session required' });
      }
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
          } else if (lowerName.endsWith('.pdf') || att.mimeType === 'application/pdf') {
            text = extractTextFromPdfBuffer(buf);
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

      // Check solo attachment unauthorized leak
      if (!this.isValidSession(req)) {
        const soloIndex = this.docManager.getDoc(getScopedIndexDocName('solo'));
        const teamIndex = this.docManager.getDoc(getScopedIndexDocName('team'));
        const isSolo = soloIndex ? getIndexMaps(soloIndex).attachments.has(hash) : false;
        const isTeam = teamIndex ? getIndexMaps(teamIndex).attachments.has(hash) : false;
        const isViewer = this.isViewerSession(req);
        const allowSolo = isViewer && this.bridgeService.isSoloAllowed();
        if (isSolo && !isTeam && !allowSolo) {
          return reply.code(401).send({ error: 'Unauthorized: Solo attachment requires session authentication' });
        }
      }

      let att = this.attachmentManager.getAttachment(hash);
      if (!att || !fs.existsSync(att.filePath)) {
        // Multi-User P2P Attachment Auto-Fetch on Cache Miss
        const originQuery = (req.query as { origin?: string })?.origin;
        const candidateOrigins: string[] = [];
        if (originQuery && originQuery.startsWith('http')) {
          const originTrimmed = originQuery.replace(/\/$/, '');
          if (this.isValidPeerOrigin(originTrimmed)) {
            candidateOrigins.push(originTrimmed);
          }
        }
        if (this.peerService) {
          for (const p of this.peerService.getPeersStatus()) {
            if (p.connected && p.address) {
              const host = p.address.split(':')[0];
              const httpPort = (p as any).webPort || this.config.webPort || 4747;
              candidateOrigins.push(`http://${host}:${httpPort}`);
              if (httpPort !== 3000) candidateOrigins.push(`http://${host}:3000`);
              if (httpPort !== 4747) candidateOrigins.push(`http://${host}:4747`);
            }
          }
        }

        let fetched = false;
        for (const candidate of candidateOrigins) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(`${candidate}/api/attachments/${hash}`, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
              const arrayBuf = await res.arrayBuffer();
              const buf = Buffer.from(arrayBuf);
              const contentDisp = res.headers.get('content-disposition') || '';
              const matchName = contentDisp.match(/filename="?([^";]+)"?/);
              const fetchedName = matchName ? decodeURIComponent(matchName[1]) : `${hash.slice(0, 8)}.bin`;
              this.attachmentManager.saveAttachment(buf, fetchedName);
              att = this.attachmentManager.getAttachment(hash);
              if (att && fs.existsSync(att.filePath)) {
                fetched = true;
                break;
              }
            }
          } catch {}
        }

        if (!fetched || !att || !fs.existsSync(att.filePath)) {
          return reply.code(404).send({ error: 'Attachment not found' });
        }
      }

      // CORS & Security headers for attachments
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      reply.header('X-Content-Type-Options', 'nosniff');
      if (att.mimeType === 'application/pdf') {
        reply.header('Content-Security-Policy', "default-src 'self' blob: data:; style-src 'unsafe-inline';");
      } else {
        reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      }

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
      const scope = ((req.query as any)?.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;

      const customName = req.headers['x-file-name'] as string;
      if (customName) {
        try {
          fileName = decodeURIComponent(customName);
        } catch {
          fileName = customName;
        }
      }

      if (req.headers['x-as-board'] === 'true' || req.headers['x-as-board'] === '1') {
        asBoard = true;
      }

      if (Buffer.isBuffer(req.body)) {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.docx') {
          try {
            content = extractTextFromDocxBuffer(req.body);
          } catch {
            content = '';
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
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
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
          const boardDoc = this.docManager.getOrCreateDoc(getScopedBoardDocName(scope, boardId));
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
          const noteDoc = this.docManager.getOrCreateDoc(getScopedNoteDocName(scope, noteId));
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
        const noteDoc = this.docManager.getOrCreateDoc(getScopedNoteDocName(scope, noteId));
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
          const boardDoc = this.docManager.getOrCreateDoc(getScopedBoardDocName(scope, boardId));
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
        const noteDoc = this.docManager.getOrCreateDoc(getScopedNoteDocName(scope, noteId));
        getNoteText(noteDoc).insert(0, content);
        return { success: true, created: 1, skipped: 0, errors: [], type: 'note', id: noteId };
      }
    });

    // API: Export Vault as .zip (Streaming ZIP without execSync - F10)
    const handleVaultZipExport = async (req: any, reply: any) => {
      const scope = (req.query as any)?.scope;
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
      const indexDoc = this.docManager.getOrCreateDoc(getScopedIndexDocName(scope));
      const { boards } = getIndexMaps(indexDoc);
      const meta = boards.get(id);
      if (!meta || meta.deleted) {
        return reply.code(404).send({ error: 'Board not found' });
      }

      const boardDoc = this.docManager.getOrCreateDoc(getScopedBoardDocName(scope, id));
      const { nodes, edges } = getBoardMaps(boardDoc);
      const activeNodes: any[] = [];
      const activeEdges: any[] = [];

      nodes.forEach((nodeMap, nodeId) => {
        const data = nodeMapToData(nodeId, nodeMap);
        if (!data.deleted) {
          activeNodes.push(data);
        }
      });

      edges.forEach((edgeData, edgeId) => {
        if (!edgeData.deleted) {
          activeEdges.push({
            ...edgeData,
            id: edgeData.id || edgeId
          });
        }
      });

      const canvasObj = boardToJSONCanvas(activeNodes, activeEdges);
      const canvasJson = JSON.stringify(canvasObj, null, 2);
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
        const isViewer = this.isViewerSession(req);
        const isHost = !isViewer && (this.isHostSession(req) || this.isLoopbackRequest(req));
        const allowSolo = isHost || (isViewer && this.bridgeService.isSoloAllowed());

        if (queryScope === 'solo' && !isHost && !allowSolo) {
          socket.close(4403, 'Forbidden: Solo scope is restricted to host');
          return;
        }

        // B21: Selective doc subscription set per socket
        const subscribedDocs = new Set<string>();

        const isDocSubscribed = (docName: string) => {
          if (!isHost && docName.startsWith('solo:') && !allowSolo) {
            return false;
          }
          return (
            subscribedDocs.size === 0 ||
            subscribedDocs.has(docName) ||
            docName === DOC_INDEX ||
            docName === `${queryScope}:${DOC_INDEX}` ||
            docName === `solo:${DOC_INDEX}` ||
            docName === `team:${DOC_INDEX}`
          );
        };

        // Handle sync and awareness between local web UI and docManager
        socket.on('message', (raw: Buffer | string) => {
          try {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            const msg = decodeMessage(text);

            if (msg.type === 'sync') {
              const data = base64ToUint8Array(msg.data);

              if (msg.docName?.startsWith('solo:') && !allowSolo) {
                return;
              }

              // If socket is in read-only viewer mode:
              if (isViewer) {
                // Check Yjs message type (first byte): syncStep1 = 0, syncStep2 = 1, syncUpdate = 2
                // A read-only viewer must only send syncStep1
                const syncType = data[0];
                if (syncType === 2 || syncType === 1) {
                  // Ignore mutations from read-only bridge viewer
                  return;
                }
              }

              const response = this.docManager.handleSyncMessage(
                msg.docName,
                data,
                isViewer ? 'viewer' : 'client'
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
              if (isViewer) {
                // Ignore awareness writes from viewer
                return;
              }
              const isSolo = msg.docName?.startsWith('solo:');
              if (isSolo && !isHost) {
                return;
              }
              // Apply browser awareness state and broadcast to mesh if not solo
              const data = base64ToUint8Array(msg.data);
              const awarenessScope = isSolo ? 'solo' : 'team';
              try {
                awarenessProtocol.applyAwarenessUpdate(this.docManager.getAwareness(awarenessScope), data, 'client');
              } catch (err) {
                console.error('[HttpServer] Awareness error:', err);
              }
              if (!isSolo && queryScope !== 'solo') {
                this.peerService.broadcastAwareness(msg.docName, data);
              }
            } else if (msg.type === 'subscribe') {
              if (msg.docName?.startsWith('solo:') && !allowSolo) {
                return;
              }
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
          if (docName.startsWith('solo:') && !allowSolo) return;

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
    const hostToBind = process.env.DOKS_HOST || '0.0.0.0';
    const freePort = await findAvailablePort(
      this.config.webPort,
      hostToBind
    );
    if (freePort !== this.config.webPort) {
      console.warn(`[HttpServer] Port ${this.config.webPort} is busy, auto-switching to free port ${freePort}`);
      this.config.webPort = freePort;
      this.bridgeService.setWebPort(this.config.webPort);
    }

    await this.fastify.listen({
      port: this.config.webPort,
      host: hostToBind
    });
    const radminIp = detectRadminIp();
    console.log(
      `[HttpServer] Local UI & API listening at http://127.0.0.1:${this.config.webPort}${radminIp ? ` (Radmin: http://${radminIp}:${this.config.webPort})` : ''}`
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
