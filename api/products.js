import { timingSafeEqual } from 'node:crypto';
import {
  db, json, isAdmin, adminToken,
  requireEnv, errorMessage
} from '../lib/server.js';

const fields = [
  'sku', 'barcode', 'name', 'category',
  'price', 'stock', 'location',
  'image_url', 'description', 'synonyms'
];

export default async function handler(req, res) {
  if (!requireEnv()) {
    return json(res, 500, { error: 'Server belum dikonfigurasi.' });
  }

  try {
    const { action } = req.method === 'GET'
      ? req.query : req.body || {};

    if (req.method === 'POST' && action === 'login') {
      const pin = String(req.body.pin || '');

      const a = Buffer.from(pin);
      const b = Buffer.from(process.env.ADMIN_PIN);

      const valid = a.length === b.length &&
        cryptoSafeEqual(a, b);

      if (!valid) {
        return json(res, 401, { error: 'PIN admin salah.' });
      }

      return json(res, 200, { token: adminToken() });
    }

    if (req.method === 'GET') {
      const {
        q = '', category, location, stock,
        page = 0, limit = 30
      } = req.query;

      const { data, error } = await db.rpc('search_products', {
        search_term: String(q).slice(0, 150),
        category_filter: category || null,
        location_filter: location || null,
        stock_filter: stock || null,
        page_size: Math.min(Number(limit) || 30, 100),
        page_offset: Math.max(Number(page) || 0, 0) * 30
      });

      if (error) throw error;

      return json(res, 200, { products: data || [] });
    }

    if (!isAdmin(req)) {
      return json(res, 403, {
        error: 'Akses admin diperlukan.'
      });
    }

    if (req.method === 'POST' && action === 'upsert') {
      const rows = Array.isArray(req.body.products)
        ? req.body.products : [req.body.product];

      if (!rows.length || rows.length > 500) {
        return json(res, 400, { error: 'Jumlah data tidak valid.' });
      }

      const clean = rows.map(p => {
        const out = {};
        for (const field of fields) {
          if (p[field] !== undefined) out[field] = p[field];
        }

        if (!out.sku || !out.name) {
          throw new Error('SKU dan nama barang wajib diisi.');
        }

        out.sku = String(out.sku).trim();
        out.name = String(out.name).trim();
        out.price = Math.max(0, Number(out.price) || 0);
        out.stock = Math.max(0, Math.floor(Number(out.stock) || 0));

        return out;
      });

      const { data, error } = await db
        .from('products')
        .upsert(clean, { onConflict: 'sku' })
        .select();

      if (error) throw error;

      return json(res, 200, { products: data });
    }

    if (req.method === 'PATCH' && action === 'stock') {
      const { id, change, reason, actor } = req.body;

      if (!Number.isInteger(change) || !change || Math.abs(change) > 100000) {
        return json(res, 400, { error: 'Perubahan stok tidak valid.' });
      }

      // RPC atomik agar dua karyawan tidak saling menimpa stok.
      const { data, error } = await db.rpc('change_product_stock', {
        product_uuid: id,
        stock_delta: change,
        log_reason: String(reason || 'Penyesuaian stok').slice(0, 200),
        log_actor: String(actor || 'Admin').slice(0, 80)
      });

      if (error) throw error;

      return json(res, 200, { product: data });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) return json(res, 400, { error: 'ID tidak ditemukan.' });

      const { error } = await db.from('products')
        .delete().eq('id', id);

      if (error) throw error;

      return json(res, 200, { success: true });
    }

    return json(res, 405, { error: 'Metode tidak didukung.' });

  } catch (error) {
    return json(res, 400, { error: errorMessage(error) });
  }
}

function cryptoSafeEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}
