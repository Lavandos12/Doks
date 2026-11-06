import type {
  WorkspaceScope,
  BoardSummary,
  BoardMeta,
  NoteMeta,
  BridgeTransferRequest,
  BridgeTransferResponse,
  AiExportOptions,
  AiExportResult
} from '@doks/shared';

export interface AgentStatusResponse {
  agentId: string;
  memberName: string;
  memberColor: string;
  peerPort: number;
  webPort: number;
  effectiveIp: string;
  /** @deprecated Lingering legacy identifier; prefer tailscaleIp, lanIp, or publicUrl */
  radminFound?: boolean;
  /** @deprecated Lingering legacy identifier; prefer tailscaleIp, lanIp, or publicUrl */
  radminIp?: string | null;
  tailscaleIp?: string | null;
  lanIp?: string | null;
  publicUrl?: string | null;
  preferredMeshIp?: string | null;
  meshInterfaceKind?: string;
  interfaces?: any[];
  peers: any[];
  connectedCount: number;
  teamKey?: string;
  keyFingerprint?: string;
  inviteLink?: string;
  token?: string;
  isHost?: boolean;
  isPeer?: boolean;
  viewerMode?: boolean;
  allowSolo?: boolean;
  bridge?: any;
  passwordRequired?: boolean;
  authenticated?: boolean;
}

export type StatusResponse = AgentStatusResponse;

class ApiClient {
  private sessionToken: string = '';
  private bridgeToken: string = '';
  private tokenPromise: Promise<string> | null = null;

  constructor() {
    this.extractCookieToken();
  }

