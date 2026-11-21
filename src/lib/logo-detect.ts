import { spawn } from "node:child_process";

/**
 * Detect a STATIC burned-in logo by temporal variance: a logo overlayed at
 * encode time stays pixel-identical across frames, while the picture behind
 * it moves. One small ffmpeg process feeds downscaled raw frames; everything
 * else is plain Node. Returns a percent bbox ready for delogo.
 */
export type LogoBox = { x: number; y: number; w: number; h: number };

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";

function sampleFrames(videoPath: string, start: number, duration: number, W: number, H: number, count: number): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const fps = count / Math.max(0.5, duration);
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-ss", String(Math.max(0, start)), "-t", String(Math.max(0.5, duration)),
      "-i", videoPath,
      "-vf", `fps=${fps.toFixed(6)},scale=${W}:${H}:flags=bilinear`,
      "-frames:v", String(count),
      "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ];
    const child = spawn(/*turbopackIgnore: true*/ ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`logo scan failed: ${err.slice(-300)}`));
      const raw = Buffer.concat(chunks);
      const size = W * H * 3;
      const out: Buffer[] = [];
      for (let off = 0; off + size <= raw.length; off += size) out.push(raw.subarray(off, off + size));
      resolve(out);
    });
  });
}

type Component = { area: number; x0: number; y0: number; x1: number; y1: number; stack: number[] };

export async function detectStaticLogo(
  videoPath: string,
  start: number,
  duration: number,
  opts?: { sensitivity?: number },
): Promise<LogoBox | null> {
  const W = 640, H = 360, N = 10;
  try {
    const frames = await sampleFrames(videoPath, start, duration, W, H, N);
    if (frames.length < 4) return null;
    const total = W * H;
    const min = new Uint8Array(total * 3).fill(255);
    const max = new Uint8Array(total * 3).fill(0);
    for (const f of frames) {
      for (let p = 0; p < total; p++) {
        const i = p * 3;
        for (let c = 0; c < 3; c++) {
          const v = f[i + c];
          if (v < min[i + c]) min[i + c] = v;
          if (v > max[i + c]) max[i + c] = v;
        }
      }
    }
    const tol = Math.max(8, Math.min(45, Number(opts?.sensitivity ?? 24)));
    const mask = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      const i = p * 3;
      const range = Math.max(max[i] - min[i], max[i + 1] - min[i + 1], max[i + 2] - min[i + 2]);
      mask[p] = range <= tol ? 1 : 0;
    }

    // 8-connected components on the "unchanging" mask.
    const seen = new Uint8Array(total);
    const comps: Component[] = [];
    const neighbours = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    for (let seed = 0; seed < total; seed++) {
      if (!mask[seed] || seen[seed]) continue;
      const stack = [seed];
      seen[seed] = 1;
      const c: Component = { area: 0, x0: W, y0: H, x1: 0, y1: 0, stack };
      while (stack.length) {
        const p = stack.pop()!;
        c.area++;
        const x = p % W, y = (p / W) | 0;
        if (x < c.x0) c.x0 = x;
        if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y;
        if (y > c.y1) c.y1 = y;
        for (const d of neighbours) {
          const q = p + d;
          if (q < 0 || q >= total) continue;
          if (d === -1 && x === 0) continue;
          if (d === 1 && x === W - 1) continue;
          if (!seen[q] && mask[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      comps.push(c);
    }

    // Rank: logo-like = compact, not a full-width/height band, with visible
    // internal edges (text/graphics). Plain black bars have no edges.
    const ref = frames[Math.floor(frames.length / 2)];
    const gray = (p: number) => {
      const i = p * 3;
      return (ref[i] * 77 + ref[i + 1] * 150 + ref[i + 2] * 29) >> 8;
    };
    let best: Component | null = null;
    let bestScore = -1;
    for (const c of comps) {
      const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      if (w > W * 0.45 || h > H * 0.45) continue; // letterbox / static scene band
      if (c.area < 40 || c.area > total * 0.16) continue;
      const fill = c.area / (w * h);
      if (fill < 0.18) continue; // too sparse to be a graphic
      let edges = 0, tested = 0;
      for (let y = c.y0 + 1; y < c.y1; y += 2) {
        for (let x = c.x0 + 1; x < c.x1; x += 2) {
          const p = y * W + x;
          if (!mask[p]) continue;
          tested++;
          if (Math.abs(gray(p) - gray(p + 1)) > 26 || Math.abs(gray(p) - gray(p + W)) > 26) edges++;
        }
      }
      if (tested < 8 || edges / tested < 0.06) continue;
      const edgeRatio = edges / tested;
      const corner = Math.min(c.x0, W - c.x1, c.y0, H - c.y1);
      const score = edgeRatio * 2 + Math.min(fill, 0.9) + (corner < W * 0.2 ? 0.5 : 0) + Math.log(1 + c.area) / 12;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return null;

    // Sparse logos (thin text on transparent PNG) only leave a few very-static
    // pixels. Expand generously sideways so the whole wordmark is covered.
    const padX = Math.round(W * 0.03);
    const padY = Math.round(H * 0.02);
    let bx = Math.max(0, best.x0 - padX);
    let by = Math.max(0, best.y0 - padY);
    let bw = Math.min(W - bx, best.x1 - best.x0 + 1 + padX * 2);
    let bh = Math.min(H - by, best.y1 - best.y0 + 1 + padY * 2);
    // Corner logos sit against the frame edge: extend the box all the way
    // there, otherwise the last letters survive the delogo.
    if (best.x1 >= W * 0.72) { bx = Math.min(bx, W - bw); bw = W - 2 - bx; }
    if (best.x0 <= W * 0.28) { bw = Math.min(W - 2, bx + bw + padX); bx = 2; }
    if (best.y1 >= H * 0.72) { by = Math.min(by, H - bh); bh = H - 2 - by; }
    if (best.y0 <= H * 0.28) { bh = Math.min(H - 2, by + bh + padY); by = 2; }
    return { x: (bx / W) * 100, y: (by / H) * 100, w: (bw / W) * 100, h: (bh / H) * 100 };
  } catch {
    return null;
  }
}
