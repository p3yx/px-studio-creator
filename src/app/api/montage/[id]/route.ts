import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

export const runtime = "nodejs";

async function getOwned(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, userId, type: "montage" }, include: { montageAssets: { orderBy: [{ kind: "asc" }, { order: "asc" }, { createdAt: "asc" }] }, jobs: { orderBy: { createdAt: "desc" }, take: 10 }, clips: { orderBy: { createdAt: "desc" } } } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await getOwned(id, user.id);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const assets = project.montageAssets.map(a => ({
      ...a,
      fileUrl: publicFileUrl(a.filePath),
      thumbnailUrl: publicFileUrl(a.thumbnailPath),
    }));
    const outputClip = project.clips.find(c => c.status === "completed" && c.outputPath);
    return NextResponse.json({
      project: {
        ...project,
        outputUrl: publicFileUrl(project.outputPath || outputClip?.outputPath || null),
      },
      assets,
      jobs: project.jobs,
      outputClip: outputClip ? { ...outputClip, downloadUrl: publicFileUrl(outputClip.outputPath) } : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await getOwned(id, user.id);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json();
    const currentConfig = (() => { try { return JSON.parse(project.configJson || "{}"); } catch { return {}; } })();
    const nextConfig = body.config ? { ...currentConfig, ...body.config } : currentConfig;
    const updated = await prisma.project.update({ where: { id }, data: { name: body.name ?? project.name, configJson: JSON.stringify(nextConfig) } });
    // optional asset reorder/trim updates
    if (Array.isArray(body.assets)) {
      for (const a of body.assets) {
        if (!a?.id) continue;
        await prisma.montageAsset.updateMany({ where: { id: a.id, projectId: id }, data: {
          order: typeof a.order === "number" ? a.order : undefined,
          trimStart: typeof a.trimStart === "number" ? a.trimStart : undefined,
          trimEnd: a.trimEnd === null ? null : (typeof a.trimEnd === "number" ? a.trimEnd : undefined),
        } as any });
      }
    }
    return NextResponse.json({ ok: true, project: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
