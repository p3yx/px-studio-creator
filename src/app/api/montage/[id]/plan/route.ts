import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { buildMontagePlan } from "@/lib/montage";
import { runTaskChat } from "@/lib/ai-providers";
import { safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findFirst({ where: { id, userId: user.id, type: "montage" }, include: { montageAssets: true } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const existingConfig = (() => { try { return JSON.parse(project.configJson || "{}"); } catch { return {}; } })();
    const config = { ...existingConfig, ...(body.config || {}) };
    const videos = project.montageAssets.filter(a => a.kind === "video").sort((a,b)=>a.order-b.order);
    const music = project.montageAssets.find(a => a.kind === "music") || null;
    if (videos.length === 0) return NextResponse.json({ error: "Add at least one video clip" }, { status: 400 });

    const force = !!body.force || body.regenerate === true;
    if (!force && config.planLocked && existingConfig.plan) {
      return NextResponse.json({ ok: true, plan: existingConfig.plan, config: { ...existingConfig, ...(body.config || {}), plan: existingConfig.plan }, locked: true });
    }

    // apply trims/order overrides if provided
    const overrides = new Map<string, any>((body.assets || []).map((a: any) => [a.id, a]));
    const clips = videos.map(v => {
      const o = overrides.get(v.id) || {};
      return { id: v.id, filePath: v.filePath, duration: v.duration, width: v.width, height: v.height, hasAudio: v.hasAudio, trimStart: o.trimStart ?? v.trimStart ?? 0, trimEnd: o.trimEnd ?? v.trimEnd ?? undefined, order: o.order ?? v.order, name: v.name };
    });

    let plan = await buildMontagePlan({
      clips,
      preset: config.preset || "cinematic",
      aspect: config.aspect || "9:16",
      fps: Number(config.fps || 30),
      mode: config.editMode || "auto",
      customOrder: config.customOrder || clips.sort((a,b)=>(a.order||0)-(b.order||0)).map(c=>c.id),
      musicPath: music?.filePath || null,
      audioMode: config.audioMode || (music ? "mix" : "original"),
      autoBeat: !!config.autoBeat,
    });

    // Deterministic algorithmic plan only — no model calls, no gateway.

    const nextConfig = { ...config, plan };
    await prisma.project.update({ where: { id }, data: { configJson: JSON.stringify(nextConfig) } });
    return NextResponse.json({ ok: true, plan, config: nextConfig });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to generate plan" }, { status: 500 });
  }
}
