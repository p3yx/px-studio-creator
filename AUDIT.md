# AUDIT PROYEK — PX STUDIO CREATOR

Tanggal audit: 2026-04-22  
Ruang lingkup: audit struktur, keamanan, dan kesiapan operasional **berdasarkan kondisi kode saat ini** (tanpa implementasi fitur roadmap besar).

## 1) Ringkasan Eksekutif
- **Status**: aplikasi fungsional untuk alur inti (clip/highlight, montage, audio extract/library, TTS, caption, prompt understanding) dengan **FFmpeg + job worker (DB polling, auto-start)** dan **gateway AI 9Router fixed via `.env` + pemilihan model di Settings**.
- **Kematangan**: **layak untuk pengembangan / penggunaan internal/VPS terkontrol**.
- **Kesiapan produksi publik**: **belum penuh** — ada celah prioritas (terutama akses file media, otorisasi konsisten, streaming/range, rate limiting) yang perlu hardening.

## 2) Arsitektur & Struktur Saat Ini
- **Stack**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind, Prisma + SQLite (`prisma/dev.db`), FFmpeg/FFprobe, OpenAI-compatible gateway (9Router).
- **Direktori utama**:
  - `src/app/(studio)/*` — halaman studio (dashboard, projects, create/clip, ai-studio/montage|prompt-editor|audio-extractor|audio-library|text-to-speech, settings, profile).
  - `src/app/api/*` — API routes (auth, projects/jobs/clips/captions, montage, audio, AI, files, settings, health).
  - `src/lib/*` — `db`, `auth`, `storage`, `ffmpeg`, `ai`/`ai-providers`, `analysis`, `montage`, `job-worker`, utilitas.
  - `prisma/schema.prisma` — model: `User/Session`, `Project/Clip/Job`, `MontageAsset/AudioAsset`, `Setting`, model AI (`AiProvider/AiModel/AiTaskRoute/AiUsageLog`).
  - `src/instrumentation.ts` — auto-start background worker (Node runtime).
  - `storage/` — sumber/hasil/temporary media (di luar source control seharusnya).
- **Pola pemrosesan**: pekerjaan berat (analisis/render/montage) berjalan sebagai **Job** di background worker; UI membaca status/progres dari DB.
- **Konfigurasi AI (kondisi terbaru)**: 9Router via env (`AI_BASE_URL`, `AI_API_KEY`, `AI_DEFAULT_MODEL`/fallback `AI_TEXT_MODEL`), model aktif dipilih & disimpan di `Setting` (`aiSelectedModel`), endpoint internal `GET/POST /api/ai/models`, `GET/PUT /api/ai/settings`, `POST /api/ai/test`. Endpoint manajemen provider/routing lama dinonaktifkan (410) dan UI provider manager dihapus dari Settings.

## 3) Fitur & Alur yang Berjalan (nyata)
- **AI Clip/Highlight**: buat project + analisis (heuristik + AI text bila model mendukung) → render klip MP4 (FFmpeg, crop/scale center per aspek) → download/preview, thumbnail.
- **AI Montage**: aset multi-klip+musik, trim/order/preset/plan, render FFmpeg (normalisasi, xfade/acrossfade, mix audio) → MP4.
- **Audio**: ekstraksi (mp3/wav/aac/m4a, trim), audio library (simpan/preview/rename/hapus/download), **TTS** via gateway.
- **Caption/Subtitle**: generasi SRT via STT (bergantung kemampuan model) dan burn subtitle saat render klip bila tersedia.
- **Auth/Project**: register/login (credential) + Google/Firebase, manajemen project/job dasar.
- **Catatan**: kapabilitas bergantung resource host/FFmpeg dan kemampuan model aktif (satu model global; STT/TTS/vision/audio tidak semua model dukung).

