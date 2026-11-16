import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { runProcess, burnSubtitlesIntoVideo, probeVideo } from "@/lib/ffmpeg";
import { clipsDir, tempDir, ensureProjectDirs, STORAGE_ROOT } from "@/lib/storage";
import { transcribeWithTask } from "@/lib/ai-providers";
import { transcriptToSrt } from "@/lib/captions";
import { getBrandKit, subtitleForceStyle, loudnormFilter } from "@/lib/brand";

function toDownloadUrl(absPath: string | null) {
  if (!absPath) return null;
  const rel = path.relative(STORAGE_ROOT, absPath).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return null;
  return `/api/files?path=${encodeURIComponent(rel)}`;
}

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
  // Fallback STT via Python SpeechRecognition (Google Web Speech API) - requires internet.
  // Chunks audio for better reliability and approximate timestamps.
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; clipId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, clipId } = await params;
    const body = await req.json().catch(() => ({} as any));
    const language = typeof body?.language === "string" ? body.language : (typeof body?.lang === "string" ? body.lang : "auto");
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== user.id) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip || clip.projectId !== project.id) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

    await ensureProjectDirs(project.id);
    const input = (clip.outputPath && clip.status === "completed") ? clip.outputPath : project.sourcePath;
    if (!input) return NextResponse.json({ error: "No media source available for transcription" }, { status: 400 });

    const work = tempDir(project.id);
    await fs.mkdir(work, { recursive: true });
    const wavPath = path.join(work, `caption-${clip.id}-${Date.now()}.wav`);

    // extract audio (trim to clip segment when using source video)
    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
    const args: string[] = ["-y"];
    if (input === project.sourcePath) {
      const start = Math.max(0, Number(clip.startTime || 0));
      const dur = Math.max(0.2, Number(clip.duration || (Number(clip.endTime || 0) - start) || 0));
      if (start > 0) args.push("-ss", String(start));
      args.push("-i", input, "-t", String(dur));
    } else {
      args.push("-i", input);
    }
    args.push("-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath);
    const { code, stderr } = await runProcess(ffmpeg, args);
    if (code !== 0) throw new Error(`Audio extraction failed: ${String(stderr || "").slice(-400)}`);

    let transcript: any = null;
    let usedFallback = false;
    let fallbackNote: string | null = null;
    try {
      transcript = await transcribeWithTask("speech_to_text", wavPath, { language });
    } catch (aiErr: any) {
      // Fallback STT (Google Web Speech via Python SpeechRecognition) so auto-caption still works if AI/gateway fails
      try {
        transcript = await transcribeFallbackGoogle(wavPath, Number(clip.duration || 0), language);
        usedFallback = true;
        fallbackNote = "Caption dibuat menggunakan fallback (Google Speech Recognition) karena transkripsi AI gagal.";
      } catch (fbErr: any) {
        const aiMsg = aiErr?.message || "Transkripsi AI gagal";
        const fbMsg = fbErr?.message || "Fallback caption gagal";
        throw new Error(`${aiMsg} (fallback caption gagal: ${fbMsg})`);
      }
    }

    const srt = transcriptToSrt(transcript, Number(clip.duration || 10));
    if (!srt.trim()) throw new Error("Transcription returned empty caption text");

    const outDir = clipsDir(project.id);
    await fs.mkdir(outDir, { recursive: true });
    const srtPath = path.join(outDir, `${clip.id}.srt`);
    await fs.writeFile(srtPath, srt, "utf8");

    // Burn captions directly into the video when possible (so caption tampil di video)
    let burnedIn = false;
    let burnNote: string | null = null;
    let outputPath: string | null = clip.outputPath || null;
    let fileSize: number | null = clip.fileSize ?? null;
    let duration: number | null = clip.duration ?? null;
    const burnTarget = (clip.outputPath && clip.status === "completed") ? clip.outputPath : null;
    if (burnTarget) {
      try {
        await fs.access(burnTarget);
        const ext = path.extname(burnTarget) || ".mp4";
        const base = burnTarget.slice(0, burnTarget.length - ext.length).replace(/-captioned$/i, "");
        const finalOut = `${base}-captioned${ext}`;
        const tmpOut = `${base}-captioned.tmp-${Date.now()}${ext}`;
        const brand = await getBrandKit();
        await burnSubtitlesIntoVideo({
          input: burnTarget,
          subtitlePath: srtPath,
          output: tmpOut,
          quality: "medium",
          subtitleStyle: subtitleForceStyle(brand),
          watermarkPath: brand.watermarkEnabled ? brand.watermarkPath : null,
          watermarkPosition: brand.watermarkPosition,
          watermarkOpacity: brand.watermarkOpacity,
          watermarkScale: brand.watermarkScale,
          watermarkMargin: brand.watermarkMargin,
          loudnessNormalize: brand.loudnessNormalize,
          loudnessFilter: loudnormFilter(brand),
        });
        // Replace captioned output atomically-ish
        await fs.rename(tmpOut, finalOut).catch(async () => { await fs.copyFile(tmpOut, finalOut); await fs.unlink(tmpOut).catch(()=>{}); });
        // Clean up old captioned variants? keep finalOut as current
        const st = await fs.stat(finalOut).catch(() => null);
        fileSize = st?.size ?? fileSize;
        try { const p = await probeVideo(finalOut); duration = p.duration || duration; } catch {}
        outputPath = finalOut;
        burnedIn = true;
        burnNote = "Caption berhasil dibuat dan dimasukkan (burn-in) ke video.";
      } catch (e: any) {
        burnedIn = false;
        burnNote = `Caption (SRT) berhasil dibuat, tetapi gagal dimasukkan ke video: ${String(e?.message || e).slice(0, 220)}. Anda masih bisa mengunduh file SRT.`;
      }
    } else {
      burnNote = "Caption (SRT) berhasil dibuat. Video hasil clip belum tersedia untuk proses burn-in subtitle.";
    }

    const updateData: any = { subtitlePath: srtPath };
    if (burnedIn && outputPath) { updateData.outputPath = outputPath; updateData.fileSize = fileSize; if (duration != null) updateData.duration = duration; }
    await prisma.clip.update({ where: { id: clip.id }, data: updateData });

    await fs.unlink(wavPath).catch(() => {});
    const notes = [fallbackNote, burnNote].filter(Boolean).join(" ");
    return NextResponse.json({ ok: true, subtitlePath: srtPath, subtitleUrl: toDownloadUrl(srtPath), text: transcript?.text || null, fallback: usedFallback, burnedIn, note: notes || null, downloadUrl: toDownloadUrl(outputPath) });
  } catch (e: any) {
    let msg = e?.name === "AbortError" ? "Timeout" : (e?.message || "Failed to generate captions");
    if (/invalid model format/i.test(String(msg || "")) && !/Buka Settings/i.test(msg)) {
      msg = `${msg}. Pastikan model aktif di Settings mendukung transkripsi/speech-to-text dan menggunakan format model yang diterima gateway 9Router.`;
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
