import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Agent } from '@doks/agent';

export interface TestAgentInstance {
  agent: Agent;
  baseDir: string;
}

export function createTestDir(name: string): string {
  const dir = path.join(os.tmpdir(), `doks-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTestDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
}

export async function createTestAgent(options: {
  name: string;
  peerPort: number;
  webPort: number;
  teamKey: string;
  peers?: string[];
  bindAddress?: string;
}): Promise<TestAgentInstance> {
  const baseDir = createTestDir(options.name);
  const agent = new Agent({
    baseDir,
    peerPort: options.peerPort,
    webPort: options.webPort,
    teamKey: options.teamKey,
    peers: options.peers || [],
    bindAddress: options.bindAddress || '127.0.0.1',
    memberName: options.name
  });

  await agent.start();
  return { agent, baseDir };
}

export function waitFor(predicate: () => boolean, timeoutMs = 8000, intervalMs = 50): Promise<void> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (predicate()) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timeout waiting for condition after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}
