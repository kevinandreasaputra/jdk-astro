# Records Memory & Misi ke Depan
**Proyek: JDK Entertainment (Port Astro & Optimasi Supabase)**

Dokumen ini mencatat memori pemahaman sistem saat ini serta rencana aksi (*misi ke depan*) untuk penyelarasan dan optimasi penuh frontend, backend, dan database Supabase.

---

## 🧠 Memori Pemahaman Codebase Saat Ini

### 1. Arsitektur & Transisi Frontend
*   **Porting Halaman:** Proyek telah berhasil di-porting dari HTML biasa (yang menggunakan custom SPA router) ke Astro Static Generation (`jdk-astro`) dengan total **35 halaman**.
*   **Routing:** Menggunakan `<ClientRouter />` dari `astro:transitions` untuk transisi halaman yang mulus.
*   **Persistent Radio Widget:** Dioptimalkan menggunakan `transition:persist="radio-widget"` pada kontainer khusus `#jdk-radio-container` sehingga lagu tidak terputus saat pengguna berpindah halaman.
*   **Sistem Styling:** Di-upgrade ke **Tailwind CSS v4** dengan modularisasi berkas CSS melalui direktif `@theme` dan `@import` di `global.css`.

### 2. Optimasi Payload & Lighthouse
*   **Lazy Loading API:** YouTube IFrame API ditunda pemuatannya dan baru dimuat saat tombol "Power On" ditekan.
*   **Code-Splitting p5.js:** Modul partikel p5.js dipisah ke `particles.js` dan hanya dimuat secara dinamis via `import()` pada layar Desktop ($\ge 768$px).
*   **Dynamic Image Compression:** Menggunakan proxy `images.weserv.nl` dan `MutationObserver` di `main.js` untuk secara otomatis mengompresi gambar dari Supabase Storage menjadi format WebP sesuai resolusi kontainer.

### 3. Sinkronisasi Aset & Metadata Terakhir
*   Aset kritis yang terlewat (`dinda-avatar.png` untuk chatbot dan `placeholder.svg` untuk fallback gambar produk) telah disalin ke folder `public/`.
*   Header keamanan **Content Security Policy (CSP)** kustom, Open Graph tags, Twitter Cards, dan **URL Kanonikal Dinamis** telah ditambahkan ke Layout.astro.
*   Eror build-time terkait pemanggilan relatif background image `../images/` di CSS telah diperbaiki menjadi absolut `/images/`.

---

## 🚨 Temuan Audit Supabase (Backend/Database)

*   **Vulnerability RLS (Kritis):** Data sensitif berupa `email` di tabel `profiles` bocor secara publik melalui pemanggilan anonim kunci publik `anon` (tidak ada pembatasan RLS policy yang mengikat kolom tersebut ke pemilik data).
*   **Efisien Payload Rendah:** Kode program frontend sering menggunakan `.select('*')` (seperti pada query hero slider, upcoming events, dan lobby reactions), yang menarik kolom yang tidak perlu dan memperlambat waktu respons halaman.

---

## 🎯 Misi ke Depan (Future Missions)

Berikut adalah rencana aksi yang akan dieksekusi secara konsisten:

### Misi 1: Mengamankan Kebocoran Data (RLS Hardening)
*   **Aksi:** Mengonfigurasi ulang kebijakan Row Level Security (RLS) pada tabel `profiles` di dashboard Supabase agar kolom sensitif (`email` dan `whatsapp`) tidak dapat dibaca oleh publik atau pengguna anonim lainnya. Pembacaan email/whatsapp hanya diperbolehkan jika `auth.uid() = id`.
*   **Status:** Menunggu perbaikan di sisi Dashboard Supabase / Migration.

### Misi 2: Optimasi Kueri Payload Frontend (Query Optimization)
*   **Aksi:** Melakukan refaktorisasi pada query Supabase di berkas JavaScript Astro agar tidak lagi menggunakan `.select('*')`.
*   **Target File:**
    *   `home.js` (Kueri `events` dan `hero_sliders`).
    *   `lobby.js` (Kueri `lobby_reactions`, `lobby_duels`, dll).
    *   `marketplace.js` (Kueri `products`).
    *   `profile.js` (Kueri inventaris dan aktivitas user).

### Misi 3: Integrasi dan Inspeksi Penuh via Supabase MCP
*   **Aksi:** Pada sesi berikutnya (saat server MCP dimuat ulang), gunakan perangkat Supabase MCP untuk:
    *   Melakukan inspeksi skema relasi antar tabel secara langsung.
    *   Membuat berkas migrasi database PostgreSQL yang terstandar.
    *   Menguji performa eksekusi query SQL langsung dari AI agent.
