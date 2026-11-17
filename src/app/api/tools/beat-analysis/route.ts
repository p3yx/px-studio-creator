import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STORAGE_ROOT } from "@/lib/storage";
import { runProcess } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function safeBase(s: string) { return String(s || "audio").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "audio"; }

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const contentType = req.headers.get("content-type") || "";
    let audioPath: string | null = null;
    let cleanupPaths: string[] = [];
    let sourceLabel = "audio";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") || form.get("audio");
      const videoFile = form.get("video");
      const audioAssetId = String(form.get("audioAssetId") || "");
      const tmpDir = path.join(os.tmpdir(), `px-beat-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
      await fs.mkdir(tmpDir, { recursive: true });

      if (file instanceof File && file.size > 0) {
        audioPath = path.join(tmpDir, safeBase(file.name || "audio") + path.extname(file.name || ".mp3"));
        await fs.writeFile(audioPath, Buffer.from(await file.arrayBuffer()));
        cleanupPaths.push(tmpDir);
        sourceLabel = file.name || "audio";
      } else if (audioAssetId) {
        const asset = await prisma.audioAsset.findFirst({ where: { id: audioAssetId, userId: user.id } });
        if (!asset) return NextResponse.json({ error: "Audio dari library tidak ditemukan" }, { status: 404 });
        audioPath = asset.filePath;
        sourceLabel = asset.name || "library-audio";
      } else if (videoFile instanceof File && videoFile.size > 0) {
        const vPath = path.join(tmpDir, safeBase(videoFile.name || "video") + path.extname(videoFile.name || ".mp4"));
        await fs.writeFile(vPath, Buffer.from(await videoFile.arrayBuffer()));
        audioPath = vPath;
        cleanupPaths.push(tmpDir);
        sourceLabel = videoFile.name || "video-audio";
      } else {
        return NextResponse.json({ error: "File audio/video atau audioAssetId diperlukan" }, { status: 400 });
      }
    } else {
      const body = await req.json().catch(() => ({}));
      const audioAssetId = String(body.audioAssetId || "");
      if (audioAssetId) {
        const asset = await prisma.audioAsset.findFirst({ where: { id: audioAssetId, userId: user.id } });
        if (!asset) return NextResponse.json({ error: "Audio dari library tidak ditemukan" }, { status: 404 });
        audioPath = asset.filePath;
        sourceLabel = asset.name || "library-audio";
      } else if (body.filePath) {
        // Only allow paths under storage for safety
        const rel = String(body.filePath);
        const abs = path.isAbsolute(rel) ? rel : path.join(STORAGE_ROOT, rel);
        const norm = path.normalize(abs);
        if (!norm.startsWith(path.normalize(STORAGE_ROOT))) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
        audioPath = norm;
      } else {
        return NextResponse.json({ error: "audioAssetId atau file diperlukan" }, { status: 400 });
      }
    }

    if (!audioPath) return NextResponse.json({ error: "Audio tidak ditemukan" }, { status: 400 });

    const tmpDir = path.join(os.tmpdir(), `px-beat-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    await fs.mkdir(tmpDir, { recursive: true });
    cleanupPaths.push(tmpDir);
    const wavPath = path.join(tmpDir, "analysis.wav");
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    // Extract/convert to mono 16k wav for analysis
    const ex = await runProcess(ff, ["-y", "-i", audioPath, "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", wavPath]);
    if (ex.code !== 0) {
      throw new Error(`Gagal mengekstrak audio untuk analisis: ${(ex.stderr || "").slice(-400)}`);
    }

    const script = path.join(process.cwd(), "src", "lib", "beat", "beat_analyze.py");
    let r = await runProcess("py", ["-3", script, wavPath]);
    if (r.code !== 0 && !String(r.stdout || "").trim()) {
      r = await runProcess("python", [script, wavPath]);
    }
    const out = String(r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
    let data: any = {};
    try { data = JSON.parse(out); } catch { data = { error: "Gagal mem-parsing hasil analisis", raw: out.slice(-300) }; }
    if (data && data.error) {
      throw new Error(String(data.error));
    }

    // cleanup temp dirs
    await Promise.allSettled(cleanupPaths.map(p => fs.rm(p, { recursive: true, force: true }).catch(() => {})));

    return NextResponse.json({ ok: true, source: sourceLabel, ...data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Beat analysis failed" }, { status: 500 });
  }
}
