import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, publicFileUrl } from "@/lib/storage";
import { probeVideo, runProcess } from "@/lib/ffmpeg";
import { editGeminiImage, saveImageResult } from "@/lib/gemini-interactions";

export const runtime = "nodejs";

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min)); }

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


    const dir = path.join(STORAGE_ROOT, "tools", "watermark-delogo", user.id);
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(4).toString("hex");
    const inExt = path.extname(video.name || ".mp4") || ".mp4";
    const inPath = path.join(dir, `in-${id}${inExt}`);
    const outPath = path.join(dir, `${mode}-${id}.mp4`);
    await fs.writeFile(inPath, Buffer.from(await video.arrayBuffer()));

    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const meta = await probeVideo(inPath).catch(() => ({ width: null, height: null, duration: null } as any));
    const iw = Math.max(2, Number(meta?.width || 1920));
    const ih = Math.max(2, Number(meta?.height || 1080));

    // AI method: edit a single frame with Gemini image model (honest, frame-level).
    if (method === "ai") {
      const ts = clamp(Number(form.get("time") || 1.5), 0, Math.max(0, Number(meta?.duration || 30) - 0.1));
      const framePath = path.join(dir, `frame-${id}.jpg`);
      const fr = await runProcess(ff, ["-y", "-ss", String(ts), "-i", inPath, "-frames:v", "1", "-q:v", "2", framePath]);
      if (fr.code !== 0) {
        await fs.unlink(inPath).catch(() => {});
        return NextResponse.json({ error: `Gagal mengambil frame: ${String(fr.stderr).slice(-300)}` }, { status: 500 });
      }
      try {
        const edited = await editGeminiImage({
          imagePath: framePath,
          prompt: "Remove the watermark, logo, or overlaid text from this image. Inpaint the area cleanly using the surrounding pixels. Do NOT blur the whole image and do NOT change anything else. Return the cleaned image.",
          aspect: iw >= ih ? "16:9" : "9:16",
        });
        const outImage = path.join(dir, `ai-${id}.png`);
        await saveImageResult(edited.image, outImage);
        const st = await fs.stat(outImage).catch(() => null);
        await fs.unlink(framePath).catch(() => {});
        await fs.unlink(inPath).catch(() => {});
        return NextResponse.json({
          ok: true, mode, method: "ai", kind: "image",
          fileUrl: publicFileUrl(outImage), fileSize: st?.size || null,
          note: `AI (${edited.model}) menghapus watermark pada frame ${ts.toFixed(1)} detik. Ini hasil gambar per-frame, bukan seluruh video.`,
          config: { time: ts, source: { width: iw, height: ih } },
        });
      } catch (e: any) {
        await fs.unlink(framePath).catch(() => {});
        await fs.unlink(inPath).catch(() => {});
        return NextResponse.json({ error: e?.message || "AI gagal menghapus watermark" }, { status: 500 });
      }
    }

    // AI LaMa: real CPU inpainting via ONNX. Preview = one frame (image), Apply = full video.
    if (method === "ai_lama") {
      const py = process.env.PYTHON_PATH || (process.platform === "win32" ? "py" : "python3");
      const pyArgs = process.platform === "win32" && py === "py" ? ["-3"] : [];
      const script = path.join(process.cwd(), "scripts", "wm_inpaint.py");
      const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
      const regions = JSON.stringify([[xP, yP, wP, hP]]);
      const isPreview = mode === "preview";
      const outFile = isPreview
        ? path.join(dir, `lama-${id}.png`)
        : path.join(dir, `lama-${id}.mp4`);
      const ts = clamp(Number(form.get("time") || 1.5), 0, Math.max(0, Number(meta?.duration || 30) - 0.1));
      const stride = Math.max(1, Math.min(10, Math.round(Number(form.get("stride") || 1))));
      const args = [...pyArgs, script,
        "--input", inPath, "--output", outFile,
        "--regions", regions,
        "--mode", isPreview ? "image" : "video",
        "--time", String(ts),
        "--stride", String(stride),
        "--ffmpeg", ffmpegBin,
      ];
      const r = await runProcess(py, args, { maxLog: 4000 });
      const okRun = r.code === 0 && /OK (image|video)/.test(r.stdout) && await fs.stat(outFile).then(s => s.size > 1000).catch(() => false);
      await fs.unlink(inPath).catch(() => {});
      if (!okRun) {
        await fs.unlink(outFile).catch(() => {});
        return NextResponse.json({ error: `AI LaMa gagal: ${String(r.stdout + r.stderr).slice(-400)}` }, { status: 500 });
      }
      const st = await fs.stat(outFile);
      return NextResponse.json({
        ok: true, mode, method: "ai_lama", kind: isPreview ? "image" : "video",
        fileUrl: publicFileUrl(outFile), fileSize: st.size,
        note: isPreview
          ? `AI LaMa (inpainting CPU) — preview 1 frame pada ${ts.toFixed(1)} detik. Area diisi dari konteks sekeliling, tanpa blur.`
          : `AI LaMa (inpainting CPU) — seluruh video diproses (stride ${stride}). Audio & durasi dipertahankan. Model: LaMa ONNX int8.`,
        config: { rect: { x: xP, y: yP, w: wP, h: hP }, stride, time: ts, source: { width: iw, height: ih } },
      });
    }

    // Delogo geometry snapped to even pixels (yuv420p chroma alignment) with a small pad.
    // Odd coordinates produce vertical-bar artefacts after the median pass.
    const even = (n: number) => { const r = Math.round(n); return Math.max(2, r - (r % 2)); };
    const pad = 2;
    let dx = even(Math.round((iw * xP) / 100) - pad);
    let dy = even(Math.round((ih * yP) / 100) - pad);
    let dw = even(Math.round((iw * wP) / 100) + pad * 2);
    let dh = even(Math.round((ih * hP) / 100) + pad * 2);
    dx = Math.min(dx, Math.max(2, iw - 8));
    dy = Math.min(dy, Math.max(2, ih - 8));
    dw = even(Math.min(dw, iw - 2 - dx));
    dh = even(Math.min(dh, ih - 2 - dy));
    if (dw < 6 || dh < 6) {
      await fs.unlink(inPath).catch(() => {});
      return NextResponse.json({ error: "Area terlalu kecil/di tepi frame. Pilih area yang berada di dalam frame." }, { status: 400 });
    }

    let note = "";
    let r: { code: number; stdout: string; stderr: string } = { code: 1, stdout: "", stderr: "" };
    const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];

    if (method === "delogo") {
      // delogo rebuilds from surrounding pixels; median removes the streak artefacts.
      // Bind first video stream explicitly (extra Data/Subtitle streams can break unlabeled pads).
      const vf = `[0:v:0]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}:show=0,split[base][tmp];[tmp]crop=${dw}:${dh}:${dx}:${dy},median=5[m];[base][m]overlay=${dx}:${dy}[vout]`;
      const args = ["-y", "-i", inPath, "-filter_complex", vf, "-map", "[vout]", "-map", "0:a?", ...enc, outPath];
      r = await runProcess(ff, args);
      if (r.code !== 0) {
        // fallback: plain delogo without median
        const vf2 = `[0:v:0]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}:show=0[vout]`;
        const args2 = ["-y", "-i", inPath, "-filter_complex", vf2, "-map", "[vout]", "-map", "0:a?", ...enc, outPath];
        r = await runProcess(ff, args2);
      }
      note = "Delogo + Median (FFmpeg): area direkonstruksi dari piksel tepi, lalu dihaluskan dengan median untuk menghilangkan garis/sisa teks. Tanpa blur. Audio, durasi, resolusi & frame rate dipertahankan. CATATAN: pada background sangat kompleks/berganti cepat, sisa bayangan tipis masih mungkin terlihat — ini batasan interpolasi delogo.";
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
