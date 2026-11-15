import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";
import { runProcess, probeVideo } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "video-with-audio").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "video-with-audio"; }

async function saveUpload(file: File, dir: string, prefix: string) {
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(file.name || "") || (file.type.startsWith("audio/") ? ".mp3" : ".mp4");
  const p = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${prefix}${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(p, buf);
  return p;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const audio = form.get("audio");
    const audioAssetId = String(form.get("audioAssetId") || "");
    const mode = String(form.get("mode") || "mix"); // mix | replace | music
    const musicVolume = Math.max(0, Math.min(2, Number(form.get("musicVolume") || 1)));
    const originalVolume = Math.max(0, Math.min(2, Number(form.get("originalVolume") || 0.8)));
    const name = String(form.get("name") || "Video dengan Suara");

    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });

    const workDir = path.join(STORAGE_ROOT, "temp", user.id, `mix-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    await fs.mkdir(workDir, { recursive: true });

    const videoPath = await saveUpload(video, workDir, "video");
    let audioPath: string | null = null;

    if (audio instanceof File && audio.size > 0) {
      audioPath = await saveUpload(audio, workDir, "audio");
    } else if (audioAssetId) {
      const asset = await prisma.audioAsset.findFirst({ where: { id: audioAssetId, userId: user.id } });
      if (!asset) return NextResponse.json({ error: "Audio dari library tidak ditemukan" }, { status: 404 });
      audioPath = asset.filePath;
    }

    if (!audioPath) return NextResponse.json({ error: "File audio wajib diunggah atau pilih dari library" }, { status: 400 });

    const outDir = path.join(STORAGE_ROOT, "audio-mix", user.id);
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${Date.now()}-${safeName(name)}.mp4`);
    const ff = process.env.FFMPEG_PATH || "ffmpeg";

    let args: string[];
    if (mode === "replace" || mode === "music") {
      // Replace original audio with provided audio (trim/loop to shortest/end handling via -shortest)
      args = ["-y", "-i", videoPath, "-stream_loop", "-1", "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
      let r = await runProcess(ff, args);
      if (r.code !== 0) {
        // fallback: re-encode video if stream copy incompatible
        args = ["-y", "-i", videoPath, "-stream_loop", "-1", "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
        r = await runProcess(ff, args);
        if (r.code !== 0) throw new Error(`Gagal merender video: ${r.stderr.slice(-500)}`);
      }
    } else {
      // Mix: keep original audio and mix with provided audio
      // If video has no audio stream, amix may fail; try and fallback to replace
      const filter = `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${originalVolume}[a0];[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      args = ["-y", "-i", videoPath, "-stream_loop", "-1", "-i", audioPath, "-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
      let r = await runProcess(ff, args);
      if (r.code !== 0) {
        // fallback: re-encode or replace if no original audio
        args = ["-y", "-i", videoPath, "-stream_loop", "-1", "-i", audioPath, "-filter_complex", `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${musicVolume}[aout]`, "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
        r = await runProcess(ff, args);
        if (r.code !== 0) throw new Error(`Gagal merender video: ${r.stderr.slice(-500)}`);
      }
    }

    let duration: number | null = null;
    try { duration = (await probeVideo(outPath)).duration || null; } catch {}
    const st = await fs.stat(outPath).catch(() => null);
    const rel = path.relative(STORAGE_ROOT, outPath).replace(/\\/g, "/");

    // cleanup temp uploads (keep library audio file)
    await Promise.allSettled([videoPath].map(p => fs.unlink(p).catch(() => {})));
    if (audio instanceof File && audioPath) await fs.unlink(audioPath).catch(() => {});

    return NextResponse.json({ ok: true, fileUrl: `/api/files?path=${encodeURIComponent(rel)}`, duration, fileSize: st?.size || null, name });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to mix audio" }, { status: 500 });
  }
}
