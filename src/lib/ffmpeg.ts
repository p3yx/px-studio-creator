import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { STORAGE_ROOT } from "@/lib/storage";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min)); }

export function runProcess(cmd: string, args: string[], opts?: { cwd?: string; maxLog?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts?.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const max = Math.max(2000, opts?.maxLog ?? 20000);
    const append = (cur: string, chunk: any) => {
      const next = cur + chunk.toString();
      return next.length > max ? next.slice(-max) : next;
    };
    child.stdout.on("data", (d) => { stdout = append(stdout, d); });
    child.stderr.on("data", (d) => { stderr = append(stderr, d); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export async function probeVideo(filePath: string) {
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath];
  const { stdout, code, stderr } = await runProcess(FFPROBE, args);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr.slice(-400)}`);
  const data = JSON.parse(stdout || "{}");
  const v = (data.streams || []).find((s: any) => s.codec_type === "video") || {};
  const duration = parseFloat(data.format?.duration || v.duration || "0") || 0;
  return {
    duration,
    width: v.width || null,
    height: v.height || null,
    size: data.format?.size ? parseInt(data.format.size, 10) : null,
    raw: data,
  };
}

export async function extractAudioWav(input: string, output: string) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const args = ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", output];
  const { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) throw new Error(`Audio extraction failed: ${stderr.slice(-400)}`);
  return output;
}

export async function extractAudioFile(opts: { input: string; output: string; format: "mp3"|"wav"|"aac"|"m4a"; start?: number; end?: number; }) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const args: string[] = ["-y"];
  if (opts.start != null && isFinite(opts.start) && opts.start > 0) args.push("-ss", String(opts.start));
  args.push("-i", opts.input);
  if (opts.end != null && isFinite(opts.end)) {
    const dur = Math.max(0.1, opts.end - (opts.start || 0));
    if (dur > 0) args.push("-t", String(dur));
  }
  args.push("-vn");
  if (opts.format === "mp3") args.push("-c:a", "libmp3lame", "-b:a", "192k");
  else if (opts.format === "wav") args.push("-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2");
  else if (opts.format === "aac") args.push("-c:a", "aac", "-b:a", "192k");
  else if (opts.format === "m4a") args.push("-c:a", "aac", "-b:a", "192k");
  args.push(opts.output);
  const { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) throw new Error(`Audio export failed: ${stderr.slice(-500)}`);
  return opts.output;
}

export async function extractFrames(input: string, outDir: string, opts?: { fps?: number; maxFrames?: number }) {
  await fs.mkdir(outDir, { recursive: true });
  const fps = opts?.fps ?? 1; // 1 frame per second by default
  const pattern = path.join(outDir, "frame-%04d.jpg");
  const args = ["-y", "-i", input, "-vf", `fps=${fps},scale=960:-1`, "-q:v", "4", pattern];
  const { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) throw new Error(`Frame extraction failed: ${stderr.slice(-400)}`);
  let files = (await fs.readdir(outDir)).filter(f => f.endsWith('.jpg')).sort().map(f => path.join(outDir, f));
  if (opts?.maxFrames && files.length > opts.maxFrames) files = files.slice(0, opts.maxFrames);
  return files;
}

export type RenderOptions = {
  input: string;
  output: string;
  start: number;
  end: number;
  aspect: "16:9" | "9:16" | "1:1";
  subtitlePath?: string | null;
  quality?: "high" | "medium" | "fast";
  subtitleStyle?: string | null;
  watermarkPath?: string | null;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  watermarkOpacity?: number;
  watermarkScale?: number;
  watermarkMargin?: number;
  // Watermark REMOVAL (delogo): regions in percent of source; blur = optional thin blur after delogo
  delogo?: { x: number; y: number; w: number; h: number; blur?: number } | null;
  delogos?: Array<{ x: number; y: number; w: number; h: number; blur?: number }> | null;
  loudnessNormalize?: boolean;
  loudnessFilter?: string | null;
};

function aspectFilter(aspect: string) {
  // smart-ish crop: center crop to target aspect then scale. (keeps subject reasonably if centered; configurable later)
  if (aspect === "9:16") return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos";
  if (aspect === "1:1") {
    return "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=1080:1080:flags=lanczos";
  }
  return "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";
}

export async function renderClip(opts: RenderOptions) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const duration = Math.max(0.1, opts.end - opts.start);
  let brand: any = null;
  try {
    if (opts.subtitleStyle == null || opts.loudnessNormalize == null || opts.watermarkPath === undefined) {
      const bmod = await import("./brand");
      brand = await bmod.getBrandKit();
    }
  } catch {}
  const subtitleStyle = opts.subtitleStyle ?? (brand ? (await import("./brand")).subtitleForceStyle(brand) : "FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=35,Alignment=2");
  const loudOn = opts.loudnessNormalize ?? (brand ? brand.loudnessNormalize !== false : true);
  const loudFilter = opts.loudnessFilter ?? (brand ? (await import("./brand")).loudnormFilter(brand) : "alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11");
  const wmPathRaw = opts.watermarkPath !== undefined ? opts.watermarkPath : (brand?.watermarkEnabled ? brand.watermarkPath : null);
  const wmPath = wmPathRaw ? await fs.stat(wmPathRaw).then(()=>wmPathRaw).catch(()=>null) : null;
  const wmPos = opts.watermarkPosition ?? brand?.watermarkPosition ?? "bottom-right";
  const wmOpacity = opts.watermarkOpacity ?? brand?.watermarkOpacity ?? 0.8;
  const wmScale = opts.watermarkScale ?? brand?.watermarkScale ?? 0.18;
  const wmMargin = opts.watermarkMargin ?? brand?.watermarkMargin ?? 24;

  const baseVf = aspectFilter(opts.aspect);
  const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
  const argsBase = ["-y", "-ss", String(opts.start), "-t", String(duration), "-i", opts.input];

  // Build delogo chain in SOURCE pixel space (must run before aspect crop/scale).
  // Multiple regions are chained sequentially; each blur region uses unique split labels.
  const regions = (opts.delogos && opts.delogos.length ? opts.delogos : (opts.delogo ? [opts.delogo] : []));
  let dlPrefix = "";
  let dlOverlay = "";
  if (regions.length) {
    try {
      const info = await probeVideo(opts.input).catch(() => ({ width: null, height: null } as any));
      const iw = Math.max(2, Number(info?.width || 1920));
      const ih = Math.max(2, Number(info?.height || 1080));
      const even = (n: number) => Math.max(2, n - (n % 2));
      regions.slice(0, 8).forEach((r, idx) => {
        const dx0 = Math.max(1, Math.round((iw * clamp(r.x, 0, 99)) / 100));
        const dy0 = Math.max(1, Math.round((ih * clamp(r.y, 0, 99)) / 100));
        let dw = Math.max(2, Math.round((iw * clamp(r.w, 1, 100)) / 100));
        let dh = Math.max(2, Math.round((ih * clamp(r.h, 1, 100)) / 100));
        if (dx0 + dw > iw - 1) dw = Math.max(2, iw - 1 - dx0);
        if (dy0 + dh > ih - 1) dh = Math.max(2, ih - 1 - dy0);
        const dx = Math.min(dx0, iw - 2), dy = Math.min(dy0, ih - 2);
        dw = Math.min(dw, iw - 1 - dx); dh = Math.min(dh, ih - 1 - dy);
        if (dw < 2 || dh < 2) return;
        dlPrefix += `delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh},`;
        const b = Math.max(2, Math.min(20, Math.round(Number(r.blur) || 0)));
        if (b >= 2) {
          const cw = Math.min(even(dw), iw - dx), ch = Math.min(even(dh), ih - dy);
          dlOverlay += `split[base${idx}][tmp${idx}];[tmp${idx}]crop=${cw}:${ch}:${dx}:${dy},boxblur=${b}:1[b${idx}];[base${idx}][b${idx}]overlay=${dx}:${dy},`;
        }
      });
    } catch { /* delogo optional */ }
  }
  const preFilter = `${dlPrefix}${dlOverlay}`;

  const subPart = opts.subtitlePath
    ? `,subtitles='${opts.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}':force_style='${String(subtitleStyle).replace(/'/g, "")}'`
    : "";

  if (wmPath) {
    const margin = Math.max(0, Math.round(wmMargin));
    const scale = Math.max(0.01, Math.min(2.0, Number(wmScale) || 0.18));
    const opacity = Math.max(0, Math.min(1, Number(wmOpacity) || 0.8));
    const xy = wmPos === "top-left" ? `x=${margin}:y=${margin}`
      : wmPos === "top-right" ? `x=W-w-${margin}:y=${margin}`
      : wmPos === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
      : wmPos === "center" ? `x=(W-w)/2:y=(H-h)/2`
      : `x=W-w-${margin}:y=H-h-${margin}`;
    const fc = `[0:v]${preFilter}${baseVf}${subPart}[v1];[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm];[v1][wm]overlay=${xy}[vout]`;
    const args = [
      ...argsBase,
      "-i", wmPath,
      "-filter_complex", fc,
      "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", opts.quality === "fast" ? "veryfast" : "medium", "-crf", crf, "-pix_fmt", "yuv420p",
      ...(loudOn ? ["-af", loudFilter, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"] : ["-c:a", "aac", "-b:a", "160k"]),
      "-movflags", "+faststart", opts.output,
    ];
    const { code, stderr } = await runProcess(FFMPEG, args);
    if (code === 0) return opts.output;
    // fallback without watermark
  }

  if (preFilter) {
    const fc = `[0:v]${preFilter}${baseVf}${subPart}[vout]`;
    const args = [
      ...argsBase,
      "-filter_complex", fc,
      "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", opts.quality === "fast" ? "veryfast" : "medium", "-crf", crf, "-pix_fmt", "yuv420p",
      ...(loudOn ? ["-af", loudFilter, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"] : ["-c:a", "aac", "-b:a", "160k"]),
      "-movflags", "+faststart", opts.output,
    ];
    const { code, stderr } = await runProcess(FFMPEG, args);
    if (code !== 0) {
      // fallback: delogo without region blur, then without subtitles if still failing
      const fc2 = `[0:v]${dlPrefix}${baseVf}[vout]`;
      const args2 = [
        ...argsBase,
        "-filter_complex", fc2,
        "-map", "[vout]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", opts.quality === "fast" ? "veryfast" : "medium", "-crf", crf, "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", opts.output,
      ];
      const r2 = await runProcess(FFMPEG, args2);
      if (r2.code !== 0) throw new Error(`Render failed: ${String(stderr || r2.stderr || "").slice(-600)}`);
    }
    return opts.output;
  }

  const vf = `${baseVf}${subPart}`;
  const args = [
    ...argsBase,
    "-vf", vf,
    ...(loudOn ? ["-af", loudFilter] : []),
    "-c:v", "libx264", "-preset", opts.quality === "fast" ? "veryfast" : "medium", "-crf", crf,
    "-c:a", "aac", "-b:a", "160k", ...(loudOn ? ["-ar", "44100", "-ac", "2"] : []),
    "-movflags", "+faststart", opts.output,
  ];
  const { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) throw new Error(`Render failed: ${stderr.slice(-600)}`);
  return opts.output;
}

/**
 * Keep the source audio but re-encode/clean it: light noise reduction + EBU loudness normalization.
 * Used when the user wants the clip's original sound preserved, not replaced by generated music.
 */
export async function reprocessClipAudio(opts: { input: string; duration?: number }) {
  const dur = Math.max(0.1, Number(opts.duration || 0));
  const tmp = `${opts.input}.audiotmp.mp4`;
  const common = ["-y", "-i", opts.input, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", "-shortest"];
  const base = `[0:a]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS`;
  const full = `${base},afftdn=nr=8:nf=-32,loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.95[aout]`;
  let r = await runProcess(FFMPEG, [...common.slice(0, 3), "-filter_complex", full, ...common.slice(3), tmp]);
  if (r.code !== 0) {
    const simple = `${base},loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
    r = await runProcess(FFMPEG, [...common.slice(0, 3), "-filter_complex", simple, ...common.slice(3), tmp]);
  }
  if (r.code !== 0) throw new Error(`Audio reprocess failed: ${String(r.stderr).slice(-500)}`);
  await fs.rename(tmp, opts.input);
  return opts.input;
}

/**
 * Generate a royalty-free ambient music track locally (pure synthesis, no AI/extract/upload).
 * Cached as a WAV in storage/temp so all clips share one file.
 */
export async function ensureAutoMusicTrack(): Promise<string> {
  const dir = path.join(STORAGE_ROOT, "temp");
  const file = path.join(dir, "auto-music.wav");
  const st = await fs.stat(file).catch(() => null);
  if (st && st.size > 100_000) return file;
  await fs.mkdir(dir, { recursive: true });

  const sr = 44100;
  const secs = 72; // covers the longest clip duration (60s) with headroom
  const n = sr * secs;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);

  // four-se chord loop: Cmaj - Am - F - G (pure sine, no sampled material)
  const chords = [
    [261.63, 329.63, 392.00],
    [220.00, 261.63, 329.63],
    [174.61, 220.00, 261.63],
    [196.00, 246.94, 293.66],
  ];
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const chord = chords[Math.floor(t / 8) % 4];
    const local = t % 8;
    const seg = Math.min(1, local / 0.6, (8 - local) / 0.6);
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const f = chord[k] * (1 + 0.0015 * (k - 1));
      v += 0.09 * Math.sin(2 * Math.PI * f * t + 0.25 * Math.sin(2 * Math.PI * 0.17 * t + k));
      if (k === 0) v += 0.05 * Math.exp(-7 * (t % 0.5)) * Math.sin(2 * Math.PI * f * 2 * t);
    }
    lp += 0.16 * (v - lp);
    const fade = Math.min(1, t / 1.5, (secs - t) / 1.5);
    const out = Math.tanh(1.4 * lp) * fade * seg * 0.85;
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out)) * 32767), 44 + i * 2);
  }
  await fs.writeFile(file, buf);
  return file;
}

/**
 * Replace or duck/mix the audio of an already-rendered clip using a licensed music track.
 * Video stream is stream-copied, so there is no extra video encoding cost.
 */
export async function replaceClipAudio(opts: {
  input: string;
  musicPath: string;
  mode: "replace" | "mix";
  musicVolume?: number;
  originalVolume?: number;
  duration?: number;
  loudnessNormalize?: boolean;
  loudnessFilter?: string;
}) {
  const musicPath = await fs.stat(opts.musicPath).then(() => opts.musicPath).catch(() => null);
  if (!musicPath) throw new Error("Music file not found: " + opts.musicPath);
  const mv = Math.max(0, Math.min(4, Number(opts.musicVolume ?? 1)));
  const ov = Math.max(0, Math.min(4, Number(opts.originalVolume ?? 0.2)));
  const dur = Math.max(0.1, Number(opts.duration || 0));
  let loud = "";
  if (opts.loudnessNormalize !== false) {
    let lf = opts.loudnessFilter;
    if (!lf) {
      try { lf = (await import("./brand")).loudnormFilter(await (await import("./brand")).getBrandKit()); } catch {}
    }
    loud = `,${lf || "alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11"}`;
  }
  const musicChain = `[1:a]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${mv}[ma]`;
  const chain = opts.mode === "replace"
    ? `${musicChain.replace("[ma]", `${loud}[aout]`)}`
    : `[0:a]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${ov}[oa];${musicChain};[oa][ma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0${loud}[aout]`;
  const tmp = `${opts.input}.audiotmp.mp4`;
  const base = ["-y", "-i", opts.input, "-i", musicPath, "-filter_complex", chain, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", "-shortest"];
  let r = await runProcess(FFMPEG, [...base, tmp]);
  if (r.code !== 0 && opts.mode === "mix") {
    // source may have no audio stream — fall back to music only
    const chain2 = `${musicChain.replace("[ma]", `${loud}[aout]`)}`;
    r = await runProcess(FFMPEG, ["-y", "-i", opts.input, "-i", musicPath, "-filter_complex", chain2, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", tmp]);
  }
  if (r.code !== 0) throw new Error(`Audio replace failed: ${String(r.stderr).slice(-500)}`);
  await fs.rename(tmp, opts.input);
  return opts.input;
}

/** Render a motion-typography video from prompt metadata (no image/video input). */
export async function createPromptVideo(opts: {
  output: string;
  title: string;
  description: string;
  aspect: "9:16" | "16:9" | "1:1";
  duration?: number;
  musicPath?: string | null;
}) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const W = opts.aspect === "16:9" ? 1920 : 1080;
  const H = opts.aspect === "9:16" ? 1920 : opts.aspect === "1:1" ? 1080 : 1080;
  const dur = Math.max(6, Math.min(30, Number(opts.duration || 12)));
  const font = process.platform === "win32" ? "C\\\\\\:/Windows/Fonts/arial.ttf" : "Arial";
  const esc = (s: string) => String(s || "")
    .replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\r?\n/g, " ");
  const words = String(opts.description || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 42) { if (line) lines.push(line.trim()); line = w; }
    else line = (line + " " + w).trim();
    if (lines.length >= 4) break;
  }
  if (line && lines.length < 4) lines.push(line);
  const filters = [
    `drawtext=fontfile=${font}:text='${esc(opts.title)}':fontcolor=white:fontsize=${W >= 1920 ? 76 : 56}:x=(w-text_w)/2:y=h/2-170:box=1:boxcolor=black@0.35:boxborderw=20`,
    ...lines.map((l, i) => `drawtext=fontfile=${font}:text='${esc(l)}':fontcolor=0xE9D5FF:fontsize=${W >= 1920 ? 40 : 30}:x=(w-text_w)/2:y=h/2-40+${i}*50`),
  ];
  const args: string[] = ["-y", "-f", "lavfi", "-i", `color=c=0x120b24:s=${W}x${H}:d=${dur}:r=30`];
  const music = opts.musicPath ? await fs.stat(opts.musicPath).then(() => opts.musicPath).catch(() => null) : null;
  if (music) args.push("-stream_loop", "-1", "-i", music);
  args.push("-vf", filters.join(","), "-map", "0:v:0");
  if (music) args.push("-map", "1:a?", "-c:a", "aac", "-b:a", "160k", "-shortest");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", opts.output);
  const r = await runProcess(FFMPEG, args);
  if (r.code !== 0) throw new Error(`Prompt video render failed: ${String(r.stderr).slice(-600)}`);
  return opts.output;
}

/** Build a Ken Burns slideshow video from local images, optionally with looping music. */
export async function createImageSlideshow(opts: {
  images: string[];
  output: string;
  aspect: "9:16" | "16:9" | "1:1";
  secondsPerImage?: number;
  musicPath?: string | null;
}) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const images = opts.images.slice(0, 12);
  if (!images.length) throw new Error("Minimal satu gambar diperlukan.");
  const W = opts.aspect === "16:9" ? 1920 : 1080;
  const H = opts.aspect === "9:16" ? 1920 : opts.aspect === "1:1" ? 1080 : 1080;
  const sec = Math.max(1.5, Math.min(10, Number(opts.secondsPerImage || 3)));
  const args: string[] = ["-y"];
  for (const img of images) args.push("-loop", "1", "-t", String(sec), "-i", img);
  const music = opts.musicPath ? await fs.stat(opts.musicPath).then(() => opts.musicPath).catch(() => null) : null;
  if (music) args.push("-stream_loop", "-1", "-i", music);
  const chains = images.map((_, i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `zoompan=z='min(zoom+0.0012,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30,` +
    `trim=duration=${sec},setpts=PTS-STARTPTS[v${i}]`,
  );
  const labels = images.map((_, i) => `[v${i}]`).join("");
  const filter = `${chains.join(";")};${labels}concat=n=${images.length}:v=1:a=0[vout]`;
  args.push("-filter_complex", filter, "-map", "[vout]");
  if (music) args.push("-map", `${images.length}:a?`, "-c:a", "aac", "-b:a", "160k", "-shortest");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", opts.output);
  const r = await runProcess(FFMPEG, args);
  if (r.code !== 0) throw new Error(`Slideshow render failed: ${String(r.stderr).slice(-600)}`);
  return opts.output;
}

export async function generateThumbnail(input: string, output: string, atSeconds = 1) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const args = ["-y", "-ss", String(atSeconds), "-i", input, "-frames:v", "1", "-q:v", "3", output];
  const { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) throw new Error(`Thumbnail failed: ${stderr.slice(-300)}`);
  return output;
}

export async function convertResizeVideo(opts: { input: string; output: string; aspect: "16:9"|"9:16"|"1:1"|"original"; fit?: "pad"|"crop"; quality?: "high"|"medium"|"fast"; keepAudio?: boolean; loudnessNormalize?: boolean; loudnessFilter?: string; watermarkPath?: string | null; watermarkPosition?: "top-left"|"top-right"|"bottom-left"|"bottom-right"|"center"; watermarkOpacity?: number; watermarkScale?: number; watermarkMargin?: number }) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const aspect = opts.aspect || "original";
  const fit = opts.fit || (aspect === "16:9" || aspect === "original" ? "pad" : "crop");
  const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
  const preset = opts.quality === "fast" ? "veryfast" : "medium";
  let brand: any = null;
  try { brand = await (await import("./brand")).getBrandKit(); } catch {}
  let loudOn = opts.loudnessNormalize ?? brand?.loudnessNormalize;
  let loudFilter = opts.loudnessFilter || (brand ? (await import("./brand")).loudnormFilter(brand) : undefined);
  loudOn = loudOn !== false;
  loudFilter = loudFilter || "alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11";
  let vf = "";
  if (aspect === "9:16") {
    vf = fit === "pad"
      ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1"
      : "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos,setsar=1";
  } else if (aspect === "1:1") {
    vf = fit === "pad"
      ? "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,setsar=1"
      : "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=1080:1080:flags=lanczos,setsar=1";
  } else if (aspect === "16:9") {
    vf = fit === "crop"
      ? "crop=ih*16/9:ih:(iw-ih*16/9)/2:0,scale=1920:1080:flags=lanczos,setsar=1"
      : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";
  } else {
    vf = "scale='min(1920,iw)':-2:force_original_aspect_ratio=decrease,setsar=1";
  }
  const wmPathRaw = opts.watermarkPath !== undefined ? opts.watermarkPath : (brand?.watermarkEnabled ? brand.watermarkPath : null);
  const wmPath = wmPathRaw ? await fs.stat(wmPathRaw).then(()=>wmPathRaw).catch(()=>null) : null;
  const wmPos = opts.watermarkPosition ?? brand?.watermarkPosition ?? "bottom-right";
  const wmOpacity = opts.watermarkOpacity ?? brand?.watermarkOpacity ?? 0.8;
  const wmScale = opts.watermarkScale ?? brand?.watermarkScale ?? 0.18;
  const wmMargin = opts.watermarkMargin ?? brand?.watermarkMargin ?? 24;

  if (wmPath) {
    const margin = Math.max(0, Math.round(wmMargin));
    const scale = Math.max(0.01, Math.min(2.0, Number(wmScale) || 0.18));
    const opacity = Math.max(0, Math.min(1, Number(wmOpacity) || 0.8));
    const xy = wmPos === "top-left" ? `x=${margin}:y=${margin}`
      : wmPos === "top-right" ? `x=W-w-${margin}:y=${margin}`
      : wmPos === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
      : wmPos === "center" ? `x=(W-w)/2:y=(H-h)/2`
      : `x=W-w-${margin}:y=H-h-${margin}`;
    const fc = `[0:v]${vf}[v1];[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm];[v1][wm]overlay=${xy}[vout]`;
    const args = [
      "-y", "-i", opts.input, "-i", wmPath,
      "-filter_complex", fc, "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p",
      ...(opts.keepAudio === false ? ["-an"] : (loudOn ? ["-af", loudFilter, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"] : ["-c:a", "aac", "-b:a", "160k"])),
      "-movflags", "+faststart", opts.output,
    ];
    const { code } = await runProcess(FFMPEG, args);
    if (code === 0) return opts.output;
    // fallback without watermark
  }

  const args = [
    "-y", "-i", opts.input,
    "-vf", vf,
    "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p",
    ...(opts.keepAudio === false ? ["-an"] : (loudOn ? ["-af", loudFilter, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"] : ["-c:a", "aac", "-b:a", "160k"])),
    "-movflags", "+faststart",
    opts.output,
  ];
  const { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) throw new Error(`Convert/resize failed: ${stderr.slice(-700)}`);
  return opts.output;
}

function escapeSubtitleFilterPath(p: string) {
  // ffmpeg subtitles filter escaping: backslashes, colons, single quotes
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function applyWatermarkToVideo(opts: {
  input: string;
  output: string;
  watermarkPath: string;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  watermarkOpacity?: number;
  watermarkScale?: number;
  watermarkMargin?: number;
  quality?: "high" | "medium" | "fast";
}) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const wmPath = await fs.stat(opts.watermarkPath).then(()=>opts.watermarkPath).catch(()=>null);
  if (!wmPath) throw new Error("Watermark file not found");
  const margin = Math.max(0, Math.round(opts.watermarkMargin ?? 24));
  const scale = Math.max(0.01, Math.min(2.0, Number(opts.watermarkScale ?? 0.18) || 0.18));
  const opacity = Math.max(0, Math.min(1, Number(opts.watermarkOpacity ?? 0.8) || 0.8));
  const pos = opts.watermarkPosition || "bottom-right";
  const xy = pos === "top-left" ? `x=${margin}:y=${margin}`
    : pos === "top-right" ? `x=W-w-${margin}:y=${margin}`
    : pos === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
    : pos === "center" ? `x=(W-w)/2:y=(H-h)/2`
    : `x=W-w-${margin}:y=H-h-${margin}`;
  const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
  const presetEnc = opts.quality === "fast" ? "veryfast" : "medium";
  const fc = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm];[0:v][wm]overlay=${xy}[vout]`;
  const args = [
    "-y", "-i", opts.input, "-i", wmPath,
    "-filter_complex", fc, "-map", "[vout]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", presetEnc, "-crf", crf, "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    opts.output,
  ];
  let { code, stderr } = await runProcess(FFMPEG, args);
  if (code !== 0) {
    // fallback re-encode audio if copy fails
    const args2 = [
      "-y", "-i", opts.input, "-i", wmPath,
      "-filter_complex", fc, "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", presetEnc, "-crf", crf, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      opts.output,
    ];
    const r2 = await runProcess(FFMPEG, args2);
    if (r2.code !== 0) throw new Error(`Watermark failed: ${String(r2.stderr || stderr || "").slice(-500)}`);
  }
  return opts.output;
}

export async function burnSubtitlesIntoVideo(opts: {
  input: string;
  subtitlePath: string;
  output: string;
  quality?: "high" | "medium" | "fast";
  subtitleStyle?: string | null;
  watermarkPath?: string | null;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  watermarkOpacity?: number;
  watermarkScale?: number;
  watermarkMargin?: number;
  loudnessNormalize?: boolean;
  loudnessFilter?: string | null;
}) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  // Copy subtitle to a simple temp path to avoid Windows path/escaping issues in subtitles filter
  const tmpSub = path.join(path.dirname(opts.output), `__subs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.srt`);
  await fs.copyFile(opts.subtitlePath, tmpSub);
  const cleanup = async () => { await fs.unlink(tmpSub).catch(() => {}); };
  try {
    const sub = escapeSubtitleFilterPath(tmpSub);
    const style = (opts.subtitleStyle && String(opts.subtitleStyle).trim())
      ? String(opts.subtitleStyle).trim()
      : "FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=35,Alignment=2";
    const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
    const loud = opts.loudnessNormalize === false ? null : (opts.loudnessFilter || "alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11");
    const wmPath = opts.watermarkPath && await fs.stat(opts.watermarkPath).then(()=>opts.watermarkPath!).catch(()=>null);

    const buildVf = () => {
      const subFilter = `subtitles='${sub}':force_style='${style}'`;
      if (!wmPath) return subFilter;
      const margin = Math.max(0, Math.round(opts.watermarkMargin ?? 24));
      const scale = Math.max(0.01, Math.min(2.0, Number(opts.watermarkScale ?? 0.18) || 0.18));
      const opacity = Math.max(0, Math.min(1, Number(opts.watermarkOpacity ?? 0.8) || 0.8));
      const pos = opts.watermarkPosition || "bottom-right";
      const xy = pos === "top-left" ? `x=${margin}:y=${margin}`
        : pos === "top-right" ? `x=W-w-${margin}:y=${margin}`
        : pos === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
        : pos === "center" ? `x=(W-w)/2:y=(H-h)/2`
        : `x=W-w-${margin}:y=H-h-${margin}`;
      return `${subFilter}[vsub];[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm];[vsub][wm]overlay=${xy}`;
    };

    const run = async (vf: string, withWatermark: boolean, copyAudio: boolean) => {
      const args = [
        "-y",
        "-i", opts.input,
        ...(withWatermark && wmPath ? ["-i", wmPath] : []),
        "-filter_complex", vf,
        "-map", "[vsubout]",
      ];
      // not used; fallback below
      return runProcess(FFMPEG, args);
    };

    // Build command variants
    const attempts: Array<{ vf?: string; filterComplex?: string; withWm: boolean; copyAudio: boolean; simpleSub?: boolean }> = [];
    if (wmPath) {
      const fc = (() => {
        const subFilterStyled = `subtitles='${sub}':force_style='${style}'`;
        const subFilterPlain = `subtitles='${sub}'`;
        return { styled: subFilterStyled, plain: subFilterPlain };
      })();
      const margin = Math.max(0, Math.round(opts.watermarkMargin ?? 24));
      const scale = Math.max(0.01, Math.min(2.0, Number(opts.watermarkScale ?? 0.18) || 0.18));
      const opacity = Math.max(0, Math.min(1, Number(opts.watermarkOpacity ?? 0.8) || 0.8));
      const pos = opts.watermarkPosition || "bottom-right";
      const xy = pos === "top-left" ? `x=${margin}:y=${margin}`
        : pos === "top-right" ? `x=W-w-${margin}:y=${margin}`
        : pos === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
        : pos === "center" ? `x=(W-w)/2:y=(H-h)/2`
        : `x=W-w-${margin}:y=H-h-${margin}`;
      const wmChain = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm]`;
      // styled + wm
      attempts.push({ filterComplex: `[0:v]${fc.styled}[vsub];${wmChain};[vsub][wm]overlay=${xy}[vout]`, withWm: true, copyAudio: !loud });
      attempts.push({ filterComplex: `[0:v]${fc.styled}[vsub];${wmChain};[vsub][wm]overlay=${xy}[vout]`, withWm: true, copyAudio: false });
      attempts.push({ filterComplex: `[0:v]${fc.plain}[vsub];${wmChain};[vsub][wm]overlay=${xy}[vout]`, withWm: true, copyAudio: !loud });
      attempts.push({ filterComplex: `[0:v]${fc.plain}[vsub];${wmChain};[vsub][wm]overlay=${xy}[vout]`, withWm: true, copyAudio: false });
    }
    // no watermark variants
    attempts.push({ vf: `subtitles='${sub}':force_style='${style}'`, withWm: false, copyAudio: !loud });
    attempts.push({ vf: `subtitles='${sub}':force_style='${style}'`, withWm: false, copyAudio: false });
    attempts.push({ vf: `subtitles='${sub}'`, withWm: false, copyAudio: !loud });
    attempts.push({ vf: `subtitles='${sub}'`, withWm: false, copyAudio: false });

    let lastErr = "";
    for (const a of attempts) {
      const args: string[] = ["-y", "-i", opts.input];
      if (a.withWm && wmPath) args.push("-i", wmPath);
      if (a.filterComplex) {
        args.push("-filter_complex", a.filterComplex, "-map", "[vout]", "-map", "0:a?");
      } else {
        args.push("-vf", a.vf!);
      }
      args.push("-c:v", "libx264", "-preset", opts.quality === "fast" ? "veryfast" : "medium", "-crf", crf, "-pix_fmt", "yuv420p");
      if (a.copyAudio && !loud) {
        args.push("-c:a", "copy");
      } else if (loud) {
        args.push("-af", loud, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2");
      } else {
        args.push("-c:a", "aac", "-b:a", "160k");
      }
      args.push("-movflags", "+faststart", opts.output);
      const res = await runProcess(FFMPEG, args);
      if (res.code === 0) return opts.output;
      lastErr = String(res.stderr || "").slice(-600);
      // if watermark failed (e.g. bad image), try without it later attempts cover that
    }
    throw new Error(`Burn subtitles failed: ${lastErr}`);
  } finally {
    await cleanup();
  }
}
