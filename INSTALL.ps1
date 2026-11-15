# PX STUDIO CREATOR - Auto Install (Windows PowerShell)
# Jalankan: klik kanan -> Run with PowerShell, atau: powershell -ExecutionPolicy Bypass -File .\INSTALL.ps1

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "PX STUDIO CREATOR - Auto Install" -ForegroundColor Magenta
Write-Host "Project: $root"

# 1) Prasyarat
Write-Step "Memeriksa prasyarat"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js tidak ditemukan. Install Node.js 20+ lalu jalankan ulang." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm tidak ditemukan. Pastikan Node.js terpasang dengan benar." }
$nodeVer = node -v
$npmVer = npm -v
Write-Ok "Node $nodeVer, npm $npmVer"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Write-Warn "ffmpeg tidak ditemukan di PATH. Fitur render/ekstraksi media membutuhkan FFmpeg." } else { Write-Ok "ffmpeg ditemukan" }
if (-not (Get-Command ffprobe -ErrorAction SilentlyContinue)) { Write-Warn "ffprobe tidak ditemukan di PATH. Analisis media membutuhkan FFprobe." } else { Write-Ok "ffprobe ditemukan" }

# 2) Environment file
Write-Step "Menyiapkan environment (.env)"
if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-Ok ".env dibuat dari .env.example"
    Write-Warn "PENTING: edit .env -> set AUTH_SECRET (acak, panjang), AI_API_BASE_URL/AI_API_KEY (9Router), dan konfigurasi Firebase bila dipakai."
  } else {
    Write-Warn ".env.example tidak ditemukan; buat .env secara manual."
  }
} else {
  Write-Ok ".env sudah ada (tidak diubah)"
}

# 3) Dependencies
Write-Step "Menginstal dependencies (npm install)"
npm install
Write-Ok "Dependencies terpasang"

# 4) Database (Prisma)
Write-Step "Menyiapkan database (Prisma generate & db push)"
npx prisma generate
npx prisma db push
Write-Ok "Database siap (SQLite sesuai DATABASE_URL)"

# 5) Direktori storage
Write-Step "Menyiapkan direktori storage"
$storage = "storage"
@($storage, "$storage/projects", "$storage/audio") | ForEach-Object {
  if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
}
Write-Ok "Direktori storage siap"

# 6) Build (opsional tapi disarankan untuk production)
Write-Step "Build aplikasi (production)"
try {
  npm run build
  Write-Ok "Build berhasil"
} catch {
  Write-Warn "Build gagal/terlewati. Anda masih bisa menjalankan mode dev: npm run dev"
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Instalasi selesai." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Langkah berikutnya:" -ForegroundColor White
Write-Host "  1. Edit .env: set AUTH_SECRET, AI_API_BASE_URL, AI_API_KEY (9Router), dan (opsional) Firebase." -ForegroundColor White
Write-Host "  2. Pastikan ffmpeg & ffprobe tersedia di PATH." -ForegroundColor White
Write-Host "  3. Jalankan (development):  npm run dev" -ForegroundColor White
Write-Host "     atau (production):      npm run start" -ForegroundColor White
Write-Host "  4. Buka: http://localhost:3000  (lalu Settings -> pilih & simpan model AI, test koneksi)" -ForegroundColor White
Write-Host "Catatan: background worker auto-start saat server berjalan. Lihat AUDIT.md untuk status & rekomendasi keamanan." -ForegroundColor DarkGray
Write-Host "`nTekan Enter untuk keluar..."
[void][System.Console]::ReadLine()
