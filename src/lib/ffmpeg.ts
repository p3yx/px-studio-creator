import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

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

  const subPart = opts.subtitlePath
    ? `,subtitles='${opts.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}':force_style='${String(subtitleStyle).replace(/'/g, "")}'`
    : "";

  if (wmPath) {
    const margin = Math.max(0, Math.round(wmMargin));
    const scale = Math.max(0.05, Math.min(0.6, Number(wmScale) || 0.18));
    const opacity = Math.max(0, Math.min(1, Number(wmOpacity) || 0.8));
    const xy = wmPos === "top-left" ? `x=${margin}:y=${margin}`
      : wmPos === "top-right" ? `x=W-w-${margin}:y=${margin}`
      : wmPos === "bottom-left" ? `x=${margin}:y=H-h-${margin}`
      : wmPos === "center" ? `x=(W-w)/2:y=(H-h)/2`
      : `x=W-w-${margin}:y=H-h-${margin}`;
    const fc = `[0:v]${baseVf}${subPart}[v1];[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)},scale=iw*${scale.toFixed(4)}:-1[wm];[v1][wm]overlay=${xy}[vout]`;
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
    const scale = Math.max(0.05, Math.min(0.6, Number(wmScale) || 0.18));
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
      const scale = Math.max(0.05, Math.min(0.6, Number(opts.watermarkScale ?? 0.18) || 0.18));
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
      const scale = Math.max(0.05, Math.min(0.6, Number(opts.watermarkScale ?? 0.18) || 0.18));
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
