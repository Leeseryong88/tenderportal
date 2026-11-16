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

/** Translates a stored enum-like value (e.g. `nda.Signed`), falling back to the raw value. */
export function tv(lang: Lang, prefix: string, value: string | null | undefined): string {
  if (!value) return '';
  const key = `${prefix}.${value}`;
  const dict = DICTIONARIES[lang] as Record<string, string>;
  return dict[key] ?? (en as Record<string, string>)[key] ?? value;
}

export function hasKey(key: string): key is I18nKey {
  return key in en;
}

/** Localized message for a server error code, or `fallback` when the code is unknown. */
export function errorMessage(lang: Lang, code: string | undefined, fallback: string): string {
  if (code) {
    if (/^INVALID_[A-Z_]+_MAGIC$/.test(code)) return t(lang, 'error.INVALID_FILE_CONTENT');
    const key = `error.${code}`;
    if (hasKey(key)) return t(lang, key);
  }
  return fallback;
}
