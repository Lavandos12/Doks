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

function safeSocketSend(socket: any, data: string): boolean {
  try {
    if (socket && socket.readyState === 1 /* OPEN */) {
      socket.send(data);
      return true;
    }
  } catch (err) {
    // Socket was closed or closing during send; gracefully ignore to prevent crash
  }
  return false;
}

export const MALICIOUS_PATTERNS = [
  /\.env/i,
  /\.git/i,
  /\.php$/i,
  /wp-/i,
  /phpmyadmin/i,
  /xmlrpc/i,
  /\.asp/i,
  /\.jsp/i,
  /actuator/i,
  /\/\.well-known\/(?!acme-challenge)/i
];

export function isScannerProbe(url: string): boolean {
  const pathname = url.split('?')[0];
  return MALICIOUS_PATTERNS.some((pattern) => pattern.test(url) || pattern.test(pathname));
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
  private static readonly CLOUD_DOMAIN_REGEX = /^([a-z0-9-]+\.)*(onrender\.com|fly\.dev|zeabur\.app|northflank\.app)$/i;
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();
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
      ignoreTrailingSlash: true,
      bodyLimit: 10 * 1024 * 1024
    });

    this.setupPlugins();
    this.setupRoutes();
  }

  private setupPlugins(): void {
    this.fastify.register(fastifyCookie);
    this.fastify.register(fastifyWebsocket);

    // Universal buffer parsers for all attachments (Office, Word, PDF, media, binary)
    this.fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

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

    // Direct share route fallback for SPA routing
    this.fastify.get('/b/:boardId', async (_req, reply) => {
      if (fs.existsSync(this.webDistPath)) {
        return reply.sendFile('index.html');
      } else {
        return reply.type('text/html').send('<!doctype html><html><body><h1>Doks</h1></body></html>');
      }
    });

    this.fastify.get('/b/:boardId/*', async (_req, reply) => {
      if (fs.existsSync(this.webDistPath)) {
        return reply.sendFile('index.html');
      } else {
        return reply.type('text/html').send('<!doctype html><html><body><h1>Doks</h1></body></html>');
      }
    });

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
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self' blob: data:; object-src 'self' blob: data:; connect-src 'self' ws: wss:;"
        );
      }
    });

    // Security hook: Host & Origin verification & Session Authentication
    this.fastify.addHook('onRequest', async (req, reply) => {
      // Immediately drop scanner probes and crawlers before cookie issuance, origin verification, or SPA routing
      if (isScannerProbe(req.url)) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      const host = req.headers.host || '';
      const rawForwarded = req.headers['x-forwarded-host'];
      const effectiveHost = typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : host;
      const [hostName] = effectiveHost.split(':');

      // Strict Host header validation (1.2 & 1.3)
      if (!this.isAllowedHost(hostName)) {
        reply.code(403).send({ error: 'Forbidden: Invalid Host header' });
        return;
      }

      // Cross-Origin check (1.2)
      const origin = req.headers.origin;
      if (origin) {
        try {
          const originUrl = new URL(origin);
          const originHost = originUrl.hostname.toLowerCase();
          const isCloudflareOrigin = this.bridgeService.getStatus().enabled && originHost.endsWith('.trycloudflare.com');
          const isAllowed = originUrl.host === host || this.isAllowedHost(originHost) || isCloudflareOrigin;

          if (!isAllowed) {
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

      // Check query parameter for magic link password ?pwd=... or ?key=...
      const configuredPassword = process.env.DOKS_PASSWORD || process.env.TEAM_PASSWORD || '';
      const queryPwd = (req.query as any)?.pwd || (req.query as any)?.key;
      if (configuredPassword && queryPwd && typeof queryPwd === 'string' && queryPwd === configuredPassword) {
        reply.setCookie('doks_session', this.sessionToken, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax'
        });
        reply.setCookie('doks_peer', this.peerSessionToken, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax'
        });
      }

      // Check route authentication
      const urlPath = req.url.split('?')[0];
      const isViewer = this.isViewerSession(req);
      const isLoopback = this.isLoopbackRequest(req);
      const isHost = !isViewer && (this.isHostSession(req) || isLoopback);

      // Public bootstrap routes accessible without prior cookies:
      // Static UI (/ and /b/), network status, auth login, and on remote/cloud (/api/status, /api/network-status)
      const isPublicBootstrapRoute =
        urlPath === '/' ||
        urlPath.startsWith('/b/') ||
        urlPath === '/api/status' ||
        urlPath === '/api/auth/login' ||
        urlPath === '/api/network-status' ||
        urlPath === '/api/network' ||
        urlPath.startsWith('/assets/') ||
        urlPath === '/favicon.svg';

      // Auto-issue session cookie on any web visit if not in viewer mode and no team password configured
      if (!isViewer && !req.cookies?.doks_session && !req.cookies?.doks_peer) {
        if (!configuredPassword) {
          const tokenToIssue = isLoopback ? this.sessionToken : this.peerSessionToken;
          const cookieName = isLoopback ? 'doks_session' : 'doks_peer';
          reply.setCookie(cookieName, tokenToIssue, {
            path: '/',
            httpOnly: false, // allow JS to read token
            sameSite: 'lax'
          });
        }
      }

      // If client is in Bridge Viewer Mode:
      if (isViewer) {
        // Enforce STRICT Read-Only on bridge viewer: reject any state mutation
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
          reply.code(403).send({ error: 'Read-Only Bridge Mode' });
          return;
        }
      }

      const isApiOrWs = urlPath.startsWith('/api') || urlPath.startsWith('/ws');
      const isAttachmentContentGet = req.method === 'GET' && urlPath.endsWith('/content');
      const isAttachmentGet = req.method === 'GET' && urlPath.startsWith('/api/attachments/') && !isAttachmentContentGet;

      if (configuredPassword && isApiOrWs && !isPublicBootstrapRoute) {
        if (!this.isValidSession(req)) {
          reply.code(401).send({ error: 'Password required', passwordRequired: true });
          return;
        }
      }

      const isWs = urlPath === '/ws' || urlPath.startsWith('/ws');
      if (isApiOrWs && !isAttachmentGet && !isPublicBootstrapRoute && !isWs) {
        const isBridgeViewerAllowed =
          isViewer &&
          req.method === 'GET' &&
          !urlPath.startsWith('/api/bridge/enable') &&
          !urlPath.startsWith('/api/bridge/disable');

        if (!this.isValidSession(req) && !isBridgeViewerAllowed) {
          reply.code(401).send({ error: 'Unauthorized: Valid doks_session or doks_peer cookie required' });
          return;
        }
      }
    });
  }

  public getBridgeService(): BridgeService {
    return this.bridgeService;
  }

  private isPrivateIPv4(ip: string): boolean {
    const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [o1, o2, o3, o4] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
    if (o1 === 10) return true;
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 26) return true; // Radmin VPN 26.0.0.0/8
    return false;
  }

  private isAllowedHost(hostName: string): boolean {
    if (!hostName) return false;
    const lower = hostName.toLowerCase();
    if (lower === '127.0.0.1' || lower === 'localhost' || lower === '::1' || lower === '[::1]') return true;
    if (this.isPrivateIPv4(lower)) return true;
    if (AgentHttpServer.CLOUD_DOMAIN_REGEX.test(lower)) return true;
    if (this.config.bindAddress && this.config.bindAddress !== 'auto' && this.config.bindAddress !== '0.0.0.0') {
      if (lower === this.config.bindAddress.toLowerCase()) return true;
    }
    const radminIp = detectRadminIp();
    if (radminIp && lower === radminIp.toLowerCase()) return true;
    return false;
  }

  private isLoopbackRequest(req: any): boolean {
    const ip = (req.ip || req.raw?.socket?.remoteAddress || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1';
  }

  private isPrivateNetworkRequest(req: any): boolean {
    const ip = (req.ip || req.raw?.socket?.remoteAddress || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return this.isPrivateIPv4(ip);
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
    const queryBridgeToken = (req.query as any)?.b || (req.query as any)?.bridge;
    const bridgeHeader = req.headers?.['x-doks-bridge'];
    // Explicit bridge token via query param or header always indicates bridge viewer session
    if (typeof queryBridgeToken === 'string' && this.bridgeService.isValidBridgeToken(queryBridgeToken)) {
      return true;
    }
    if (typeof bridgeHeader === 'string' && this.bridgeService.isValidBridgeToken(bridgeHeader)) {
      return true;
    }
    // Lingering doks_bridge cookie: ignored if the request has an authenticated host session or is loopback
    const bridgeCookie = req.cookies?.doks_bridge;
    if (typeof bridgeCookie === 'string' && this.bridgeService.isValidBridgeToken(bridgeCookie)) {
      if (this.isHostSession(req) || this.isLoopbackRequest(req)) {
        return false;
      }
      return true;
    }
    return false;
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
    // POST /api/auth/login: Team password authentication with constant-time check & rate limiting (1.4)
    this.fastify.post('/api/auth/login', async (req, reply) => {
      const clientIp = (req.ip || req.raw?.socket?.remoteAddress || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
      const now = Date.now();
      const attempt = this.loginAttempts.get(clientIp);

      if (attempt && attempt.count >= 5 && now < attempt.resetAt) {
        const retryAfter = Math.ceil((attempt.resetAt - now) / 1000);
        reply.header('Retry-After', retryAfter.toString());
        return reply.code(429).send({
          ok: false,
          error: 'Too many failed login attempts. Please try again in 1 minute.',
          retryAfter
        });
      }

      const configuredPassword = process.env.DOKS_PASSWORD || process.env.TEAM_PASSWORD || '';
      if (!configuredPassword) {
        return { ok: true, token: this.sessionToken };
      }
      const body = req.body as any;
      const candidate = (body?.password || '').toString();

      // Timing-attack defense: compare SHA-256 hashes of candidate and configured password with timingSafeEqual
      const hashCandidate = crypto.createHash('sha256').update(candidate, 'utf8').digest();
      const hashExpected = crypto.createHash('sha256').update(configuredPassword, 'utf8').digest();
      const isMatch = crypto.timingSafeEqual(hashCandidate, hashExpected);

      if (isMatch) {
        this.loginAttempts.delete(clientIp);
        reply.setCookie('doks_session', this.sessionToken, { path: '/', httpOnly: false, sameSite: 'lax' });
        reply.setCookie('doks_peer', this.peerSessionToken, { path: '/', httpOnly: false, sameSite: 'lax' });
        return { ok: true, token: this.sessionToken };
      }

      // Record failed attempt
      const newCount = (attempt && now < attempt.resetAt ? attempt.count : 0) + 1;
      this.loginAttempts.set(clientIp, {
        count: newCount,
        resetAt: attempt && now < attempt.resetAt ? attempt.resetAt : now + 60_000
      });

      return reply.code(403).send({ ok: false, error: 'Invalid team password' });
    });

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

      const isAuthRequired = Boolean(process.env.DOKS_PASSWORD || process.env.TEAM_PASSWORD);
      const isAuthenticated = !isAuthRequired || this.isValidSession(req);

      let token: string | undefined = undefined;
      if (!isViewer && isAuthenticated) {
        token = isHost ? this.sessionToken : this.peerSessionToken;
      }
      const effectiveHost = isHost;
      const effectivePeer = isPeer || (!isViewer && !isHost);

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
        isHost: effectiveHost,
        isPeer: effectivePeer,
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
        inviteLink: isHost ? networkOverview.inviteUri : undefined,
        inviteUri: isHost ? networkOverview.inviteUri : undefined,
        viewerMode: isViewer,
        allowSolo: isViewer ? this.bridgeService.isSoloAllowed() : isHost,
        bridge: this.bridgeService.getStatus(),
        passwordRequired: isAuthRequired,
        authenticated: isAuthenticated
      };
    });

    // GET /api/network-status: Direct status overview for ShareModal & co-authors (1.1 masked for non-host)
    this.fastify.get('/api/network-status', async (req) => {
      const isHost = this.isHostSession(req);
      const overview = detectNetworkOverview({
        p2pEnabled: this.p2pMeshEnabled,
        teamKey: isHost ? this.config.teamKey : '',
        port: this.config.peerPort,
        peerId: this.config.agentId
      });
      return {
        ...overview,
        inviteUri: isHost ? overview.inviteUri : undefined,
        inviteLink: isHost ? overview.inviteUri : undefined,
        running: true,
        ip: overview.lanIp || '127.0.0.1',
        port: this.config.webPort,
        radminIp: overview.detectedRadminIp,
        peers: this.peerService.getPeersStatus(),
        connectedCount: this.peerService.getConnectedCount(),
        discoveredLanRooms: this.peerService.getDiscoveredLanRooms()
      };
    });

    // GET /api/network: Guaranteed non-null inviteUri and P2P overview (1.1 masked for non-host)
    this.fastify.get('/api/network', async (req) => {
      const isHost = this.isHostSession(req);
      const overview = detectNetworkOverview({
        p2pEnabled: this.p2pMeshEnabled,
        teamKey: isHost ? this.config.teamKey : '',
        port: this.config.peerPort,
        peerId: this.config.agentId
      });
      return {
        ...overview,
        inviteUri: isHost ? overview.inviteUri : undefined,
        inviteLink: isHost ? overview.inviteUri : undefined,
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

    this.fastify.post('/api/bridge/start', async (req, reply) => {
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Bridge management requires host privileges' });
      }
      const body = (req.body as any) || {};
      const status = await this.bridgeService.enableBridge({
        useCloudflare: body.useCloudflare !== undefined ? body.useCloudflare : true,
        allowSolo: true
      });
      return {
        active: status.enabled,
        url: status.primaryUrl,
        ...status
      };
    });

    this.fastify.post('/api/bridge/stop', async (req, reply) => {
      if (!this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Bridge management requires host privileges' });
      }
      const status = this.bridgeService.disableBridge();
      return {
        active: false,
        ...status
      };
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
      if (!this.isHostSession(req) && !this.isLoopbackRequest(req)) {
        return reply.code(403).send({ error: 'Forbidden: Only host can modify server profile' });
      }
      const raw = req.body;
      const body = (Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : (raw || {})) as { memberName?: string; memberColor?: string };
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

    this.fastify.post('/api/profile', async (req, reply) => {
      if (!this.isHostSession(req) && !this.isLoopbackRequest(req)) {
        return reply.code(403).send({ error: 'Forbidden: Only host can modify server profile' });
      }
      const raw = req.body;
      const body = (Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : (raw || {})) as { memberName?: string; memberColor?: string };
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

    // API: Add peer (1.6 protect team key mutation)
    this.fastify.post('/api/peers', async (req, reply) => {
      const isHost = this.isHostSession(req);
      const body = req.body as { address?: string; peer?: string };
      const target = body?.address || body?.peer;
      if (!target) {
        return reply.code(400).send({ error: 'address or peer is required' });
      }
      this.peerService.addPeer(target, isHost);
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
      const title = (body.title || 'New Board').trim();
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
      const title = (body.title || 'New Note').trim();
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
      const HASH_REGEX = /^[a-f0-9]{64}$/;
      if (!HASH_REGEX.test(hash)) {
        return reply.code(400).send({ error: 'Invalid attachment hash format' });
      }
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
        reply.header('Content-Security-Policy', "default-src 'self' blob: data:; frame-src 'self' blob: data:; object-src 'self' blob: data:; style-src 'self' 'unsafe-inline';");
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
      if (scope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }

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
        await streamDirectoryAsZip(vaultDir, reply.raw, { excludeDirs: scope === 'solo' ? [] : ['solo'] });
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
      const workspaceScope = query.workspaceScope || 'team';
      if (workspaceScope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }
      const options: any = {
        boardId: query.boardId,
        scope: query.scope || 'all',
        includeNotes: query.includeNotes || 'cards',
        includeAttachments: query.includeAttachments || 'list',
        workspaceScope
      };
      return generateAiContext(this.docManager, options);
    });

    this.fastify.post('/api/export/ai', async (req, reply) => {
      const rawBody = req.body;
      const body: AiExportOptions = Buffer.isBuffer(rawBody)
        ? JSON.parse(rawBody.toString('utf8'))
        : ((rawBody || {}) as AiExportOptions);
      if (!body?.boardId) {
        return reply.code(400).send({ error: 'boardId is required' });
      }
      if (body.workspaceScope === 'solo' && !this.isHostSession(req)) {
        return reply.code(403).send({ error: 'Forbidden: Solo workspace is private to host' });
      }

      const result = generateAiContext(this.docManager, body);
      return result;
    });

    // WebSocket bridge for browser client
    this.fastify.register(async (fastify) => {
      interface ConnectedSocketClient {
        socket: any;
        id: string;
        queryScope: WorkspaceScope;
        isViewer: boolean;
        isHost: boolean;
        subscribedDocs: Set<string>;
      }

      const activeClients = new Set<ConnectedSocketClient>();

      fastify.get('/ws', { websocket: true }, (socket, req) => {
        const queryScope = ((req.query as any)?.scope === 'solo' ? 'solo' : 'team') as WorkspaceScope;
        const isViewer = this.isViewerSession(req);
        const isHost = !isViewer && (this.isHostSession(req) || this.isLoopbackRequest(req));
        const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        const currentClient: ConnectedSocketClient = {
          socket,
          id: clientId,
          queryScope,
          isViewer,
          isHost,
          subscribedDocs: new Set<string>()
        };

        activeClients.add(currentClient);

        const isDocSubscribed = (client: ConnectedSocketClient, docName: string) => {
          const isSoloDoc = docName.startsWith('solo:') || docName.includes(':solo:');
          if (isSoloDoc && !client.isHost) {
            return false;
          }
          return (
            client.subscribedDocs.size === 0 ||
            client.subscribedDocs.has(docName) ||
            docName === DOC_INDEX ||
            docName.endsWith(`:${DOC_INDEX}`) ||
            docName.includes('doks-board-') ||
            docName.includes('doks-note-') ||
            docName.startsWith('board:') ||
            docName.includes(':board:') ||
            docName === `${client.queryScope}:${DOC_INDEX}` ||
            (client.isHost && docName === `solo:${DOC_INDEX}`) ||
            docName === `team:${DOC_INDEX}`
          );
        };

        // Forward doc updates to all connected browser clients EXCEPT the sender
        const updateListener = ({ scope: docScope, docName, update, origin }: any) => {
          if (socket.readyState !== socket.OPEN) return;
          // Do not echo back to the same client that originated the change
          if (origin === clientId) return;

          const isSoloDoc = docName.startsWith('solo:') || docName.includes(':solo:');
          if (isSoloDoc && !currentClient.isHost) {
            return;
          }

          if (isDocSubscribed(currentClient, docName)) {
            const syncMsg = this.docManager.createUpdateSyncMessage(update);
            safeSocketSend(
              socket,
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
          if (socket.readyState === socket.OPEN && isDocSubscribed(currentClient, docName)) {
            safeSocketSend(
              socket,
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

        // Handle sync and awareness between local web UI and docManager
        socket.on('message', (raw: Buffer | string) => {
          try {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            const msg = decodeMessage(text);

            const docName = 'docName' in msg ? (msg as any).docName : undefined;
            const isSoloDoc = typeof docName === 'string' && (docName.startsWith('solo:') || docName.includes(':solo:'));
            if (isSoloDoc && !currentClient.isHost) {
              return;
            }

            if (msg.type === 'sync') {
              const data = base64ToUint8Array(msg.data);

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

              // Pass clientId as origin so updateListener knows who sent it
              const response = this.docManager.handleSyncMessage(
                msg.docName,
                data,
                isViewer ? 'viewer' : clientId
              );
              if (response) {
                safeSocketSend(
                  socket,
                  encodeMessage({
                    type: 'sync',
                    docName: msg.docName,
                    data: uint8ArrayToBase64(response)
                  })
                );
              }
              // If client sent SyncStep1 (0), send server's SyncStep1 back to request client's updates
              if (data[0] === 0) {
                const serverStep1 = this.docManager.createSyncStep1Message(msg.docName);
                safeSocketSend(
                  socket,
                  encodeMessage({
                    type: 'sync',
                    docName: msg.docName,
                    data: uint8ArrayToBase64(serverStep1)
                  })
                );
              }
            } else if (msg.type === 'awareness') {
              if (isViewer) {
                // Ignore awareness writes from viewer
                return;
              }

              // 1. Broadcast awareness (live cursor coordinates & user badge) to ALL OTHER connected clients!
              for (const otherClient of activeClients) {
                if (otherClient.socket !== socket && otherClient.socket.readyState === 1 /* OPEN */) {
                  if (isDocSubscribed(otherClient, msg.docName)) {
                    safeSocketSend(
                      otherClient.socket,
                      encodeMessage({
                        type: 'awareness',
                        docName: msg.docName,
                        data: msg.data
                      })
                    );
                  }
                }
              }

              // 2. Apply awareness locally and broadcast to P2P mesh
              const isSolo = msg.docName?.startsWith('solo:');
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
              // B21: selective subscription
              if (msg.docName) {
                currentClient.subscribedDocs.add(msg.docName);
                // Send server's SyncStep1 to prompt client to upload any cached/offline data
                const serverStep1 = this.docManager.createSyncStep1Message(msg.docName);
                safeSocketSend(
                  socket,
                  encodeMessage({
                    type: 'sync',
                    docName: msg.docName,
                    data: uint8ArrayToBase64(serverStep1)
                  })
                );
              }
            } else if (msg.type === 'unsubscribe') {
              currentClient.subscribedDocs.delete(msg.docName);
            } else if (msg.type === 'ping') {
              safeSocketSend(socket, encodeMessage({ type: 'pong', timestamp: Date.now() }));
            }
          } catch (err) {
            console.error('[HttpServer] WS error:', err);
          }
        });

        socket.on('close', () => {
          activeClients.delete(currentClient);
          this.docManager.off('update', updateListener);
          this.peerService.off('awareness', peerAwarenessListener);
        });
      });
    });

    // Fallback for SPA routing if dist exists
    if (fs.existsSync(this.webDistPath)) {
      this.fastify.setNotFoundHandler((req, reply) => {
        const url = req.raw.url || '';
        if (isScannerProbe(url) || url.startsWith('/api')) {
          reply.code(404).send({ error: 'Not found' });
          return;
        }
        return reply.sendFile('index.html');
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
    console.log(
      `[HttpServer] Local UI & API listening at http://127.0.0.1:${this.config.webPort}`
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
