import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, ensureProjectDirs } from "@/lib/storage";
import { getInpaintingStatus, normalizeRegions } from "@/lib/watermark-remover";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "watermark-remover").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "watermark-remover"; }

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const inpainting = await getInpaintingStatus();
    return NextResponse.json({
      ok: true,
      inpainting,
      methods: [
        { id: "ai_inpainting", label: "AI Inpainting", available: inpainting.configured, note: inpainting.reason },
        { id: "smart_crop", label: "Smart Crop", available: true, note: "Memotong area agar watermark keluar dari frame (dapat mengubah komposisi/aspect)." },
        { id: "soft_blur", label: "Soft Blur", available: true, note: "Menyamarkan/interpolasi area terpilih (FFmpeg delogo). Hasil tergantung background." },
      ],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const method = String(form.get("method") || "soft_blur");
    const name = String(form.get("name") || "Watermark Removed");
    const regionsJson = String(form.get("regions") || "[]");
    const cropRectJson = String(form.get("cropRect") || "");
    const blurStrength = Number(form.get("blurStrength") || 12);
    const band = Number(form.get("delogoBand") || 4);
    const notes = String(form.get("notes") || "");

    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    if (!["ai_inpainting", "smart_crop", "soft_blur"].includes(method)) return NextResponse.json({ error: "Metode tidak valid" }, { status: 400 });

    let regions: any[] = [];
    try { regions = JSON.parse(regionsJson); } catch { regions = []; }
    const normRegions = normalizeRegions(regions);
    if (normRegions.length === 0 && !(method === "smart_crop" && cropRectJson)) {
      return NextResponse.json({ error: "Pilih area watermark (rectangle/mask) terlebih dahulu." }, { status: 400 });
    }

    let cropRect: any = null;
    if (cropRectJson) { try { cropRect = JSON.parse(cropRectJson); } catch { cropRect = null; } }

    if (method === "ai_inpainting") {
      const st = await getInpaintingStatus();
      if (!st.configured) {
        return NextResponse.json({ ok: false, error: "AI Inpainting belum dikonfigurasi di server. " + st.reason, code: "INPAINT_NOT_CONFIGURED", inpainting: st }, { status: 400 });
      }
    }

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: safeName(name).replace(/_/g, " ").slice(0, 80) || "Watermark Removed",
        type: "watermark-remover",
        status: "WAITING",
        sourceFileName: video.name || "video.mp4",
        configJson: JSON.stringify({ tool: "watermark-remover", method, regions: normRegions, cropRect, blurStrength, delogoBand: band, notes }),
      } as any,
    });
    await ensureProjectDirs(project.id);

    const srcDir = path.join(STORAGE_ROOT, "uploads", user.id, project.id);
    await fs.mkdir(srcDir, { recursive: true });
    const videoPath = path.join(srcDir, `source${path.extname(video.name || ".mp4") || ".mp4"}`);
    await fs.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));

    let duration: number | null = null, width: number | null = null, height: number | null = null;
    try { const { probeVideo } = await import("@/lib/ffmpeg"); const info = await probeVideo(videoPath); duration = info.duration || null; width = info.width || null; height = info.height || null; } catch {}
    const vStat = await fs.stat(videoPath).catch(() => null);
    await prisma.project.update({ where: { id: project.id }, data: { sourcePath: videoPath, sourceDuration: duration, sourceWidth: width, sourceHeight: height, sourceSize: vStat?.size || null } as any });

    const payload = { method, regions: normRegions, cropRect, blurStrength, delogoBand: band, notes, name: safeName(name) };
    const job = await prisma.job.create({ data: { projectId: project.id, type: "watermark_remove", status: "WAITING", stage: "Queued", progress: 0, payloadJson: JSON.stringify(payload) } as any });
    try { const { runWorkerLoop } = await import("@/lib/job-worker"); runWorkerLoop().catch(() => {}); } catch {}

    return NextResponse.json({ ok: true, async: true, projectId: project.id, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Watermark removal failed" }, { status: 500 });
  }
}
