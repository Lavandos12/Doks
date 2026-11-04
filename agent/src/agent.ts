import path from 'node:path';
import fs from 'node:fs';
import type { AgentConfig } from '@doks/shared';
import { loadOrCreateConfig, type ConfigOptions } from './config.js';
import { StateStore } from './storage/state-store.js';
import { DocManager } from './storage/doc-manager.js';
import { FileMirror } from './storage/file-mirror.js';
import { FileWatcher } from './storage/file-watcher.js';
import { SnapshotManager } from './storage/snapshots.js';
import { AttachmentManager } from './storage/attachments.js';
import { R2Storage } from './storage/r2-storage.js';
import { PeerService } from './peer/peer-service.js';
import { AgentHttpServer } from './server/http-server.js';

export class Agent {
  public config: AgentConfig;
  public stateStore: StateStore;
  public docManager: DocManager;
  public fileMirror: FileMirror;
  public fileWatcher: FileWatcher;
  public snapshotManager: SnapshotManager;
  public attachmentManager: AttachmentManager;
  public r2Storage: R2Storage;
  public peerService: PeerService;
  public httpServer: AgentHttpServer;
  private memoryGovernorInterval?: NodeJS.Timeout;

  constructor(options: ConfigOptions = {}) {
    this.config = loadOrCreateConfig(options);
    this.stateStore = new StateStore(this.config.statePath);
    this.docManager = new DocManager(this.stateStore);
    this.fileMirror = new FileMirror(this.config.vaultPath, this.docManager);
    this.fileWatcher = new FileWatcher(this.config.vaultPath, this.docManager, this.fileMirror);
    const blobsDir = path.join(path.dirname(this.config.vaultPath), '.doks', 'blobs');
    this.attachmentManager = new AttachmentManager(this.config.vaultPath, blobsDir);
    this.r2Storage = new R2Storage();
    
    const snapshotsDir = path.join(path.dirname(this.config.statePath), 'snapshots');
    this.snapshotManager = new SnapshotManager(snapshotsDir, this.docManager, 600000, this.r2Storage);

    this.peerService = new PeerService(this.config, this.docManager, this.attachmentManager);
    this.httpServer = new AgentHttpServer({
      config: this.config,
      docManager: this.docManager,
      peerService: this.peerService,
      snapshotManager: this.snapshotManager,
      attachmentManager: this.attachmentManager
    });

    // Proactive memory governor for cloud deployments (Render 512MB threshold)
    this.memoryGovernorInterval = setInterval(() => {
      this.checkMemoryHealth();
    }, 30000);
    if (this.memoryGovernorInterval.unref) {
      this.memoryGovernorInterval.unref();
    }
  }

  public checkMemoryHealth(): { heapUsedMb: number; rssMb: number; gcTriggered: boolean } {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    const rssMb = Math.round(mem.rss / (1024 * 1024));
    let gcTriggered = false;

    // Trigger GC if heap exceeds 180MB or RSS exceeds 320MB (staying safely below 512MB Render free tier)
    if (heapUsedMb > 180 || rssMb > 320) {
      if (typeof (global as any).gc === 'function') {
        (global as any).gc();
        gcTriggered = true;
        const afterMem = process.memoryUsage();
        const afterHeap = Math.round(afterMem.heapUsed / (1024 * 1024));
        const afterRss = Math.round(afterMem.rss / (1024 * 1024));
        console.log(`[MemoryGovernor] Cleaned memory: Heap ${heapUsedMb}MB -> ${afterHeap}MB, RSS ${rssMb}MB -> ${afterRss}MB`);
      }
    }
    return { heapUsedMb, rssMb, gcTriggered };
  }

  public async start(): Promise<void> {
    if (this.r2Storage.isConfigured()) {
      try {
        const latestKey = 'doks-latest-snapshot.json';
        const targetPath = path.join(path.dirname(this.config.statePath), 'r2-restore.json');
        const downloaded = await this.r2Storage.downloadFile(latestKey, targetPath);
        if (downloaded && fs.existsSync(targetPath)) {
          const content = fs.readFileSync(targetPath, 'utf8');
          const data = JSON.parse(content);
          if (data && typeof data === 'object') {
            for (const [docName, b64Update] of Object.entries(data)) {
              if (typeof b64Update === 'string') {
                const update = Buffer.from(b64Update, 'base64');
                this.stateStore.saveUpdate(docName, update);
              }
            }
            console.log('[R2Storage] Successfully restored remote state snapshot from R2/S3.');
          }
        }
      } catch (err) {
        console.error('[R2Storage] Error restoring from R2:', err);
      }
    }

    await this.peerService.start();
    await this.httpServer.start();
  }

  public async stop(): Promise<void> {
    if (this.memoryGovernorInterval) {
      clearInterval(this.memoryGovernorInterval);
      this.memoryGovernorInterval = undefined;
    }
    try {
      this.httpServer.getBridgeService().disableBridge();
    } catch {}
    await this.httpServer.stop();
    await this.peerService.stop();
    await this.fileWatcher.stop();
    this.snapshotManager.destroy();
    this.fileMirror.destroy();
    this.docManager.destroy();
    this.stateStore.destroy();
  }
}
