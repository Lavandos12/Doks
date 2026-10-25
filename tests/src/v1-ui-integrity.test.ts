import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('V1 UI Integrity & Strict Zero-Emoji Policy', () => {
  it('enforces 0 Extended_Pictographic Unicode emojis across all web/src and shared/src source files', () => {
    const emojiRegex = /\p{Extended_Pictographic}/u;
    const targetDirs = [
      path.resolve(process.cwd(), 'web/src'),
      path.resolve(process.cwd(), 'shared/src')
    ];

    const violations: { file: string; line: number; text: string }[] = [];

    function scanDirectory(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', 'dist', '.git'].includes(entry.name)) {
            scanDirectory(fullPath);
          }
        } else if (/\.(ts|tsx|css|html)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (emojiRegex.test(line)) {
              violations.push({
                file: path.relative(process.cwd(), fullPath),
                line: index + 1,
                text: line.trim()
              });
            }
          });
        }
      }
    }

    targetDirs.forEach(scanDirectory);

    if (violations.length > 0) {
      const details = violations.map((v) => `  ${v.file}:${v.line} -> ${v.text}`).join('\n');
      expect.fail(
        `Strict Zero-Emoji Policy violation: found ${violations.length} emoji characters in source files:\n${details}`
      );
    }

    expect(violations.length).toBe(0);
  });
});
