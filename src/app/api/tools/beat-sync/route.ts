import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, ensureProjectDirs } from "@/lib/storage";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "autobeat-video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "autobeat-video"; }

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const audio = form.get("audio");
    const audioAssetId = String(form.get("audioAssetId") || "");
    const mode = String(form.get("mode") || "replace"); // mix | replace | music
    const musicVolume = Math.max(0, Math.min(2, Number(form.get("musicVolume") || 1)));
    const originalVolume = Math.max(0, Math.min(2, Number(form.get("originalVolume") || 0.8)));
    const name = String(form.get("name") || "Auto Beat Video");
    let plan: any = null;
    try { plan = JSON.parse(String(form.get("plan") || "null")); } catch { plan = null; }

    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    if (!plan || !Array.isArray(plan.cuts) || plan.cuts.length < 2) return NextResponse.json({ error: "Sync plan tidak valid. Jalankan Auto Sync terlebih dahulu." }, { status: 400 });

    // Resolve audio source path (copy library audio to job work dir later? keep ref if stable)
    let audioPath: string | null = null;
    let audioTempPath: string | null = null;
    if (audio instanceof File && audio.size > 0) {
      // will be saved under project temp after project creation
      audioTempPath = "__upload__"; // marker
    } else if (audioAssetId) {
      const asset = await prisma.audioAsset.findFirst({ where: { id: audioAssetId, userId: user.id } });
      if (!asset) return NextResponse.json({ error: "Audio dari library tidak ditemukan" }, { status: 404 });
      audioPath = asset.filePath;
    }
    if (!audioPath && !audioTempPath) return NextResponse.json({ error: "Audio/musik diperlukan untuk Auto Beat" }, { status: 400 });

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: safeName(name).replace(/_/g, " ").slice(0, 80) || "Auto Beat Video",
        type: "auto-beat",
        status: "WAITING",
        sourceFileName: video.name || "video.mp4",
        configJson: JSON.stringify({ tool: "auto-beat", mode, musicVolume, originalVolume, planPreset: plan.preset || null, plan, planLocked: true }),
      } as any,
    });
    await ensureProjectDirs(project.id);

    // Save uploaded video as project source
    const srcDir = path.join(STORAGE_ROOT, "uploads", user.id, project.id);
    await fs.mkdir(srcDir, { recursive: true });
    const videoPath = path.join(srcDir, `source${path.extname(video.name || ".mp4") || ".mp4"}`);
    await fs.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));

    // Save uploaded audio into project temp if provided
    if (audio instanceof File && audio.size > 0) {
      const tdir = path.join(STORAGE_ROOT, "temp", project.id);
      await fs.mkdir(tdir, { recursive: true });
      audioPath = path.join(tdir, `music${path.extname(audio.name || ".mp3") || ".mp3"}`);
      await fs.writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));
    }

    // probe source for metadata (best effort)
    let duration: number | null = null, width: number | null = null, height: number | null = null;
    try {
      const { probeVideo } = await import("@/lib/ffmpeg");
      const info = await probeVideo(videoPath);
      duration = info.duration || null; width = info.width || null; height = info.height || null;
    } catch {}
    const vStat = await fs.stat(videoPath).catch(() => null);
    await prisma.project.update({ where: { id: project.id }, data: { sourcePath: videoPath, sourceDuration: duration, sourceWidth: width, sourceHeight: height, sourceSize: vStat?.size || null } as any });

    const payload = { plan, mode, musicVolume, originalVolume, audioPath, name: safeName(name) };
    const job = await prisma.job.create({
      data: {
        projectId: project.id,
        type: "beat_sync",
        status: "WAITING",
        stage: "Queued",
        progress: 0,
        payloadJson: JSON.stringify(payload),
      } as any,
    });

    // ensure worker is running in dev/server runtime (idempotent guard inside)
    try { const { runWorkerLoop } = await import("@/lib/job-worker"); runWorkerLoop().catch(() => {}); } catch {}

    return NextResponse.json({ ok: true, async: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Beat sync failed" }, { status: 500 });
  }
}
