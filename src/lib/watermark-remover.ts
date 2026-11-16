import path from "path";
import fs from "fs/promises";
import { probeVideo, runProcess } from "./ffmpeg";

export type RemovalMethod = "ai_inpainting" | "smart_crop" | "soft_blur";
export type SelectionShape = "rect" | "brush" | "eraser";

export type NormalizedRect = { x: number; y: number; w: number; h: number }; // 0..1 relative to video
export type MaskRegion = {
  id?: string;
  type: "rect" | "mask";
  // rect in normalized coordinates (0..1)
  rect?: NormalizedRect;
  // optional time range (seconds) for moving/manual tracking key regions
  startTime?: number | null;
  endTime?: number | null;
  // for brush/eraser masks, stored as data URL or relative path in project storage (future)
  maskData?: string | null;
};

export type WatermarkRemoverConfig = {
  method: RemovalMethod;
  regions: MaskRegion[];
  // smart crop: if set, crop to this rect (normalized) instead of auto; else derive from regions union
  cropRect?: NormalizedRect | null;
  // soft blur: blur strength
  blurStrength?: number; // 1..30
  delogoBand?: number; // 1..10 for delogo interpolation band
  notes?: string;
};

export function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

export function normalizeRegions(regions: any[]): MaskRegion[] {
  if (!Array.isArray(regions)) return [];
  return regions.map((r, i) => {
    const rect = r?.rect && typeof r.rect === "object" ? {
      x: clamp01(Number(r.rect.x) || 0),
      y: clamp01(Number(r.rect.y) || 0),
      w: clamp01(Number(r.rect.w) || 0),
      h: clamp01(Number(r.rect.h) || 0),
    } : undefined;
    return {
      id: r?.id ? String(r.id) : `r${i + 1}`,
      type: r?.type === "mask" ? "mask" : "rect",
      rect,
      startTime: r?.startTime == null ? null : Number(r.startTime),
      endTime: r?.endTime == null ? null : Number(r.endTime),
      maskData: r?.maskData ? String(r.maskData) : null,
    } as MaskRegion;
  }).filter(r => (r.type === "rect" ? (r.rect && r.rect.w > 0.001 && r.rect.h > 0.001) : !!r.maskData));
}

export function rectToPixels(rect: NormalizedRect, width: number, height: number) {
  const x = Math.max(0, Math.min(width - 2, Math.round(rect.x * width)));
  const y = Math.max(0, Math.min(height - 2, Math.round(rect.y * height)));
  const w = Math.max(2, Math.min(width - x, Math.round(rect.w * width)));
  const h = Math.max(2, Math.min(height - y, Math.round(rect.h * height)));
  return { x, y, w, h };
}

