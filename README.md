# PX STUDIO CREATOR

**PX STUDIO CREATOR** (PX STUDIO) adalah platform AI video editing & creative studio berbasis **Next.js (App Router)** untuk menggabungkan clip, menyusun montage, mengekstrak/mengelola audio, membuat plan editing berbasis prompt, dan merender video MP4 secara nyata dengan **FFmpeg** + background worker.

> Pengembangan lanjutan dari sistem sebelumnya (rebrand & upgrade), tanpa menghapus alur inti yang sudah berjalan.

## Fitur utama (terintegrasi)
- **Rebranding & UI:** identitas PX STUDIO CREATOR (logo PX, favicon/icon, metadata, dashboard, auth, layout studio).
- **AI Clip Studio (existing):** upload video → analisis highlight AI/heuristik → render clip MP4.
- **AI Montage Maker:** pilih/upload beberapa clip + musik, atur urutan/trim, preset (cinematic/AMV/hype/emotional/clean/story), aspect/FPS/audio mode, generate plan (auto/custom), render montage MP4 via worker (FFmpeg xfade/concat/audio mix).
- **AI Prompt Editor:** tulis instruksi editing (prompt & template), terjemahkan ke konfigurasi/preset montage, buat project dan lanjutkan ke workflow montage.
- **Audio Extractor:** ekstrak audio dari video (MP4/MKV/MOV/WEBM) ke **MP3/WAV/AAC/M4A** dengan trim start/end (FFmpeg encoding asli), preview & download.
- **Audio Library:** simpan, preview, rename, download, dan hapus audio hasil ekstraksi.
- **Project Management:** project/job tracking, preview & download hasil render.
- **Background processing:** job queue di database; worker otomatis berjalan di server Node (`instrumentation`) **tanpa perlu `npm run worker` manual** (opsi manual tetap tersedia).
- **AI provider (OpenAI-compatible):** konfigurasi 9router/gateway & model di Settings (server-side).

## Tech stack
- Next.js 16 + React 19 + TypeScript + Tailwind CSS
- Prisma + SQLite
- FFmpeg/FFprobe
- OpenAI-compatible AI endpoint (mis. 9router `http://192.168.0.157:20128/v1`)

## Prerequisites
- Node.js 20+ dan npm
- **FFmpeg** dan **FFprobe** di PATH (atau konfigurasi di Settings/env)
- (Opsional) endpoint AI OpenAI-compatible (9router) untuk analisis/penalaran AI

## Setup & Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Siapkan environment:
   ```bash
   copy .env.example .env
   ```
   Set minimal `AUTH_SECRET`. Default gateway AI: `http://192.168.0.157:20128/v1`.
3. Inisialisasi database & Prisma client:
   ```bash
   npm run db:generate
   npm run db:push
   ```
4. Jalankan aplikasi:
   ```bash
   npm run dev
   # atau
   npm run build
   npm run start
   ```
   Buka `http://localhost:3000`

> **Catatan:** background worker otomatis aktif saat server berjalan (Node runtime). Jika ingin menjalankan worker terpisah/manual: `npm run worker`.

## Konfigurasi AI (9router)
- Buka **Settings** (admin) dan pastikan:
  - **API Base URL:** `http://192.168.0.157:20128/v1`
  - **API Key / Model** sesuai konfigurasi 9router
- Jika AI tidak tersedia, sistem tetap dapat menggunakan fallback heuristik untuk beberapa alur analisis; rendering tetap bergantung pada FFmpeg.

## Struktur penting
- `src/app` — halaman & API routes (dashboard, create, projects, ai-studio/*, audio, auth, dll.)
- `src/components` — UI shell/brand/components
- `src/lib` — db, auth, storage, ffmpeg, ai, analysis, montage, job-worker
- `prisma/schema.prisma` — model data (user, project, clip, job, montage assets, audio assets, settings, dll.)
- `src/instrumentation.ts` — auto-start background worker
- `storage/` — file sumber/hasil (gitignored)

## Catatan
- Proses video/audio bergantung resource host; optimalkan untuk lingkungan tanpa GPU.
- Gunakan hanya media yang Anda miliki atau memiliki izin penggunaan/distribusi.
- Beberapa kemampuan lanjutan (analisis beat/scene/audio mendalam, editor timeline multi-track penuh, revisi prompt parsial kompleks, dll.) dapat dikembangkan lebih lanjut di atas fondasi yang sudah ada.
