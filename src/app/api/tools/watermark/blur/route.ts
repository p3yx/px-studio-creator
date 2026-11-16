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
    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    const x = Math.max(0, Math.min(95, Number(form.get("x") || 70))) / 100;
    const y = Math.max(0, Math.min(95, Number(form.get("y") || 80))) / 100;
    const w = Math.max(1, Math.min(100, Number(form.get("w") || 25))) / 100;
    const h = Math.max(1, Math.min(100, Number(form.get("h") || 12))) / 100;
    const blur = Math.max(5, Math.min(60, Number(form.get("blur") || 20)));

    const dir = path.join(STORAGE_ROOT, "tools", "watermark", user.id);
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(4).toString("hex");
    const inExt = path.extname(video.name || ".mp4") || ".mp4";
    const inPath = path.join(dir, `in-${id}${inExt}`);
    const outPath = path.join(dir, `blur-${id}.mp4`);
    await fs.writeFile(inPath, Buffer.from(await video.arrayBuffer()));

    // soft blur region: crop region, boxblur, overlay back
    const vf = `split[base][tmp];[tmp]crop=iw*${w.toFixed(4)}:ih*${h.toFixed(4)}:iw*${x.toFixed(4)}:ih*${y.toFixed(4)},boxblur=${blur}:1[blurred];[base][blurred]overlay=iw*${x.toFixed(4)}:ih*${y.toFixed(4)}`;
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const args = ["-y", "-i", inPath, "-filter_complex", vf, "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "copy", "-movflags", "+faststart", outPath];
    let r = await runProcess(ff, args);
    if (r.code !== 0) {
      // retry with audio re-encode
      const args2 = ["-y", "-i", inPath, "-filter_complex", vf, "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];
      r = await runProcess(ff, args2);
    }
    if (r.code !== 0) throw new Error(`FFmpeg gagal: ${(r.stderr || r.stdout || "").slice(-500)}`);

    await fs.unlink(inPath).catch(() => {});
    const st = await fs.stat(outPath).catch(() => null);
    return NextResponse.json({ ok: true, fileUrl: publicFileUrl(outPath), fileSize: st?.size || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal memproses soft blur" }, { status: 500 });
  }
}
