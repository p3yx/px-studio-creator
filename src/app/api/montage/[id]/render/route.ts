import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findFirst({ where: { id, userId: user.id, type: "montage" }, include: { montageAssets: true } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const videos = project.montageAssets.filter(a => a.kind === "video");
    if (videos.length < 1) return NextResponse.json({ error: "Add at least one video clip" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const existingConfig = (() => { try { return JSON.parse(project.configJson || "{}"); } catch { return {}; } })();
    const config = { ...existingConfig, ...(body.config || {}) };
    if (body.plan) config.plan = body.plan;
    await prisma.project.update({ where: { id }, data: { status: "WAITING", errorMessage: null, configJson: JSON.stringify(config) } });

    const job = await prisma.job.create({
      data: {
        projectId: id,
        type: "montage",
        status: "WAITING",
        stage: "Queued",
        progress: 0,
        payloadJson: JSON.stringify({ plan: config.plan || null, config }),
      }
    });
    return NextResponse.json({ ok: true, jobId: job.id, projectId: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to queue render" }, { status: 500 });
  }
}
