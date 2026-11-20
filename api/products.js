
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
    token: await adminToken()
  });
}
    // GANTI PIN ADMIN
if (req.method === 'POST' && action === 'change-pin') {
  if (!(await isAdmin(req))) {
    return json(res, 403, {
      error: 'Akses admin diperlukan.'
    });
  }

  const { oldPin, newPin, confirmPin } = body;

  if (
    typeof oldPin !== 'string' ||
    typeof newPin !== 'string' ||
    typeof confirmPin !== 'string' ||
    !oldPin ||
    !newPin ||
    !confirmPin
  ) {
    return json(res, 400, {
      error: 'Semua kolom PIN wajib diisi.'
    });
  }

  if (newPin !== confirmPin) {
    return json(res, 400, {
      error: 'PIN baru dan konfirmasi tidak sama.'
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

  if (!security || !security.pin_hash) {
    return json(res, 500, {
      error: 'Data keamanan PIN admin tidak ditemukan.'
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
    message: 'PIN admin berhasil diganti.'
  });
}
    // ==================================
// UPDATE GALERI FOTO PRODUK
// ==================================

if (req.method === 'POST' && action === 'update-photos') {
if (!(await isAdmin(req))) {
    return json(res, 401, {
      error: 'Akses admin diperlukan.'
    });
  }

  const { id, image_url } = body;

  if (!id) {
    return json(res, 400, {
      error: 'ID produk tidak ditemukan.'
    });
  }

  if (
    typeof image_url !== 'string' ||
    image_url.length > 5000
  ) {
    return json(res, 400, {
      error: 'Data URL foto tidak valid atau terlalu panjang.'
    });
  }

  const { data, error } = await db
    .from('products')
    .update({
      image_url: image_url
    })
    .eq('id', id)
    .select('id, sku, image_url')
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return json(res, 404, {
      error: 'Produk tidak ditemukan.'
    });
  }

  return json(res, 200, {
    success: true,
    product: data
  });
}
    // TAMBAH / UPDATE PRODUK — VALIDASI INPUT
if (req.method === 'POST' && action === 'upsert') {
    if (!(await isAdmin(req))) {
    return json(res, 401, {
      error: 'Akses admin diperlukan.'
    });
  }
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

  const clean = [];

  for (const p of rows) {
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p)
    ) {
      return json(res, 400, {
        error: 'Format data produk tidak valid.'
      });
    }

    const out = {};

    // Ambil hanya field yang diizinkan
    for (const field of fields) {
      if (p[field] !== undefined) {
        out[field] = p[field];
      }
    }

    // Validasi SKU dan nama
    if (
      typeof out.sku !== 'string' &&
      typeof out.sku !== 'number'
    ) {
      return json(res, 400, {
        error: 'SKU tidak valid.'
      });
    }

    if (
      typeof out.name !== 'string' ||
      !out.name.trim()
    ) {
      return json(res, 400, {
        error: 'Nama barang wajib diisi.'
      });
    }

    out.sku = String(out.sku).trim();
    out.name = out.name.trim();

    if (!out.sku || out.sku.length > 100) {
      return json(res, 400, {
        error: 'SKU kosong atau terlalu panjang.'
      });
    }

    if (out.name.length > 300) {
      return json(res, 400, {
        error: 'Nama barang terlalu panjang.'
      });
    }

    // Validasi field teks
    const textLimits = {
      barcode: 100,
      category: 150,
      location: 150,
      image_url: 5000,
      description: 5000
    };

    for (const [field, max] of Object.entries(textLimits)) {
      if (out[field] === undefined || out[field] === null) {
        continue;
      }

      if (
        typeof out[field] !== 'string' &&
        typeof out[field] !== 'number'
      ) {
        return json(res, 400, {
          error: `Format ${field} tidak valid.`
        });
      }

      out[field] = String(out[field]).trim();

      if (out[field].length > max) {
        return json(res, 400, {
          error: `${field} terlalu panjang.`
        });
      }
    }

    // Validasi harga
    const price = out.price === '' ? 0 : (out.price ?? 0);

    if (
      price === '' ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0 ||
      Number(price) > 1000000000000
    ) {
      return json(res, 400, {
        error: 'Harga produk tidak valid.'
      });
    }

    out.price = Number(price);

    // Validasi stok
    const stock = out.stock === '' ? 0 : (out.stock ?? 0);

    if (
      stock === '' ||
      !Number.isFinite(Number(stock)) ||
      !Number.isInteger(Number(stock)) ||
      Number(stock) < 0 ||
      Number(stock) > 1000000000
    ) {
      return json(res, 400, {
        error: 'Jumlah stok tidak valid.'
      });
    }

    out.stock = Number(stock);

    // Validasi sinonim pencarian
    if (out.synonyms !== undefined && out.synonyms !== null) {
      if (Array.isArray(out.synonyms)) {
        if (
          out.synonyms.length > 50 ||
          out.synonyms.some(
            s => typeof s !== 'string' || s.length > 100
          )
        ) {
          return json(res, 400, {
            error: 'Sinonim produk tidak valid.'
          });
        }
      } else if (
        typeof out.synonyms !== 'string' ||
        out.synonyms.length > 2000
      ) {
        return json(res, 400, {
          error: 'Sinonim produk tidak valid.'
        });
      }
    }

    clean.push(out);
  }

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
      if (!(await isAdmin(req))) {
  return json(res, 401, {
    error: 'Akses admin diperlukan.'
  });
}
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
  if (!(await isAdmin(req))) {
    return json(res, 401, {
      error: 'Akses admin diperlukan.'
    });
  }

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
        // GET: membaca daftar barang
    if (req.method === 'GET') {
      const q = String(req.query.q || '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .slice(0, 80);

      const category = String(req.query.category || '').trim();
      const location = String(req.query.location || '').trim();
      const stockFilter = String(req.query.stock || '').trim();

      const pageNum = Number(req.query.page);
      const page = Number.isInteger(pageNum) && pageNum >= 0
        ? Math.min(pageNum, 100000)
        : 0;

      const limitNum = Number(req.query.limit);
      const limit = Number.isInteger(limitNum) && limitNum > 0
        ? Math.min(limitNum, 200)
        : 30;

      let query = db
        .from('products')
        .select('*')
        .order('name')
        .range(page * limit, (page * limit) + limit - 1);

      if (q) {
        query = query.or(
          `name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%,description.ilike.%${q}%`
        );
      }

      if (category) {
        query = query.eq('category', category);
      }

      if (location) {
        query = query.eq('location', location);
      }

      if (stockFilter === 'empty') {
        query = query.eq('stock', 0);
      } else if (stockFilter === 'low') {
        query = query.gte('stock', 1).lte('stock', 4);
      } else if (stockFilter === 'safe') {
        query = query.gte('stock', 5);
      }

      const { data, error } = await query;

      if (error) {
        console.error('PRODUCTS GET ERROR:', error);
        return json(res, 500, {
          error: 'Gagal mengambil data barang.'
        });
      }

      return json(res, 200, {
        products: data || []
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
