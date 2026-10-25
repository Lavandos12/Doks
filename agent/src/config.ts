import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { AgentConfig } from '@doks/shared';
import { generateTeamKey } from './security.js';
import { findRadminIp } from './network.js';
import { logger } from './logger.js';

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
  let baseDir = options.baseDir;
  if (!baseDir) {
    const legacyElumaDir = path.join(os.homedir(), 'Eluma');
    const defaultDoksDir = path.join(os.homedir(), 'Doks');
    if (!fs.existsSync(defaultDoksDir) && fs.existsSync(legacyElumaDir)) {
      try {
        fs.cpSync(legacyElumaDir, defaultDoksDir, { recursive: true });
        logger.info('[Migration] Migrated ~/Eluma to ~/Doks');
      } catch (err) {
        logger.warn('[Migration] Failed to migrate ~/Eluma to ~/Doks:', err);
      }
    }
    baseDir = defaultDoksDir;
  }

  const doksDir = path.join(baseDir, '.doks');
  const legacyDotEluma = path.join(baseDir, '.eluma');
  if (fs.existsSync(legacyDotEluma) && !fs.existsSync(doksDir)) {
    try {
      fs.cpSync(legacyDotEluma, doksDir, { recursive: true });
      logger.info('[Migration] Migrated .eluma to .doks');
    } catch (err) {
      logger.warn('[Migration] Failed to migrate .eluma to .doks:', err);
    }
  }

  const configPath = path.join(doksDir, 'config.json');
  const vaultPath = path.join(baseDir, 'vault');
  const statePath = path.join(doksDir, 'state');
  const snapshotsPath = path.join(doksDir, 'snapshots');
  const blobsPath = path.join(doksDir, 'blobs');

  // Ensure directories exist
  fs.mkdirSync(doksDir, { recursive: true });
  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(statePath, { recursive: true });
  fs.mkdirSync(snapshotsPath, { recursive: true });
  fs.mkdirSync(blobsPath, { recursive: true });

  let existing: Partial<AgentConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  // Safe migration: preserve backup-v1
  const backupV1Path = path.join(doksDir, 'backup-v1');
  if (fs.existsSync(statePath) && !fs.existsSync(backupV1Path) && (!existing.version || existing.version < 2)) {
    try {
      const stateFiles = fs.readdirSync(statePath);
      if (stateFiles.length > 0) {
        fs.cpSync(statePath, backupV1Path, { recursive: true });
        logger.info('[Migration] Created backup of v1.0 state at .doks/backup-v1');
      }
    } catch (e) {
      logger.warn('[Migration] Failed to backup v1 state:', e);
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
    version: 3,
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
  const doksDir = path.dirname(config.statePath);
  const configPath = path.join(doksDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
