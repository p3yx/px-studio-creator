import path from "path";
import fs from "fs/promises";
import { runProcess, probeVideo } from "@/lib/ffmpeg";
import { getBrandKit, loudnormFilter } from "@/lib/brand";

export type BeatRenderOptions = {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  plan: any;
  mode: "mix" | "replace" | "music" | string;
  musicVolume: number;
  originalVolume: number;
  onProgress?: (stage: string, progress: number) => Promise<void> | void;
};

export async function renderBeatSync(opts: BeatRenderOptions) {
  const { videoPath, audioPath, outputPath, plan } = opts;
  const mode = String(opts.mode || "replace");
  const musicVolume = Math.max(0, Math.min(2, Number(opts.musicVolume || 1)));
  const originalVolume = Math.max(0, Math.min(2, Number(opts.originalVolume || 0.8)));

  await opts.onProgress?.("Preparing", 5);
  const ff = process.env.FFMPEG_PATH || "ffmpeg";
  const probe = await probeVideo(videoPath);
  const vDur = Math.max(0.5, probe.duration || 0.5);
  const targetDur = Math.max(1, Math.min(Number(plan?.duration) || 99999, 600));

  let ow = probe.width || 1280, oh = probe.height || 720;
  const maxW = 1280, maxH = 1280;
  if (ow > maxW || oh > maxH) {
    const r = Math.min(maxW / ow, maxH / oh);
    ow = Math.max(2, Math.floor(ow * r / 2) * 2);
    oh = Math.max(2, Math.floor(oh * r / 2) * 2);
  } else {
    ow = Math.max(2, Math.floor(ow / 2) * 2);
    oh = Math.max(2, Math.floor(oh / 2) * 2);
  }

  let cuts: number[] = (Array.isArray(plan?.cuts) ? plan.cuts : []).map((x: any) => Number(x)).filter((x: number) => isFinite(x)).sort((a: number, b: number) => a - b);
  cuts = cuts.map(c => Math.max(0, Math.min(c, targetDur)));
  const minSeg = Math.max(0.8, Math.min(4, Number(plan?.minSegment) > 0 ? Number(plan.minSegment) : 1.2));
  const merged: number[] = [0];
  for (let i = 1; i < cuts.length; i++) {
    const c = cuts[i];
    if (c - merged[merged.length - 1] >= minSeg) merged.push(c);
  }
  if (merged[merged.length - 1] < targetDur - 0.2) merged.push(Math.min(targetDur, Number(plan?.duration) || targetDur));
  const MAX_SEG = 32;
  let finalCuts = merged;
  if (finalCuts.length - 1 > MAX_SEG) {
    const total = Math.max(1, finalCuts[finalCuts.length - 1] - finalCuts[0]);
    const step = total / MAX_SEG;
    const nc: number[] = [finalCuts[0]];
    for (let i = 1; i < MAX_SEG; i++) nc.push(+ (finalCuts[0] + step * i).toFixed(3));
    nc.push(finalCuts[finalCuts.length - 1]);
    finalCuts = nc;
  }

  const segments: { dur: number; srcStart: number }[] = [];
  let cursorSrc = 0;
  for (let i = 0; i < finalCuts.length - 1; i++) {
    let dur = Math.max(0.5, finalCuts[i + 1] - finalCuts[i]);
    dur = Math.min(dur, Math.max(0.5, vDur));
    let srcStart = cursorSrc % Math.max(0.1, vDur - 0.1);
    if (srcStart + dur > vDur) srcStart = Math.max(0, vDur - dur);
    segments.push({ dur, srcStart });
    cursorSrc += dur * 0.9;
  }
  if (!segments.length) throw new Error("Tidak ada segmen yang dapat dibuat dari plan");

  const intensity = String(plan?.intensity || "balanced");
  const wantZoom = !!plan?.beatZoom;
  const wantTransition = !!plan?.beatTransition && segments.length > 1;
  const n = segments.length;
  const useXfade = wantTransition && n <= 24;
  const useZoom = wantZoom && n <= 20;
  const xfadeDur = intensity === "aggressive" ? 0.15 : intensity === "dynamic" ? 0.22 : intensity === "subtle" ? 0.35 : 0.25;
  const totalDur = segments.reduce((a, s) => a + s.dur, 0);
  const renderDur = Math.max(1, Math.min(totalDur, targetDur));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await opts.onProgress?.("Rendering", 20);

  const buildFilter = (simple: boolean) => {
    let filter = "";
    const vLabels: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = segments[i];
      const label = `v${i}`;
      const base = `[0:v]trim=start=${s.srcStart.toFixed(3)}:duration=${s.dur.toFixed(3)},setpts=PTS-STARTPTS,scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
      const doZ = !simple && useZoom && (intensity === "aggressive" || intensity === "dynamic" || (plan?.beatImpact && i % 2 === 0));
      if (doZ) {
        const zAmt = intensity === "aggressive" ? 0.0012 : intensity === "dynamic" ? 0.0008 : 0.0005;
        filter += `${base},zoompan=z='min(zoom+${zAmt},1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${ow}x${oh},fps=30[${label}];`;
      } else {
        filter += `${base}[${label}];`;
      }
      vLabels.push(label);
    }
    if (!simple && useXfade && n > 1) {
      let cur = vLabels[0];
      let curDur = segments[0].dur;
      for (let i = 1; i < n; i++) {
        const next = vLabels[i];
        const outL = i === n - 1 ? "vout" : `vx${i}`;
        const d = Math.max(0.05, Math.min(xfadeDur, segments[i - 1].dur / 2.5, segments[i].dur / 2.5, 0.6));
        const offset = Math.max(0, curDur - d);
        const trans = intensity === "aggressive" ? (i % 2 ? "fade" : "wipeleft") : "fade";
        filter += `[${cur}][${next}]xfade=transition=${trans}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${outL}];`;
        curDur = curDur + segments[i].dur - d;
        cur = outL;
      }
    } else {
      filter += `${vLabels.map(l => `[${l}]`).join("")}concat=n=${n}:v=1:a=0[vout];`;
    }
    if (mode === "mix") {
      filter += `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${originalVolume}[a0];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,${loud}[aout]`;
    } else {
      filter += `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume},${loud}[aout]`;
    }
    return filter;
  };

  const runRender = async (filter: string) => runProcess(ff, [
    "-y",
    "-i", videoPath,
    "-stream_loop", "-1", "-i", audioPath,
    "-filter_complex", filter,
    "-map", "[vout]", "-map", "[aout]",
    "-t", String(renderDur),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    outputPath,
  ]);

  let r = await runRender(buildFilter(false));
  if (r.code !== 0) r = await runRender(buildFilter(true));
  if (r.code !== 0) {
    const fallbackFilter = mode === "mix"
      ? `[0:v]scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[vout];[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${originalVolume}[a0];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,${loud}[aout]`
      : `[0:v]scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[vout];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume},${loud}[aout]`;
    r = await runRender(fallbackFilter);
    if (r.code !== 0) throw new Error(`Gagal merender Auto Beat: ${(r.stderr || r.stdout || "").slice(-800)}`);
  }

  // Optional watermark post-process
  try {
    const wmKit = brand || await getBrandKit().catch(() => null);
    if (wmKit?.watermarkEnabled && wmKit.watermarkPath) {
      await opts.onProgress?.("Finalizing", 97);
      const tmpOut = outputPath.replace(/\.mp4$/i, "") + `.wm-${Date.now()}.mp4`;
      const ffmod = await import("@/lib/ffmpeg");
      await ffmod.applyWatermarkToVideo({
        input: outputPath,
        output: tmpOut,
        watermarkPath: wmKit.watermarkPath,
        watermarkPosition: wmKit.watermarkPosition,
        watermarkOpacity: wmKit.watermarkOpacity,
        watermarkScale: wmKit.watermarkScale,
        watermarkMargin: wmKit.watermarkMargin,
        quality: "medium",
      });
      await fs.rename(tmpOut, outputPath).catch(async () => { await fs.copyFile(tmpOut, outputPath); await fs.unlink(tmpOut).catch(()=>{}); });
    }
  } catch {}

  await opts.onProgress?.("Finalizing", 95);
  let duration: number | null = null;
  try { duration = (await probeVideo(outputPath)).duration || null; } catch {}
  const st = await fs.stat(outputPath).catch(() => null);
  const simplified = !useXfade || !useZoom || merged.length - 1 > MAX_SEG ? " (disederhanakan agar render stabil)" : "";

  return {
    outputPath,
    duration,
    fileSize: st?.size || null,
    segments: n,
    note: `Auto Beat diterapkan (${plan?.preset || 'preset'}, ${n} segmen, mode ${mode})${simplified}.`,
    width: ow,
    height: oh,
  };
}
