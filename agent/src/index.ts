#!/usr/bin/env node
import { exec } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import v8 from 'node:v8';

// Clear proxy environment variables so Node never routes 127.0.0.1 or 26.x.x.x via Hiddify / sing-box
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;

import { Agent } from './agent.js';

export * from './agent.js';
export * from './config.js';
export * from './security.js';
export * from './network.js';
export * from './storage/doc-manager.js';
export * from './storage/state-store.js';
export * from './storage/file-mirror.js';
export * from './storage/file-watcher.js';
export * from './storage/snapshots.js';
export * from './storage/r2-storage.js';
export * from './storage/attachments.js';
export * from './storage/db.js';
export * from './peer/peer-service.js';
export * from './server/http-server.js';

// If run directly from CLI
const argv1 = (typeof process !== 'undefined' && process.argv && process.argv[1])
  ? process.argv[1].replace(/\\/g, '/')
  : '';

const isCliEntry =
  argv1.endsWith('doks-server.cjs') ||
  (!process.env.VITEST && (
    (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
    argv1.endsWith('agent/dist/index.js') ||
    argv1.endsWith('dist/index.js') ||
    (argv1.endsWith('/doks') && !argv1.includes('node_modules'))
  ));

if (isCliEntry) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Doks v1.0.0 - Local-first collaborative workspace for teams

Usage:
  doks [options]

Options:
  --open              Open browser on startup
  --dir <path>        Vault data directory (default: ~/Doks)
  --port <number>     Web UI & API port (default: 4780)
  --peer-port <num>   Peer service port (default: 4747)
  --key <secret>      Team authentication key (64 hex characters)
  --version, -v       Show version number
  --help, -h          Show this help message
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('1.0.0');
    process.exit(0);
  }

  let baseDir: string | undefined;
  let webPort: number | undefined;
  let peerPort: number | undefined;
  let teamKey: string | undefined;
  let openBrowser = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--open') openBrowser = true;
    if (args[i] === '--dir' && args[i + 1]) baseDir = args[++i];
    if (args[i] === '--port' && args[i + 1]) webPort = parseInt(args[++i], 10);
    if (args[i] === '--peer-port' && args[i + 1]) peerPort = parseInt(args[++i], 10);
    if (args[i] === '--key' && args[i + 1]) teamKey = args[++i];
  }

  if (!webPort && process.env.PORT) {
    webPort = parseInt(process.env.PORT, 10);
  }

  const agent = new Agent({ baseDir, webPort, peerPort, teamKey });

  agent.start().then(() => {
    const port = agent.config.webPort;
    const heapLimitMb = Math.round(v8.getHeapStatistics().heap_size_limit / (1024 * 1024));
    const hasGc = typeof (global as any).gc === 'function';
    console.log(`[Doks Server] Collaborative Canvas listening on http://0.0.0.0:${port} (Heap Limit: ${heapLimitMb} MB, GC: ${hasGc ? 'Active' : 'Default'})`);
    if (openBrowser) {
      const localUrl = `http://127.0.0.1:${port}`;
      const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${openCmd} ${localUrl}`);
    }
  }).catch((err) => {
    console.error('[Doks Server] Startup failed:', err);
    process.exit(1);
  });

  let isShuttingDown = false;
  const shutdown = async (signal?: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Doks Agent] Received ${signal || 'shutdown signal'}, gracefully stopping...`);
    try {
      await agent.stop();
    } catch (err) {
      console.error('[Doks Agent] Error during stop:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  process.on('uncaughtException', (err) => {
    console.error('[Doks Agent] Uncaught exception:', err);
    // Do not kill process for closed websocket sockets or transient network drops
    if (err && (err.message?.includes('WebSocket') || (err as any).code === 'ECONNRESET' || (err as any).code === 'EPIPE')) {
      return;
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[Doks Agent] Handled rejection:', reason);
  });
}
