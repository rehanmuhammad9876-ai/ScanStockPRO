
import {
  timingSafeEqual,
  createHmac
} from 'node:crypto';
import {
  db, json, isAdmin, adminToken,
  requireEnv, errorMessage,
  createPinHash, verifyPinHash
} from '../lib/server.js';
const fields = [
  'sku', 'barcode', 'name', 'category',
  'price', 'stock', 'location',
  'image_url', 'description', 'synonyms'
];
function getLoginIpHash(req) {
  const ip = req.headers['x-real-ip'];

  if (typeof ip !== 'string' || !ip.trim()) {
    return null;
  }

  return createHmac(
    'sha256',
    process.env.SESSION_SECRET
  )
    .update(ip.trim())
    .digest('hex');
}
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
   // LOGIN ADMIN + MIGRASI PIN + PROTEKSI BRUTE-FORCE
if (req.method === 'POST' && action === 'login') {
  const ipHash = getLoginIpHash(req);

  if (!ipHash) {
    return json(res, 503, {
      error: 'Identitas koneksi tidak tersedia. Coba kembali.'
    });
  }

  // Cek apakah IP sedang diblokir
  const { data: blocked, error: blockError } = await db
    .rpc('admin_login_is_blocked', {
      p_ip_hash: ipHash
    });

  if (blockError) throw blockError;

  if (blocked === true) {
    return json(res, 429, {
      error: 'Terlalu banyak percobaan PIN salah. Coba lagi 15 menit kemudian.'
    });
  }

  const pin = String(body.pin || '');
  const adminPin = String(process.env.ADMIN_PIN || '');

  let valid = false;

  // Baca hash PIN dari database
  const { data: security, error: readError } = await db
    .from('admin_security')
    .select('pin_hash')
    .eq('id', 1)
    .maybeSingle();

  if (readError) throw readError;

  // Verifikasi hash yang sudah tersimpan
  if (security?.pin_hash) {
    if (pin && pin.length <= 100) {
      valid = await verifyPinHash(
        pin,
        security.pin_hash
      );
    }
  } else {
    // Migrasi pertama dari ADMIN_PIN Vercel
    if (pin && pin.length <= 100 && adminPin) {
      const a = Buffer.from(pin);
      const b = Buffer.from(adminPin);

      const legacyValid =
        a.length === b.length &&
        timingSafeEqual(a, b);

      if (legacyValid) {
        const pinHash = await createPinHash(pin);

        const { error: insertError } = await db
          .from('admin_security')
          .insert({
            id: 1,
            pin_hash: pinHash
          });

        if (!insertError) {
          valid = true;
        } else {
          // Antisipasi login bersamaan
          const { data: latest, error: latestError } =
            await db
              .from('admin_security')
              .select('pin_hash')
              .eq('id', 1)
              .maybeSingle();

          if (latestError) throw latestError;

          if (latest?.pin_hash) {
            valid = await verifyPinHash(
              pin,
              latest.pin_hash
            );
          } else {
            throw insertError;
          }
        }
      }
    }
  }

  // Jika PIN salah, catat percobaan
  if (!valid) {
    const { data: failureData, error: failureError } =
      await db.rpc('record_admin_login_failure', {
        p_ip_hash: ipHash
      });

    if (failureError) throw failureError;

    const failure = Array.isArray(failureData)
      ? failureData[0]
      : failureData;

    if (failure?.blocked_until) {
      return json(res, 429, {
        error: '5 kali PIN salah. Login diblokir sementara selama 15 menit.'
      });
    }

    return json(res, 401, {
      error: 'PIN admin salah.'
    });
  }

  // PIN benar: hapus penghitung kesalahan
  const { error: resetError } = await db.rpc(
    'reset_admin_login_attempts',
    {
      p_ip_hash: ipHash
    }
  );

  if (resetError) throw resetError;

  return json(res, 200, {
    token: adminToken()
  });
}
    // GANTI PIN ADMIN — UPDATE LANGSUNG KE DATABASE
    if (req.method === 'POST' && action === 'change_pin') {
      if (!isAdmin(req)) {
        return json(res, 403, {
          error: 'Akses admin diperlukan.'
        });
      }

      const oldPin = String(body.oldPin || '');
      const newPin = String(body.newPin || '');
      const confirmPin = String(body.confirmPin || '');

      if (!/^\d{6,12}$/.test(newPin)) {
        return json(res, 400, {
          error: 'PIN baru harus 6–12 digit angka.'
        });
      }

      if (newPin !== confirmPin) {
        return json(res, 400, {
          error: 'Konfirmasi PIN baru tidak cocok.'
        });
      }

      if (oldPin === newPin) {
        return json(res, 400, {
          error: 'PIN baru harus berbeda dari PIN lama.'
        });
      }

      const { data: security, error: readError } = await db
        .from('admin_security')
        .select('pin_hash')
        .eq('id', 1)
        .maybeSingle();

      if (readError) throw readError;

      if (!security?.pin_hash) {
        return json(res, 400, {
          error: 'Data keamanan PIN belum tersedia.'
        });
      }

      const validOldPin = await verifyPinHash(
        oldPin,
        security.pin_hash
      );

      if (!validOldPin) {
        return json(res, 401, {
          error: 'PIN lama salah.'
        });
      }

      const newHash = await createPinHash(newPin);

      const { error: updateError } = await db
        .from('admin_security')
        .update({
          pin_hash: newHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);

      if (updateError) throw updateError;

      return json(res, 200, {
        success: true,
        message: 'PIN Admin berhasil diubah.'
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
