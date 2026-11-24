
import { randomUUID } from 'node:crypto';

import {
  db,
  json,
  isAdmin,
  requireEnv,
  errorMessage
} from '../lib/server.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      success: false,
      error: 'Metode harus POST.'
    });
  }

  if (!requireEnv()) {
    return json(res, 500, {
      success: false,
      error: 'Server belum dikonfigurasi.'
    });
  }

  if (!(await isAdmin(req))) {
    return json(res, 401, {
      success: false,
      error: 'Akses admin diperlukan.'
    });
  }

  try {
    const { image, sku, id } = req.body || {};

    if (!image || typeof image !== 'string') {
      return json(res, 400, {
        success: false,
        error: 'Foto belum dipilih.'
      });
    }

    if (!id && !sku) {
      return json(res, 400, {
        success: false,
        error: 'ID atau SKU produk wajib diisi.'
      });
    }

    const match = image.match(
      /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/
    );

    if (!match) {
      return json(res, 400, {
        success: false,
        error: 'Format foto tidak didukung.'
      });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];

    const mime = ext === 'jpg'
      ? 'image/jpeg'
      : `image/${ext}`;

    const buffer = Buffer.from(match[2], 'base64');

    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return json(res, 400, {
        success: false,
        error: 'Ukuran foto maksimal 5 MB.'
      });
    }

    const safeSku = String(sku || 'product')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);

    const filename =
      `${safeSku}-${randomUUID()}.${ext}`;

    const { error: uploadError } = await db
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

    const { data: publicData } = db
      .storage
      .from('product-photos')
      .getPublicUrl(filename);

    const imageUrl = publicData?.publicUrl;

    if (!imageUrl) {
      throw new Error('URL foto gagal dibuat.');
    }

    // URL dikembalikan ke JavaScript.
    // Penyimpanan daftar foto dilakukan melalui API products.
    return json(res, 200, {
      success: true,
      message: 'Foto berhasil diunggah.',
      url: imageUrl,
      image_url: imageUrl
    });

  } catch (error) {
    console.error('UPLOAD FOTO ERROR:', error);

    return json(res, 500, {
      success: false,
      error: errorMessage(error)
    });
  }
}
