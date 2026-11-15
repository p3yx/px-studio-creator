import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";
import { runProcess, burnSubtitlesIntoVideo, probeVideo } from "@/lib/ffmpeg";
import { transcribeWithTask } from "@/lib/ai-providers";
import { transcriptToSrt } from "@/lib/captions";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "captioned-video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "captioned-video"; }

function mapSpeechLang(lang?: string) {
  const l = String(lang || "auto").toLowerCase();
  if (l === "auto") return null;
  if (l === "id" || l.startsWith("id-")) return "id-ID";
  if (l === "en" || l.startsWith("en-")) return "en-US";
  if (l === "ja") return "ja-JP";
  if (l === "ko") return "ko-KR";
  if (l === "zh" || l.startsWith("zh")) return "zh-CN";
  if (l === "es") return "es-ES";
  if (l === "fr") return "fr-FR";
  if (l === "de") return "de-DE";
  if (l === "ar") return "ar-SA";
  if (l === "hi") return "hi-IN";
  if (l === "pt") return "pt-BR";
  if (l === "ru") return "ru-RU";
  return lang || null;
}

async function transcribeFallbackGoogle(wavPath: string, duration: number, language?: string) {
  const chunkSec = 20;
  const tmpDir = path.join(os.tmpdir(), `px-cap-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    const pattern = path.join(tmpDir, "chunk_%03d.wav");
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const seg = await runProcess(ff, ["-y", "-i", wavPath, "-f", "segment", "-segment_time", String(chunkSec), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", pattern]);
    if (seg.code !== 0) throw new Error(`Gagal memecah audio untuk fallback caption: ${(seg.stderr || "").slice(-300)}`);
    const files = (await fs.readdir(tmpDir)).filter(f => /^chunk_\d+\.wav$/i.test(f)).sort();
    if (!files.length) throw new Error("Fallback caption: tidak ada segmen audio yang dihasilkan.");

    const langCode = mapSpeechLang(language);
    const pyScript = path.join(tmpDir, "stt.py");
    const pyCode = [
      "import sys, json",
      "import speech_recognition as sr",
      "path = sys.argv[1]",
      "lang = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] not in ('', 'None', 'auto') else None",
      "r = sr.Recognizer()",
      "with sr.AudioFile(path) as source:",
      "    audio = r.record(source)",
      "try:",
      "    if lang:",
      "        text = r.recognize_google(audio, language=lang)",
      "    else:",
      "        text = r.recognize_google(audio)",
      "    print(json.dumps({'ok': True, 'text': text}))",
      "except sr.UnknownValueError:",
      "    print(json.dumps({'ok': True, 'text': ''}))",
      "except Exception as e:",
      "    print(json.dumps({'ok': False, 'error': str(e)}))",
    ].join("\n");
    await fs.writeFile(pyScript, pyCode, "utf8");

    const segments: { start: number; end: number; text: string }[] = [];
    let fullTextParts: string[] = [];
    let lastErr: string | null = null;
    for (let i = 0; i < files.length; i++) {
      const f = path.join(tmpDir, files[i]);
      const start = i * chunkSec;
      const end = Math.min(duration || (i + 1) * chunkSec, (i + 1) * chunkSec);
      const args = ["-3", pyScript, f];
      if (langCode) args.push(langCode); else args.push("auto");
      let r = await runProcess("py", args);
      if (r.code !== 0 && !String(r.stdout || "").trim()) {
        r = await runProcess("python", [pyScript, f, langCode || "auto"]);
      }
      const out = String(r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
      let j: any = {};
      try { j = JSON.parse(out); } catch { j = {}; }
      if (j && j.ok === false) { lastErr = j.error || lastErr; continue; }
      const text = String((j && j.text) || "").trim();
      if (text) {
        segments.push({ start, end, text });
        fullTextParts.push(text);
      }
    }
    if (!segments.length) {
      throw new Error(lastErr ? `Fallback caption gagal: ${lastErr}` : "Fallback caption tidak menghasilkan teks (audio mungkin tidak jelas atau layanan tidak tersedia).");
    }
    return { text: fullTextParts.join(" "), segments, _fallback: "google_speech" };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function toDownloadUrl(absPath: string) {
  const rel = path.relative(STORAGE_ROOT, absPath).replace(/\\/g, "/");
  return `/api/files?path=${encodeURIComponent(rel)}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const language = String(form.get("language") || form.get("lang") || "auto");
    const name = String(form.get("name") || "Video Caption");
    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });

    const workDir = path.join(STORAGE_ROOT, "temp", user.id, `autocap-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    const outDir = path.join(STORAGE_ROOT, "auto-captions", user.id);
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const ext = path.extname(video.name || "") || ".mp4";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, Buffer.from(await video.arrayBuffer()));

    let duration = 0;
    try { duration = (await probeVideo(inputPath)).duration || 0; } catch {}

    const wavPath = path.join(workDir, "audio.wav");
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const ex = await runProcess(ff, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath]);
    if (ex.code !== 0) throw new Error(`Audio extraction failed: ${(ex.stderr || "").slice(-400)}`);

    let transcript: any = null;
    let usedFallback = false;
    let fallbackNote: string | null = null;
    try {
      transcript = await transcribeWithTask("speech_to_text", wavPath, { language });
    } catch (aiErr: any) {
      try {
        transcript = await transcribeFallbackGoogle(wavPath, duration || 0, language);
        usedFallback = true;
        fallbackNote = "Caption dibuat menggunakan fallback (Google Speech Recognition) karena transkripsi AI gagal.";
      } catch (fbErr: any) {
        const aiMsg = aiErr?.message || "Transkripsi AI gagal";
        const fbMsg = fbErr?.message || "Fallback caption gagal";
        throw new Error(`${aiMsg} (fallback caption gagal: ${fbMsg})`);
      }
    }

    const srt = transcriptToSrt(transcript, duration || 10);
    if (!srt.trim()) throw new Error("Transkripsi menghasilkan caption kosong.");

    const base = `${Date.now()}-${safeName(name)}`;
    const srtPath = path.join(outDir, `${base}.srt`);
    await fs.writeFile(srtPath, srt, "utf8");

    // Burn into video
    const outVideoPath = path.join(outDir, `${base}-captioned.mp4`);
    let burnedIn = false;
    let burnNote: string | null = null;
    try {
      await burnSubtitlesIntoVideo({ input: inputPath, subtitlePath: srtPath, output: outVideoPath, quality: "medium" });
      burnedIn = true;
      burnNote = "Caption berhasil dimasukkan (burn-in) ke video.";
    } catch (e: any) {
      // fallback: copy original as output? no, better just return srt
      burnNote = `SRT berhasil dibuat, tetapi gagal burn-in ke video: ${String(e?.message || e).slice(0, 220)}.`;
    }

    await Promise.allSettled([fs.unlink(inputPath).catch(()=>{}), fs.unlink(wavPath).catch(()=>{})]);
    const notes = [fallbackNote, burnNote].filter(Boolean).join(" ");
    const videoStat = burnedIn ? await fs.stat(outVideoPath).catch(() => null) : null;
    return NextResponse.json({
      ok: true,
      burnedIn,
      fallback: usedFallback,
      note: notes || null,
      text: transcript?.text || null,
      srtUrl: toDownloadUrl(srtPath),
      videoUrl: burnedIn ? toDownloadUrl(outVideoPath) : null,
      duration,
      fileSize: videoStat?.size || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuat auto caption" }, { status: 500 });
  }
}
