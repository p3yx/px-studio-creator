import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        clips: { where: { status: "completed" }, orderBy: { createdAt: "desc" } },
        montageAssets: { where: { kind: "video" }, orderBy: { order: "asc" } },
      },
      take: 50,
    });
    const items = projects.flatMap((p) => {
      if (p.type === "montage") {
        // montage project's own assets not listed as selectable source here except maybe output; skip
        return [];
      }
      return p.clips
        .filter((c) => c.outputPath)
        .map((c) => ({
          id: c.id,
          projectId: p.id,
          projectName: p.name,
          title: c.title,
          duration: c.duration,
          resolution: c.resolution,
          aspectRatio: c.aspectRatio,
          fileUrl: publicFileUrl(c.outputPath),
          outputPath: c.outputPath,
          type: "generated-clip" as const,
        }));
    });
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
