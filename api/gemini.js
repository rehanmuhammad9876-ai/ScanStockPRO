
const MODEL = 'gemini-3.5-flash-lite';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Metode tidak didukung.'
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: 'Layanan AI belum dikonfigurasi.'
    });
  }

  try {
    const {
      action, image, mimeType, name, query, candidates
    } = req.body || {};

    const prompts = {
      identify: `Identifikasi produk pada foto.
Keluarkan JSON: {"name":"","brand":"","color":"",
"category":"","description":"","keywords":[]}.
Jangan mengarang merek jika tidak terlihat.`,

      describe: `Buat deskripsi singkat produk dan kategori.
Nama produk: ${name || ''}.
JSON: {"description":"","category":"","synonyms":[]}.`,

      search: `Ubah kalimat pengguna menjadi kata kunci pencarian barang gudang.
Kalimat: ${query || ''}.
JSON: {"keywords":[],"category":null}.`,

      verify: `Bandingkan foto barang dengan kandidat database.
Kandidat: ${JSON.stringify(candidates || [])}.
JSON: {"matches":[{"sku":"","similarity":0,"reason":""}]}.
Jangan menyatakan cocok jika bukti visual tidak cukup.`
    };

    if (!prompts[action]) {
      return res.status(400).json({
        error: 'Jenis permintaan AI tidak dikenal.'
      });
    }

    const parts = [{ text: prompts[action] }];

    if (image) {
      if (!/^image\/(jpeg|png|webp)$/.test(mimeType || '')) {
        return res.status(400).json({
          error: 'Format foto harus JPG, PNG, atau WebP.'
        });
      }

      if (image.length > 7_000_000) {
        return res.status(413).json({
          error: 'Ukuran foto terlalu besar.'
        });
      }

      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: image.replace(/^data:image\/\w+;base64,/, '')
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      }
    );

    if (!response.ok) {
      console.error('Gemini request failed:', response.status);
      throw new Error('AI_UNAVAILABLE');
    }

    const result = await response.json();
    const output = result.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '').join('');

    if (!output) throw new Error('EMPTY_RESPONSE');

    return res.status(200).json({
      result: JSON.parse(output)
    });

  } catch (error) {
    console.error('AI error:', error.message);

    return res.status(502).json({
      error: 'AI belum dapat memproses permintaan. Silakan coba lagi.'
    });
  }
}
