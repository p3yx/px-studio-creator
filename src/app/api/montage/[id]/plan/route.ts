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
    const config = (() => { try { return { ...JSON.parse(project.configJson || "{}"), ...(body.config || {}) }; } catch { return body.config || {}; } })();
    const videos = project.montageAssets.filter(a => a.kind === "video").sort((a,b)=>a.order-b.order);
    const music = project.montageAssets.find(a => a.kind === "music") || null;
    if (videos.length === 0) return NextResponse.json({ error: "Add at least one video clip" }, { status: 400 });

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

    // Best-effort AI enhancement via task routing (editing_plan). Falls back silently to algorithmic plan.
    try {
      const prompt = String(config.prompt || "").trim();
      const clipInfo = clips.map(c => ({ id: c.id, name: c.name || c.id, duration: c.duration || null, trimStart: c.trimStart || 0, trimEnd: c.trimEnd || null }));
      const aiPrompt = `Buat rencana editing montage (JSON saja) untuk project video.\nConfig: ${JSON.stringify({ preset: plan.preset, aspect: plan.aspect, fps: plan.fps, audioMode: config.audioMode || "original", prompt: prompt || null })}\nClips: ${JSON.stringify(clipInfo)}\nKembalikan JSON: {"notes":["..."],"preferredOrder":[clipId,...],"pacing":"...","transitionStyle":"..."}. Jangan ubah struktur render lain.`;
      const resp = await runTaskChat("editing_plan", [
        { role: "system", content: "You are a video editing planner. Return strict JSON only." },
        { role: "user", content: aiPrompt },
      ], { temperature: 0.2, json: true });
      const content = resp?.choices?.[0]?.message?.content || "{}";
      const parsed = typeof content === "string" ? safeJsonParse<any>(content, {}) : content;
      const notes: string[] = Array.isArray(parsed?.notes) ? parsed.notes.filter((n: any) => typeof n === "string").slice(0, 6) : [];
      if (notes.length) plan = { ...plan, notes: [...(plan.notes || []), ...notes] };
      // apply preferred order if valid and mode auto
      const pref = Array.isArray(parsed?.preferredOrder) ? parsed.preferredOrder.filter((x: any) => clips.some(c => c.id === x)) : [];
      if (pref.length && (config.editMode || "auto") === "auto") {
        const reordered = await buildMontagePlan({
          clips,
          preset: config.preset || "cinematic",
          aspect: config.aspect || "9:16",
          fps: Number(config.fps || 30),
          mode: "custom",
          customOrder: [...pref, ...clips.map(c=>c.id).filter(id => !pref.includes(id))],
          musicPath: music?.filePath || null,
          audioMode: config.audioMode || (music ? "mix" : "original"),
          autoBeat: !!config.autoBeat,
        });
        plan = { ...reordered, notes: plan.notes };
      }
    } catch {}

    const nextConfig = { ...config, plan };
    await prisma.project.update({ where: { id }, data: { configJson: JSON.stringify(nextConfig) } });
    return NextResponse.json({ ok: true, plan, config: nextConfig });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to generate plan" }, { status: 500 });
  }
}
