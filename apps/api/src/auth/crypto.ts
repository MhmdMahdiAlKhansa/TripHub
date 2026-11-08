import { createHash, randomBytes } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/** OWASP-aligned argon2id parameters (19 MiB, t=2, p=1). */
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** URL-safe random token (256 bits). Only its hash is persisted. */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';

function encryptionKey(): Buffer {
  const material = process.env.MFA_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!material || material.length < 32) throw new Error('MFA_ENCRYPTION_KEY (or SESSION_SECRET) must be >= 32 chars');
  if (process.env.NODE_ENV === 'production' && !process.env.MFA_ENCRYPTION_KEY) {
    throw new Error('MFA_ENCRYPTION_KEY is required in production');
  }
  return Buffer.from(hkdfSync('sha256', material, 'triphub', 'mfa-secret-v1', 32));
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, 'base64');
  const d = createDecipheriv('aes-256-gcm', encryptionKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/** 80-bit recovery code, formatted xxxxx-xxxxx-xxxxx-xxxxx. */
export function newRecoveryCode(): string {
  return randomBytes(10).toString('hex').match(/.{5}/g)!.join('-');
}
