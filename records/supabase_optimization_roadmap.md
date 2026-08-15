# Roadmap Optimasi Supabase & Kompresi Storage
**Proyek:** JDK Entertainment  
**Tanggal:** 15 Agustus 2026  
**Status:** Menunggu Konfirmasi Pihak Pengguna (Proceed)

Dokumen ini menjabarkan panduan langkah demi langkah secara aman (*safety protocols*) untuk melakukan optimasi penuh database Supabase dan kompresi storage retroaktif tanpa mengganggu aplikasi produksi (*live production*).

---

## 🗺️ Rencana Kerja 4 Fase

```
Fase 1: Pencadangan (Backup)
       └──> Fase 2: Kompresi Gambar Retroaktif
               └──> Fase 3: Refaktorisasi Kode Astro
                       └──> Fase 4: Verifikasi & Pembersihan
```

---

## 🛠️ Detail Pelaksanaan Tiap Fase

### FASE 1: Pencadangan Data (Backup) — *Keamanan Pertama*
Sebelum memulai migrasi, kita harus memiliki salinan data hidup saat ini.
1.  **Backup Data Database (JSON):**
    *   Kita akan menulis skrip lokal `backup_tables.js` yang akan menarik seluruh baris data dari tabel `profiles`, `events`, `products`, `hero_sliders`, dan `lobby_duels` menggunakan kunci `anon` publik saat ini, kemudian menyimpannya sebagai file `.json` lokal di folder `.tmp/backup/`.
2.  **Backup Gambar Asli (Storage):**
    *   Skrip `backup_storage.js` akan merayapi semua URL gambar aktif di database, lalu mengunduh file asli berukuran megabyte (total ~25 MB) ke direktori lokal `.tmp/backup_images/`.

### FASE 2: Kompresi Retroaktif Gambar (Sharp + SQL Generation)
Untuk meringankan gambar lama berukuran MB (misalnya slider banner 6,9 MB) di cloud storage:
1.  **Instalasi dependensi:** Kita akan menginstal pustaka pengolah gambar berkinerja tinggi `sharp` di folder proyek.
2.  **Pemrosesan Gambar Lokal:**
    *   Skrip `compress_assets.js` akan memproses gambar di folder `.tmp/backup_images/` ke folder output `.tmp/compressed_images/`.
    *   *Aturan Kompresi:*
        *   Mengubah format PNG besar ke **WebP** dengan kualitas **80%**.
        *   Membatasi resolusi: Lebar slider banner maks `1920px`, poster event maks `800px`, produk maks `600px`.
3.  **Unggah & Pembaruan Tautan Database:**
    *   *Pertimbangan Keamanan:* Karena kita tidak memiliki kunci admin `service_role` di file `.env`, skrip kita **tidak dapat melakukan UPDATE** ke database secara langsung.
    *   *Solusi:* Skrip pengunggah akan mengunggah gambar terkompresi ke Supabase Storage (jika diizinkan anonim, atau kita meminta user mengunggahnya), dan secara otomatis **menghasikan berkas SQL `update_image_urls.sql`**.
    *   Berkas SQL ini berisi perintah `UPDATE events SET image_url = '...' WHERE id = '...';` untuk seluruh baris data. Anda cukup menyalin isi berkas ini dan mengeksekusinya dalam satu klik melalui **Supabase Dashboard SQL Editor** (yang memiliki hak akses admin penuh).

### FASE 3: Refaktorisasi Kode Astro (Astro Query & Server Rendering)
1.  **Optimasi Payload API (Query Optimization):**
    *   Merefaktorkan berkas JS frontend (`home.js`, `events.js`, `marketplace.js`, `profile.js`) untuk mengganti `.select('*')` menjadi pemanggilan kolom spesifik (misalnya `.select('id, title, date, image_url')`).
2.  **Penerapan Render-Time Optimization:**
    *   Mengintegrasikan pemanggilan fungsi `optimizeImageUrl` langsung di dalam komponen `.astro` (misalnya `index.astro`, `events.astro`) di sisi server.
    *   Browser akan langsung menerima URL terkompresi `weserv.nl` sejak awal render HTML, menghentikan proses *double-download* gambar asli oleh browser.

### FASE 4: Verifikasi & Pembersihan (Validation & Cleanup)
1.  **Uji Coba Lokal:** Jalankan server Astro local (`npm run dev`) untuk memastikan semua gambar tampil sempurna dan tidak ada tautan rusak.
2.  **Uji Lighthouse:** Jalankan Lighthouse di browser lokal untuk memverifikasi peningkatan skor FCP, LCP, TTI, dan hilangnya peringatan ukuran payload jaringan.
3.  **Pembersihan:** Setelah sistem stabil di server produksi selama beberapa hari, berkas gambar lama berukuran MB di Supabase Storage dapat dihapus dengan aman melalui dashboard Supabase Storage Anda.

---

## 🔒 Pertimbangan Keamanan & Rencana Darurat (Fallback Plan)
*   **Aset Asli Tetap Aman:** Gambar versi asli (megabyte) tidak akan dihapus atau ditimpa di storage. Jika ada gambar baru terkompresi yang pecah atau gagal muat, kita cukup menjalankan perintah SQL balik untuk mengembalikan tautan gambar ke berkas asli.
*   **Perlindungan Kunci Admin:** Dengan menggunakan taktik pembuatan berkas SQL untuk memperbarui database, kita tidak perlu memaparkan kunci admin sensitif (`service_role`) di dalam file konfigurasi program.
