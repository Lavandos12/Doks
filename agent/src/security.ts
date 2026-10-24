import crypto from 'node:crypto';

/**
 * Generates a random 32-byte hex team key.
 */
export function generateTeamKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a random 16-byte nonce.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generates a random session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Computes HMAC-SHA256 proof given teamKey and payload.
 */
export function computeHmacProof(teamKey: string, payload: string): string {
  return crypto.createHmac('sha256', teamKey).update(payload).digest('hex');
}

/**
 * Verifies HMAC-SHA256 proof using timing-safe comparison.
 */
export function verifyHmacProof(teamKey: string, payload: string, candidateProof: string): boolean {
  try {
    const expected = computeHmacProof(teamKey, payload);
    const expectedBuf = Buffer.from(expected, 'hex');
    const candidateBuf = Buffer.from(candidateProof, 'hex');
    if (expectedBuf.length !== candidateBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, candidateBuf);
  } catch {
    return false;
  }
}
