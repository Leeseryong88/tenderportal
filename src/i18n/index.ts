import { en, type I18nKey } from './en';
import { ko } from './ko';

export type Lang = 'en' | 'ko';

const DICTIONARIES: Record<Lang, Record<I18nKey, string>> = { en, ko };

export function t(lang: Lang, key: I18nKey, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[lang] || en;
  let text = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
