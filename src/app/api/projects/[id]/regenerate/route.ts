import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!project.sourcePath) return NextResponse.json({ error: "Source video not found for this project" }, { status: 400 });

    // reset project/clips state and queue a new job
    await prisma.clip.deleteMany({ where: { projectId: id } });
    await prisma.project.update({ where: { id }, data: { status: "WAITING", errorMessage: null } });
    const job = await prisma.job.create({ data: { projectId: id, type: "generate", status: "WAITING", stage: "Waiting", progress: 0, payloadJson: project.configJson } });
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Failed" }, { status: 500 }); }
}