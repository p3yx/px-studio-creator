import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, publicFileUrl } from "@/lib/storage";
import { probeVideo, runProcess } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min)); }
function even(n: number) { return Math.max(2, n - (n % 2)); }

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });

    const method = String(form.get("method") || "delogo");
    const mode = String(form.get("mode") || "preview");

    let xP = clamp(Number(form.get("x") || 70), 0, 99);
    let yP = clamp(Number(form.get("y") || 80), 0, 99);
    let wP = clamp(Number(form.get("w") || 20), 1, 100);
    let hP = clamp(Number(form.get("h") || 12), 1, 100);
    if (xP + wP > 100) wP = Math.max(1, 100 - xP);
    if (yP + hP > 100) hP = Math.max(1, 100 - yP);

    const blur = clamp(Number(form.get("blur") || 8), 2, 20);

    const dir = path.join(STORAGE_ROOT, "tools", "watermark-delogo", user.id);
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(4).toString("hex");
    const inExt = path.extname(video.name || ".mp4") || ".mp4";
    const inPath = path.join(dir, `in-${id}${inExt}`);
    const outPath = path.join(dir, `${mode}-${id}.mp4`);
    await fs.writeFile(inPath, Buffer.from(await video.arrayBuffer()));

    const meta = await probeVideo(inPath).catch(() => ({ width: null, height: null } as any));
    const iw = Math.max(2, Number(meta?.width || 1920));
    const ih = Math.max(2, Number(meta?.height || 1080));

    // delogo requires the region strictly inside the frame with >=1px margin from borders
    let dx = Math.max(1, Math.round((iw * xP) / 100));
    let dy = Math.max(1, Math.round((ih * yP) / 100));
    let dw = Math.max(2, Math.round((iw * wP) / 100));
    let dh = Math.max(2, Math.round((ih * hP) / 100));
    if (dx + dw > iw - 1) dw = Math.max(2, iw - 1 - dx);
    if (dy + dh > ih - 1) dh = Math.max(2, ih - 1 - dy);
    if (dx > iw - 2) { dx = 1; dw = Math.max(2, Math.min(dw, iw - 2)); }
    if (dy > ih - 2) { dy = 1; dh = Math.max(2, Math.min(dh, ih - 2)); }
    dw = Math.min(dw, iw - 1 - dx); dh = Math.min(dh, ih - 1 - dy);
    if (dw < 2 || dh < 2) {
      await fs.unlink(inPath).catch(() => {});
      return NextResponse.json({ error: "Area terlalu kecil/di tepi frame. Pilih area yang berada di dalam frame." }, { status: 400 });
    }

    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    let note = "";
    let r: { code: number; stdout: string; stderr: string } = { code: 1, stdout: "", stderr: "" };
    const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];

    if (method === "delogo") {
      // bind first video stream explicitly (extra Data/Subtitle streams in source files can break unlabeled pads)
      const vf = `[0:v:0]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}:show=0[vout]`;
      const args = ["-y", "-i", inPath, "-filter_complex", vf, "-map", "[vout]", "-map", "0:a?", ...enc, outPath];
      r = await runProcess(ff, args);
      if (r.code !== 0) {
        // fallback: band interpolation tuning
        const vf2 = `[0:v:0]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}[vout]`;
        const args2 = ["-y", "-i", inPath, "-filter_complex", vf2, "-map", "[vout]", "-map", "0:a?", ...enc, outPath];
        r = await runProcess(ff, args2);
      }
      note = "Delogo (FFmpeg): area diisi dengan interpolasi piksel dari tepi sekelilingnya — bukan blur, sehingga watermark tidak menyisakan bayangan. Audio, durasi, resolusi & frame rate dipertahankan. Sumber tidak diubah.";
    } else if (method === "delogo_blur") {
      const cx = dx, cy = dy;
      let cw = even(dw), ch = even(dh);
      cw = Math.min(cw, iw - cx); ch = Math.min(ch, ih - cy);
      const vf = `[0:v:0]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh},split[base][tmp];[tmp]crop=${cw}:${ch}:${cx}:${cy},boxblur=${blur}:1[b];[base][b]overlay=${cx}:${cy}[vout]`;
      const args = ["-y", "-i", inPath, "-filter_complex", vf, "-map", "[vout]", "-map", "0:a?", ...enc, outPath];
      r = await runProcess(ff, args);
      if (r.code !== 0) {
        const vf2 = `[0:v:0]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh},split[base][tmp];[tmp]crop=${cw}:${ch}:${cx}:${cy},boxblur=${Math.min(blur, 10)}:1[b];[base][b]overlay=${cx}:${cy}[vout]`;
        const args2 = ["-y", "-i", inPath, "-filter_complex", vf2, "-map", "[vout]", "-map", "0:a?", ...enc, outPath];
        r = await runProcess(ff, args2);
      }
      note = "Delogo + Blur Tipis (FFmpeg): area direkonstruksi dari tepi (delogo) lalu diberi blur sangat tipis agar tekstur lebih halus — cocok untuk logo besar/tebal. Audio, durasi, resolusi & frame rate dipertahankan. Sumber tidak diubah.";
    } else {
      await fs.unlink(inPath).catch(() => {});
      return NextResponse.json({ error: "Metode tidak didukung." }, { status: 400 });
    }

    if (r.code !== 0) {
      const tail = String(r.stderr || r.stdout || "").slice(-500);
      await fs.unlink(inPath).catch(() => {});
      return NextResponse.json({ error: `FFmpeg gagal: ${tail}` }, { status: 500 });
    }

    await fs.unlink(inPath).catch(() => {});
    const st = await fs.stat(outPath).catch(() => null);
    return NextResponse.json({
      ok: true,
      mode,
      method,
      fileUrl: publicFileUrl(outPath),
      fileSize: st?.size || null,
      note,
      config: { rect: { x: xP, y: yP, w: wP, h: hP }, source: { width: iw, height: ih }, delogoPx: { x: dx, y: dy, w: dw, h: dh } },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal memproses" }, { status: 500 });
  }
}
