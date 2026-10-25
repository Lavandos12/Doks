import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes a buffer using Bitcoin Base58 alphabet.
 */
export function base58Encode(source: Buffer | Uint8Array): string {
  if (source.length === 0) return '';
  const bytes = Array.from(source);
  const digits = [0];

  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let str = '';
  // Deal with leading zeros
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) {
    str += '1';
  }
  for (let q = digits.length - 1; q >= 0; q--) {
    str += BASE58_ALPHABET[digits[q]];
  }
  return str;
}

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

export interface NodeIdentity {
  publicKeyPem: string;
  privateKeyPem: string;
  peerId: string;
  rawPublicKeyDer: string;
}

/**
 * Generates or loads an Ed25519 identity keypair stored at node-identity.json.
 */
export function getOrGenerateNodeIdentity(configDir: string): NodeIdentity {
  const identityPath = path.join(configDir, 'node-identity.json');
  fs.mkdirSync(configDir, { recursive: true });

  if (fs.existsSync(identityPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      if (data.publicKeyPem && data.privateKeyPem && data.peerId) {
        return data as NodeIdentity;
      }
    } catch {}
  }

  // Generate Ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const rawPublicKeyDer = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

  // peerId = base58(sha256(rawPublicKeyDer))
  const keyHash = crypto.createHash('sha256').update(Buffer.from(rawPublicKeyDer, 'base64')).digest();
  const peerId = base58Encode(keyHash);

  const identity: NodeIdentity = {
    publicKeyPem,
    privateKeyPem,
    peerId,
    rawPublicKeyDer
  };

  try {
    fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
  } catch {}

  return identity;
}

/**
 * Signs a challenge payload using the node's Ed25519 private key.
 */
export function signChallenge(privateKeyPem: string, payload: string | Buffer): string {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  return crypto.sign(null, data, privateKey).toString('hex');
}

/**
 * Verifies an Ed25519 signature against a public key.
 */
export function verifyChallengeSignature(
  publicKeyPemOrDer: string,
  payload: string | Buffer,
  signatureHex: string
): boolean {
  try {
    let publicKey: crypto.KeyObject;
    if (publicKeyPemOrDer.startsWith('-----BEGIN')) {
      publicKey = crypto.createPublicKey(publicKeyPemOrDer);
    } else {
      publicKey = crypto.createPublicKey({
        key: Buffer.from(publicKeyPemOrDer, 'base64'),
        format: 'der',
        type: 'spki'
      });
    }
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    const signature = Buffer.from(signatureHex, 'hex');
    return crypto.verify(null, data, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Derives a 256-bit symmetric traffic key using HKDF-SHA256 from teamKey and salt.
 */
export function deriveTrafficKey(teamKey: string, salt: string | Buffer): Buffer {
  const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'utf8');
  const ikm = Buffer.from(teamKey, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, saltBuf, 'doks-p2p-v1', 32));
}

/**
 * Encrypts a payload into an AEAD AES-256-GCM frame: [16-byte authTag][ciphertext].
 */
export function encryptAeadFrame(key: Buffer, nonce: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([authTag, ciphertext]);
}

/**
 * Decrypts an AEAD AES-256-GCM frame. Throws error if tag fails to verify.
 */
export function decryptAeadFrame(key: Buffer, nonce: Buffer, frame: Buffer, aad?: Buffer): Buffer {
  if (frame.length < 16) {
    throw new Error('AEAD frame length too short');
  }
  const authTag = frame.subarray(0, 16);
  const ciphertext = frame.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Creates a 12-byte monotonic nonce: 4 bytes random prefix + 8 bytes big-endian counter.
 */
export function createMonotonicNonce(prefix: number, counter: bigint): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(prefix >>> 0, 0);
  buf.writeBigUInt64BE(counter, 4);
  return buf;
}
