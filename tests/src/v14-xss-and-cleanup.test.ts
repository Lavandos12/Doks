import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isSafeUrl } from '@doks/shared';

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
});