## 4) Temuan Keamanan (apa yang sudah baik)
- **Kredensial AI**: tidak diinput/ditampilkan di dashboard; akses gateway dari backend; key berasal dari `.env` server.
- **Session/Auth**: password hash (`bcrypt`), token session acak disimpan sebagai hash, cookie `httpOnly` + `sameSite=lax` (+ `secure` di production), logout invalidasi session.
- **DB**: Prisma (query parameterized) → risiko SQL injection rendah.
- **Eksekusi proses**: FFmpeg/FFprobe via `spawn` argumen array (bukan shell string), path kerja di bawah `STORAGE_ROOT`.
- **Pemisahan kerja**: render/analisis di worker background (bukan di request sinkron utama).

## 5) Temuan Risiko / Gap (prioritas perbaikan)
| Prioritas | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| **Tinggi** | `/api/files` **tanpa autentikasi & tanpa cek kepemilikan**; hanya memvalidasi path di dalam `STORAGE_ROOT`. | Kebocoran media jika path diketahui/ditebak. | Wajibkan login, verifikasi kepemilikan (project/asset milik user), atau signed URL ber-expiry. |
| **Tinggi** | `/api/files` membaca **seluruh file ke memori** (`readFile`) tanpa streaming/HTTP `Range`. | Konsumsi memori tinggi/DoS pada video besar, seeking tidak efisien. | Streaming (`createReadStream`) + dukungan `Range`/partial content. |
| **Sedang** | **Tidak ada middleware/guard terpusat**; authz per-route rawan inkonsisten. | Endpoint dapat terlewat proteksi/ownership. | Middleware/utility guard konsisten + audit seluruh route (project, montage, clip, audio, caption, AI). |
| **Sedang** | **Tidak ada rate limiting** & proteksi brute-force login; CSRF hanya mengandalkan `sameSite=lax`. | Penyalahgunaan endpoint/auth. | Rate limit (login & API sensitif), kebijakan lockout/backoff, pertimbangkan token CSRF untuk aksi state-changing jika perlu. |
| **Sedang** | **Validasi upload/input** perlu konsistensi (tipe/ukuran/durasi/path) di semua jalur. | Upload tak terduga/beban resource. | Validasi ketat server-side + batas yang ditegakkan seragam. |
| **Sedang** | **Rahasia di `.env`** (API key, `AUTH_SECRET`, config). | Kebocoran jika file/backup terekspos. | Permission ketat, jangan commit, secret kuat/unik di produksi, rotasi bila perlu. |
| **Rendah/Operasional** | Observabilitas, cleanup temp, limit konkurensi/resource, & kuota perlu penguatan untuk beban produksi. | Stabilitas/biaya resource. | Logging terkontrol (tanpa secret), cleanup terjadwal, limit & retry/cancel yang konsisten. |

## 6) Catatan Fungsional & Batasan
- **Satu model aktif global** (9Router): fitur yang butuh kapabilitas khusus (vision/STT/TTS/audio) bergantung dukungan model; jika tidak didukung, sistem melaporkan error/keterbatasan (tanpa fallback otomatis).
- **VPS tanpa GPU / tanpa model CV-ML lokal**: face/object tracking, audio separation semantik, word-level timing presisi, noise/dialog enhancement AI lanjutan memerlukan provider/model/adapter khusus — harus ditandai *belum dikonfigurasi* bila tidak tersedia (bukan simulasi).
- **Fitur “ultimate” (roadmap)** belum diimplementasikan; pengerjaan harus bertahap (Phase 1–4) di atas fondasi ini.

## 7) Rekomendasi Tindak Lanjut (berurutan)
1. **Hardening akses media (kritis)**: amankan `/api/files` (auth + ownership + streaming + Range) dan audit otorisasi semua endpoint media/project.
2. **Konsistensi authz & validasi**: guard terpusat, audit route, validasi upload/param seragam.
3. **Proteksi abuse**: rate limiting & penguatan login.
4. **Operasional**: hardening secret/permission, logging aman, cleanup & limit resource.
5. **Lanjut pengembangan fitur**: mulai Phase 1 (scene/reframing/beat/color/subtitle fondasi) secara nyata & teruji.

---
*Audit ini bersifat deskriptif atas kondisi saat ini, bukan sertifikasi keamanan formal/pentest.*
