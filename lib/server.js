import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

// TOKEN ADMIN DENGAN MASA BERLAKU 8 JAM
export async function adminToken() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET belum tersedia.');

  const { data, error } = await db
    .from('admin_security')
    .select('pin_hash')
    .eq('id', 1)
    .single();

  if (error || !data?.pin_hash) {
    throw new Error('Hash PIN admin tidak ditemukan.');
  }

  const pinFingerprint = crypto
    .createHash('sha256')
    .update(data.pin_hash)
    .digest('hex');

  const payload = Buffer.from(JSON.stringify({
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
    pinFingerprint
  })).toString('base64url');

  const signature = crypto.createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

export async function isAdmin(req) {
  const secret = process.env.SESSION_SECRET;
  const header = req.headers.authorization || '';

  if (!secret || !header.startsWith('Bearer ')) return false;

  const token = header.slice(7).trim();

  if (!token || token.length > 1000) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    const now = Date.now();
    const issuedAt = Number(data.iat);
    const maxAge = 8 * 60 * 60 * 1000;

    if (!Number.isFinite(issuedAt)) return false;
    if (issuedAt > now + 60 * 1000) return false;
    if (now - issuedAt > maxAge) return false;
    if (typeof data.pinFingerprint !== 'string') return false;

    const { data: security, error } = await db
      .from('admin_security')
      .select('pin_hash')
      .eq('id', 1)
      .single();

    if (error || !security?.pin_hash) return false;

    const currentFingerprint = crypto
      .createHash('sha256')
      .update(security.pin_hash)
      .digest('hex');

    const oldFingerprint = Buffer.from(data.pinFingerprint);
    const newFingerprint = Buffer.from(currentFingerprint);

    if (
      oldFingerprint.length !== newFingerprint.length ||
      !crypto.timingSafeEqual(oldFingerprint, newFingerprint)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function createPinHash(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(String(pin), salt, 64);

  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPinHash(pin, storedHash) {
  try {
    const parts = String(storedHash).split('$');

    if (
      parts.length !== 3 ||
      parts[0] !== 'scrypt' ||
      !/^[a-f0-9]{32}$/i.test(parts[1]) ||
      !/^[a-f0-9]{128}$/i.test(parts[2])
    ) {
      return false;
    }

    const salt = parts[1];
    const expected = Buffer.from(parts[2], 'hex');
    const actual = await scrypt(String(pin), salt, 64);

    return actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function requireEnv() {
  const keys = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SESSION_SECRET',
    'ADMIN_PIN'
  ];

  return keys.every(k => Boolean(process.env[k]));
}

export function errorMessage(error) {
  console.error(error);
  return 'Terjadi kendala saat memproses data. Silakan coba kembali.';
}
