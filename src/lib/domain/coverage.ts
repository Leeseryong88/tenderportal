import { WORLD_COUNTRY_PATHS } from '@/data/maps/worldCountries';
import { US_STATE_PATHS } from '@/data/maps/usStates';
import type { CoverageItem, DeliveryMode, SupplierDirectoryDTO, SupplierRecord } from '@/types/domain';

// Comprehensive ISO 3166-1 alpha-3 -> alpha-2 mapping covering Natural Earth countries
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: 'AF', AGO: 'AO', ALB: 'AL', ARE: 'AE', ARG: 'AR', ARM: 'AM', ATA: 'AQ', ATF: 'TF',
  AUS: 'AU', AUT: 'AT', AZE: 'AZ', BDI: 'BI', BEL: 'BE', BEN: 'BJ', BFA: 'BF', BGD: 'BD',
  BGR: 'BG', BHS: 'BS', BIH: 'BA', BLR: 'BY', BLZ: 'BZ', BOL: 'BO', BRA: 'BR', BRN: 'BN',
  BTN: 'BT', BWA: 'BW', CAF: 'CF', CAN: 'CA', CHE: 'CH', CHL: 'CL', CHN: 'CN', CIV: 'CI',
  CMR: 'CM', COD: 'CD', COG: 'CG', COL: 'CO', CRI: 'CR', CUB: 'CU', CYP: 'CY', CZE: 'CZ',
  DEU: 'DE', DJI: 'DJ', DNK: 'DK', DOM: 'DO', DZA: 'DZ', ECU: 'EC', EGY: 'EG', ERI: 'ER',
  ESP: 'ES', EST: 'EE', ETH: 'ET', FIN: 'FI', FJI: 'FJ', FLK: 'FK', FRA: 'FR', GAB: 'GA',
  GBR: 'GB', GEO: 'GE', GHA: 'GH', GIN: 'GN', GMB: 'GM', GNB: 'GW', GNQ: 'GQ', GRC: 'GR',
  GRL: 'GL', GTM: 'GT', GUY: 'GY', HND: 'HN', HRV: 'HR', HTI: 'HT', HUN: 'HU', IDN: 'ID',
  IND: 'IN', IRL: 'IE', IRN: 'IR', IRQ: 'IQ', ISL: 'IS', ISR: 'IL', ITA: 'IT', JAM: 'JM',
  JOR: 'JO', JPN: 'JP', KAZ: 'KZ', KEN: 'KE', KGZ: 'KG', KHM: 'KH', KOR: 'KR', KWT: 'KW',
  LAO: 'LA', LBN: 'LB', LBR: 'LR', LBY: 'LY', LKA: 'LK', LSO: 'LS', LTU: 'LT', LUX: 'LU',
  LVA: 'LV', MAR: 'MA', MDA: 'MD', MDG: 'MG', MEX: 'MX', MKD: 'MK', MLI: 'ML', MMR: 'MM',
  MNE: 'ME', MNG: 'MN', MOZ: 'MZ', MRT: 'MR', MWI: 'MW', MYS: 'MY', NAM: 'NA', NCL: 'NC',
  NER: 'NE', NGA: 'NG', NIC: 'NI', NLD: 'NL', NOR: 'NO', NPL: 'NP', NZL: 'NZ', OMN: 'OM',
  PAK: 'PK', PAN: 'PA', PER: 'PE', PHL: 'PH', PNG: 'PG', POL: 'PL', PRI: 'PR', PRK: 'KP',
  PRT: 'PT', PRY: 'PY', PSE: 'PS', QAT: 'QA', ROU: 'RO', RUS: 'RU', RWA: 'RW', SAH: 'EH',
  SAU: 'SA', SDN: 'SD', SEN: 'SN', SGP: 'SG', SLB: 'SB', SLE: 'SL', SLV: 'SV', SOM: 'SO',
  SRB: 'RS', SSD: 'SS', SUR: 'SR', SVK: 'SK', SVN: 'SI', SWE: 'SE', SWZ: 'SZ', SYR: 'SY',
  TCD: 'TD', TGO: 'TG', THA: 'TH', TJK: 'TJ', TKM: 'TM', TLS: 'TL', TTO: 'TT', TUN: 'TN',
  TUR: 'TR', TWN: 'TW', TZA: 'TZ', UGA: 'UG', UKR: 'UA', URY: 'UY', USA: 'US', UZB: 'UZ',
  VEN: 'VE', VNM: 'VN', VUT: 'VU', YEM: 'YE', ZAF: 'ZA', ZMB: 'ZM', ZWE: 'ZW',
  KOS: 'XK', SOL: 'SO', CYN: 'CY',
};

