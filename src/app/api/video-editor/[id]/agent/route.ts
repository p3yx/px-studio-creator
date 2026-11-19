import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeTimeline } from "@/lib/editor";
import { safeJsonParse } from "@/lib/utils";
import { runEditorAgent } from "@/lib/editor-agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const command = String(body.command || "").trim();
    if (!command) return NextResponse.json({ ok: false, error: "Perintah kosong" }, { status: 400 });
    const p = await prisma.project.findFirst({ where: { id, userId: user.id } });
    if (!p) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    const cfg: any = safeJsonParse(p.configJson, {});
    const timeline = normalizeTimeline(cfg.timeline);
    const result = await runEditorAgent(command, timeline);
    cfg.timeline = result.timeline;
    await prisma.project.update({ where: { id }, data: { configJson: JSON.stringify(cfg) } });
    return NextResponse.json({ ok: true, timeline: result.timeline, notes: result.notes, ops: result.ops, source: result.source });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Agent gagal" }, { status: 500 });
  }
}
