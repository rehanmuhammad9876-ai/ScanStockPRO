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

export function adminToken() {
  return crypto.createHmac(
    'sha256',
    process.env.SESSION_SECRET
  ).update('scanstocks-admin-v1').digest('hex');
}

export function isAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !process.env.SESSION_SECRET) return false;

  const expected = Buffer.from(adminToken());
  const actual = Buffer.from(token);

  return actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected);
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
