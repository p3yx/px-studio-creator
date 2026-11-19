import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicFileUrl } from "@/lib/storage";
import { normalizeTimeline } from "@/lib/editor";
import { safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";

function withUrls(timeline: any) {
  const t = normalizeTimeline(timeline);
  return {
    ...t,
    tracks: t.tracks.map(tr => ({
      ...tr,
      clips: tr.clips.map(c => ({ ...c, url: publicFileUrl(c.path) })),
    })),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const p = await prisma.project.findFirst({ where: { id, userId: user.id }, include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } } });
    if (!p) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    const cfg: any = safeJsonParse(p.configJson, {});
    return NextResponse.json({
      ok: true,
      project: { id: p.id, name: p.name, status: p.status },
      timeline: withUrls(cfg.timeline),
      job: p.jobs[0] ? { status: p.jobs[0].status, stage: p.jobs[0].stage, progress: p.jobs[0].progress, error: p.jobs[0].error } : null,
      outputUrl: publicFileUrl(p.outputPath),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal memuat" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const p = await prisma.project.findFirst({ where: { id, userId: user.id } });
    if (!p) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    const cfg: any = safeJsonParse(p.configJson, {});
    const timeline = normalizeTimeline(body.timeline || cfg.timeline);
    // Strip client-only URL fields before persisting.
    timeline.tracks = timeline.tracks.map(tr => ({ ...tr, clips: tr.clips.map(c => ({ ...c, url: undefined })) })) as any;
    cfg.timeline = timeline;
    await prisma.project.update({ where: { id }, data: {
      configJson: JSON.stringify(cfg),
      name: body.name ? String(body.name).slice(0, 120) : p.name,
    }});
    return NextResponse.json({ ok: true, timeline: withUrls(timeline) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal menyimpan" }, { status: 500 });
  }
}
