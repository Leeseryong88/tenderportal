const collators = new Map<string, Intl.Collator>();

/** Locale-aware comparer: 가나다 order in Korean (Hangul before Latin), A–Z in English. */
export function compareLabels(lang: 'en' | 'ko'): (a: string, b: string) => number {
  let collator = collators.get(lang);
  if (!collator) {
    collator = new Intl.Collator(lang === 'ko' ? 'ko' : 'en', { numeric: true, sensitivity: 'base' });
    collators.set(lang, collator);
  }
  return collator.compare;
}

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

function toChoseong(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code >= 0xac00 && code <= 0xd7a3 ? CHOSEONG[Math.floor((code - 0xac00) / 588)] : ch;
  }
  return out;
}

function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

/** Case/space-insensitive substring match; a query of bare initial consonants (e.g. "ㅁㄱ") matches 미국. */
export function matchesSearch(text: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const target = normalize(text);
  if (target.includes(q)) return true;
  return /^[ㄱ-ㅎ]+$/.test(q) && toChoseong(target).includes(q);
}
