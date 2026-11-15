
import { randomUUID } from 'node:crypto';
import {
  db,
  json,
  isAdmin,
  requireEnv,
  errorMessage
} from '../lib/server.js';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      error: 'Metode harus POST.'
    });
  }

  if (!requireEnv()) {
    return json(res, 500, {
      error: 'Server belum dikonfigurasi.'
    });
  }

  if (!isAdmin(req)) {
    return json(res, 403, {
      error: 'Akses admin diperlukan.'
    });
  }

  try {
    const { image, sku, id } = req.body || {};

    if (!image || typeof image !== 'string') {
      return json(res, 400, {
        error: 'Foto belum dipilih.'
      });
    }

    if (!id && !sku) {
      return json(res, 400, {
        error: 'ID atau SKU produk wajib diisi.'
      });
    }

    // MEMBACA FORMAT FOTO
    const match = image.match(
      /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/
    );

    if (!match) {
      return json(res, 400, {
        error: 'Format foto tidak didukung.'
      });
    }

    const ext = match[1] === 'jpeg'
      ? 'jpg'
      : match[1];

    const mime = ext === 'jpg'
      ? 'image/jpeg'
      : `image/${ext}`;

    const buffer = Buffer.from(match[2], 'base64');

    // BATAS UKURAN FOTO 5 MB
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return json(res, 400, {
        error: 'Ukuran foto maksimal 5 MB.'
      });
    }

    // NAMA FILE AMAN
    const safeSku = String(sku || 'product')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);

    const filename =
      `${safeSku}-${randomUUID()}.${ext}`;

    // UPLOAD KE SUPABASE STORAGE
    const { error: uploadError } = await supabase
      .storage
      .from('product-photos')
      .upload(filename, buffer, {
        contentType: mime,
        upsert: false,
        cacheControl: '3600'
      });

    if (uploadError) {
      throw uploadError;
    }

    // AMBIL URL FOTO
    const { data: publicData } = supabase
      .storage
      .from('product-photos')
      .getPublicUrl(filename);

    const imageUrl = publicData.publicUrl;

    if (!imageUrl) {
      throw new Error('URL foto gagal dibuat.');
    }

    // SIMPAN URL FOTO KE TABEL PRODUCTS
    let updateQuery = db
      .from('products')
      .update({
        image_url: imageUrl
      });

    if (id) {
      updateQuery = updateQuery.eq('id', id);
    } else {
      updateQuery = updateQuery.eq('sku', String(sku).trim());
    }

    const { data: product, error: updateError } =
      await updateQuery
        .select('id, sku, image_url')
        .single();

    if (updateError) {
      throw updateError;
    }

    // BERHASIL
    return json(res, 200, {
      success: true,
      message: 'Foto berhasil diunggah dan disimpan.',
      url: imageUrl,
      image_url: imageUrl,
      product
    });

  } catch (error) {
    console.error('UPLOAD FOTO ERROR:', error);

    return json(res, 500, {
      success: false,
      error: errorMessage(error)
    });
  }
}
