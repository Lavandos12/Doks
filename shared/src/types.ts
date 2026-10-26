export type WorkspaceScope = 'solo' | 'team';

export interface BoardSummary {
  id: string;
  scope: WorkspaceScope;
  title: string;
  updatedAt: number;
  nodeCount: number;
}

export interface NoteMeta {
  id: string;
  title: string;
  folder: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  deletedAt?: number;
  scope?: WorkspaceScope;
  originId?: string;
  promotedAt?: number;
  promotedBy?: string;
}

export interface BoardMeta {
  id: string;
  title: string;
  folder: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  deletedAt?: number;
  scope?: WorkspaceScope;
  originId?: string;
  promotedAt?: number;
  promotedBy?: string;
}

export interface FolderMeta {
  id: string;
  name: string;
  parent: string | null;
  deleted: boolean;
  deletedAt?: number;
  scope?: WorkspaceScope;
}

export type BoardNodeType = 'sticky' | 'text' | 'note' | 'frame' | 'shape' | 'file' | 'image' | 'link';

export interface AttachmentMeta {
  hash: string;
  name: string;
  size: number;
  mime: string;
  addedBy: string;
  addedAt: number;
  deleted: boolean;
  deletedAt?: number;
  scope?: WorkspaceScope;
}

export interface BoardNodeData {
  id: string;
  type: BoardNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  author: string;
  done?: boolean;
  noteId?: string;
  fileHash?: string;
  fileName?: string;
  url?: string;
  z: number;
  locked?: boolean;
  fontSize?: number;
  hasCheckbox?: boolean;
  shapeVariant?: 'rectangle' | 'rounded' | 'diamond' | 'pill' | 'circle';
  deleted: boolean;
  deletedAt?: number;
  scope?: WorkspaceScope;
  originId?: string;
  promotedAt?: number;
  promotedBy?: string;
}

export interface BoardEdgeData {
  id: string;
  from: string;
  to: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  color?: string;
  direction?: 'forward' | 'both' | 'none';
  style?: 'solid' | 'dashed' | 'dotted';
  curveType?: 'bezier' | 'orthogonal' | 'straight';
  thickness?: number;
  deleted: boolean;
  deletedAt?: number;
  scope?: WorkspaceScope;
}

export interface UserPresence {
  peerId: string;
  name: string;
  color: string;
  activeDoc?: string;
  cursor?: { x: number; y: number };
  selection?: any;
  lastActive: number;
}

export interface PeerStatus {
  address: string;
  peerId?: string;
  name?: string;
  connected: boolean;
  isOutbound: boolean;
  lastSeen?: number;
  error?: string;
}

export interface AgentConfig {
  version?: number;
  agentId: string;
  memberName: string;
  memberColor: string;
  teamKey: string;
  peerPort: number;
  webPort: number;
  bindAddress?: string;
  peers: string[];
  vaultPath: string;
  statePath: string;
}

export interface SnapshotMeta {
  id: string;
  timestamp: number;
  dateStr: string;
  docsCount: number;
  sizeBytes: number;
  scope?: WorkspaceScope;
}

export interface BridgeTransferRequest {
  fromScope: WorkspaceScope;
  toScope: WorkspaceScope;
  boardId: string;
  targetBoardId: string;
  nodeIds: string[];
  includeLinkedNotes?: boolean;
  mode?: 'copy' | 'move';
}

export interface BridgeTransferResponse {
  success: boolean;
  transferredNodeCount: number;
  transferredNoteCount: number;
  frameId?: string;
  error?: string;
}
