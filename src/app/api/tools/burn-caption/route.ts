import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";
import { burnSubtitlesIntoVideo, probeVideo } from "@/lib/ffmpeg";
import { getBrandKit, subtitleForceStyle, loudnormFilter } from "@/lib/brand";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "captioned-video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "captioned-video"; }
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
    const srtFile = form.get("srt");
    const name = String(form.get("name") || "Captioned Video");
    const quality = String(form.get("quality") || "medium") as "high"|"medium"|"fast";
    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    if (!(srtFile instanceof File)) return NextResponse.json({ error: "File SRT wajib diunggah" }, { status: 400 });

    const workDir = path.join(STORAGE_ROOT, "temp", user.id, `burncap-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    const outDir = path.join(STORAGE_ROOT, "auto-captions", user.id);
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const vExt = path.extname(video.name || "") || ".mp4";
    const inputPath = path.join(workDir, `input${vExt}`);
    const srtPath = path.join(workDir, "subs.srt");
    await fs.writeFile(inputPath, Buffer.from(await video.arrayBuffer()));
    await fs.writeFile(srtPath, Buffer.from(await srtFile.arrayBuffer()));

    let duration = 0;
    try { duration = (await probeVideo(inputPath)).duration || 0; } catch {}

    const base = `${Date.now()}-${safeName(name)}`;
    const outVideoPath = path.join(outDir, `${base}-captioned.mp4`);
    const brand = await getBrandKit();
    await burnSubtitlesIntoVideo({
      input: inputPath,
      subtitlePath: srtPath,
      output: outVideoPath,
      quality: quality === "high" || quality === "fast" ? quality : "medium",
      subtitleStyle: subtitleForceStyle(brand),
      watermarkPath: brand.watermarkEnabled ? brand.watermarkPath : null,
      watermarkPosition: brand.watermarkPosition,
      watermarkOpacity: brand.watermarkOpacity,
      watermarkScale: brand.watermarkScale,
      watermarkMargin: brand.watermarkMargin,
      loudnessNormalize: brand.loudnessNormalize,
      loudnessFilter: loudnormFilter(brand),
    });

    const st = await fs.stat(outVideoPath).catch(() => null);
    await Promise.allSettled([fs.unlink(inputPath).catch(()=>{}), fs.unlink(srtPath).catch(()=>{})]);
    return NextResponse.json({ ok: true, videoUrl: toDownloadUrl(outVideoPath), duration, fileSize: st?.size || null, note: "Subtitle berhasil dimasukkan ke video dengan preset Brand Kit." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal burn caption" }, { status: 500 });
  }
}