export function unionRect(rects: NormalizedRect[]): NormalizedRect | null {
  if (!rects.length) return null;
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  x1 = clamp01(x1); y1 = clamp01(y1); x2 = clamp01(x2); y2 = clamp01(y2);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

export async function getInpaintingStatus() {
  const cmd = process.env.WATERMARK_INPAINT_CMD || process.env.INPAINT_CMD || "";
  const script = process.env.WATERMARK_INPAINT_SCRIPT || process.env.INPAINT_SCRIPT || "";
  const python = process.env.PYTHON_PATH || process.env.PYTHON || "python";
  let scriptExists = false;
  if (script) { try { await fs.access(script); scriptExists = true; } catch {} }
  const configured = !!(cmd || scriptExists);
  return {
    available: false, // no verified runtime/model probe here; treated as unavailable until configured+validated
    configured,
    cmd: cmd || null,
    script: script || null,
    scriptExists,
    python,
    reason: configured
      ? "Backend inpainting terkonfigurasi (perintah/script). Pastikan model/dependency tersedia di server sebelum render."
      : "Model/backend inpainting tidak tersedia. Atur WATERMARK_INPAINT_CMD atau WATERMARK_INPAINT_SCRIPT di environment server, atau gunakan metode Smart Crop/Soft Blur.",
  };
}

function ffmpegBase() { return process.env.FFMPEG_PATH || "ffmpeg"; }

export async function renderSoftBlurRemoval(opts: {
  input: string;
  output: string;
  regions: MaskRegion[];
  blurStrength?: number;
  band?: number;
  duration?: number;
}) {
  const info = await probeVideo(opts.input);
  const W = info.width || 1920, H = info.height || 1080;
  const rects = opts.regions.filter(r => r.type === "rect" && r.rect).map(r => r.rect!) as NormalizedRect[];
  if (!rects.length) throw new Error("Pilih minimal satu area (rectangle) untuk Soft Blur.");
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const band = Math.max(1, Math.min(10, Math.round(opts.band ?? 4)));
  const blur = Math.max(1, Math.min(30, Math.round(opts.blurStrength ?? 12)));
  // Chain delogo filters per region (FFmpeg delogo interpolates/blurs rectangle area)
  let filter = `[0:v]format=yuv420p`;
  rects.forEach((r, idx) => {
    const p = rectToPixels(r, W, H);
    const label = idx === rects.length - 1 ? "[vout]" : `[v${idx}]`;
    filter += `${idx === 0 ? "" : `[v${idx - 1}]`}delogo=x=${p.x}:y=${p.y}:w=${p.w}:h=${p.h}:show=0:band=${band}${label}`;
  });
  // If multiple regions, delogo must be chained properly
  let fc = `[0:v]format=yuv420p[v0];`;
  rects.forEach((r, idx) => {
    const p = rectToPixels(r, W, H);
    const inp = `[v${idx}]`;
    const out = idx === rects.length - 1 ? "[vout]" : `[v${idx + 1}]`;
    fc += `${inp}delogo=x=${p.x}:y=${p.y}:w=${p.w}:h=${p.h}:show=0:band=${band}${out};`;
  });
  fc = fc.replace(/;$/, "");
  // fallback simpler single chain build
  let chain = "[0:v]format=yuv420p";
  for (let i = 0; i < rects.length; i++) {
    const p = rectToPixels(rects[i], W, H);
    chain += `,delogo=x=${p.x}:y=${p.y}:w=${p.w}:h=${p.h}:show=0:band=${band}`;
  }
  chain += "[vout]";
  const args = ["-y", "-i", opts.input, "-filter_complex", chain, "-map", "[vout]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", opts.output];
  let res = await runProcess(ffmpegBase(), args);
  if (res.code !== 0) {
    // try re-encode audio
    const args2 = ["-y", "-i", opts.input, "-filter_complex", chain, "-map", "[vout]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", opts.output];
    res = await runProcess(ffmpegBase(), args2);
  }
  if (res.code !== 0) throw new Error(`Soft Blur gagal: ${String(res.stderr || "").slice(-700)}`);
  return { output: opts.output, method: "soft_blur" as const };
}

export async function renderSmartCropRemoval(opts: {
  input: string;
  output: string;
  regions: MaskRegion[];
  cropRect?: NormalizedRect | null;
}) {
  const info = await probeVideo(opts.input);
  const W = info.width || 1920, H = info.height || 1080;
  const rects = opts.regions.filter(r => r.type === "rect" && r.rect).map(r => r.rect!) as NormalizedRect[];
  const target = opts.cropRect && opts.cropRect.w > 0.05 && opts.cropRect.h > 0.05 ? opts.cropRect : null;
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  let crop: { x: number; y: number; w: number; h: number };
  if (target) {
    crop = rectToPixels(target, W, H);
  } else if (rects.length) {
    // remove area containing watermark by cropping it out: keep largest side area opposite/around watermark union
    const u = unionRect(rects)!;
    const px = rectToPixels(u, W, H);
    // Heuristic: if watermark near bottom, crop top portion; near top crop bottom; near side crop opposite; else crop centered excluding band
    const cx = px.x + px.w / 2, cy = px.y + px.h / 2;
    const margin = 8;
    if (cy > H * 0.65) {
      // bottom watermark -> crop above it
      crop = { x: 0, y: 0, w: W, h: Math.max(2, px.y - margin) };
    } else if (cy < H * 0.35) {
      const y = Math.min(H - 2, px.y + px.h + margin);
      crop = { x: 0, y, w: W, h: Math.max(2, H - y) };
    } else if (cx > W * 0.65) {
      crop = { x: 0, y: 0, w: Math.max(2, px.x - margin), h: H };
    } else if (cx < W * 0.35) {
      const x = Math.min(W - 2, px.x + px.w + margin);
      crop = { x, y: 0, w: Math.max(2, W - x), h: H };
    } else {
      // center-ish: crop to exclude watermark band by removing bottom band including it
      crop = { x: 0, y: 0, w: W, h: Math.max(2, px.y - margin) };
      if (crop.h < H * 0.5) crop = { x: 0, y: Math.min(H - 2, px.y + px.h + margin), w: W, h: Math.max(2, H - (px.y + px.h + margin)) };
    }
  } else {
    throw new Error("Pilih area watermark atau tentukan area crop untuk Smart Crop.");
  }
  // ensure even dimensions for yuv420p
  crop.w = crop.w - (crop.w % 2); crop.h = crop.h - (crop.h % 2);
  crop.x = Math.min(crop.x, W - crop.w); crop.y = Math.min(crop.y, H - crop.h);
  if (crop.w < 64 || crop.h < 64) throw new Error("Area crop terlalu kecil setelah perhitungan. Sesuaikan pilihan area.");
  const vf = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`;
  const args = ["-y", "-i", opts.input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", opts.output];
  let res = await runProcess(ffmpegBase(), args);
  if (res.code !== 0) {
    const args2 = ["-y", "-i", opts.input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", opts.output];
    res = await runProcess(ffmpegBase(), args2);
  }
  if (res.code !== 0) throw new Error(`Smart Crop gagal: ${String(res.stderr || "").slice(-700)}`);
  return { output: opts.output, method: "smart_crop" as const, crop };
}

export async function renderAiInpaintingRemoval(opts: {
  input: string;
  output: string;
  regions: MaskRegion[];
  workDir: string;
}) {
  const status = await getInpaintingStatus();
  if (!status.configured) {
    throw new Error("AI Inpainting belum dikonfigurasi: " + status.reason);
  }
  // External command/script integration (no fake/simulated inpainting)
  const rects = opts.regions.filter(r => r.type === "rect" && r.rect).map(r => r.rect!);
  if (!rects.length) throw new Error("Pilih area watermark untuk AI Inpainting.");
  const info = await probeVideo(opts.input);
  const payload = {
    input: opts.input,
    output: opts.output,
    width: info.width, height: info.height, duration: info.duration,
    regions: opts.regions,
    rectsPixels: rects.map(r => rectToPixels(r, info.width || 1920, info.height || 1080)),
  };
  await fs.mkdir(opts.workDir, { recursive: true });
  const payloadPath = path.join(opts.workDir, "inpaint-payload.json");
  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf-8");

  const cmdEnv = process.env.WATERMARK_INPAINT_CMD || "";
  if (cmdEnv) {
    // Allow placeholders {input} {output} {payload}
    const expanded = cmdEnv
      .replace(/\{input\}/g, opts.input)
      .replace(/\{output\}/g, opts.output)
      .replace(/\{payload\}/g, payloadPath)
      .replace(/\{workdir\}/g, opts.workDir);
    const res = await runProcess(process.platform === "win32" ? "cmd" : "sh", [process.platform === "win32" ? "/c" : "-lc", expanded], { cwd: opts.workDir });
    if (res.code !== 0) throw new Error("AI Inpainting command gagal: " + String(res.stderr || res.stdout || "").slice(-800));
  } else if (status.script && status.scriptExists) {
    const python = process.env.PYTHON_PATH || process.env.PYTHON || "python";
    const res = await runProcess(python, [status.script, "--input", opts.input, "--output", opts.output, "--payload", payloadPath], { cwd: opts.workDir });
    if (res.code !== 0) throw new Error("AI Inpainting script gagal: " + String(res.stderr || res.stdout || "").slice(-800));
  } else {
    throw new Error("AI Inpainting belum dikonfigurasi dengan benar: " + status.reason);
  }

  const st = await fs.stat(opts.output).catch(() => null);
  if (!st || st.size < 1024) throw new Error("AI Inpainting tidak menghasilkan file output yang valid.");
  return { output: opts.output, method: "ai_inpainting" as const };
}
