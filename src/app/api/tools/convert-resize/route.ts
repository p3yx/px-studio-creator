import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, ensureProjectDirs } from "@/lib/storage";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "converted-video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "converted-video"; }

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const aspect = String(form.get("aspect") || "16:9");
    const fit = String(form.get("fit") || "pad");
    const quality = String(form.get("quality") || "medium");
    const keepAudio = String(form.get("keepAudio") || "true") !== "false";
    const name = String(form.get("name") || "Converted Video");
    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: safeName(name).replace(/_/g, " ").slice(0, 80) || "Converted Video",
        type: "convert-resize",
        status: "WAITING",
        sourceFileName: video.name || "video.mp4",
        configJson: JSON.stringify({ tool: "convert-resize", aspect, fit, quality, keepAudio }),
      } as any,
    });
    await ensureProjectDirs(project.id);

    const srcDir = path.join(STORAGE_ROOT, "uploads", user.id, project.id);
    await fs.mkdir(srcDir, { recursive: true });
    const videoPath = path.join(srcDir, `source${path.extname(video.name || ".mp4") || ".mp4"}`);
    await fs.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));

    let duration: number | null = null, width: number | null = null, height: number | null = null;
    try { const { probeVideo } = await import("@/lib/ffmpeg"); const info = await probeVideo(videoPath); duration = info.duration || null; width = info.width || null; height = info.height || null; } catch {}
    const vStat = await fs.stat(videoPath).catch(() => null);
    await prisma.project.update({ where: { id: project.id }, data: { sourcePath: videoPath, sourceDuration: duration, sourceWidth: width, sourceHeight: height, sourceSize: vStat?.size || null } as any });

    const payload = { aspect, fit, quality, keepAudio, name: safeName(name) };
    const job = await prisma.job.create({ data: { projectId: project.id, type: "convert_resize", status: "WAITING", stage: "Queued", progress: 0, payloadJson: JSON.stringify(payload) } as any });
    try { const { runWorkerLoop } = await import("@/lib/job-worker"); runWorkerLoop().catch(() => {}); } catch {}

    return NextResponse.json({ ok: true, async: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Convert/resize failed" }, { status: 500 });
  }
}
