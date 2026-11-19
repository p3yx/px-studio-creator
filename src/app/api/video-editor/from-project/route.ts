import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureProjectDirs } from "@/lib/storage";
import { probeVideo } from "@/lib/ffmpeg";
import { emptyTimeline } from "@/lib/editor";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const sourceId = String(body.projectId || "").trim();
    if (!sourceId) return NextResponse.json({ ok: false, error: "Project sumber wajib" }, { status: 400 });
    const src = await prisma.project.findFirst({ where: { id: sourceId, userId: user.id }, include: { clips: { orderBy: { startTime: "asc" } } } });
    if (!src) return NextResponse.json({ ok: false, error: "Project tidak ditemukan" }, { status: 404 });

    const paths = src.clips.filter(c => c.status === "completed" && c.outputPath).map(c => ({ path: c.outputPath!, name: c.title || "Clip" }));
    if (!paths.length && src.sourcePath) paths.push({ path: src.sourcePath, name: src.name || "Source" });
    if (!paths.length) return NextResponse.json({ ok: false, error: "Project belum punya hasil/video sumber." }, { status: 400 });

    const project = await prisma.project.create({
      data: { userId: user.id, name: `${src.name || "Project"} — Editor`, type: "editor", status: "DRAFT", configJson: "{}" },
    });
    await ensureProjectDirs(project.id);
    const t = emptyTimeline();
    let cursor = 0;
    for (const p of paths) {
      const meta = await probeVideo(p.path).catch(() => ({ duration: 5, width: 1920, height: 1080 }));
      const dur = Math.max(0.1, Number(meta.duration || 5));
      t.width = meta.width || t.width; t.height = meta.height || t.height;
      t.tracks[0].clips.push({
        id: `c-${Math.random().toString(36).slice(2, 9)}`, name: p.name, path: p.path,
        sourceIn: 0, sourceOut: dur, start: cursor, duration: dur, trackId: "v1", kind: "video",
      });
      cursor += dur;
    }
    t.duration = cursor;
    await prisma.project.update({ where: { id: project.id }, data: {
      sourcePath: paths[0].path, sourceDuration: cursor, sourceWidth: t.width, sourceHeight: t.height,
      configJson: JSON.stringify({ tool: "editor", timeline: t }),
    }});
    return NextResponse.json({ ok: true, projectId: project.id, timeline: t, clips: paths.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuka di editor" }, { status: 500 });
  }
}
