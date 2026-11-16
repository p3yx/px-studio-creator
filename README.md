# PX STUDIO CREATOR

<p align="center">
  <img src="public/logo.svg" alt="PX STUDIO CREATOR" width="120" height="120" />
</p>

<p align="center">
  <b>AI Video Editing &amp; Creative Studio</b><br/>
  Gabungkan clip, susun montage, olah audio, dan render video MP4 secara nyata dengan Next.js + FFmpeg.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-4-06b6d4?logo=tailwindcss&logoColor=white" />
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-ORM-2d3748?logo=prisma" />
  <img alt="FFmpeg" src="https://img.shields.io/badge/FFmpeg-Rendering-007808?logo=ffmpeg&logoColor=white" />
</p>

<p align="center">
  <a href="public/qris/qris.png">
    <img src="public/qris/qris.png" alt="Buy Me a Coffee - QRIS" width="220" />
  </a><br/>
  <sub>Scan QRIS untuk dukungan (Buy Me a Coffee)</sub>
</p>

---

**PX STUDIO CREATOR** adalah platform AI video editing & creative studio berbasis **Next.js (App Router)** untuk menggabungkan clip, menyusun montage, mengekstrak/mengelola audio, menganalisis beat musik, membuat caption/TTS, dan merender video secara nyata menggunakan **FFmpeg** + background worker.

> Dikembangkan dari sistem sebelumnya (rebrand & upgrade) dengan tetap mempertahankan alur inti yang sudah berjalan.

## Fitur Utama

- **AI Clip Studio** — upload video, analisis highlight (AI/heuristik), render clip MP4.
- **AI Montage Maker** — pilih/upload beberapa clip + musik, atur urutan/trim, preset (cinematic/AMV/hype/emotional/clean/story), aspect/FPS/audio mode, generate plan (auto/custom), render montage via worker (FFmpeg xfade/concat/audio mix).
- **AI Prompt Editor** — tulis instruksi editing & template, terjemahkan ke konfigurasi/preset montage.
- **Tambah Suara ke Video** — mix/replace audio, Audio Library, Extract Audio, dan **Auto Beat** (analisis beat/BPM/marker, sync plan, render sinkron musik via FFmpeg).
- **Auto Caption** — transkripsi (STT/fallback), generate SRT, burn-in subtitle ke video bila memungkinkan.
- **Audio Extractor & Audio Library** — ekstrak audio (MP3/WAV/AAC/M4A, trim start/end), simpan/preview/rename/download/hapus.
- **Text to Speech (TTS)** — generate suara dengan fallback yang tersedia.
- **YouTube AutoClip** — buat project dari link YouTube (unduh via `yt-dlp`, proses clip).
- **Project/Job Management** — tracking status, preview & download hasil render.
- **Background Worker** — job queue di database; worker otomatis berjalan di server Node (`instrumentation`).
- **AI Gateway (9Router-only)** — konfigurasi via `.env` server-side, model aktif global di Settings (tanpa provider manager/routing di dashboard).

## Tech Stack

- **Frontend/Backend:** Next.js 16 (App Router) + React 19 + TypeScript
- **UI:** Tailwind CSS 4, komponen kustom, ikon Lucide
- **Database/ORM:** Prisma + SQLite
- **Media/Render:** FFmpeg / FFprobe
- **AI:** endpoint OpenAI-compatible (gateway 9Router)

## Prasyarat

- **Node.js 20+** dan **npm**
- **FFmpeg** dan **FFprobe** tersedia di PATH (atau set di `.env`)
- **Python 3** (untuk analisis beat/audio tertentu; `numpy`/`scipy` direkomendasikan)
- (Opsional) **yt-dlp** untuk fitur YouTube AutoClip
- (Opsional) endpoint AI OpenAI-compatible (9Router) untuk analisis/penalaran AI

## Instalasi & Menjalankan

### Instalasi per pengguna (disarankan — bisa dijalankan dari mana saja)

Saat instalasi pertama, aplikasi akan disalin ke folder pengguna (Windows: `%USERPROFILE%\px-studio`, Linux/macOS: `~/px-studio`) dan perintah `px` didaftarkan global, jadi Anda **tidak perlu selalu membuka folder project**.

1. **Clone/download source** (sekali saja, mis. ke Desktop/Downloads)
   ```bash
   git clone https://github.com/p3yx/px-studio-creator.git px-studio
   cd px-studio
   npm install
   ```
   > Anda bisa mengganti nama folder menjadi `px-studio` (atau nama lain) agar mudah dikenali.
2. **Siapkan environment (opsional tapi disarankan sebelum install user)**
   ```bash
   copy .env.example .env
   ```
   Atur minimal `AUTH_SECRET`. Konfigurasi gateway AI (9Router) dan path tool (FFmpeg/yt-dlp) melalui `.env` sesuai kebutuhan. (File `.env` akan ikut disalin saat instalasi user.)
3. **Jalankan instalasi ke folder pengguna & daftarkan perintah global**
   ```bash
   npx -y node bin/px.js studio install
   # atau (setelah npm install): node bin/px.js studio install
   ```
   Perintah ini menyalin app ke folder pengguna, menjalankan install/generate/build, dan `npm link` sehingga `px` bisa dipanggil dari mana saja.

