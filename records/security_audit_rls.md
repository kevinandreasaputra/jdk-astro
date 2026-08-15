# Audit Keamanan Supabase: Kebocoran Data Profil Pengguna (RLS Column Leak)
**Tanggal Audit:** 15 Agustus 2026  
**Status:** 🚨 Kritis (Celah Keamanan RLS Terbuka)  
**Target Tabel:** `public.profiles`

---

## 1. Deskripsi Kerentanan (Vulnerability Description)

Tabel `public.profiles` menyimpan informasi data profil pengguna. Database memiliki kebijakan Row Level Security (RLS) yang memungkinkan akses pembacaan (`SELECT`) secara terbuka kepada publik/pengguna anonim (`anon` role) melalui kebijakan `"Public Read Profiles"` atau sejenisnya.

### Masalah Utama:
Dalam PostgreSQL/Supabase, Row Level Security (RLS) mengamankan data secara **horizontal** (baris per baris), bukan secara **vertikal** (kolom per kolom). 
Ketika izin `SELECT` diberikan secara bebas kepada publik (`USING (true)`), maka **seluruh kolom** pada baris tersebut ikut terekspos secara publik.

Di tabel `profiles` Anda, kolom sensitif seperti **`email`** dan **`whatsapp`** disatukan dengan kolom publik seperti `username`, `avatar_url`, dan `level`. Akibatnya, pihak luar yang memiliki kunci anonim (`anon_key` publik) dapat memanen daftar email dan kontak WhatsApp seluruh pengguna terdaftar tanpa perlu melakukan login.

---

## 2. Bukti Kerentanan (Proof of Concept - PoC)

Menggunakan kunci publik `anon` aplikasi, kueri berikut dieksekusi secara anonim:
```javascript
const { data } = await supabase.from('profiles').select('*').limit(1);
console.log(data);
```

### Hasil Data yang Bocor:
```json
[
  {
    "id": "9c788c78-2e77-4616-b876-78d757f5c49f",
    "username": "bakhri.aldanel",
    "full_name": "I'M GOOD BOY",
    "avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocK...",
    "level": 1,
    "email": "bakhri.aldanel@gmail.com",  // 🚨 LEAKED!
    "whatsapp": "0812XXXXXXXX"             // 🚨 LEAKED!
  }
]
```

---

## 3. Dampak Bisnis & Kepatuhan
1.  **Pelanggaran Privasi Data:** Kebocoran email dan nomor WhatsApp melanggar regulasi pelindungan data pribadi (GDPR / UU PDP Indonesia).
2.  **Spamming & Phishing:** Pihak tidak bertanggung jawab dapat mengumpulkan seluruh email pengguna untuk dikirimi pesan spam atau phishing yang menargetkan kredensial akun JDK Entertainment mereka.

---

## 4. Solusi Rekomendasi (Remediation Patterns)

Ada tiga metode standar untuk menutup celah keamanan ini tanpa merusak fitur frontend:

### Opsi A: Memisahkan Kolom Sensitif ke Tabel Privat (Direkomendasikan)
Pindahkan data privat (`email`, `whatsapp`) dari tabel `profiles` ke tabel baru, misalnya `public.profiles_private`.
1.  Buat tabel baru `profiles_private` dengan kolom `id` (references `profiles.id`), `email`, dan `whatsapp`.
2.  Terapkan RLS pada `profiles_private` agar hanya pemilik data yang bisa membaca:
    ```sql
    CREATE POLICY "Allow owners to read their own private data" 
    ON profiles_private FOR SELECT 
    USING (auth.uid() = id);
    ```
3.  Hapus kolom `email` dan `whatsapp` dari tabel utama `profiles`.

### Opsi B: Menggunakan Database View untuk Konsumsi Publik
Jika pemisahan tabel terlalu berisiko bagi kode frontend yang sudah ada:
1.  Ubah kebijakan RLS pada tabel `profiles` agar hanya bisa dibaca oleh pemilik akun:
    ```sql
    DROP POLICY IF EXISTS "Public Read Profiles" ON profiles;
    CREATE POLICY "Allow owner select profiles" ON profiles FOR SELECT USING (auth.uid() = id);
    ```
2.  Buat **Database View** khusus publik yang mengecualikan kolom sensitif:
    ```sql
    CREATE VIEW public_profiles_view AS
    SELECT id, username, full_name, avatar_url, level, current_points, user_level, xp, coin, achievements_unlocked, joined_at
    FROM profiles;
    ```
3.  Ubah query frontend (misalnya di fitur leaderboard/profil publik) untuk memanggil `public_profiles_view` ketimbang langsung ke tabel `profiles`.

### Opsi C: Mengontrol Izin Kolom PostgreSQL (Column-Level Privileges)
Membatasi hak akses select secara eksplisit per-kolom untuk peran publik (`anon` dan `authenticated`):
```sql
-- Cabut izin SELECT default untuk semua kolom
REVOKE SELECT ON profiles FROM anon, authenticated;

-- Berikan izin SELECT hanya untuk kolom non-sensitif
GRANT SELECT (id, username, full_name, avatar_url, level, current_points, user_level, xp, coin, achievements_unlocked, joined_at, referral_code, created_at) 
ON profiles TO anon, authenticated;
```
*Catatan: Metode ini sangat bersih, tetapi memerlukan penanganan khusus di Supabase karena kueri `.select('*')` di frontend akan langsung eror jika ada satu kolom yang tidak diizinkan. Frontend harus secara disiplin hanya memilih kolom yang diizinkan.*
