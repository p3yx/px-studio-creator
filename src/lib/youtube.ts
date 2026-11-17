import path from "path";
import fs from "fs/promises";
import { runProcess } from "./ffmpeg";

export function isYouTubeUrl(url: string) {
  try {
    const u = new URL(String(url || "").trim());
    const h = u.hostname.replace(/^www\./, "");
    return h === "youtube.com" || h === "m.youtube.com" || h === "youtu.be" || h === "music.youtube.com";
  } catch { return false; }
}

export function normalizeYouTubeUrl(url: string) {
  return String(url || "").trim();
}

async function resolveYtDlp() {
  const candidates = [process.env.YTDLP_PATH, "yt-dlp", "yt-dlp.exe"].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const r = await runProcess(c, ["--version"]);
      if (r.code === 0) return c;
    } catch {}
  }
  return null;
}

export async function downloadYouTubeVideo(opts: {
  url: string;
  outDir: string;
  basename?: string;
  onProgress?: (msg: string) => Promise<void> | void;
}): Promise<{ filePath: string; title?: string; duration?: number | null }> {
  const url = normalizeYouTubeUrl(opts.url);
  if (!isYouTubeUrl(url)) throw new Error("URL YouTube tidak valid");
  await fs.mkdir(opts.outDir, { recursive: true });
  const ytdlp = await resolveYtDlp();
  if (!ytdlp) {
    throw new Error("yt-dlp tidak ditemukan di server. Instal yt-dlp dan/atau set YTDLP_PATH di .env untuk mengaktifkan AutoClip via link YouTube.");
  }

  await opts.onProgress?.("Mengunduh video YouTube...");
  const base = (opts.basename || "youtube-source").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "youtube-source";
  const outTpl = path.join(opts.outDir, `${base}.%(ext)s`);

  // Prefer mp4 (h264+aac) for compatibility with ffmpeg pipeline
  const args = [
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "--restrict-filenames",
    "-o", outTpl,
    "--print", "after_move:filepath",
    "--print", "before_dl:title",
    url,
  ];
  const r = await runProcess(ytdlp, args);
  if (r.code !== 0) {
    const err = (r.stderr || r.stdout || "").slice(-800);
    throw new Error(`Gagal mengunduh video YouTube: ${err || "unknown error"}`);
  }

  const lines = String(r.stdout || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // prints: title (before_dl) then filepath (after_move)
  let title: string | undefined;
  let filePath: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!filePath && /\.(mp4|mkv|webm|mov)$/i.test(l)) filePath = l;
  }
  if (!filePath) {
    // fallback: find produced file
    const files = await fs.readdir(opts.outDir);
    const cand = files.filter(f => f.startsWith(base) && /\.(mp4|mkv|webm|mov)$/i.test(f)).sort();
    if (cand.length) filePath = path.join(opts.outDir, cand[cand.length - 1]);
  }
  if (!filePath) throw new Error("Unduhan YouTube selesai tetapi file video tidak ditemukan.");
  // title best-effort: first non-path line
  for (const l of lines) { if (l !== filePath && !/\.(mp4|mkv|webm|mov)$/i.test(l)) { title = l; break; } }

  return { filePath, title };
}
