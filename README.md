# SCANSTOCK Pro - Smart Warehouse Inventory

Sistem Manajemen Inventaris Gudang Cerdas dengan Pemindai Barcode, Manajemen Stok Real-time, dan Pencarian Berbasis AI Vision (Google Gemini).

---

## 🛠️ Fitur Utama

- **Pencarian Cerdas & Filter Multi-Kriteria**: Cari berdasarkan Nama, SKU, Barcode, Kategori, Lokasi Rak, atau Status Stok.
- **Scan Barcode Cepat**: Mendukung kamera belakang HP / webcam (ZXing & BarcodeDetector) serta upload foto barcode dari galeri.
- **Pencarian Berbasis Foto AI**: Foto barang langsung dikenali oleh model Google Gemini (`gemini-2.0-flash`) dan dicocokkan dengan katalog barang di gudang.
- **Manajemen Galeri Foto Barang**: Tambah banyak foto untuk tiap barang gudang, tersimpan di Supabase Storage.
- **Pusat Admin Aman**:
  - Proteksi Brute-Force Login PIN (Rate Limiting).
  - Ganti PIN Admin langsung dari dashboard.
  - Penyesuaian stok instan (+ / -) dengan riwayat audit log.
  - Import massal dari Excel (`.xlsx`, `.xls`, `.csv`) dengan auto-cleaning angka & mata uang.
  - Export data ke Excel / CSV & Cetak Label Barcode fisik.
- **PWA & Offline Ready**: Service Worker dan IndexedDB caching untuk tetap bisa melihat katalog saat koneksi gudang terputus.

---

## 🚀 Konfigurasi Environment Variables (Vercel)

Tambahkan variabel lingkungan berikut di dashboard **Vercel** (`Settings > Environment Variables`):

| Variable | Keterangan | Contoh Nilai |
|---|---|---|
| `GEMINI_API_KEY` | API Key dari Google AI Studio | `AIzaSy...` |
| `GEMINI_MODEL` | Model AI Gemini (opsional, default: `gemini-2.0-flash`) | `gemini-2.0-flash` |
| `SUPABASE_URL` | URL Proyek Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key (Secret) | `eyJhbGciOi...` |
| `ADMIN_PIN` | PIN awal untuk masuk admin | `123456` *(ganti dengan PIN kuat)* |
| `SESSION_SECRET` | Kunci acak minimal 32 karakter untuk tanda tangan token | `a8f9c2d1e0b3456789abcdef12345678` |

---

## 🗄️ Setup Database Supabase

1. Buka dashboard proyek **Supabase** Anda.
2. Masuk ke menu **SQL Editor**.
3. Buka file [`supabase-schema.sql`](supabase-schema.sql) dari repositori ini, salin seluruh isinya, dan jalankan (**Run**).
4. Skrip tersebut otomatis akan membuat:
   - Tabel `products` (Master barang)
   - Tabel `admin_security` (Hash PIN)
   - Tabel `admin_login_attempts` (Proteksi login)
   - Tabel `stock_logs` (Riwayat stok)
   - Bucket Storage `product-photos` (Penyimpanan foto produk)
   - Fungsi RPC untuk operasi atomik stok dan proteksi brute-force.

---

## 📦 Deployment ke Vercel

1. Push pembaruan kode ini ke repositori GitHub Anda.
2. Jika Anda menghubungkan repositori ke Vercel, Vercel akan otomatis melakukan build & deploy.
3. Pastikan semua Environment Variables di atas sudah diisi di Vercel agar backend API dan fitur AI dapat berfungsi penuh.
