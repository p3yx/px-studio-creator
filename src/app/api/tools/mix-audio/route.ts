import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, ensureProjectDirs } from "@/lib/storage";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "video-with-audio").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "video-with-audio"; }

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

    let audioPath: string | null = null;
    if (audio instanceof File && audio.size > 0) {
      // saved after project creation
    } else if (audioAssetId) {
      const asset = await prisma.audioAsset.findFirst({ where: { id: audioAssetId, userId: user.id } });
      if (!asset) return NextResponse.json({ error: "Audio dari library tidak ditemukan" }, { status: 404 });
      audioPath = asset.filePath;
    }
    if (!audioPath && !(audio instanceof File && audio.size > 0)) {
      return NextResponse.json({ error: "File audio wajib diunggah atau pilih dari library" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: safeName(name).replace(/_/g, " ").slice(0, 80) || "Video dengan Suara",
        type: "mix-audio",
        status: "WAITING",
        sourceFileName: video.name || "video.mp4",
        configJson: JSON.stringify({ tool: "mix-audio", mode, musicVolume, originalVolume }),
      } as any,
    });
    await ensureProjectDirs(project.id);

    const srcDir = path.join(STORAGE_ROOT, "uploads", user.id, project.id);
    await fs.mkdir(srcDir, { recursive: true });
    const videoPath = path.join(srcDir, `source${path.extname(video.name || ".mp4") || ".mp4"}`);
    await fs.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));

    if (audio instanceof File && audio.size > 0) {
      const tdir = path.join(STORAGE_ROOT, "temp", project.id);
      await fs.mkdir(tdir, { recursive: true });
      audioPath = path.join(tdir, `audio${path.extname(audio.name || ".mp3") || ".mp3"}`);
      await fs.writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));
    }

    let duration: number | null = null, width: number | null = null, height: number | null = null;
    try {
      const { probeVideo } = await import("@/lib/ffmpeg");
      const info = await probeVideo(videoPath);
      duration = info.duration || null; width = info.width || null; height = info.height || null;
    } catch {}
    const vStat = await fs.stat(videoPath).catch(() => null);
    await prisma.project.update({ where: { id: project.id }, data: { sourcePath: videoPath, sourceDuration: duration, sourceWidth: width, sourceHeight: height, sourceSize: vStat?.size || null } as any });

    const payload = { mode, musicVolume, originalVolume, audioPath, name: safeName(name) };
    const job = await prisma.job.create({
      data: {
        projectId: project.id,
        type: "mix_audio",
        status: "WAITING",
        stage: "Queued",
        progress: 0,
        payloadJson: JSON.stringify(payload),
      } as any,
    });

    try { const { runWorkerLoop } = await import("@/lib/job-worker"); runWorkerLoop().catch(() => {}); } catch {}

    return NextResponse.json({ ok: true, async: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to mix audio" }, { status: 500 });
  }
}
