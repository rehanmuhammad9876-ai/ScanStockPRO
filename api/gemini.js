const MODEL = 'gemini-3.5-flash-lite';

function parseJsonSafe(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

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
      identify: `Sebutkan HANYA 1 jenis barang utama pada foto dan maksimal 5 kata kunci penting (tanpa warna, motif, bentuk, atau kalimat panjang).
Keluarkan JSON valid: {"name":"jenis barang singkat","category":"kategori singkat","keywords":["kata1","kata2"]}.`,

      describe: `Buat deskripsi sangat singkat dan kategori untuk barang gudang.
Nama produk: ${name || ''}.
JSON valid: {"description":"","category":"","synonyms":[]}.`,

      search: `Ubah kalimat pengguna menjadi maksimal 5 kata kunci pencarian barang gudang.
Kalimat: ${query || ''}.
JSON valid: {"keywords":[],"category":null}.`,

      verify: `Kamu adalah pencari barang gudang. Tugasmu HANYA mencocokkan FOTO dengan DAFTAR PRODUK.

DAFTAR PRODUK (candidates):
${JSON.stringify(candidates || [])}

ATURAN WAJIB:
1. Fokus HANYA pada kesamaan JENIS BARANG. Warna, motif, ukuran, bahan, dan kapasitas boleh beda.
2. SINONIM dianggap SAMA:
   - botol = botol minum = tumbler = flask = termos = bottle = water bottle
   - vacuum = vacuum cleaner = penyedot debu
   - pulpen = ball pen = ballpoint = pena = bolpoin
   - pensil = pencil; spidol = marker; penggaris = ruler = mistar; penghapus = eraser
3. Jika jenis barang di FOTO BEDA dengan kandidat, similarity = 0 (jangan masukkan ke matches).
4. Jika jenis barang di FOTO SAMA dengan kandidat (meski warna/motif beda), beri similarity 90-100.
5. Balas HANYA JSON valid, tanpa markdown dan tanpa penjelasan lain.

Format balasan:
{"jenis_barang":"botol minum","matches":[{"sku":"...","similarity":95}]}
Jika tidak ada yang jenisnya sama, balas:
{"jenis_barang":"...","matches":[]}`
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
        inlineData: {
          mimeType,
          data: image.replace(/^data:image\/\w+;base64,/, '')
        }
      });
    }

    const endpoint = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){encodeURIComponent(MODEL)}:generateContent`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('Gemini request failed:', response.status, errBody);
      throw new Error('AI_UNAVAILABLE');
    }

    const result = await response.json();
    const output = result.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '').join('');

    if (!output) throw new Error('EMPTY_RESPONSE');

    const parsed = parseJsonSafe(output);
    return res.status(200).json({
      result: parsed
    });

  } catch (error) {
    console.error('AI error:', error.message);

    return res.status(502).json({
      error: 'AI belum dapat memproses permintaan. Silakan coba lagi.'
    });
  }
}
