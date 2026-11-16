import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { saveUploadedFile, ensureProjectDirs, projectDir } from "@/lib/storage";
import { probeVideo } from "@/lib/ffmpeg";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findFirst({ where: { id, userId: user.id, type: "montage" } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files").filter(Boolean) as File[];
      const kind = String(form.get("kind") || "video");
      if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
      await ensureProjectDirs(id);
      const created: any[] = [];
      const existingCount = await prisma.montageAsset.count({ where: { projectId: id, kind } });
      let i = 0;
      for (const file of files) {
        const saved = await saveUploadedFile(id, file, "source");
        let info: any = {};
        try { info = await probeVideo(saved.path); } catch {}
        const hasAudio = Array.isArray(info?.raw?.streams) ? info.raw.streams.some((s: any) => s.codec_type === "audio") : true;
        const asset = await prisma.montageAsset.create({
          data: {
            projectId: id,
            kind: kind === "music" ? "music" : "video",
            name: file.name,
            filePath: saved.path,
            duration: info.duration || null,
            width: info.width || null,
            height: info.height || null,
            fileSize: saved.size || info.size || null,
            hasAudio,
            order: kind === "music" ? 0 : existingCount + i,
            trimStart: 0,
            trimEnd: info.duration || null,
          }
        });
        created.push(asset);
        i++;
      }
      return NextResponse.json({ ok: true, assets: created });
    }

    // JSON: add existing generated clip as montage source (copy path reference)
    const body = await req.json();
    if (body.sourceClipId) {
      const clip = await prisma.clip.findFirst({ where: { id: String(body.sourceClipId), status: "completed", outputPath: { not: null } }, include: { project: true } });
      if (!clip || !clip.outputPath || clip.project.userId !== user.id) return NextResponse.json({ error: "Source clip not found" }, { status: 404 });
      const existingCount = await prisma.montageAsset.count({ where: { projectId: id, kind: "video" } });
      let info: any = {}; try { info = await probeVideo(clip.outputPath); } catch {}
      const asset = await prisma.montageAsset.create({
        data: {
          projectId: id,
          kind: "video",
          name: clip.title || path.basename(clip.outputPath),
          filePath: clip.outputPath,
          duration: clip.duration || info.duration || null,
          width: info.width || null,
          height: info.height || null,
          fileSize: clip.fileSize || info.size || null,
          hasAudio: true,
          order: existingCount,
          trimStart: 0,
          trimEnd: clip.duration || info.duration || null,
          metaJson: JSON.stringify({ sourceClipId: clip.id, sourceProjectId: clip.projectId }),
        }
      });
      return NextResponse.json({ ok: true, asset });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to add assets" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("assetId");
    if (!assetId) return NextResponse.json({ error: "assetId required" }, { status: 400 });
    const project = await prisma.project.findFirst({ where: { id, userId: user.id, type: "montage" } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.montageAsset.deleteMany({ where: { id: assetId, projectId: id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
