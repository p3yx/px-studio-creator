import path from "path";
import fs from "fs/promises";
import { runProcess, renderClip } from "./ffmpeg";
import { EditorTimeline, timelineDuration } from "./editor";

function aspectOf(t: EditorTimeline): "16:9" | "9:16" | "1:1" {
  if (t.width === t.height) return "1:1";
  return t.height > t.width ? "9:16" : "16:9";
}

function escapeConcat(p: string) {
  return p.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function makeFiller(out: string, seconds: number, t: EditorTimeline) {
  const args = [
    "-y", "-f", "lavfi", "-i", `color=c=black:s=${t.width}x${t.height}:r=${t.fps}:d=${seconds}`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest", out,
  ];
  const r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", args);
  if (r.code !== 0) throw new Error(`Filler gagal: ${String(r.stderr).slice(-300)}`);
}

export async function renderEditorTimeline(opts: {
  timeline: EditorTimeline;
  workDir: string;
  output: string;
  onProgress?: (stage: string, progress: number) => Promise<void> | void;
}) {
  const t = opts.timeline;
  await fs.mkdir(opts.workDir, { recursive: true });
  const segDir = path.join(opts.workDir, "segments");
  await fs.mkdir(segDir, { recursive: true });
  const videos = t.tracks
    .filter(tr => tr.type === "video" && !tr.hidden)
    .flatMap(tr => tr.clips.filter(c => c.path))
    .sort((a, b) => a.start - b.start);
  if (!videos.length) throw new Error("Timeline tidak memiliki clip video.");

  const total = Math.max(timelineDuration(t), videos[videos.length - 1].start + videos[videos.length - 1].duration);
  const segs: string[] = [];
  let cursor = 0;
  let index = 0;
  for (const c of videos) {
    const gap = Math.max(0, c.start - cursor);
    if (gap > 0.05) {
      const filler = path.join(segDir, `gap-${index}.mp4`);
      await makeFiller(filler, Math.min(gap, 60), t);
      segs.push(filler);
    }
    const seg = path.join(segDir, `seg-${index}.mp4`);
    await renderClip({
      input: c.path, output: seg, start: c.sourceIn, end: c.sourceOut,
      aspect: aspectOf(t), quality: "fast",
    });
    segs.push(seg);
    cursor = c.start + c.duration;
    index++;
    await opts.onProgress?.("Rendering", Math.round((index / videos.length) * 70));
  }
  const tail = Math.max(0, total - cursor);
  if (tail > 0.05) {
    const filler = path.join(segDir, `tail.mp4`);
    await makeFiller(filler, Math.min(tail, 60), t);
    segs.push(filler);
  }

  const listPath = path.join(opts.workDir, "concat.txt");
  await fs.writeFile(listPath, segs.map(s => `file '${escapeConcat(s)}'`).join("\n"), "utf8");
  const joined = path.join(opts.workDir, "joined.mp4");
  let r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", joined]);
  if (r.code !== 0) throw new Error(`Concat gagal: ${String(r.stderr).slice(-500)}`);

  // Optional audio tracks: per-clip trim + delay + mix, then mux over the joined video.
  const audios = t.tracks
    .filter(tr => tr.type === "audio" && !tr.muted)
    .flatMap(tr => tr.clips.filter(c => c.path).map(c => ({ ...c, volume: tr.volume ?? 1 })));
  if (audios.length) {
    const wavs: string[] = [];
    for (let i = 0; i < audios.length; i++) {
      const c = audios[i];
      const wav = path.join(segDir, `audio-${i}.wav`);
      const delay = Math.max(0, Math.round(c.start * 1000));
      const af = `atrim=${c.sourceIn}:${c.sourceOut},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${c.volume}`;
      const ar = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", c.path, "-af", af, "-ac", "2", "-ar", "44100", wav]);
      if (ar.code === 0) wavs.push(wav);
    }
    if (wavs.length) {
      const mix = path.join(opts.workDir, "mix.wav");
      const inputs = wavs.flatMap(w => ["-i", w]);
      const filter = wavs.map((_, i) => `[${i}:a]`).join("") + `amix=inputs=${wavs.length}:duration=longest:normalize=0[aout]`;
      const mr = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", [...inputs, "-filter_complex", filter, "-map", "[aout]", "-ac", "2", "-ar", "44100", mix]);
      if (mr.code === 0) {
        r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", joined, "-i", mix, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", opts.output]);
        if (r.code !== 0) throw new Error(`Audio mux gagal: ${String(r.stderr).slice(-400)}`);
        await opts.onProgress?.("Rendering", 100);
        return { outputPath: opts.output, duration: total };
      }
    }
  }
  await fs.copyFile(joined, opts.output);
  await opts.onProgress?.("Rendering", 100);
  return { outputPath: opts.output, duration: total };
}
