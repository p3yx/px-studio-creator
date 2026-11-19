import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureProjectDirs, saveUploadedFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const prompt = String(form.get("prompt") || "").trim();
    const name = String(form.get("name") || "").trim() || "AI Video";
    const aspect = ["9:16", "16:9", "1:1"].includes(String(form.get("aspect"))) ? String(form.get("aspect")) : "9:16";
    const secondsPerImage = Math.max(1.5, Math.min(10, Number(form.get("secondsPerImage") || 3)));
    const music = String(form.get("music") || "1") === "1";
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return NextResponse.json({ error: "Pilih minimal satu gambar atau video." }, { status: 400 });

    const project = await prisma.project.create({
      data: { userId: user.id, name, type: "ai-video", status: "WAITING", configJson: "{}" },
    });
    await ensureProjectDirs(project.id);

    const images: string[] = [];
    let videoPath: string | null = null;
    for (const file of files) {
      const saved = await saveUploadedFile(project.id, file);
      if (file.type.startsWith("image/")) images.push(saved.path);
      else if (file.type.startsWith("video/")) videoPath = videoPath || saved.path;
    }
    if (!images.length && !videoPath) {
      await prisma.project.delete({ where: { id: project.id } });
      return NextResponse.json({ error: "Format harus gambar atau video." }, { status: 400 });
    }

    const config = { prompt, name, aspect, secondsPerImage, music, images, videoPath };
    await prisma.project.update({ where: { id: project.id }, data: { configJson: JSON.stringify(config) } });
    await prisma.clip.create({
      data: {
        projectId: project.id,
        title: name,
        description: `Dibuat dari prompt: ${prompt.slice(0, 200)}`,
        startTime: 0,
        endTime: images.length * secondsPerImage,
        duration: images.length * secondsPerImage,
        status: "pending",
        aspectRatio: aspect,
      },
    });
    const job = await prisma.job.create({
      data: { projectId: project.id, type: "ai_video", status: "WAITING", stage: "Waiting", progress: 0, payloadJson: JSON.stringify(config) },
    });
    return NextResponse.json({ ok: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuat video" }, { status: 500 });
  }
}
