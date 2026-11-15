
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
    return json(res, 500, {
      error: 'Server belum dikonfigurasi.'
    });
  }

  try {
    const body = req.body || {};

    const { action } = req.method === 'GET'
      ? req.query
      : body;

    // LOGIN ADMIN
    if (req.method === 'POST' && action === 'login') {
      const pin = String(body.pin || '');
      const adminPin = String(process.env.ADMIN_PIN || '');

      const a = Buffer.from(pin);
      const b = Buffer.from(adminPin);

      const valid = a.length === b.length &&
        a.length > 0 &&
        timingSafeEqual(a, b);

      if (!valid) {
        return json(res, 401, {
          error: 'PIN admin salah.'
        });
      }

      return json(res, 200, {
        token: adminToken()
      });
    }

    // PENCARIAN PRODUK
    if (req.method === 'GET') {
      const {
        q = '',
        category,
        location,
        stock,
        page = 0,
        limit = 30
      } = req.query;

      const pageSize = Math.min(
        Math.max(Number(limit) || 30, 1),
        100
      );

      const { data, error } = await db.rpc(
        'search_products',
        {
          search_term: String(q).slice(0, 150),
          category_filter: category || null,
          location_filter: location || null,
          stock_filter: stock || null,
          page_size: pageSize,
          page_offset:
            Math.max(Number(page) || 0, 0) * pageSize
        }
      );

      if (error) throw error;

      return json(res, 200, {
        products: data || []
      });
    }

    // SEMUA FITUR SELAIN LOGIN DAN PENCARIAN
    // MEMERLUKAN AKSES ADMIN
    if (!isAdmin(req)) {
      return json(res, 403, {
        error: 'Akses admin diperlukan.'
      });
    }

    // ==================================
    // UPDATE FOTO PRODUK
    // ==================================

    const hasImageData =
      body.id !== undefined &&
      body.image_url !== undefined;

    const isImageUpdate =
      hasImageData &&
      (
        req.method === 'PATCH' ||
        (
          req.method === 'POST' &&
          (
            action === 'update_image' ||
            (
              action !== 'upsert' &&
              !body.product &&
              !body.products
            )
          )
        )
      );

    if (isImageUpdate) {
      const id = String(body.id || '').trim();
      const imageUrl = String(body.image_url || '').trim();

      if (!id || !imageUrl) {
        return json(res, 400, {
          error: 'ID dan URL foto wajib diisi.'
        });
      }

      if (imageUrl.length > 5000) {
        return json(res, 400, {
          error: 'URL foto terlalu panjang.'
        });
      }

      const { data, error } = await db
        .from('products')
        .update({
          image_url: imageUrl
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return json(res, 200, {
        success: true,
        message: 'Foto produk berhasil disimpan.',
        product: data
      });
    }

    // ==================================
    // TAMBAH / UPDATE PRODUK
    // ==================================

    if (req.method === 'POST' && action === 'upsert') {
      const rows = Array.isArray(body.products)
        ? body.products
        : body.product
          ? [body.product]
          : [];

      if (!rows.length || rows.length > 500) {
        return json(res, 400, {
          error: 'Jumlah data tidak valid.'
        });
      }

      const clean = rows.map(p => {
        if (!p || typeof p !== 'object') {
          throw new Error('Data produk tidak valid.');
        }

        const out = {};

        for (const field of fields) {
          if (p[field] !== undefined) {
            out[field] = p[field];
          }
        }

        if (!out.sku || !out.name) {
          throw new Error(
            'SKU dan nama barang wajib diisi.'
          );
        }

        out.sku = String(out.sku).trim();
        out.name = String(out.name).trim();
        out.price = Math.max(
          0,
          Number(out.price) || 0
        );
        out.stock = Math.max(
          0,
          Math.floor(Number(out.stock) || 0)
        );

        return out;
      });

const { error } = await db
  .from('products')
  .upsert(clean, {
    onConflict: 'sku'
  });

if (error) throw error;

return json(res, 200, {
  success: true,
  imported: clean.length
});

    }

    // ==================================
    // PERUBAHAN STOK
    // ==================================

    if (req.method === 'PATCH' && action === 'stock') {
      const {
        id,
        change,
        reason,
        actor
      } = body;

      if (
        !Number.isInteger(change) ||
        !change ||
        Math.abs(change) > 100000
      ) {
        return json(res, 400, {
          error: 'Perubahan stok tidak valid.'
        });
      }

      const { data, error } = await db.rpc(
        'change_product_stock',
        {
          product_uuid: id,
          stock_delta: change,
          log_reason: String(
            reason || 'Penyesuaian stok'
          ).slice(0, 200),
          log_actor: String(
            actor || 'Admin'
          ).slice(0, 80)
        }
      );

      if (error) throw error;

      return json(res, 200, {
        product: data
      });
    }

    // ==================================
    // HAPUS PRODUK
    // ==================================

    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return json(res, 400, {
          error: 'ID tidak ditemukan.'
        });
      }

      const { error } = await db
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return json(res, 200, {
        success: true
      });
    }

    return json(res, 405, {
      error: 'Metode tidak didukung.'
    });

  } catch (error) {
    console.error('PRODUCTS API ERROR:', error);

    return json(res, 400, {
      error: errorMessage(error)
    });
  }
}
