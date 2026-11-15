import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureProjectDirs, saveUploadedFile, tempDir } from "@/lib/storage";
import { probeVideo, generateThumbnail } from "@/lib/ffmpeg";
import { safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized. Please login." }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const name = String(form.get("name") || "Untitled Project");
    const config = safeJsonParse(String(form.get("config") || "{}"), {} as any);
    if (!file) return NextResponse.json({ error: "Video file is required" }, { status: 400 });

    const allowed = ["video/mp4","video/x-matroska","video/quicktime","video/webm","application/octet-stream"];
    const ext = path.extname(file.name).toLowerCase();
    if (!allowed.includes(file.type) && ![".mp4",".mkv",".mov",".webm"].includes(ext)) {
      return NextResponse.json({ error: "Unsupported video format" }, { status: 400 });
    }

    const project = await prisma.project.create({ data: { userId: user.id, name, status: "UPLOADED", configJson: JSON.stringify(config), thumbnailStatus: "pending" } as any });
    await ensureProjectDirs(project.id);
    const saved = await saveUploadedFile(project.id, file);

    let duration: number | null = null, width: number | null = null, height: number | null = null;
    try {
      const info = await probeVideo(saved.path);
      duration = info.duration || null; width = info.width; height = info.height;
    } catch {}

    let thumbnailPath: string | null = null;
    let thumbnailTimestamp: number | null = null;
    let thumbnailStatus = "failed";
    try {
      const at = duration && duration > 2 ? Math.min(1.5, Math.max(0.5, duration * 0.1)) : 0.5;
      thumbnailTimestamp = at;
      const thumbPath = path.join(tempDir(project.id), "thumbnail.jpg");
      await generateThumbnail(saved.path, thumbPath, at);
      await fs.access(thumbPath);
      thumbnailPath = thumbPath;
      thumbnailStatus = "ready";
    } catch {}

    await prisma.project.update({ where: { id: project.id }, data: { sourceFileName: file.name, sourcePath: saved.path, sourceSize: saved.size, sourceDuration: duration, sourceWidth: width, sourceHeight: height, thumbnailPath, thumbnailTimestamp, thumbnailStatus, thumbnailGeneratedAt: thumbnailStatus === "ready" ? new Date() : null, status: "WAITING" } as any });
    const job = await prisma.job.create({ data: { projectId: project.id, type: "generate", status: "WAITING", stage: "Waiting", progress: 0, payloadJson: JSON.stringify(config) } });

    return NextResponse.json({ ok: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to create project" }, { status: 500 });
  }
}