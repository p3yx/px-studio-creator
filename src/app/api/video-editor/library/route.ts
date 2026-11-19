import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicFileUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const clips = await prisma.clip.findMany({
      where: { project: { userId: user.id }, status: "completed", outputPath: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: { id: true, title: true, outputPath: true, duration: true, fileSize: true, projectId: true, project: { select: { name: true } } },
    });
    const audios = await prisma.audioAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: { id: true, name: true, filePath: true, duration: true, fileSize: true, format: true },
    });
    return NextResponse.json({
      ok: true,
      videos: clips.filter(c => c.outputPath).map(c => ({
        id: c.id, name: c.title || c.project?.name || "Clip", path: c.outputPath!,
        url: publicFileUrl(c.outputPath!), duration: Math.max(0.1, Number(c.duration || 0)),
        fileSize: c.fileSize, projectId: c.projectId, projectName: c.project?.name || "",
      })),
      audios: audios.map(a => ({
        id: a.id, name: a.name, path: a.filePath, url: publicFileUrl(a.filePath),
        duration: Math.max(0.1, Number(a.duration || 0)), fileSize: a.fileSize, format: a.format,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal memuat library" }, { status: 500 });
  }
}
