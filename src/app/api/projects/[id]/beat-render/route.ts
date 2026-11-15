import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findFirst({ where: { id, userId: user.id } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (String((project as any).type) !== "auto-beat") return NextResponse.json({ error: "Project bukan auto-beat" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const existingConfig = (() => { try { return JSON.parse((project as any).configJson || "{}"); } catch { return {}; } })();
    const plan = body.plan || existingConfig.plan;
    if (!plan || !Array.isArray(plan.cuts) || plan.cuts.length < 2) {
      return NextResponse.json({ error: "Plan auto-beat tidak valid atau tidak ditemukan" }, { status: 400 });
    }
    const audioPath = body.audioPath || existingConfig.audioPath;
    if (!project.sourcePath) return NextResponse.json({ error: "Source video project tidak ditemukan" }, { status: 400 });
    if (!audioPath) return NextResponse.json({ error: "Audio/musik project tidak ditemukan. Buat ulang dari Auto Beat." }, { status: 400 });

    const mode = String(body.mode || existingConfig.mode || "replace");
    const musicVolume = Math.max(0, Math.min(2, Number(body.musicVolume ?? existingConfig.musicVolume ?? 1)));
    const originalVolume = Math.max(0, Math.min(2, Number(body.originalVolume ?? existingConfig.originalVolume ?? 0.8)));
    const name = String(body.name || existingConfig.name || project.name || "Auto Beat").slice(0, 80);
    const planLocked = body.planLocked === false ? false : true;

    const nextConfig = { ...existingConfig, plan, mode, musicVolume, originalVolume, audioPath, name, planLocked, tool: "auto-beat" };
    await prisma.project.update({ where: { id }, data: { status: "WAITING", errorMessage: null, configJson: JSON.stringify(nextConfig), name } as any });

    const payload = { plan, mode, musicVolume, originalVolume, audioPath, name };
    const job = await prisma.job.create({ data: { projectId: id, type: "beat_sync", status: "WAITING", stage: "Queued", progress: 0, payloadJson: JSON.stringify(payload) } as any });
    try { const { runWorkerLoop } = await import("@/lib/job-worker"); runWorkerLoop().catch(() => {}); } catch {}

    return NextResponse.json({ ok: true, async: true, projectId: id, jobId: job.id, config: nextConfig });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal requeue auto-beat" }, { status: 500 });
  }
}
