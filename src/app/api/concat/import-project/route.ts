import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STORAGE_ROOT } from "@/lib/storage";
import { concatCallTool, concatRoot } from "@/lib/concat-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "Project ID wajib" }, { status: 400 });
    const src = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, include: { clips: { orderBy: { startTime: "asc" } } } });
    if (!src) return NextResponse.json({ ok: false, error: "Project tidak ditemukan" }, { status: 404 });
    const files = src.clips.filter(c => c.status === "completed" && c.outputPath).map(c => c.outputPath!);
    if (!files.length && src.sourcePath) files.push(src.sourcePath);
    if (!files.length) return NextResponse.json({ ok: false, error: "Project belum punya hasil render." }, { status: 400 });

    const location = concatRoot();
    await fs.mkdir(location, { recursive: true });
    const name = `px-${Date.now().toString(36)}`;
    const created: any = await concatCallTool("project_create", { location, name, video: { width: 1920, height: 1080, rateNum: 30, rateDen: 1 } });
    const projectPath = path.join(location, name);
    const media: string[] = [];
    for (const file of files) {
      const r: any = await concatCallTool("media_import", { path: projectPath, file });
      const id = r?.createdId || r?.id || r?.mediaId;
      if (id) media.push(String(id));
    }
    if (!media.length) {
      const state: any = await concatCallTool("timeline_read", { path: projectPath });
      const ids = (state?.media || state?.project?.media || []).map((m: any) => m.id).filter(Boolean);
      media.push(...ids.map(String));
    }
    let cursor = 0;
    for (const mediaId of media) {
      await concatCallTool("clip_add", { path: projectPath, mediaId, trackId: "T1", start: cursor, ripple: true });
      cursor += 5;
    }
    await concatCallTool("project_save", { path: projectPath });
    return NextResponse.json({ ok: true, concatProject: projectPath, media: media.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal import ke Concat" }, { status: 500 });
  }
}
