export const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

/**
 * Decides the real file type from its first bytes. The client-declared Content-Type and file name
 * are never trusted: they only have to agree with what the bytes say.
 */
export function sniffType(b: Buffer): AllowedType | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** A display-safe file name: no paths, no control characters, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').slice(0, 100).trim();
  return cleaned || 'file';
}
