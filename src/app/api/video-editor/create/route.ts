import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureProjectDirs, saveUploadedFile, publicFileUrl } from "@/lib/storage";
import { probeVideo } from "@/lib/ffmpeg";
import { emptyTimeline, normalizeTimeline } from "@/lib/editor";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    const name = String(form.get("name") || "").trim() || file.name.replace(/\.[^.]+$/, "") || "Video Editor Project";

    const project = await prisma.project.create({
      data: { userId: user.id, name, type: "editor", status: "DRAFT", configJson: "{}" },
    });
    await ensureProjectDirs(project.id);
    const saved = await saveUploadedFile(project.id, file);
    const meta = await probeVideo(saved.path).catch(() => ({ duration: 0, width: 1920, height: 1080 }));
    const dur = Math.max(0.1, Number(meta.duration || 10));
    const t = emptyTimeline();
    t.width = meta.width || 1920;
    t.height = meta.height || 1080;
    t.duration = dur;
    t.tracks[0].clips.push({
      id: `c-${Date.now().toString(36)}`,
      name: file.name,
      path: saved.path,
      sourceIn: 0,
      sourceOut: dur,
      start: 0,
      duration: dur,
      trackId: "v1",
      kind: "video",
    });
    await prisma.project.update({ where: { id: project.id }, data: {
      sourcePath: saved.path, sourceDuration: dur, sourceWidth: t.width, sourceHeight: t.height,
      configJson: JSON.stringify({ tool: "editor", timeline: t }),
    }});
    return NextResponse.json({ ok: true, projectId: project.id, previewUrl: publicFileUrl(saved.path), timeline: t });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuat project editor" }, { status: 500 });
  }
}
