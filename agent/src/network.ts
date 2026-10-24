import os from 'node:os';
import net from 'node:net';

/**
 * Finds the local IPv4 address assigned to the Radmin VPN interface.
 * Priority:
 * 1. Interface with 'radmin' in its name having an IPv4 address.
 * 2. Any IPv4 address starting with '26.' (Radmin subnet 26.0.0.0/8).
 * 3. Fallback to undefined.
 */
export function findRadminIp(): string | undefined {
  const interfaces = os.networkInterfaces();
  
  // Check interface names first
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name.toLowerCase().includes('radmin') && addrs) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
  }

  // Check 26.0.0.0/8 subnet
  for (const addrs of Object.values(interfaces)) {
    if (addrs) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal && addr.address.startsWith('26.')) {
          return addr.address;
        }
      }
    }
  }

  return undefined;
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

