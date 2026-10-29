import { signal } from '@preact/signals';
import { en } from './en.js';

export type Language = 'en';
export type TranslationKey = keyof typeof en;

export const currentLanguage = signal<Language>('en');

export function setLanguage(_lang?: string): void {
  // Single language mode: English
}

export function cycleLanguage(): void {
  // Single language mode: English
}

export function t(key: TranslationKey | string, params?: Record<string, string | number>): string {
  let text = (en as Record<string, string>)[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

export function useTranslation() {
  return { t, currentLanguage, setLanguage, cycleLanguage };
}
