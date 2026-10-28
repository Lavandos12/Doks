import { signal } from '@preact/signals';
import { ru } from './ru.js';
import { en } from './en.js';
import { es } from './es.js';

export type Language = 'ru' | 'en' | 'es';
export type TranslationKey = keyof typeof ru;

const savedLang = typeof localStorage !== 'undefined'
  ? (localStorage.getItem('doks_lang') as Language)
  : null;

export const currentLanguage = signal<Language>(
  savedLang === 'en' || savedLang === 'es' || savedLang === 'ru' ? savedLang : 'ru'
);

export function setLanguage(lang: Language): void {
  currentLanguage.value = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('doks_lang', lang);
  }
}

export function cycleLanguage(): void {
  const next: Language =
    currentLanguage.value === 'ru' ? 'en' : currentLanguage.value === 'en' ? 'es' : 'ru';
  setLanguage(next);
}

export function t(key: TranslationKey | string, params?: Record<string, string | number>): string {
  const lang = currentLanguage.value;
  const dict = lang === 'en' ? en : lang === 'es' ? es : ru;
  let text = (dict as Record<string, string>)[key] || (ru as Record<string, string>)[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}
