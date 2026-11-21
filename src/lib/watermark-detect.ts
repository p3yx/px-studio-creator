import { spawn } from "node:child_process";
import { probeVideo } from "./ffmpeg";

/**
 * Lightweight watermark detector. No Python, no model, no extra encode:
 * one ffmpeg process streams a handful of raw RGB frames from a strip (or a
 * user-picked region), and Node counts text-like pixel runs.
 */
export type WmRegion = { x: number; y: number; w: number; h: number }; // percent of source frame
export type WatermarkRange = { start: number; end: number }; // seconds, relative to the clip
export type WatermarkDetection = {
  found: boolean;
  band: WmRegion | null;
  ranges: WatermarkRange[];
  samples: number;
  reason?: string;
};

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
const even = (n: number) => { const r = Math.round(n); return Math.max(2, r - (r % 2)); };

type FrameStat = { shortRuns: number; longRuns: number; activeRows: number; minY: number; maxY: number };

function statFrame(buf: Buffer, width: number, height: number, isRegion: boolean): FrameStat {
  let shortRuns = 0, longRuns = 0, activeRows = 0, minY = height, maxY = 0;
  // The fansub banner sits around y=10..42 at 720p; subtitles are lower and
  // must not be mistaken for it. A user-picked region scans in full.
  const top = isRegion ? 0 : 2;
  const bottom = isRegion ? height : Math.min(height, Math.max(44, Math.round(height * 0.68)));
  for (let y = top; y < bottom; y++) {
    const off = y * width * 3;
    let run = 0, rowBright = 0;
    for (let x = 0; x < width; x++) {
      const i = off + x * 3;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
      if (lo > 170 && hi - lo < 55) {
        run++; rowBright++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        if (run) { if (run <= 14) shortRuns++; else longRuns++; run = 0; }
      }
    }
    if (run) { if (run <= 14) shortRuns++; else longRuns++; }
    if (rowBright >= 10) activeRows++;
  }
  return { shortRuns, longRuns, activeRows, minY, maxY };
}

function sampleBand(
  videoPath: string, start: number, duration: number,
  x: number, y: number, w: number, h: number,
  interval: number, maxSamples: number,
): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-ss", String(Math.max(0, start)), "-t", String(Math.max(0.1, duration)),
      "-i", videoPath,
      "-vf", `fps=${(1 / interval).toFixed(6)},crop=${w}:${h}:${x}:${y}`,
      "-frames:v", String(maxSamples),
      "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ];
    const child = spawn(/*turbopackIgnore: true*/ ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`watermark scan failed: ${err.slice(-300)}`));
      const raw = Buffer.concat(chunks);
      const frameBytes = w * h * 3;
      const frames: Buffer[] = [];
      for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) {
        frames.push(raw.subarray(off, off + frameBytes));
      }
      resolve(frames);
    });
  });
}

export async function detectWatermark(
  videoPath: string,
  clipStart: number,
  clipDuration: number,
  opts?: { interval?: number; region?: WmRegion },
): Promise<WatermarkDetection> {
  const interval = Math.max(0.5, Math.min(2, Number(opts?.interval || 1)));
  const region = opts?.region;
  try {
    const info = await probeVideo(videoPath);
    const W = Math.max(2, Number(info.width || 1280));
    const H = Math.max(2, Number(info.height || 720));
    const isRegion = !!region && Number(region.w) > 0 && Number(region.h) > 0;
    const clampEven = (v: number, max: number) => even(Math.max(2, Math.min(max - 2, v)));
    const cw = isRegion ? clampEven((W * Number(region!.w)) / 100, W) : W;
    const ch = isRegion ? clampEven((H * Number(region!.h)) / 100, H) : even(Math.max(40, Math.min(96, Math.round(H * 0.11))));
    const cx = isRegion ? clampEven((W * Number(region!.x)) / 100, W) : 0;
    const cy = isRegion ? clampEven((H * Number(region!.y)) / 100, H) : 0;
    const maxSamples = Math.max(4, Math.min(90, Math.ceil(clipDuration / interval) + 2));
    const frames = await sampleBand(videoPath, clipStart, clipDuration, cx, cy, cw, ch, interval, maxSamples);
    if (!frames.length) return { found: false, band: region || null, ranges: [], samples: 0, reason: "no frames" };

    const hits: number[] = [];
    frames.forEach((frame, i) => {
      const s = statFrame(frame, cw, ch, isRegion);
      // Glyph strokes are many SHORT bright runs with no long ones. Large
      // bright areas (skin, sky, speed lines) always produce long runs.
      if (s.shortRuns >= 100 && s.longRuns <= 2 && s.activeRows >= 6 && s.activeRows <= Math.max(34, ch - 8)) {
        hits.push(i);
      }
    });
    if (!hits.length) return { found: false, band: region || null, ranges: [], samples: frames.length, reason: "no text-like band" };

    const rawRanges = hits.map((i) => ({
      start: Math.max(0, i * interval - interval * 0.9),
      end: Math.min(clipDuration, (i + 1) * interval + interval * 0.3),
    }));
    const ranges: WatermarkRange[] = [];
    for (const r of rawRanges) {
      const last = ranges[ranges.length - 1];
      if (last && r.start <= last.end + 0.01) last.end = Math.max(last.end, r.end);
      else ranges.push({ ...r });
    }
    for (const r of ranges) r.end = Math.min(clipDuration, r.end + interval * 0.6);

    if (isRegion) return { found: true, band: region!, ranges, samples: frames.length };

    let minY = ch, maxY = 0;
    frames.forEach((frame, i) => {
      if (!hits.includes(i)) return;
      const s = statFrame(frame, cw, ch, false);
      if (s.minY < minY) minY = s.minY;
      if (s.maxY > maxY) maxY = s.maxY;
    });
    const pad = Math.max(4, Math.round(ch * 0.12));
    const yPx = Math.max(0, Math.min(H - 12, even(minY - pad)));
    const hPx = even(Math.max(12, Math.min(H - yPx - 2, maxY - minY + pad * 2)));
    return {
      found: true,
      band: { x: 0, y: Math.max(0, (yPx / H) * 100), w: 100, h: Math.max(1, (hPx / H) * 100) },
      ranges, samples: frames.length,
    };
  } catch (e: any) {
    return { found: false, band: region || null, ranges: [], samples: 0, reason: e?.message || "scan error" };
  }
}