const ALPHA2_TO_COUNTRY = new Map<string, { n: string; ko: string; iso3: string }>();
for (const c of WORLD_COUNTRY_PATHS) {
  const alpha2 = ALPHA3_TO_ALPHA2[c.iso] ?? c.iso.slice(0, 2);
  if (!ALPHA2_TO_COUNTRY.has(alpha2)) {
    ALPHA2_TO_COUNTRY.set(alpha2, { n: c.n, ko: c.ko, iso3: c.iso });
  }
}

export const US_STATE_BY_CODE = new Map(US_STATE_PATHS.map((s) => [`US-${s.c}`, s]));
export const US_STATE_BY_ABBR = new Map(US_STATE_PATHS.map((s) => [s.c, s]));

const COUNTRY_ALIASES: Record<string, string> = {
  au: 'AU',
  aus: 'AU',
  australia: 'AU',
  'commonwealth of australia': 'AU',
  호주: 'AU',
  오스트레일리아: 'AU',
  us: 'US',
  'u s': 'US',
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  미국: 'US',
  uk: 'GB',
  gb: 'GB',
  gbr: 'GB',
  'united kingdom': 'GB',
  'great britain': 'GB',
  england: 'GB',
  영국: 'GB',
  kr: 'KR',
  kor: 'KR',
  korea: 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'korea republic of': 'KR',
  대한민국: 'KR',
  한국: 'KR',
  de: 'DE',
  deu: 'DE',
  germany: 'DE',
  deutschland: 'DE',
  독일: 'DE',
  it: 'IT',
  ita: 'IT',
  italy: 'IT',
  italia: 'IT',
  이탈리아: 'IT',
  fr: 'FR',
  fra: 'FR',
  france: 'FR',
  프랑스: 'FR',
  jp: 'JP',
  jpn: 'JP',
  japan: 'JP',
  日本: 'JP',
  일본: 'JP',
  cn: 'CN',
  chn: 'CN',
  china: 'CN',
  中国: 'CN',
  중국: 'CN',
  sg: 'SG',
  sgp: 'SG',
  singapore: 'SG',
  싱가포르: 'SG',
  ca: 'CA',
  can: 'CA',
  canada: 'CA',
  캐나다: 'CA',
};

