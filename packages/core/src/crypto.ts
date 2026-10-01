import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url — used for invite, reset and refresh tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes (plan §9.1). */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
