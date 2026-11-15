import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureProjectDirs } from "@/lib/storage";
import { isYouTubeUrl, normalizeYouTubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized. Please login." }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const url = normalizeYouTubeUrl(String(body.url || body.youtubeUrl || ""));
    const name = String(body.name || "YouTube AutoClip").slice(0, 120) || "YouTube AutoClip";
    const configIn = (body.config && typeof body.config === "object") ? body.config : {};

    if (!url || !isYouTubeUrl(url)) {
      return NextResponse.json({ error: "URL YouTube tidak valid" }, { status: 400 });
    }

    const config = { ...configIn, youtubeUrl: url, sourceType: "youtube" };
    const project = await prisma.project.create({ data: { userId: user.id, name, status: "WAITING", configJson: JSON.stringify(config), thumbnailStatus: "pending" } as any });
    await ensureProjectDirs(project.id);
    const job = await prisma.job.create({ data: { projectId: project.id, type: "generate", status: "WAITING", stage: "Waiting", progress: 0, payloadJson: JSON.stringify({ youtubeUrl: url, config }) } });

    return NextResponse.json({ ok: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to create YouTube project" }, { status: 500 });
  }
}