function cleanKey(raw: string): string {
  return String(raw || '')
    .trim()
    .normalize('NFC')
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAsciiKey(raw: string): string {
  return String(raw || '')
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NormalizedMarket {
  countryCode: string;
  countryName: string;
  subdivisionCode: string | null;
  displayName: string;
  recognized: boolean;
  legacyValue: string | null;
}

export function normalizeCountryInput(rawInput: string): {
  countryCode: string;
  countryName: string;
  recognized: boolean;
} {
  const raw = String(rawInput || '').trim();
  if (!raw) return { countryCode: '', countryName: '', recognized: false };
  const key = cleanKey(raw);

  // Direct alias (checks NFC Korean + ASCII-folded Latin)
  const aliasAlpha2 = COUNTRY_ALIASES[key] ?? COUNTRY_ALIASES[cleanAsciiKey(raw)];
  if (aliasAlpha2) {
    const found = ALPHA2_TO_COUNTRY.get(aliasAlpha2);
    return {
      countryCode: aliasAlpha2,
      countryName: found?.n || raw,
      recognized: true,
    };
  }

  // Exact alpha-2 or alpha-3
  const upper = raw.toUpperCase();
  if (ALPHA2_TO_COUNTRY.has(upper)) {
    return {
      countryCode: upper,
      countryName: ALPHA2_TO_COUNTRY.get(upper)!.n,
      recognized: true,
    };
  }
  if (ALPHA3_TO_ALPHA2[upper] && ALPHA2_TO_COUNTRY.has(ALPHA3_TO_ALPHA2[upper])) {
    const a2 = ALPHA3_TO_ALPHA2[upper];
    return {
      countryCode: a2,
      countryName: ALPHA2_TO_COUNTRY.get(a2)!.n,
      recognized: true,
    };
  }

  // Natural Earth English / Korean match
  const asciiKey = cleanAsciiKey(raw);
  const matched = WORLD_COUNTRY_PATHS.find(
    (c) => cleanAsciiKey(c.n) === asciiKey || c.ko === raw.trim()
  );
  if (matched) {
    const a2 = ALPHA3_TO_ALPHA2[matched.iso] ?? matched.iso.slice(0, 2);
    return { countryCode: a2, countryName: matched.n, recognized: true };
  }

  return { countryCode: 'UNMAPPED', countryName: raw, recognized: false };
}

export function normalizeMarketInput(rawInput: string): NormalizedMarket {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return {
      countryCode: '',
      countryName: '',
      subdivisionCode: null,
      displayName: '',
      recognized: false,
      legacyValue: null,
    };
  }
  const key = cleanKey(raw);

  // Check US-XX format or US state name / abbreviation / Korean label
  const isoSubMatch = raw.toUpperCase().match(/^US-([A-Z]{2})$/);
  if (isoSubMatch && US_STATE_BY_ABBR.has(isoSubMatch[1])) {
    const st = US_STATE_BY_ABBR.get(isoSubMatch[1])!;
    return {
      countryCode: 'US',
      countryName: 'United States',
      subdivisionCode: `US-${st.c}`,
      displayName: st.n,
      recognized: true,
      legacyValue: null,
    };
  }

  const stateMatch = US_STATE_PATHS.find(
    (s) =>
      cleanKey(s.n) === key ||
      s.c.toLowerCase() === key ||
      s.ko === raw.trim()
  );
  if (stateMatch) {
    return {
      countryCode: 'US',
      countryName: 'United States',
      subdivisionCode: `US-${stateMatch.c}`,
      displayName: stateMatch.n,
      recognized: true,
      legacyValue: null,
    };
  }

  const country = normalizeCountryInput(raw);
  if (country.recognized) {
    return {
      countryCode: country.countryCode,
      countryName: country.countryName,
      subdivisionCode: null,
      displayName: country.countryName,
      recognized: true,
      legacyValue: null,
    };
  }

  return {
    countryCode: 'UNMAPPED',
    countryName: raw,
    subdivisionCode: null,
    displayName: raw,
    recognized: false,
    legacyValue: raw,
  };
}

export function normalizeDeliveryMode(raw: string): DeliveryMode {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'LOCAL_PARTNER' || v === 'LOCAL PARTNER' || v === 'LOCAL' || v === '현지 파트너') {
    return 'LOCAL_PARTNER';
  }
  if (v === 'UNAVAILABLE' || v === 'NOT AVAILABLE' || v === '불가' || v === '수행 불가') {
    return 'UNAVAILABLE';
  }
  return 'DIRECT';
}

export function normalizeCoverageList(
  items: Array<{ market: string; cityName?: string | null; deliveryMode: DeliveryMode }>
): CoverageItem[] {
  const dedup = new Map<string, CoverageItem>();
  for (const item of items) {
    const norm = normalizeMarketInput(item.market);
    if (!norm.displayName) continue;
    const key = `${norm.countryCode}::${norm.subdivisionCode || ''}::${norm.displayName.toLowerCase()}`;
    dedup.set(key, {
      countryCode: norm.countryCode,
      subdivisionCode: norm.subdivisionCode,
      cityName: item.cityName?.trim() || null,
      displayName: norm.displayName,
      deliveryMode: normalizeDeliveryMode(item.deliveryMode),
      legacyValue: norm.recognized ? null : norm.legacyValue,
    });
  }
  return [...dedup.values()];
}

