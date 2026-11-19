import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tempDir } from "@/lib/storage";
import { normalizeTimeline } from "@/lib/editor";
import { safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const p = await prisma.project.findFirst({ where: { id, userId: user.id } });
    if (!p) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    const cfg: any = safeJsonParse(p.configJson, {});
    const timeline = normalizeTimeline(cfg.timeline);
    if (!timeline.tracks.some(tr => tr.type === "video" && tr.clips.length)) {
      return NextResponse.json({ ok: false, error: "Timeline belum memiliki clip video." }, { status: 400 });
    }
    await prisma.job.deleteMany({ where: { projectId: id, status: { in: ["WAITING", "RENDERING"] } } });
    const job = await prisma.job.create({ data: {
      projectId: id, type: "editor", status: "WAITING", stage: "Waiting", progress: 0,
      payloadJson: JSON.stringify({ timeline }),
    }});
    await prisma.project.update({ where: { id }, data: { status: "WAITING", errorMessage: null, outputPath: null } });
    return NextResponse.json({ ok: true, jobId: job.id, projectId: id, workDir: tempDir(id) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal memulai render" }, { status: 500 });
  }
}
