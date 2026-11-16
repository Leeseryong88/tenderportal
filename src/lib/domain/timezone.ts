export type DstDisambiguation = 'earlier' | 'later' | 'reject';

export interface LocalDateTimeResolution {
  ok: boolean;
  utcIso?: string;
  ambiguous?: boolean;
  candidates?: Array<{ utcIso: string; offsetLabel: string }>;
  errorCode?: 'INVALID_FORMAT' | 'INVALID_TIMEZONE' | 'NON_EXISTENT_LOCAL_TIME' | 'AMBIGUOUS_LOCAL_TIME';
}

export function timeZoneForLocation(country = '', city = ''): string {
  const c = String(country).toLowerCase();
  const v = String(city).toLowerCase();
  if (c.includes('united states') || c === 'us' || c === 'usa') {
    if (/boston|new york|miami|washington|atlanta/.test(v)) return 'America/New_York';
    if (/dallas|austin|chicago|houston/.test(v)) return 'America/Chicago';
    if (/denver|phoenix/.test(v)) return /phoenix/.test(v) ? 'America/Phoenix' : 'America/Denver';
    if (/los angeles|san francisco|seattle|san diego/.test(v)) return 'America/Los_Angeles';
    return 'America/New_York';
  }
  if (c.includes('canada') || c === 'ca') {
    return /vancouver/.test(v) ? 'America/Vancouver' : 'America/Toronto';
  }
  if (c.includes('australia') || c === 'au') {
    if (/melbourne/.test(v)) return 'Australia/Melbourne';
    if (/perth/.test(v)) return 'Australia/Perth';
    if (/brisbane/.test(v)) return 'Australia/Brisbane';
    if (/adelaide/.test(v)) return 'Australia/Adelaide';
    return 'Australia/Sydney';
  }
  if (c.includes('united kingdom') || c === 'uk' || c === 'gb') return 'Europe/London';
  if (c.includes('germany') || c === 'de') return 'Europe/Berlin';
  if (c.includes('italy') || c === 'it') return 'Europe/Rome';
  if (c.includes('france') || c === 'fr') return 'Europe/Paris';
  if (c.includes('japan') || c === 'jp') return 'Asia/Tokyo';
  if (c.includes('china') || c === 'cn') return 'Asia/Shanghai';
  if (c.includes('indonesia') || c === 'id') return 'Asia/Jakarta';
  if (c.includes('singapore') || c === 'sg') return 'Asia/Singapore';
  if (c.includes('korea') || c === 'kr') return 'Asia/Seoul';
  return 'Asia/Seoul';
}

export function isValidIanaTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function getSupportedTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/New_York',
      'America/Toronto',
      'America/Vancouver',
      'Asia/Jakarta',
      'Asia/Seoul',
      'Asia/Shanghai',
      'Asia/Singapore',
      'Asia/Tokyo',
      'Australia/Melbourne',
      'Australia/Perth',
      'Australia/Sydney',
      'Europe/Berlin',
      'Europe/London',
      'Europe/Paris',
      'Europe/Rome',
      'Pacific/Auckland',
      'UTC',
    ];
  }
}

function partsInZone(ms: number, zone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

export function timeZoneOffsetLabel(zone: string, value: Date = new Date(), locale: 'en' | 'ko' = 'en'): string {
  try {
    const parts = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(value);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
    return tz ? `${zone} (${tz})` : zone;
  } catch {
    return zone;
  }
}

/**
 * Converts YYYY-MM-DDTHH:mm in an IANA time zone to UTC ISO string.
 * Explicitly detects:
 * - Spring-forward DST gaps (non-existent wall-clock time) -> error
 * - Fall-back DST folds (ambiguous wall-clock time occurring twice) -> returns both candidates or picks earlier/later
 */
export function resolveLocalDateTimeInZone(
  value: string,
  zone: string,
  disambiguation: DstDisambiguation = 'reject'
): LocalDateTimeResolution {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) {
    return { ok: false, errorCode: 'INVALID_FORMAT' };
  }
  if (!isValidIanaTimeZone(zone)) {
    return { ok: false, errorCode: 'INVALID_TIMEZONE' };
  }

  const target = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
  const targetMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);

  // Probe around +/- 26 hours in 30-min / 15-min steps, then refine exact offset matches.
  // DST offsets can shift by 30 or 60 minutes (e.g. Australia/Lord_Howe is 30 min).
  const candidateInstants = new Set<number>();
  for (let offsetMin = -16 * 60; offsetMin <= 16 * 60; offsetMin += 15) {
    const probeMs = targetMs - offsetMin * 60_000;
    const seen = partsInZone(probeMs, zone);
    if (
      seen.year === target.year &&
      seen.month === target.month &&
      seen.day === target.day &&
      seen.hour === target.hour &&
      seen.minute === target.minute
    ) {
      candidateInstants.add(probeMs);
    }
  }

  const sorted = [...candidateInstants].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { ok: false, errorCode: 'NON_EXISTENT_LOCAL_TIME' };
  }

  if (sorted.length > 1) {
    const candidates = sorted.map((ms) => ({
      utcIso: new Date(ms).toISOString(),
      offsetLabel: timeZoneOffsetLabel(zone, new Date(ms)),
    }));
    if (disambiguation === 'earlier') {
      return { ok: true, utcIso: candidates[0].utcIso, ambiguous: true, candidates };
    }
    if (disambiguation === 'later') {
      return { ok: true, utcIso: candidates[candidates.length - 1].utcIso, ambiguous: true, candidates };
    }
    return {
      ok: false,
      ambiguous: true,
      candidates,
      errorCode: 'AMBIGUOUS_LOCAL_TIME',
    };
  }

  return { ok: true, utcIso: new Date(sorted[0]).toISOString(), ambiguous: false };
}

export function dateInTimeZone(isoUtc: string, zone: string): string {
  try {
    const d = new Date(isoUtc);
    if (!Number.isFinite(d.getTime())) return String(isoUtc).slice(0, 10);
    const p = partsInZone(d.getTime(), zone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  } catch {
    return String(isoUtc).slice(0, 10);
  }
}

export function utcToLocalDateTimeInput(isoUtc: string | null | undefined, zone: string): string {
  if (!isoUtc) return '';
  try {
    const d = new Date(isoUtc);
    if (!Number.isFinite(d.getTime())) return '';
    const p = partsInZone(d.getTime(), zone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function formatDateTimeInZone(
  isoUtc: string | null | undefined,
  zone: string,
  locale: 'en' | 'ko' = 'en'
): string {
  if (!isoUtc) return '—';
  try {
    const d = new Date(isoUtc);
    if (!Number.isFinite(d.getTime())) return String(isoUtc);
    return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return String(isoUtc);
  }
}