Setelah itu, buka terminal/CMD/PowerShell **di mana saja** dan jalankan:
```bash
px studio start   # production (butuh build)
px studio dev     # development
px studio build   # build ulang
px studio worker  # worker saja
px studio where   # tampilkan lokasi instalasi
```
Buka: `http://localhost:3000`

### Instalasi & Aplikasi via EXE (Windows)

Repo ini menyertakan proyek dan hasil build **launcher/setup EXE** (Windows, .NET 6) di `windows/` dan `windows/release/`:

- **`PXStudio-Setup.exe`** — setup per pengguna: menyalin app ke `%USERPROFILE%\px-studio`, menjalankan `npm install` / `db:generate` / `db:push` / `build` / `npm link`, dan mencoba membuat shortcut desktop.
- **`PX Studio.exe`** — launcher aplikasi: menjalankan server (dari instalasi user) dan membuka `http://localhost:3000`.

**Prasyarat:** Node.js 20+ & npm, FFmpeg/FFprobe (sesuai kebutuhan), dan **.NET 6 Runtime** (untuk menjalankan EXE framework-dependent). `.env` sebaiknya disiapkan sebelum setup.

**Cara pakai (paket sumber):**
1. Siapkan paket yang berisi source project (`package.json`, `src/`, dll.) bersama file EXE dari `windows/release/` (salin `PXStudio-Setup.exe`, `PXStudio-Setup.dll`, `PXStudio-Setup.deps.json`, `PXStudio-Setup.runtimeconfig.json`, dan file launcher `PX Studio.*` ke folder paket/root project).
2. Jalankan **`PXStudio-Setup.exe`** dari folder paket tersebut. Setup akan menginstal ke `%USERPROFILE%\px-studio`.
3. Jalankan **`PX Studio.exe`** (atau shortcut "PX Studio" di Desktop, jika dibuat) untuk membuka aplikasi. Anda juga tetap bisa memakai `px studio start` dari terminal mana saja.

**Build ulang EXE (jika mengubah source launcher/setup):**
```bash
dotnet publish windows/PXStudio.Launcher/PXStudio.Launcher.csproj -c Release
dotnet publish windows/PXStudio.Setup/PXStudio.Setup.csproj -c Release
```
Hasil publish ada di `windows/PXStudio.Launcher/bin/Release/net6.0/publish/` dan `windows/PXStudio.Setup/bin/Release/net6.0/publish/` (salin ke `windows/release/` bila perlu). Untuk membuat EXE **self-contained** (tanpa .NET Runtime terpasang) diperlukan runtime packs .NET yang sesuai saat publish (`--self-contained true -r win-x64`).

### Instalasi manual (dari folder project)
Jika tidak ingin instalasi ke folder pengguna, Anda tetap bisa menjalankan dari folder project:
```bash
npm install
copy .env.example .env
npm run db:generate
npm run db:push
npm run build
npm start
```
Atau daftarkan CLI global dari folder tersebut: `npm link` (lalu `px studio start`).

> **Catatan:** background worker otomatis aktif saat server berjalan (Node runtime). Opsi manual: `npm run worker` atau `px studio worker`. Jika instalasi user perlu diperbarui setelah mengubah source, jalankan kembali `node bin/px.js studio install` dari source (atau perbarui di folder instalasi lalu `px studio build`). Pada beberapa sistem, `npm link` saat instalasi mungkin memerlukan hak akses tambahan.

## Konfigurasi Penting (`.env`)

- `AUTH_SECRET` — secret autentikasi (wajib di production)
- `FFMPEG_PATH` / `FFPROBE_PATH` — path FFmpeg/FFprobe (opsional jika sudah di PATH)
- `AI_API_BASE_URL` / `AI_API_KEY` / `AI_DEFAULT_MODEL` — gateway AI (9Router, server-side)
- `YTDLP_PATH` — path `yt-dlp` untuk YouTube AutoClip

Lihat `.env.example` untuk daftar lengkap.

## Struktur Proyek

```text
src/
  app/            # Halaman & API routes (dashboard, projects, ai-studio, auth, dll.)
  components/     # UI shell, brand, komponen
  lib/            # db, auth, storage, ffmpeg, ai, analysis, montage, beat, worker
prisma/
  schema.prisma   # Model data (user, project, clip, job, montage/audio assets, settings)
public/           # Aset statis & ikon
storage/          # File sumber/hasil render (gitignored)
```

## Ikon & Branding

Aset ikon modern tersedia di:
- `public/logo.svg`, `public/logo-mark.svg` — logo/mark PX STUDIO CREATOR
- `src/app/icon.svg` & `src/app/favicon.ico` — ikon aplikasi (Next.js App Router)

## Catatan

- Proses video/audio sangat bergantung resource host (CPU/RAM/disk). Render berat disarankan pada durasi/segmen yang wajar.
- Gunakan hanya media yang Anda miliki atau memiliki izin penggunaan/distribusinya.
- Kemampuan AI (STT/caption/prompt) bergantung pada ketersediaan & kompatibilitas model di gateway yang dikonfigurasi.

## Dukungan

Jika project ini bermanfaat, Anda bisa mendukung pengembang via QRIS:

<a href="public/qris/qris.png">
  <img src="public/qris/qris.png" alt="Buy Me a Coffee - QRIS" width="220" />
</a>

## Lisensi

Belum ditentukan. Tambahkan file `LICENSE` sesuai kebutuhan distribusi Anda.
