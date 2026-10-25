import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import crypto from 'node:crypto';
import {
  applyStringDiffToYText,
  parseScopedDocName,
  getScopedDocName,
  isSoloDoc,
  isTeamDoc
} from '@doks/shared';
import {
  getOrGenerateNodeIdentity,
  signChallenge,
  verifyChallengeSignature,
  deriveTrafficKey,
  encryptAeadFrame,
  decryptAeadFrame,
  createMonotonicNonce,
  base58Encode
} from '../../agent/src/security.js';
import path from 'node:path';
import fs from 'node:fs';

describe('V3 Security, CRDT Diffing & AEAD Cryptography', () => {
  it('applyStringDiffToYText merges concurrent edits from two peers without data loss or character duplication', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const textA = docA.getText('text');
    const textB = docB.getText('text');

    // Initial state: "Hello World"
    textA.insert(0, 'Hello World');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(textB.toString()).toBe('Hello World');

    // Peer A edits start: "Great Hello World"
    applyStringDiffToYText(textA, 'Great Hello World');

    // Peer B edits end: "Hello World Today"
    applyStringDiffToYText(textB, 'Hello World Today');

    // Sync updates both ways
    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docB, updateA);
    Y.applyUpdate(docA, updateB);

    // Both documents must converge to the exact same text containing both edits
    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toContain('Great');
    expect(textA.toString()).toContain('Today');
    expect(textA.toString()).toContain('Hello World');
  });

  it('generates persistent Ed25519 node identity and base58 peerId', () => {
    const tmpDir = path.join(process.cwd(), 'tmp', `test-ident-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const identity = getOrGenerateNodeIdentity(tmpDir);

    expect(identity.peerId).toBeDefined();
    expect(identity.peerId.length).toBeGreaterThan(20);
    expect(identity.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(identity.privateKeyPem).toContain('BEGIN PRIVATE KEY');

    // Re-reading from same dir returns identical identity
    const identity2 = getOrGenerateNodeIdentity(tmpDir);
    expect(identity2.peerId).toBe(identity.peerId);

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('signs and verifies handshake challenge with Ed25519 keypair', () => {
    const tmpDir = path.join(process.cwd(), 'tmp', `test-sign-${Date.now()}`);
    const identity = getOrGenerateNodeIdentity(tmpDir);

    const challengePayload = 'nonce1234-nonce5678-' + identity.peerId;
    const signature = signChallenge(identity.privateKeyPem, challengePayload);
    expect(signature).toBeDefined();

    const isValid = verifyChallengeSignature(identity.publicKeyPem, challengePayload, signature);
    expect(isValid).toBe(true);

    const isInvalid = verifyChallengeSignature(identity.publicKeyPem, 'tampered-payload', signature);
    expect(isInvalid).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts frames with HKDF-derived AEAD AES-256-GCM rejecting tampered frames', () => {
    const teamKey = 'my-secret-team-key-32-bytes-long!';
    const salt = 'random-salt-12345';
    const trafficKey = deriveTrafficKey(teamKey, salt);

    expect(trafficKey.length).toBe(32);

    const nonce = createMonotonicNonce(1, 42n);
    const plaintext = Buffer.from('Sensitive P2P CRDT sync update content');

    const encrypted = encryptAeadFrame(trafficKey, nonce, plaintext);
    expect(encrypted.length).toBeGreaterThan(plaintext.length);

    const decrypted = decryptAeadFrame(trafficKey, nonce, encrypted);
    expect(decrypted.toString('utf8')).toBe(plaintext.toString('utf8'));

    // Tampering with 1 byte in ciphertext must fail authentication
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0x01;

    expect(() => {
      decryptAeadFrame(trafficKey, nonce, tampered);
    }).toThrow();
  });

  it('correctly parses and validates scoped document names', () => {
    expect(parseScopedDocName('solo:doks-index')).toEqual({ scope: 'solo', entityName: 'doks-index' });
    expect(parseScopedDocName('team:doks-note-123')).toEqual({ scope: 'team', entityName: 'doks-note-123' });
    expect(parseScopedDocName('doks-board-main')).toEqual({ scope: 'team', entityName: 'doks-board-main' });

    expect(isSoloDoc('solo:doks-note-1')).toBe(true);
    expect(isSoloDoc('team:doks-note-1')).toBe(false);
    expect(isSoloDoc('doks-note-1')).toBe(false);

    expect(isTeamDoc('solo:doks-note-1')).toBe(false);
    expect(isTeamDoc('team:doks-note-1')).toBe(true);
    expect(isTeamDoc('doks-note-1')).toBe(true);

    expect(getScopedDocName('solo', 'doks-note-abc')).toBe('solo:doks-note-abc');
    expect(getScopedDocName('team', 'doks-note-abc')).toBe('team:doks-note-abc');
  });
});
