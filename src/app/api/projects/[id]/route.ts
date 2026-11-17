import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";

function toDownloadUrl(absPath: string | null) {
  if (!absPath) return null;
  const rel = path.relative(STORAGE_ROOT, absPath).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return null;
  return `/api/files?path=${encodeURIComponent(rel)}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        clips: { orderBy: { startTime: "asc" } },
        jobs: { orderBy: { createdAt: "desc" }, take: 10 },
        montageAssets: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
      } as any,
    });
    if (!project || project.userId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const p: any = project;
    const enriched = {
      ...p,
      outputUrl: toDownloadUrl(p.outputPath || null),
      clips: (p.clips || []).map((c: any) => ({ ...c, downloadUrl: toDownloadUrl(c.outputPath), subtitleUrl: toDownloadUrl(c.subtitlePath || null) })),
      montageAssets: (p.montageAssets || []).map((a: any) => ({ ...a, fileUrl: toDownloadUrl(a.filePath), thumbnailUrl: toDownloadUrl(a.thumbnailPath) })),
    };
    return NextResponse.json({ project: enriched });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Failed" }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.project.delete({ where: { id } });
    // storage cleanup best-effort
    const { removeProjectStorage } = await import("@/lib/storage");
    await removeProjectStorage(id).catch(()=>{});
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Failed" }, { status: 500 }); }
}