/**
 * Specificity rule:
 * - For a US state query (e.g. subdivisionCode = 'US-TX'), if a supplier has an explicit
 *   entry for 'US-TX', that specific state entry overrides any country-wide 'US' entry.
 * - If no specific 'US-TX' entry exists, a country-wide 'US' entry (subdivisionCode === null) applies.
 */
export function resolveSupplierCoverageForMarket(
  coverage: CoverageItem[],
  query: { countryCode?: string; subdivisionCode?: string | null }
): CoverageItem | null {
  if (query.subdivisionCode) {
    const exactSub = coverage.find((c) => c.subdivisionCode === query.subdivisionCode);
    if (exactSub) return exactSub;
    // Country-wide fallback for US states
    if (query.subdivisionCode.startsWith('US-')) {
      const countryWide = coverage.find(
        (c) => c.countryCode === 'US' && !c.subdivisionCode
      );
      if (countryWide) return countryWide;
    }
    return null;
  }

  if (query.countryCode) {
    const exactCountry = coverage.find(
      (c) => c.countryCode === query.countryCode && !c.subdivisionCode
    );
    if (exactCountry) return exactCountry;
    // If querying 'US' country-level, any US state coverage also means presence in US
    const anyInCountry = coverage.find((c) => c.countryCode === query.countryCode);
    return anyInCountry || null;
  }

  return null;
}

export function countryDisplayName(countryCode: string, fallbackName: string, lang: 'en' | 'ko'): string {
  const c = ALPHA2_TO_COUNTRY.get(countryCode);
  if (!c) return fallbackName;
  return lang === 'ko' ? c.ko || c.n : c.n;
}

export function marketDisplayName(
  item: Pick<CoverageItem, 'countryCode' | 'subdivisionCode' | 'displayName'>,
  lang: 'en' | 'ko'
): string {
  if (item.subdivisionCode) {
    const st = US_STATE_BY_CODE.get(item.subdivisionCode);
    if (st) return lang === 'ko' ? `${st.ko} (${st.c})` : `${st.n} (${st.c})`;
  }
  const c = ALPHA2_TO_COUNTRY.get(item.countryCode);
  if (c) return lang === 'ko' ? c.ko || c.n : c.n;
  return item.displayName;
}

export function getCountryAlpha2List(): Array<{ code: string; en: string; ko: string }> {
  return WORLD_COUNTRY_PATHS.map((c) => ({
    code: ALPHA3_TO_ALPHA2[c.iso] ?? c.iso.slice(0, 2),
    en: c.n,
    ko: c.ko,
  })).sort((a, b) => a.en.localeCompare(b.en));
}

export function getUsStateList(): Array<{ code: string; abbr: string; en: string; ko: string }> {
  return US_STATE_PATHS.map((s) => ({
    code: `US-${s.c}`,
    abbr: s.c,
    en: s.n,
    ko: s.ko,
  })).sort((a, b) => a.en.localeCompare(b.en));
}

export function toSupplierDirectoryDTO(s: SupplierRecord): SupplierDirectoryDTO {
  // Explicitly strip internalNotes, tender history, amounts, NDA files, and internal metadata
  return {
    id: s.id,
    name: s.name,
    countryCode: s.countryCode,
    countryName: s.countryName,
    city: s.city,
    categories: [...s.categories],
    coverage: s.coverage.map((c) => ({ ...c })),
    contacts: s.contacts.map((c) => ({ ...c })),
    website: s.website,
    ndaStatus: s.ndaStatus,
    ndaSignedDate: s.ndaSignedDate,
    license: s.license,
    licenseStatus: s.licenseStatus,
    licenseExpiry: s.licenseExpiry,
    status: s.status,
  };
}
