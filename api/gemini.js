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
      identify: `Identifikasi produk pada foto secara visual (jenis barang, warna dominan, bentuk/model, ciri fisik, perkiraan merek jika terlihat).
Keluarkan JSON: {"name":"","brand":"","color":"","shape":"","category":"","description":"","keywords":[]}.
Jangan mengarang merek jika tidak terlihat.`,

      describe: `Buat deskripsi singkat produk dan kategori.
Nama produk: ${name || ''}.
JSON: {"description":"","category":"","synonyms":[]}.`,

      search: `Ubah kalimat pengguna menjadi kata kunci pencarian barang gudang.
Kalimat: ${query || ''}.
JSON: {"keywords":[],"category":null}.`,

      verify: `Kamu adalah pencari barang gudang. Tugasmu HANYA mencocokkan FOTO dengan DAFTAR PRODUK.

FOTO: Lihat foto ini, tentukan 1 jenis barangnya saja. Contoh: "botol minum", "vacuum cleaner", "ball pen".

DAFTAR PRODUK (candidates):
Kandidat: ${JSON.stringify(candidates || [])}.

ATURAN WAJIB:
1. JANGAN peduli warna, motif, ukuran, dan bahan dulu. Yang penting JENIS BARANGNYA SAMA.
2. SINONIM itu SAMA. botol = tumbler = flask = termos = botol minum. vacuum = vacuum cleaner = penyedot debu. ball pen = pulpen = pena.
3. Jika jenis barangnya beda, similarity = 0. JANGAN dipaksakan.
4. Jika jenis barangnya sama, similarity = 90-100, walaupun warna / motif beda.
5. Balas HANYA JSON valid, tanpa penjelasan lain.

Format balasan:
{"jenis_barang": "botol minum", "matches": [{"sku": "...", "similarity": 95}]}
Jika TIDAK ADA yang jenisnya sama, balas: {"jenis_barang": "...", "matches": []}
`,
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

       const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

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
          temperature: 0.2
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
