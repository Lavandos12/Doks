import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface PeerDiscoveryOptions {
  teamKey: string;
  wsPort: number;
  peerId: string;
  port?: number;
  bindAddress?: string;
  disabled?: boolean;
}

export interface DiscoveredPeer {
  address: string;
  wsPort: number;
  peerId: string;
}

export class PeerDiscoveryService extends EventEmitter {
  private teamKey: string;
  private wsPort: number;
  private peerId: string;
  private udpPort: number;
  private bindAddress?: string;
  private socket?: dgram.Socket;
  private beaconTimer?: NodeJS.Timeout;
  private workspaceHash: string;
  private isRunning = false;

  constructor(options: PeerDiscoveryOptions) {
    super();
    this.teamKey = options.teamKey;
    this.wsPort = options.wsPort;
    this.peerId = options.peerId;
    this.udpPort = options.port || 41234;
    this.bindAddress = options.bindAddress;

    // 16-char hex hash identifying team workspace without revealing teamKey
    this.workspaceHash = crypto.createHash('sha256').update(this.teamKey).digest('hex').slice(0, 16);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve) => {
      try {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.socket.on('error', (err: any) => {
          // If port is in use or UDP is not permitted, degrade gracefully
          console.log(`[PeerDiscovery] UDP discovery on port ${this.udpPort} unavailable (${err.code || err.message}). Operating in direct mesh mode.`);
          this.stop();
          resolve();
        });

        this.socket.on('message', (msg, rinfo) => {
          try {
            const data = JSON.parse(msg.toString('utf8'));
            if (
              data.protocol === 'doks-v1' &&
              data.workspaceHash === this.workspaceHash &&
              data.peerId &&
              data.peerId !== this.peerId &&
              data.wsPort
            ) {
              const peer: DiscoveredPeer = {
                address: rinfo.address,
                wsPort: data.wsPort,
                peerId: data.peerId
              };
              this.emit('peer', peer);
            }
          } catch {}
        });

        this.socket.bind(this.udpPort, () => {
          this.isRunning = true;
          try {
            this.socket?.setBroadcast(true);
          } catch {}

          // Broadcast beacon every 5 seconds
          this.beaconTimer = setInterval(() => {
            this.broadcastBeacon();
          }, 5000);
          if (this.beaconTimer.unref) {
            this.beaconTimer.unref();
          }

          // Send initial beacon
          this.broadcastBeacon();
          resolve();
        });
      } catch (err: any) {
        console.log(`[PeerDiscovery] Failed to start UDP service: ${err.message}`);
        resolve();
      }
    });
  }

  public broadcastBeacon(): void {
    if (!this.socket || !this.isRunning) return;

    const beacon = JSON.stringify({
      protocol: 'doks-v1',
      workspaceHash: this.workspaceHash,
      wsPort: this.wsPort,
      peerId: this.peerId
    });

    const buffer = Buffer.from(beacon, 'utf8');

    // Broadcast to global broadcast address and localhost
    const targets = ['255.255.255.255', '127.0.0.1'];
    for (const target of targets) {
      try {
        this.socket.send(buffer, 0, buffer.length, this.udpPort, target);
      } catch {}
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = undefined;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = undefined;
    }
  }
}
