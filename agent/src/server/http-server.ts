import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { AgentConfig } from '@doks/shared';
import {
  type PeerMessage,
  encodeMessage,
  decodeMessage,
  uint8ArrayToBase64,
  base64ToUint8Array
} from '@doks/shared';
import { DocManager } from '../storage/doc-manager.js';
import { PeerService } from '../peer/peer-service.js';
import { generateSessionToken } from '../security.js';
import { findAvailablePort, findRadminIp } from '../network.js';
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
  webDistPath?: string;
}

export class AgentHttpServer {
  private fastify: FastifyInstance;
  private config: AgentConfig;
  private docManager: DocManager;
  private peerService: PeerService;
  private snapshotManager?: any;
  private sessionToken: string;
  private webDistPath: string;

  constructor(options: HttpServerOptions) {
    this.config = options.config;
    this.docManager = options.docManager;
    this.peerService = options.peerService;
    this.snapshotManager = options.snapshotManager;
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

    // Serve static files if webDistPath exists
    if (fs.existsSync(this.webDistPath)) {
      this.fastify.register(fastifyStatic, {
        root: this.webDistPath,
        prefix: '/'
      });
    }

    // Security hook: Host & Origin verification
    this.fastify.addHook('onRequest', async (req, reply) => {
      const host = req.headers.host || '';
      const allowedHosts = [
        `127.0.0.1:${this.config.webPort}`,
        `localhost:${this.config.webPort}`,
        '127.0.0.1',
        'localhost'
      ];

      const hostMatches = allowedHosts.some((h) => host === h);
      if (!hostMatches) {
        reply.code(403).send({ error: 'Forbidden: Invalid Host header' });
        return;
      }

      const origin = req.headers.origin;
      if (origin) {
        const isAllowedOrigin =
          origin.startsWith('http://127.0.0.1') ||
          origin.startsWith('http://localhost') ||
          origin.startsWith('https://127.0.0.1') ||
          origin.startsWith('https://localhost');
        if (!isAllowedOrigin) {
          reply.code(403).send({ error: 'Forbidden: Invalid Origin header' });
          return;
        }
      }

      // Check or issue session cookie
      const token = req.cookies.doks_session;
      if (!token) {
        reply.setCookie('doks_session', this.sessionToken, {
          path: '/',
          httpOnly: true,
          sameSite: 'strict'
        });
      }
    });
  }

  private setupRoutes(): void {
    // API: Config & Peer status
    this.fastify.get('/api/status', async (req) => {
      const radminIp = findRadminIp();
      const hasAuth = req.cookies.doks_session === this.sessionToken;
      return {
        agentId: this.config.agentId,
        memberName: this.config.memberName,
        memberColor: this.config.memberColor,
        peerPort: this.config.peerPort,
        webPort: this.config.webPort,
        bindAddress: this.config.bindAddress,
        effectiveIp: radminIp || '127.0.0.1',
        radminFound: Boolean(radminIp),
        peers: this.peerService.getPeersStatus(),
        connectedCount: this.peerService.getConnectedCount(),
        // B17: Do not expose raw teamKey without session authentication
        teamKey: hasAuth ? this.config.teamKey : undefined,
        inviteLink: hasAuth ? `doks://${radminIp || '127.0.0.1'}:${this.config.peerPort}#${this.config.teamKey}` : undefined
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

    // API: Add peer
    this.fastify.post('/api/peers', async (req, reply) => {
      const body = req.body as { address?: string };
      if (!body?.address) {
        return reply.code(400).send({ error: 'address is required' });
      }
      this.peerService.addPeer(body.address);
      return { success: true, peers: this.peerService.getPeersStatus() };
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

    // WebSocket bridge for browser client
    this.fastify.register(async (fastify) => {
      fastify.get('/ws', { websocket: true }, (socket, req) => {
        // B21: Selective doc subscription set per socket
        const subscribedDocs = new Set<string>();

        const isDocSubscribed = (docName: string) => {
          return subscribedDocs.size === 0 || subscribedDocs.has(docName) || docName === 'eluma-index';
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
              // B11: Apply browser awareness state and broadcast to mesh
              const data = base64ToUint8Array(msg.data);
              try {
                awarenessProtocol.applyAwarenessUpdate(this.docManager.getAwareness(), data, 'client');
              } catch (err) {
                console.error('[HttpServer] Awareness error:', err);
              }
              this.peerService.broadcastAwareness(msg.docName, data);
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
        const updateListener = ({ docName, update, origin }: any) => {
          if (origin !== 'client' && socket.readyState === socket.OPEN && isDocSubscribed(docName)) {
            socket.send(
              encodeMessage({
                type: 'sync',
                docName,
                data: uint8ArrayToBase64(update)
              })
            );
          }
        };

        // B11: Forward peer awareness updates to the browser
        const peerAwarenessListener = ({ docName, data }: { docName: string; data: Uint8Array }) => {
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
    const freePort = await findAvailablePort(this.config.webPort, '127.0.0.1');
    if (freePort !== this.config.webPort) {
      console.warn(`[HttpServer] Port ${this.config.webPort} is busy, auto-switching to free port ${freePort}`);
      this.config.webPort = freePort;
    }

    await this.fastify.listen({
      port: this.config.webPort,
      host: '127.0.0.1'
    });
    console.log(
      `[HttpServer] Local UI & API listening at http://127.0.0.1:${this.config.webPort}`
    );
  }

  public async stop(): Promise<void> {
    await this.fastify.close();
  }
}
