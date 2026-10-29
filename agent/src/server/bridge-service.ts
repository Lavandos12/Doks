import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { detectRadminIp, detectPreferredMeshIp } from '../network.js';

export interface BridgeStatus {
  enabled: boolean;
  allowSolo: boolean;
  useCloudflare: boolean;
  tunnelStatus: 'off' | 'starting' | 'active' | 'error';
  localUrl: string | null;
  publicUrl: string | null;
  primaryUrl: string | null;
  tunnelError: string | null;
  expiresAt: number | null;
}

export class BridgeService {
  private enabled = false;
  private bridgeToken: string | null = null;
  private allowSolo = true;
  private useCloudflare = false;
  private expiresAt: number | null = null;
  private tunnelStatus: 'off' | 'starting' | 'active' | 'error' = 'off';
  private publicBaseUrl: string | null = null;
  private tunnelError: string | null = null;
  private tunnelProcess: ChildProcess | null = null;
  private webPort: number;
  private doksDir: string;

  constructor(webPort: number, statePath: string) {
    this.webPort = webPort;
    this.doksDir = path.dirname(statePath);
  }

  public setWebPort(port: number): void {
    this.webPort = port;
  }

  public isValidBridgeToken(token?: string | null): boolean {
    if (!this.enabled || !this.bridgeToken || !token) return false;
    if (this.expiresAt && Date.now() > this.expiresAt) {
      this.disableBridge();
      return false;
    }
    const a = Buffer.from(token);
    const b = Buffer.from(this.bridgeToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  public isSoloAllowed(): boolean {
    return this.allowSolo;
  }

  public getStatus(): BridgeStatus {
    if (this.expiresAt && Date.now() > this.expiresAt) {
      this.disableBridge();
    }
    const preferred = detectPreferredMeshIp();
    const radmin = detectRadminIp();
    const hostIp = preferred.ip && preferred.ip !== '127.0.0.1' ? preferred.ip : (radmin || '127.0.0.1');

    const localUrl =
      this.enabled && this.bridgeToken
        ? `http://${hostIp}:${this.webPort}/?b=${this.bridgeToken}`
        : null;

    const publicUrl =
      this.enabled && this.bridgeToken && this.publicBaseUrl
        ? `${this.publicBaseUrl}/?b=${this.bridgeToken}`
        : null;

    return {
      enabled: this.enabled,
      allowSolo: this.allowSolo,
      useCloudflare: this.useCloudflare,
      tunnelStatus: this.tunnelStatus,
      localUrl,
      publicUrl,
      primaryUrl: publicUrl || localUrl,
      tunnelError: this.tunnelError,
      expiresAt: this.expiresAt
    };
  }

  public async enableBridge(options: { useCloudflare?: boolean; allowSolo?: boolean } = {}): Promise<BridgeStatus> {
    this.stopTunnelProcess();
    // 12-byte random hex (24 chars) keeps the URL compact so the QR code is dense and fast to scan
    this.bridgeToken = crypto.randomBytes(12).toString('hex');
    this.enabled = true;
    this.allowSolo = options.allowSolo !== undefined ? options.allowSolo : true;
    this.useCloudflare = Boolean(options.useCloudflare);
    this.expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours session
    this.tunnelError = null;
    this.publicBaseUrl = null;

    if (this.useCloudflare) {
      this.startCloudflareTunnel();
    } else {
      this.tunnelStatus = 'off';
    }

    return this.getStatus();
  }

  public disableBridge(): BridgeStatus {
    this.stopTunnelProcess();
    this.enabled = false;
    this.bridgeToken = null;
    this.publicBaseUrl = null;
    this.expiresAt = null;
    this.tunnelStatus = 'off';
    this.tunnelError = null;
    return this.getStatus();
  }

  private stopTunnelProcess(): void {
    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill();
      } catch {}
      this.tunnelProcess = null;
    }
  }

  private startCloudflareTunnel(): void {
    this.tunnelStatus = 'starting';
    const binDir = path.join(this.doksDir, 'bin');
    const localBin = path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    const cmd = fs.existsSync(localBin) ? localBin : 'cloudflared';

    try {
      const child = spawn(cmd, ['tunnel', '--url', `http://127.0.0.1:${this.webPort}`, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      this.tunnelProcess = child;

      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !this.publicBaseUrl) {
          this.publicBaseUrl = match[0];
          this.tunnelStatus = 'active';
        }
      };

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);

      child.on('error', () => {
        this.tunnelStatus = 'error';
        this.tunnelError =
          'cloudflared binary not found. Local Wi-Fi / Radmin VPN access is fully functional (place cloudflared.exe into .doks/bin for internet access).';
      });

      child.on('exit', (code) => {
        if (this.tunnelStatus === 'starting' && !this.publicBaseUrl) {
          this.tunnelStatus = 'error';
          this.tunnelError = `Cloudflare tunnel exited with code ${code ?? 0}. Local network link remains active.`;
        }
      });
    } catch {
      this.tunnelStatus = 'error';
      this.tunnelError = 'Failed to launch cloudflared. Local Wi-Fi link remains active.';
    }
  }
}
