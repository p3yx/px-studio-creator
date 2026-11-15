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
  const vfParts = [aspectFilter(opts.aspect)];
  if (opts.subtitlePath) {
    // escape for ffmpeg filter
    const sub = opts.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const style = "FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=35,Alignment=2";
    vfParts.push(`subtitles='${sub}':force_style='${style}'`);
  }
  const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
  const args = [
    "-y",
    "-ss", String(opts.start),
    "-t", String(duration),
    "-i", opts.input,
    "-vf", vfParts.join(","),
    "-c:v", "libx264",
    "-preset", opts.quality === "fast" ? "veryfast" : "medium",
    "-crf", crf,
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    opts.output,
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

function escapeSubtitleFilterPath(p: string) {
  // ffmpeg subtitles filter escaping: backslashes, colons, single quotes
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function burnSubtitlesIntoVideo(opts: { input: string; subtitlePath: string; output: string; quality?: "high" | "medium" | "fast" }) {
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  // Copy subtitle to a simple temp path to avoid Windows path/escaping issues in subtitles filter
  const tmpSub = path.join(path.dirname(opts.output), `__subs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.srt`);
  await fs.copyFile(opts.subtitlePath, tmpSub);
  const cleanup = async () => { await fs.unlink(tmpSub).catch(() => {}); };
  try {
    const sub = escapeSubtitleFilterPath(tmpSub);
    const style = "FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=35,Alignment=2";
    const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
    const run = async (vf: string, copyAudio: boolean) => {
      const args = [
        "-y",
        "-i", opts.input,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", opts.quality === "fast" ? "veryfast" : "medium",
        "-crf", crf,
        ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"]),
        "-movflags", "+faststart",
        opts.output,
      ];
      return runProcess(FFMPEG, args);
    };

    // Try with readable style first, then fallback to plain subtitles filter
    let res = await run(`subtitles='${sub}':force_style='${style}'`, true);
    if (res.code !== 0) res = await run(`subtitles='${sub}':force_style='${style}'`, false);
    if (res.code !== 0) res = await run(`subtitles='${sub}'`, true);
    if (res.code !== 0) res = await run(`subtitles='${sub}'`, false);
    if (res.code !== 0) throw new Error(`Burn subtitles failed: ${String(res.stderr || "").slice(-600)}`);
    return opts.output;
  } finally {
    await cleanup();
  }
}
