# 💻 PANDUAN PENGEMBANGAN & UJI COBA STAGING (LOKAL)

Konfigurasi `.env` lokal Anda saat ini sudah diubah untuk menggunakan database **Staging** (`evppqcuruqitriqcyolt`). Kredensial database Production yang lama telah diamankan di file `.env.production`.

Berikut cara menjalankan dan menguji sistem staging secara lokal:

---

## 1. Menjalankan Server Pengembangan Lokal (Localhost)

1. Buka terminal di folder `/jdk-astro`.
2. Jalankan perintah untuk menginstal dependencies (jika ada yang baru):
   ```bash
   npm install
   ```
3. Jalankan server lokal Astro:
   ```bash
   npm run dev
   ```
4. Buka **`http://localhost:4321`** di browser Anda.
5. Jalankan pendaftaran member baru atau pengetesan lainnya. Data tersebut otomatis masuk ke database Staging Anda.

---

## 2. Deploy Langsung ke Vercel via Vercel CLI (Tanpa Git/GitHub)

Jika Anda ingin mengunggah hasil pekerjaan langsung ke hosting Vercel (sebagai preview/staging) tanpa melalui GitHub:

1. Pastikan Vercel CLI sudah terinstal di laptop Anda. Jika belum, instal global:
   ```bash
   npm install -g vercel
   ```
2. Jalankan perintah deploy untuk **Preview/Staging**:
   ```bash
   vercel
   ```
   *(Pilih YES untuk semua pertanyaan jika baru pertama kali menghubungkan proyek).*
3. Vercel akan langsung mem-build dan memberikan URL Preview yang aman dan terhubung ke database Staging.

---

## 3. Cara Mengembalikan ke Database Production (Lokal)
Jika sewaktu-waktu Anda ingin menjalankan database Production utama di localhost:
* Jalankan perintah berikut untuk menukar file `.env`:
  ```bash
  cp .env.production .env
  ```
