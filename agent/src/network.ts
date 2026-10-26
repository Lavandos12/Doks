import os from 'node:os';
import net from 'node:net';
import { execSync } from 'node:child_process';

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  netmask: string;
  cidr: string;
  kind: 'radmin' | 'tailscale' | 'zerotier' | 'lan' | 'vpn-tun';
}

let lastRadminCheckTime = 0;
let lastRadminCheckResult = false;

/**
 * On Windows, Famatech Radmin adapter keeps dormant static 26.x.x.x even when turned off.
 * This verifies if the actual Radmin VPN process or service is running.
 */
export function isRadminTunnelOperational(): boolean {
  if (process.platform !== 'win32') return true;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.DOKS_FORCE_RADMIN) {
    return true;
  }
  const now = Date.now();
  if (now - lastRadminCheckTime < 10000) {
    return lastRadminCheckResult;
  }
  lastRadminCheckTime = now;

  try {
    const stdout = execSync('tasklist /NH /FI "IMAGENAME eq RadminVPN.exe"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 1000,
    });
    if (stdout.toLowerCase().includes('radminvpn.exe')) {
      lastRadminCheckResult = true;
      return true;
    }
  } catch {}

  lastRadminCheckResult = false;
  return false;
}

/**
 * Known proxy/TUN fake subnets used by Hiddify (sing-box), Clash, Nekoray, v2rayN.
 * We must NEVER use these as P2P host addresses.
 */
export function isProxyTunAddress(ip: string, ifaceName: string): boolean {
  const lower = ifaceName.toLowerCase();
  if (
    lower.includes('hiddify') ||
    lower.includes('sing-tun') ||
    lower.includes('nekoray') ||
    lower.includes('clash') ||
    lower.includes('v2ray') ||
    lower.includes(' xray') ||
    lower.includes('wintun')
  ) {
    // Note: Radmin uses Famatech driver, never wintun/sing-tun.
    // Still, double-check IP range first: if it's 26.x.x.x, it IS Radmin.
    if (!ip.startsWith('26.')) return true;
  }
  // 198.18.0.0/15 is standard FakeIP range in sing-box / Hiddify
  if (ip.startsWith('198.18.') || ip.startsWith('198.19.')) return true;
  // 172.19.0.x is standard sing-tun interface address in Hiddify
  if (ip.startsWith('172.19.0.')) return true;
  return false;
}

export function classifyInterface(name: string, ip: string): NetworkInterfaceInfo['kind'] | null {
  if (ip.startsWith('127.') || ip.startsWith('169.254.')) return null;

  // Radmin VPN ALWAYS uses the 26.0.0.0/8 subnet regardless of localized Windows adapter name
  if (ip.startsWith('26.') || name.toLowerCase().includes('radmin')) {
    return 'radmin';
  }

  if (isProxyTunAddress(ip, name)) {
    return 'vpn-tun';
  }

  // Tailscale / CGNAT range 100.64.0.0/10
  const parts = ip.split('.').map(Number);
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return 'tailscale';
  }

  if (name.toLowerCase().includes('zerotier')) {
    return 'zerotier';
  }

  if (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  ) {
    return 'lan';
  }

  return null;
}

export function listOverlayInterfaces(): NetworkInterfaceInfo[] {
  const nets = os.networkInterfaces();
  const result: NetworkInterfaceInfo[] = [];

  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const kind = classifyInterface(name, addr.address);
      if (!kind || kind === 'vpn-tun') continue;
      result.push({
        name,
        address: addr.address,
        netmask: addr.netmask,
        cidr: addr.cidr || `${addr.address}/24`,
        kind,
      });
    }
  }

  // Sort priority: Radmin VPN first -> Tailscale -> ZeroTier -> LAN
  const priority: Record<NetworkInterfaceInfo['kind'], number> = {
    radmin: 1,
    tailscale: 2,
    zerotier: 3,
    lan: 4,
    'vpn-tun': 99,
  };

  return result.sort((a, b) => priority[a.kind] - priority[b.kind]);
}

export function detectRadminIp(verifyActiveProcess = true): string | null {
  const all = listOverlayInterfaces();
  const radmin = all.find((i) => i.kind === 'radmin');
  if (!radmin) return null;
  if (verifyActiveProcess && !isRadminTunnelOperational()) {
    return null;
  }
  return radmin.address;
}

export interface NetworkOverview {
  p2pEnabled: boolean;
  detectedRadminIp: string | null;
  lanIp: string | null;
  effectiveIp: string;
  port: number;
  peerId: string;
  inviteUri: string;
  interfaces: NetworkInterfaceInfo[];
}

export function detectNetworkOverview(params: {
  p2pEnabled: boolean;
  teamKey: string;
  port: number;
  peerId: string;
}): NetworkOverview {
  const allIfaces = listOverlayInterfaces();
  const radmin = allIfaces.find((i) => i.kind === 'radmin')?.address || null;
  const lan = allIfaces.find((i) => i.kind === 'lan')?.address || null;
  const tailscale = allIfaces.find((i) => i.kind === 'tailscale')?.address || null;

  const candidateIp = radmin || lan || tailscale || '127.0.0.1';
  const effectiveIp = params.p2pEnabled ? candidateIp : '127.0.0.1';
  const inviteHost = candidateIp;
  const inviteUri = `doks://${inviteHost}:${params.port}#${params.teamKey}`;

  return {
    p2pEnabled: params.p2pEnabled,
    detectedRadminIp: radmin,
    lanIp: lan,
    effectiveIp,
    port: params.port,
    peerId: params.peerId,
    inviteUri,
    interfaces: allIfaces,
  };
}

export function detectPreferredMeshIp(meshEnabled = true): { ip: string | null; kind: string; all: NetworkInterfaceInfo[] } {
  if (!meshEnabled) {
    return { ip: '127.0.0.1', kind: 'local-only', all: [] };
  }
  const radmin = detectRadminIp(true);
  const all = listOverlayInterfaces().filter((i) => i.kind !== 'radmin' || Boolean(radmin));
  if (all.length === 0) {
    return { ip: null, kind: 'local-only', all: [] };
  }
  return { ip: all[0].address, kind: all[0].kind, all };
}

/**
 * Finds the local IPv4 address assigned to the Radmin VPN interface.
 * Backwards-compatibility helper returning string | undefined.
 */
export function findRadminIp(): string | undefined {
  return detectRadminIp() ?? undefined;
}

/**
 * Validates whether an IP address belongs to the Radmin VPN subnet (26.0.0.0/8).
 */
export function isRadminIp(ip: string): boolean {
  return ip.startsWith('26.');
}

/**
 * Checks if a specific TCP port is currently free on the given host.
 */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Finds the first available TCP port starting from startPort.
 */
export async function findAvailablePort(startPort: number, host = '127.0.0.1'): Promise<number> {
  let port = startPort;
  while (port < startPort + 100) {
    if (await isPortFree(port, host)) {
      return port;
    }
    port++;
  }
  return startPort;
}
