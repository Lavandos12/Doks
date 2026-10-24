import path from 'node:path';
import type { AgentConfig } from '@doks/shared';
import { loadOrCreateConfig, type ConfigOptions } from './config.js';
import { StateStore } from './storage/state-store.js';
import { DocManager } from './storage/doc-manager.js';
import { FileMirror } from './storage/file-mirror.js';
import { FileWatcher } from './storage/file-watcher.js';
import { SnapshotManager } from './storage/snapshots.js';
import { AttachmentManager } from './storage/attachments.js';
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
  public peerService: PeerService;
  public httpServer: AgentHttpServer;

  constructor(options: ConfigOptions = {}) {
    this.config = loadOrCreateConfig(options);
    this.stateStore = new StateStore(this.config.statePath);
    this.docManager = new DocManager(this.stateStore);
    this.fileMirror = new FileMirror(this.config.vaultPath, this.docManager);
    this.fileWatcher = new FileWatcher(this.config.vaultPath, this.docManager, this.fileMirror);
    this.attachmentManager = new AttachmentManager(this.config.vaultPath);
    
    const snapshotsDir = path.join(path.dirname(this.config.statePath), 'snapshots');
    this.snapshotManager = new SnapshotManager(snapshotsDir, this.docManager);

    this.peerService = new PeerService(this.config, this.docManager, this.attachmentManager);
    this.httpServer = new AgentHttpServer({
      config: this.config,
      docManager: this.docManager,
      peerService: this.peerService,
      snapshotManager: this.snapshotManager,
      attachmentManager: this.attachmentManager
    });
  }

  public async start(): Promise<void> {
    await this.peerService.start();
    await this.httpServer.start();
  }

  public async stop(): Promise<void> {
    await this.httpServer.stop();
    await this.peerService.stop();
    await this.fileWatcher.stop();
    this.snapshotManager.destroy();
    this.fileMirror.destroy();
    this.docManager.destroy();
  }
}
