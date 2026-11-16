import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, publicFileUrl } from "@/lib/storage";
import { runProcess } from "@/lib/ffmpeg";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const wm = form.get("watermark");
    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    if (!(wm instanceof File)) return NextResponse.json({ error: "File watermark wajib diunggah" }, { status: 400 });

    const position = String(form.get("position") || "bottom-right");
    const scale = Math.max(0.05, Math.min(0.8, Number(form.get("scale") || 0.18)));
    const opacity = Math.max(0.05, Math.min(1, Number(form.get("opacity") || 0.8)));
    const margin = Math.max(0, Math.min(400, Number(form.get("margin") || 24)));

    const dir = path.join(STORAGE_ROOT, "tools", "watermark", user.id);
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(4).toString("hex");
    const inExt = path.extname(video.name || ".mp4") || ".mp4";
    const wmExt = path.extname(wm.name || ".png") || ".png";
    const inPath = path.join(dir, `in-${id}${inExt}`);
    const wmPath = path.join(dir, `wm-${id}${wmExt}`);
    const outPath = path.join(dir, `out-${id}.mp4`);
    await fs.writeFile(inPath, Buffer.from(await video.arrayBuffer()));
    await fs.writeFile(wmPath, Buffer.from(await wm.arrayBuffer()));

    const xy = position === "top-left" ? `x=${margin}:y=${margin}`
      : position === "top-right" ? `x=W-w-${margin}:y=${margin}`
      : position === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
      : position === "center" ? `x=(W-w)/2:y=(H-h)/2`
      : `x=W-w-${margin}:y=H-h-${margin}`;

    const fc = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm];[0:v][wm]overlay=${xy}:format=auto[v]`;
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const args = ["-y", "-i", inPath, "-i", wmPath, "-filter_complex", fc, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "copy", "-movflags", "+faststart", outPath];
    let r = await runProcess(ff, args);
    if (r.code !== 0) {
      const args2 = ["-y", "-i", inPath, "-i", wmPath, "-filter_complex", fc, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];
      r = await runProcess(ff, args2);
    }
    if (r.code !== 0) throw new Error(`FFmpeg gagal: ${(r.stderr || r.stdout || "").slice(-500)}`);

    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(wmPath).catch(() => {});
    const st = await fs.stat(outPath).catch(() => null);
    return NextResponse.json({ ok: true, fileUrl: publicFileUrl(outPath), fileSize: st?.size || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal memasang watermark" }, { status: 500 });
  }
}
