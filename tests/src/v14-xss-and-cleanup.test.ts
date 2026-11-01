import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isSafeUrl } from '@doks/shared';
import { isScannerProbe } from '@doks/agent';

describe('V29 Garbage Elimination, XSS Sanitization & Cloud Host Compatibility', () => {
  it('strictly validates URL protocols and rejects javascript:, data:, and vbscript: URIs', () => {
    // Malicious XSS vectors
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JAVASCRIPT:alert(document.cookie)')).toBe(false);
    expect(isSafeUrl('  javascript:void(0)  ')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeUrl('')).toBe(false);

    // Safe valid URLs
    expect(isSafeUrl('https://example.com/page')).toBe(true);
    expect(isSafeUrl('http://127.0.0.1:4780/b/test')).toBe(true);
    expect(isSafeUrl('mailto:user@example.com')).toBe(true);
    expect(isSafeUrl('/api/attachments/hash123')).toBe(true);
    expect(isSafeUrl('#section-overview')).toBe(true);
  });

  it('confirms doks.sh, test-results/, and tmp/ are permanently deleted', () => {
    const rootDir = process.cwd();
    expect(fs.existsSync(path.join(rootDir, 'doks.sh'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'test-results'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'tmp'))).toBe(false);
  });

  it('confirms release/web/dist/assets/ contains only a single clean build bundle without orphaned hashes', () => {
    const assetsDir = path.resolve(process.cwd(), 'release/web/dist/assets');
    if (fs.existsSync(assetsDir)) {
      const files = fs.readdirSync(assetsDir);
      const jsFiles = files.filter((f) => f.endsWith('.js'));
      const cssFiles = files.filter((f) => f.endsWith('.css'));
      expect(jsFiles.length).toBe(1);
      expect(cssFiles.length).toBe(1);
    }
  });

  it('detects scanner probes and allows legitimate SPA routes and ACME challenges', () => {
    // Malicious scanner probe patterns
    expect(isScannerProbe('/.env')).toBe(true);
    expect(isScannerProbe('/.env.production')).toBe(true);
    expect(isScannerProbe('/.git/config')).toBe(true);
    expect(isScannerProbe('/.git/HEAD')).toBe(true);
    expect(isScannerProbe('/index.php')).toBe(true);
    expect(isScannerProbe('/index.php?foo=bar')).toBe(true);
    expect(isScannerProbe('/wp-login.php')).toBe(true);
    expect(isScannerProbe('/wp-admin/')).toBe(true);
    expect(isScannerProbe('/phpmyadmin/index.php')).toBe(true);
    expect(isScannerProbe('/xmlrpc.php')).toBe(true);
    expect(isScannerProbe('/test.asp')).toBe(true);
    expect(isScannerProbe('/shell.jsp')).toBe(true);
    expect(isScannerProbe('/actuator/health')).toBe(true);
    expect(isScannerProbe('/.well-known/security.txt')).toBe(true);

    // Legitimate paths allowed through
    expect(isScannerProbe('/.well-known/acme-challenge/token123')).toBe(false);
    expect(isScannerProbe('/')).toBe(false);
    expect(isScannerProbe('/b/solo-main')).toBe(false);
    expect(isScannerProbe('/b/4d41fa33-8798-466d-a199-52e698889ff9')).toBe(false);
    expect(isScannerProbe('/api/status')).toBe(false);
    expect(isScannerProbe('/api/network-status')).toBe(false);
    expect(isScannerProbe('/assets/index.js')).toBe(false);
    expect(isScannerProbe('/favicon.svg')).toBe(false);
  });
});
