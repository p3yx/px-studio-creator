import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureProjectDirs } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "AI Montage Project").slice(0, 120);
    const config = body.config || { preset: "cinematic", aspect: "9:16", fps: 30, editMode: "auto", audioMode: "mix" };
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name,
        type: "montage",
        status: "DRAFT",
        configJson: JSON.stringify(config),
      },
    });
    await ensureProjectDirs(project.id);
    return NextResponse.json({ ok: true, projectId: project.id, project });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to create montage project" }, { status: 500 });
  }
}
