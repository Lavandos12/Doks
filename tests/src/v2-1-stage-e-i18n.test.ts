import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Stage E: Bilingual Support, Apache-2.0 License & Documentation', () => {
  const rootDir = path.resolve(__dirname, '../../');

  it('verifies LICENSE is Apache License 2.0 with proper grant and liability clauses', () => {
    const licensePath = path.join(rootDir, 'LICENSE');
    expect(fs.existsSync(licensePath)).toBe(true);
    const content = fs.readFileSync(licensePath, 'utf-8');
    expect(content).toContain('Apache License');
    expect(content).toContain('Version 2.0, January 2004');
    expect(content).toContain('Grant of Patent License');
    expect(content).toContain('Disclaimer of Warranty');
    expect(content).toContain('Limitation of Liability');
  });

  it('verifies NOTICE and THIRD_PARTY_NOTICES.md exist with third-party components', () => {
    const noticePath = path.join(rootDir, 'NOTICE');
    const thirdPartyPath = path.join(rootDir, 'THIRD_PARTY_NOTICES.md');
    expect(fs.existsSync(noticePath)).toBe(true);
    expect(fs.existsSync(thirdPartyPath)).toBe(true);

    const notices = fs.readFileSync(thirdPartyPath, 'utf-8');
    expect(notices).toContain('Yjs');
    expect(notices).toContain('Fastify');
    expect(notices).toContain('CodeMirror');
    expect(notices).toContain('MiniSearch');
    expect(notices).toContain('Preact');
  });

  it('verifies English README.md and Russian README.ru.md exist with required sections', () => {
    const readmeEnPath = path.join(rootDir, 'README.md');
    const readmeRuPath = path.join(rootDir, 'README.ru.md');
    expect(fs.existsSync(readmeEnPath)).toBe(true);
    expect(fs.existsSync(readmeRuPath)).toBe(true);

    const en = fs.readFileSync(readmeEnPath, 'utf-8');
    const ru = fs.readFileSync(readmeRuPath, 'utf-8');

    // English README checks
    expect(en).toContain('Feature Matrix');
    expect(en).toContain('Benchmarks');
    expect(en).toContain('Known Limitations');
    expect(en).toContain('doks.bat');
    expect(en).toContain('doks.sh');
    expect(en).toContain('Apache License 2.0');

    // Russian README checks
    expect(ru).toContain('Матрица возможностей');
    expect(ru).toContain('Бенчмарки');
    expect(ru).toContain('Ограничения');
    expect(ru).toContain('doks.bat');
    expect(ru).toContain('doks.sh');
    expect(ru).toContain('Apache License 2.0');
  });

  it('verifies technical documentation in docs/ directory', () => {
    const docs = ['architecture.md', 'formats.md', 'threat-model.md', 'faq.md'];
    for (const doc of docs) {
      const docPath = path.join(rootDir, 'docs', doc);
      expect(fs.existsSync(docPath), `docs/${doc} should exist`).toBe(true);
      const content = fs.readFileSync(docPath, 'utf-8');
      expect(content.length).toBeGreaterThan(200);
    }
  });

  it('verifies web English dictionary has comprehensive translations and legacy ru.ts purged', async () => {
    const i18nPath = path.join(rootDir, 'web/src/i18n');
    expect(fs.existsSync(i18nPath)).toBe(true);

    const ruPath = path.join(i18nPath, 'ru.ts');
    const enPath = path.join(i18nPath, 'en.ts');
    expect(fs.existsSync(ruPath), 'Legacy ru.ts must be purged').toBe(false);
    expect(fs.existsSync(enPath)).toBe(true);

    const enContent = fs.readFileSync(enPath, 'utf-8');

    // Simple key extraction from typescript object
    const extractKeys = (src: string) => {
      const matches = src.match(/^\s*['"]?([a-zA-Z0-9_.-]+)['"]?:\s*['"`]/gm) || [];
      return new Set(matches.map((m) => m.split(':')[0].trim().replace(/['"]/g, '')));
    };

    const enKeys = extractKeys(enContent);
    expect(enKeys.size).toBeGreaterThan(50);
    expect(enKeys.has('status.synced')).toBe(true);
    expect(enKeys.has('status.connecting')).toBe(true);
    expect(enKeys.has('status.offline')).toBe(true);
  });
});