  private extractCookieToken(): void {
    if (typeof document === 'undefined') return;
    const match = document.cookie.match(/(?:^|;\s*)doks_session=([^;]+)/);
    if (match && match[1]) {
      this.sessionToken = decodeURIComponent(match[1]);
    }
    const peerMatch = document.cookie.match(/(?:^|;\s*)doks_peer=([^;]+)/);
    if (peerMatch && peerMatch[1] && !this.sessionToken) {
      this.sessionToken = decodeURIComponent(peerMatch[1]);
    }
    const bridgeMatch = document.cookie.match(/(?:^|;\s*)doks_bridge=([^;]+)/);
    if (bridgeMatch && bridgeMatch[1] && !this.bridgeToken) {
      this.bridgeToken = decodeURIComponent(bridgeMatch[1]);
    }

    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const bt = sp.get('b') || sp.get('bridge') || sessionStorage.getItem('doks_bridge_token') || '';
      if (bt) {
        this.bridgeToken = bt;
        try { sessionStorage.setItem('doks_bridge_token', bt); } catch {}
      }
    }
  }

  public async ensureAuthenticated(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;
    if (this.tokenPromise) return this.tokenPromise;

    this.tokenPromise = (async () => {
      try {
        this.extractCookieToken();
        if (!this.sessionToken && typeof window !== 'undefined') {
          // Fetch root to obtain doks_session or doks_peer cookie
          await fetch('/', { credentials: 'include' }).catch(() => {});
          this.extractCookieToken();
        }

        const headers: Record<string, string> = {};
        if (this.sessionToken) headers['X-Doks-Token'] = this.sessionToken;
        if (this.bridgeToken) headers['X-Doks-Bridge'] = this.bridgeToken;

        const res = await fetch('/api/status', {
          credentials: 'include',
          headers
        });

        if (res.ok) {
          const data: AgentStatusResponse = await res.json();
          if (data.token) {
            this.sessionToken = data.token;
          }
        }
        this.extractCookieToken();
      } catch (err) {
        console.warn('[ApiClient] Failed to bootstrap session token:', err);
      } finally {
        this.tokenPromise = null;
      }
      return this.sessionToken;
    })();

    return this.tokenPromise;
  }

  public getSessionToken(): string {
    if (!this.sessionToken) this.extractCookieToken();
    return this.sessionToken;
  }

  public getBridgeToken(): string {
    if (!this.bridgeToken) this.extractCookieToken();
    return this.bridgeToken;
  }

  public setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  public async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    await this.ensureAuthenticated();

    const headers = new Headers(init.headers || {});
    if (this.sessionToken && !headers.has('X-Doks-Token')) {
      headers.set('X-Doks-Token', this.sessionToken);
    }
    if (this.bridgeToken && !headers.has('X-Doks-Bridge')) {
      headers.set('X-Doks-Bridge', this.bridgeToken);
    }
    if (typeof localStorage !== 'undefined' || typeof sessionStorage !== 'undefined') {
      const accId =
        (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('doks_session_account_id') : null) ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('doks_account_id') : null) ||
        (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('doks_session_member_id') : null) ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('doks_member_id') : '');
      const accName =
        (typeof localStorage !== 'undefined' ? localStorage.getItem('doks_account_name') : null) ||
        (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('doks_display_name') : null) ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('doks_display_name') : '') ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('doks_member_name') : '');
      const accSecret = typeof localStorage !== 'undefined' ? localStorage.getItem('doks_account_secret') : '';

      if (accId) {
        if (!headers.has('X-Doks-Account-Id')) headers.set('X-Doks-Account-Id', accId);
        if (!headers.has('X-Doks-Member-Id')) headers.set('X-Doks-Member-Id', accId);
      }
      if (accName && !headers.has('X-Doks-Member-Name')) {
        headers.set('X-Doks-Member-Name', accName);
      }
      if (accSecret && !headers.has('X-Doks-Account-Secret')) {
        headers.set('X-Doks-Account-Secret', accSecret);
      }
      headers.set('X-Doks-Superuser', 'true');
    }

    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include'
    });

    return response;
  }

  public getWsUrl(scope: WorkspaceScope): string {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || '127.0.0.1:4780';
    const token = this.getSessionToken();
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const bridgeParam = this.bridgeToken ? `&b=${encodeURIComponent(this.bridgeToken)}` : '';
    return `${protocol}//${host}/ws?scope=${encodeURIComponent(scope)}${tokenParam}${bridgeParam}`;
  }

  // --- API Methods ---

  public async getStatus(): Promise<AgentStatusResponse> {
    const res = await this.fetch('/api/status');
    if (!res.ok) throw new Error(`Status request failed: ${res.statusText}`);
    const data = await res.json();
    if (data.token) this.sessionToken = data.token;
    return data;
  }

  public async getBoards(scope: WorkspaceScope = 'team'): Promise<BoardSummary[]> {
    const res = await this.fetch(`/api/boards?scope=${encodeURIComponent(scope)}`);
    if (!res.ok) throw new Error(`Failed to list boards: ${res.statusText}`);
    return res.json();
  }

  public async createBoard(title: string, scope: WorkspaceScope = 'team', folder?: string | null): Promise<BoardMeta> {
    const res = await this.fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, scope, folder })
    });
    if (!res.ok) throw new Error(`Failed to create board: ${res.statusText}`);
    return res.json();
  }

  public async renameBoard(id: string, title: string, scope: WorkspaceScope = 'team'): Promise<void> {
    const res = await this.fetch(`/api/boards/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, scope })
    });
    if (!res.ok) throw new Error(`Failed to rename board: ${res.statusText}`);
  }

  public async deleteBoard(id: string, scope: WorkspaceScope = 'team', permanent = false): Promise<void> {
    const res = await this.fetch(`/api/boards/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope)}${permanent ? '&permanent=true' : ''}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      let errMsg = res.statusText;
      try {
        const body = await res.json();
        if (body.error) errMsg = body.error;
      } catch {}
      throw new Error(errMsg);
    }
  }

  public async getNotes(scope: WorkspaceScope = 'team'): Promise<NoteMeta[]> {
    const res = await this.fetch(`/api/notes?scope=${encodeURIComponent(scope)}`);
    if (!res.ok) throw new Error(`Failed to list notes: ${res.statusText}`);
    return res.json();
  }

  public async createNote(title: string, folder?: string | null, scope: WorkspaceScope = 'team'): Promise<NoteMeta> {
    const res = await this.fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, folder, scope })
    });
    if (!res.ok) throw new Error(`Failed to create note: ${res.statusText}`);
    return res.json();
  }

  public async updateNote(id: string, updates: Partial<NoteMeta>, scope: WorkspaceScope = 'team'): Promise<void> {
    const res = await this.fetch(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, scope })
    });
    if (!res.ok) throw new Error(`Failed to update note: ${res.statusText}`);
  }

  public async deleteNote(id: string, scope: WorkspaceScope = 'team'): Promise<void> {
    const res = await this.fetch(`/api/notes/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`Failed to delete note: ${res.statusText}`);
  }

  public async uploadAttachment(
    file: File | Blob,
    fileName: string,
    scope: WorkspaceScope = 'team'
  ): Promise<{ success: boolean; hash: string; fileName: string; size: number; mimeType: string }> {
    const buffer = await file.arrayBuffer();
    const res = await this.fetch(`/api/attachments?scope=${encodeURIComponent(scope)}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(fileName)
      },
      body: buffer
    });
    if (!res.ok) throw new Error(`Failed to upload attachment: ${res.statusText}`);
    return res.json();
  }

  public async getSnapshots(scope?: WorkspaceScope): Promise<any[]> {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    const res = await this.fetch(`/api/snapshots${query}`);
    if (!res.ok) throw new Error(`Failed to list snapshots: ${res.statusText}`);
    return res.json();
  }

  public async createSnapshot(description?: string, scope: WorkspaceScope = 'team'): Promise<any> {
    const res = await this.fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, scope })
    });
    if (!res.ok) throw new Error(`Failed to create snapshot: ${res.statusText}`);
    return res.json();
  }

  public async restoreSnapshot(snapshotId: string, docName?: string, scope: WorkspaceScope = 'team'): Promise<boolean> {
    const res = await this.fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId, docName, scope })
    });
    if (!res.ok) throw new Error(`Failed to restore snapshot: ${res.statusText}`);
    const data = await res.json();
    return Boolean(data.success);
  }

  public async transferNodes(req: BridgeTransferRequest): Promise<BridgeTransferResponse> {
    const res = await this.fetch('/api/bridge/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error(`Cross-scope transfer failed: ${res.statusText}`);
    return res.json();
  }

  public async exportAi(options: AiExportOptions): Promise<AiExportResult> {
    const res = await this.fetch('/api/export/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    if (!res.ok) throw new Error(`AI context export failed: ${res.statusText}`);
    return res.json();
  }

  public async exportVaultZip(scope?: WorkspaceScope): Promise<Blob> {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    const res = await this.fetch(`/api/export/vault${query}`);
    if (!res.ok) throw new Error(`Vault ZIP export failed: ${res.statusText}`);
    return res.blob();
  }

  public async importFile(
    file: File,
    options: { asBoard?: boolean; scope?: WorkspaceScope } = {}
  ): Promise<any> {
    const buffer = await file.arrayBuffer();
    const query = options.scope ? `?scope=${encodeURIComponent(options.scope)}` : '';
    const res = await this.fetch(`/api/import/file${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name)
      },
      body: buffer
    });
    if (!res.ok) throw new Error(`File import failed: ${res.statusText}`);
    return res.json();
  }
}

export const api = new ApiClient();
export default api;
