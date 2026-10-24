import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { AgentConfig } from '@doks/shared';
import { generateTeamKey } from './security.js';
import { findRadminIp } from './network.js';

const AUTHOR_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
];

export interface ConfigOptions {
  baseDir?: string;
  peerPort?: number;
  webPort?: number;
  teamKey?: string;
  memberName?: string;
  bindAddress?: string;
  peers?: string[];
}

export function loadOrCreateConfig(options: ConfigOptions = {}): AgentConfig {
  const baseDir = options.baseDir || path.join(os.homedir(), 'Eluma');
  const elumaDir = path.join(baseDir, '.eluma');
  const configPath = path.join(elumaDir, 'config.json');
  const vaultPath = path.join(baseDir, 'vault');
  const statePath = path.join(elumaDir, 'state');
  const snapshotsPath = path.join(elumaDir, 'snapshots');

  // Ensure directories exist
  fs.mkdirSync(elumaDir, { recursive: true });
  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(statePath, { recursive: true });
  fs.mkdirSync(snapshotsPath, { recursive: true });

  let existing: Partial<AgentConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const radminIp = findRadminIp();
  const agentId = existing.agentId || crypto.randomUUID();
  const teamKey = options.teamKey || existing.teamKey || generateTeamKey();
  const memberName = options.memberName || existing.memberName || `User-${agentId.slice(0, 4)}`;
  const memberColor = existing.memberColor || AUTHOR_COLORS[Math.floor(Math.random() * AUTHOR_COLORS.length)];
  const peerPort = options.peerPort ?? existing.peerPort ?? 4747;
  const webPort = options.webPort ?? existing.webPort ?? 3000;
  const bindAddress = options.bindAddress ?? existing.bindAddress ?? 'auto';
  const peers = options.peers ?? existing.peers ?? [];

  const config: AgentConfig = {
    agentId,
    memberName,
    memberColor,
    teamKey,
    peerPort,
    webPort,
    bindAddress,
    peers,
    vaultPath,
    statePath
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

export function saveConfig(config: AgentConfig): void {
  const elumaDir = path.dirname(config.statePath);
  const configPath = path.join(elumaDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
