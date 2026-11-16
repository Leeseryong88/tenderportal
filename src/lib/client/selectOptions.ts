import type { SelectOption } from '@/components/ui/SearchableSelect';
import { getCountryAlpha2List, getUsStateList } from '@/lib/domain/coverage';

/** Country options keyed by English name (the stored value), searchable in both languages and by ISO code. */
export function countryOptions(lang: 'en' | 'ko', group?: string): SelectOption[] {
  return getCountryAlpha2List().map((c) => ({
    value: c.en,
    label: lang === 'ko' ? c.ko || c.en : c.en,
    keywords: `${c.en} ${c.ko} ${c.code}`,
    group,
  }));
}

export function usStateOptions(lang: 'en' | 'ko', group?: string): SelectOption[] {
  return getUsStateList().map((s) => ({
    value: s.code,
    label: lang === 'ko' ? `${s.ko} (${s.abbr})` : `${s.en} (${s.abbr})`,
    keywords: `${s.en} ${s.ko} ${s.abbr}`,
    group,
  }));
}
