/**
 * Doks v85: Sovereign Collaborator Pseudo-Accounts & Session State
 * 
 * Every browser client holds a sovereign, persistent pseudo-account generated locally.
 * Client identities are never usurped or overwritten by server daemon agent IDs.
 */

export interface SovereignAccount {
  id: string; // e.g. "usr_2d4e8c1a..."
  displayName: string;
  avatarColor: string;
  secret: string; // e.g. "sec_9a7b..."
}

const STORAGE_KEYS = {
  ACCOUNT_ID: 'doks_account_id',
  ACCOUNT_NAME: 'doks_account_name',
  ACCOUNT_COLOR: 'doks_account_color',
  ACCOUNT_SECRET: 'doks_account_secret',
  LEGACY_MEMBER_ID: 'doks_member_id',
  LEGACY_MEMBER_NAME: 'doks_member_name',
  LEGACY_DISPLAY_NAME: 'doks_display_name',
  LEGACY_COLOR: 'doks_member_color',
  SESSION_ACCOUNT_ID: 'doks_session_account_id'
} as const;

const AVATAR_PALETTE = [
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#06b6d4', // Cyan
  '#84cc16', // Lime
  '#f43f5e'  // Rose
];

let cachedAccount: SovereignAccount | null = null;

function generateRandomHex(bytes = 16): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

function generateAccountSecret(): string {
  return 'sec_' + generateRandomHex(24);
}

function generateAccountId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'usr_' + crypto.randomUUID();
  }
  return 'usr_' + generateRandomHex(16);
}

function generateDefaultName(accountId: string): string {
  const shortCode = accountId.replace(/^usr_/, '').slice(0, 4).toUpperCase();
  return `Collaborator-${shortCode}`;
}

function getRandomColor(): string {
  const idx = Math.floor(Math.random() * AVATAR_PALETTE.length);
  return AVATAR_PALETTE[idx];
}

/**
 * Purges contaminated storage if the client previously stored the server's daemon agent ID.
 */
export function sanitizeContaminatedStorage(serverAgentId?: string): void {
  if (typeof localStorage === 'undefined') return;

  if (serverAgentId) {
    const existingLegacy = localStorage.getItem(STORAGE_KEYS.LEGACY_MEMBER_ID);
    if (existingLegacy && existingLegacy === serverAgentId) {
      localStorage.removeItem(STORAGE_KEYS.LEGACY_MEMBER_ID);
    }
    const existingAccount = localStorage.getItem(STORAGE_KEYS.ACCOUNT_ID);
    if (existingAccount && existingAccount === serverAgentId) {
      localStorage.removeItem(STORAGE_KEYS.ACCOUNT_ID);
      cachedAccount = null;
    }
  }
}

/**
 * Retrieves or lazily creates the sovereign pseudo-account for this browser profile.
 */
export function getMyAccount(): SovereignAccount {
  if (cachedAccount) return cachedAccount;

  let accountId: string | null = null;
  let secret: string | null = null;
  let name: string | null = null;
  let color: string | null = null;

  // 1. Session storage override (useful for multi-tab testing on the same PC)
  if (typeof sessionStorage !== 'undefined') {
    accountId = sessionStorage.getItem(STORAGE_KEYS.SESSION_ACCOUNT_ID);
  }

  // 2. Persistent local storage
  if (typeof localStorage !== 'undefined') {
    if (!accountId) {
      accountId = localStorage.getItem(STORAGE_KEYS.ACCOUNT_ID);
    }
    // Backward compatibility check: if doks_account_id is missing but doks_member_id exists,
    // ensure it's not a server agentId before adopting
    if (!accountId) {
      const legacyId = localStorage.getItem(STORAGE_KEYS.LEGACY_MEMBER_ID);
      if (legacyId && legacyId.startsWith('usr_')) {
        accountId = legacyId;
      }
    }

    secret = localStorage.getItem(STORAGE_KEYS.ACCOUNT_SECRET);
    name =
      localStorage.getItem(STORAGE_KEYS.ACCOUNT_NAME) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_DISPLAY_NAME) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_MEMBER_NAME);
    color =
      localStorage.getItem(STORAGE_KEYS.ACCOUNT_COLOR) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_COLOR);
  }

  // 3. Generate fresh sovereign identity if missing
  if (!accountId) {
    accountId = generateAccountId();
  }
  if (!secret) {
    secret = generateAccountSecret();
  }
  if (!name || name === 'User' || name === 'Admin') {
    name = generateDefaultName(accountId);
  }
  if (!color) {
    color = getRandomColor();
  }

  // 4. Persist to storage
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_ID, accountId);
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_SECRET, secret);
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_NAME, name);
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_COLOR, color);
      // Sync legacy keys for backward compatibility
      localStorage.setItem(STORAGE_KEYS.LEGACY_MEMBER_ID, accountId);
      localStorage.setItem(STORAGE_KEYS.LEGACY_MEMBER_NAME, name);
      localStorage.setItem(STORAGE_KEYS.LEGACY_DISPLAY_NAME, name);
      localStorage.setItem(STORAGE_KEYS.LEGACY_COLOR, color);
    } catch {}
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(STORAGE_KEYS.SESSION_ACCOUNT_ID, accountId);
    } catch {}
  }

  cachedAccount = {
    id: accountId,
    displayName: name,
    avatarColor: color,
    secret
  };

  return cachedAccount;
}

export function getMyAccountId(): string {
  return getMyAccount().id;
}

export function getMyAccountName(): string {
  return getMyAccount().displayName;
}

export function getMyAccountColor(): string {
  return getMyAccount().avatarColor;
}

/**
 * Updates the user's sovereign display signature.
 */
export function updateMyAccount(displayName: string, avatarColor: string): SovereignAccount {
  const current = getMyAccount();
  const trimmedName = displayName.trim() || generateDefaultName(current.id);
  const validColor = avatarColor || current.avatarColor;

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_NAME, trimmedName);
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_COLOR, validColor);
      localStorage.setItem(STORAGE_KEYS.LEGACY_DISPLAY_NAME, trimmedName);
      localStorage.setItem(STORAGE_KEYS.LEGACY_MEMBER_NAME, trimmedName);
      localStorage.setItem(STORAGE_KEYS.LEGACY_COLOR, validColor);
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('doks_profile_updated'));
  }

  cachedAccount = {
    ...current,
    displayName: trimmedName,
    avatarColor: validColor
  };

  return cachedAccount;
}
