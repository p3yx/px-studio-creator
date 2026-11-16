import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, publicFileUrl } from "@/lib/storage";
import { runProcess } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function escapeDrawtextText(s: string) {
  // escape for ffmpeg drawtext
  return String(s || "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/\n/g, "\\n");
}
function hexToFFmpegColor(hex: string, opacity: number) {
  const h = (hex || "#ffffff").replace("#", "");
  const r = h.length >= 6 ? h.slice(0,2) : "ff";
  const g = h.length >= 6 ? h.slice(2,4) : "ff";
  const b = h.length >= 6 ? h.slice(4,6) : "ff";
  const a = Math.max(0, Math.min(1, opacity));
  const aa = Math.round(a * 255).toString(16).padStart(2, "0");
  return `${r}${g}${b}@${a.toFixed(2)}`; // fontcolor supports RRGGBB@alpha
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const text = String(form.get("text") || "WATERMARK").slice(0, 120);
    const fontSize = Math.max(12, Math.min(200, Number(form.get("fontSize") || 48)));
    const color = String(form.get("color") || "#ffffff");
    const opacity = Math.max(0.05, Math.min(1, Number(form.get("opacity") || 0.7)));
    const bg = String(form.get("bg") || "transparent");

    const dir = path.join(STORAGE_ROOT, "tools", "watermark", user.id);
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(4).toString("hex");
    const outPath = path.join(dir, `wm-${id}.png`);

    // estimate canvas size
    const padX = Math.max(20, Math.round(fontSize * 0.8));
    const padY = Math.max(16, Math.round(fontSize * 0.6));
    const w = Math.max(200, Math.min(2000, text.length * Math.round(fontSize * 0.65) + padX * 2));
    const h = Math.max(80, Math.min(800, fontSize + padY * 2));

    let bgColor = "black@0";
    if (bg === "dark") bgColor = "black@0.45";
    else if (bg === "black") bgColor = "black@1";

    const fc = hexToFFmpegColor(color, opacity);
    const safeText = escapeDrawtextText(text);
    // Try drawtext; on Windows default font may vary. Try with font=Arial fallback chain by attempting multiple commands.
    const vf = `drawtext=text='${safeText}':fontcolor=${fc}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`;
    const ff = process.env.FFMPEG_PATH || "ffmpeg";

    const attempts = [
      ["-y", "-f", "lavfi", "-i", `color=c=${bgColor}:s=${w}x${h},format=rgba`, "-vf", `drawtext=font='Arial':${vf.replace(/^drawtext=/,'')}`, "-frames:v", "1", outPath],
      ["-y", "-f", "lavfi", "-i", `color=c=${bgColor}:s=${w}x${h},format=rgba`, "-vf", vf, "-frames:v", "1", outPath],
    ];
    let ok = false; let lastErr = "";
    for (const args of attempts) {
      const r = await runProcess(ff, args);
      if (r.code === 0) { ok = true; break; }
      lastErr = r.stderr || r.stdout || "";
    }
    if (!ok) throw new Error(`FFmpeg gagal membuat watermark: ${lastErr.slice(-400)}`);

    return NextResponse.json({ ok: true, fileUrl: publicFileUrl(outPath) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuat watermark" }, { status: 500 });
  }
}
