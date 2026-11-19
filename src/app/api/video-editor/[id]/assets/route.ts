import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureProjectDirs, saveUploadedFile, publicFileUrl } from "@/lib/storage";
import { probeVideo } from "@/lib/ffmpeg";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const p = await prisma.project.findFirst({ where: { id, userId: user.id } });
    if (!p) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "File wajib diunggah" }, { status: 400 });
    await ensureProjectDirs(id);
    const saved = await saveUploadedFile(id, file);
    const isAudio = file.type.startsWith("audio/");
    const meta = isAudio ? { duration: 30 } : await probeVideo(saved.path).catch(() => ({ duration: 10 }));
    return NextResponse.json({
      ok: true,
      path: saved.path,
      url: publicFileUrl(saved.path),
      name: file.name,
      kind: isAudio ? "audio" : "video",
      duration: Math.max(0.1, Number(meta.duration || 10)),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal upload" }, { status: 500 });
  }
}
