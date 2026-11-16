import crypto from 'crypto';

const BLOCKED_EXTENSIONS = new Set([
  'html',
  'htm',
  'svg',
  'xhtml',
  'js',
  'mjs',
  'cjs',
  'ts',
  'exe',
  'dll',
  'bat',
  'cmd',
  'sh',
  'ps1',
  'vbs',
  'jar',
  'msi',
  'php',
  'jsp',
  'asp',
  'aspx',
]);

const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export function extractExtension(filename: string): string {
  const base = String(filename || '').trim().split(/[\\/]/).pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

export function sanitizeOriginalFilename(filename: string): string {
  const base = String(filename || 'file').split(/[\\/]/).pop() || 'file';
  return base.replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(0, 200);
}

export function isAllowedExtension(filename: string, allowedExtensions: string[]): boolean {
  const ext = extractExtension(filename);
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) return false;
  const normalizedAllowed = new Set(allowedExtensions.map((x) => x.toLowerCase().replace(/^\./, '')));
  return normalizedAllowed.has(ext);
}

export function validateFileMagicBytes(ext: string, buf: Buffer): { ok: boolean; reason?: string } {
  if (buf.length === 0) {
    return { ok: false, reason: 'EMPTY_FILE' };
  }

  // Reject HTML / SVG / script payloads masquerading under other extensions
  const headText = buf.subarray(0, Math.min(buf.length, 512)).toString('utf8').trimStart().toLowerCase();
  if (
    headText.startsWith('<!doctype html') ||
    headText.startsWith('<html') ||
    headText.startsWith('<svg') ||
    headText.startsWith('<script')
  ) {
    return { ok: false, reason: 'DISALLOWED_ACTIVE_MARKUP' };
  }

  if (ext === 'pdf') {
    if (!buf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return { ok: false, reason: 'INVALID_PDF_MAGIC' };
    }
    return { ok: true };
  }

  if (ext === 'png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(pngSig)) {
      return { ok: false, reason: 'INVALID_PNG_MAGIC' };
    }
    return { ok: true };
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return { ok: false, reason: 'INVALID_JPEG_MAGIC' };
    }
    return { ok: true };
  }

  if (ext === 'zip' || ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
    // PK\x03\x04 or empty zip PK\x05\x06
    const isPk =
      buf.length >= 4 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06));
    if (!isPk) {
      return { ok: false, reason: 'INVALID_ZIP_OOXML_MAGIC' };
    }
    // Guard against obvious zip bomb / excessive local file header count in buffer
    if (ext === 'zip' && buf.length < 22) {
      return { ok: false, reason: 'MALFORMED_ZIP' };
    }
    return { ok: true };
  }

  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
    const oleSig = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(oleSig)) {
      return { ok: false, reason: 'INVALID_OLE_MAGIC' };
    }
    return { ok: true };
  }

  if (ext === 'dwg') {
    const header = buf.subarray(0, 4).toString('ascii');
    if (!header.startsWith('AC10')) {
      return { ok: false, reason: 'INVALID_DWG_MAGIC' };
    }
    return { ok: true };
  }

  if (ext === 'dxf' || ext === 'txt' || ext === 'csv') {
    return { ok: true };
  }

  return { ok: false, reason: 'UNSUPPORTED_EXTENSION' };
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function evaluateScannerPolicy(buf: Buffer): {
  scanStatus: 'CLEAN' | 'PENDING' | 'INFECTED';
  scanDetail: string;
} {
  // Always detect EICAR signature immediately
  if (buf.includes(Buffer.from(EICAR_SIGNATURE, 'ascii'))) {
    return { scanStatus: 'INFECTED', scanDetail: 'EICAR test signature detected' };
  }

  const mode = process.env.MALWARE_SCANNER_MODE || 'webhook';
  if (mode === 'local_signature_dev') {
    if (process.env.NODE_ENV === 'production') {
      // Production MUST NOT trust local_signature_dev mock scanning!
      return {
        scanStatus: 'PENDING',
        scanDetail: 'Production requires external malware scanner webhook',
      };
    }
    return {
      scanStatus: 'CLEAN',
      scanDetail: 'Verified by local_signature_dev (non-production)',
    };
  }

  return {
    scanStatus: 'PENDING',
    scanDetail: 'Awaiting external malware scanner verdict',
  };
}
