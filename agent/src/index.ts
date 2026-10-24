import { exec } from 'node:child_process';
import { Agent } from './agent.js';

export * from './agent.js';
export * from './config.js';
export * from './security.js';
export * from './network.js';
export * from './storage/doc-manager.js';
export * from './storage/state-store.js';
export * from './peer/peer-service.js';
export * from './server/http-server.js';

// If run directly from CLI
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
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

  const agent = new Agent({ baseDir, webPort, peerPort, teamKey });

  agent.start().then(() => {
    const url = `http://127.0.0.1:${agent.config.webPort}`;
    console.log(`[Doks Agent] Running at ${url}`);
    console.log(`[Doks Agent] Agent ID: ${agent.config.agentId}`);
    if (openBrowser) {
      console.log(`[Doks Agent] Opening browser at ${url}`);
      exec(`start ${url}`);
    }
  }).catch((err) => {
    console.error('[Doks Agent] Startup failed:', err);
    process.exit(1);
  });

  const shutdown = async () => {
    console.log('\n[Doks Agent] Shutting down...');
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
