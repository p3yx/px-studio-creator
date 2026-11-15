import path from "path";
import fs from "fs/promises";
import { runProcess, probeVideo } from "./ffmpeg";
import { getBrandKit, loudnormFilter } from "./brand";

export type MontagePreset = "cinematic" | "amv" | "hype" | "emotional" | "clean" | "story";
export type TransitionType = "cut" | "crossfade" | "fadeblack" | "fadewhite" | "zoom" | "blur" | "slide";

export type MontageInputClip = {
  id: string;
  filePath: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
  trimStart?: number;
  trimEnd?: number;
  order?: number;
  name?: string;
};

export type MontagePlanItem = {
  sourceId: string;
  start: number;
  end: number;
  transition: TransitionType;
  transitionDuration: number;
  effects?: string[];
};

export type MontagePlan = {
  preset: MontagePreset;
  clips: MontagePlanItem[];
  aspect: "16:9" | "9:16" | "1:1";
  fps: number;
  width: number;
  height: number;
  music?: { filePath: string; mode: "music" | "original" | "mix" | "mute-original"; volume?: number; originalVolume?: number } | null;
  notes?: string[];
  autoBeat?: boolean;
  beatPoints?: number[];
};

const presetDefaults: Record<MontagePreset, { transition: TransitionType; td: number; seg: number; fps: number }> = {
  cinematic: { transition: "crossfade", td: 0.6, seg: 4.5, fps: 30 },
  amv: { transition: "cut", td: 0.0, seg: 2.2, fps: 30 },
  hype: { transition: "zoom", td: 0.25, seg: 1.8, fps: 30 },
  emotional: { transition: "crossfade", td: 0.8, seg: 5.0, fps: 30 },
  clean: { transition: "cut", td: 0.0, seg: 3.5, fps: 30 },
  story: { transition: "crossfade", td: 0.5, seg: 4.0, fps: 30 },
};

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

async function analyzeAudioEnergyPoints(filePath: string): Promise<number[]> {
  // Real analysis via FFmpeg silencedetect: derive energy-change boundaries (end/start of silence)
  const ff = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    const { stderr } = await runProcess(ff, ["-hide_banner", "-nostats", "-i", filePath, "-vn", "-af", "silencedetect=noise=-30dB:d=0.20", "-f", "null", "-"]);
    const points: number[] = [];
    const re = /silence_(start|end):\s*([0-9]+(?:\.[0-9]+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stderr || ""))) {
      const t = Number(m[2]);
      if (isFinite(t) && t >= 0) points.push(t);
    }
    // Also add periodic emphasis points from mean volume if very few points
    if (points.length < 4) {
      const { stderr: vstderr } = await runProcess(ff, ["-hide_banner", "-nostats", "-i", filePath, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
      // no direct timestamps, but we can fall back to empty -> caller will use even pacing
      void vstderr;
    }
    const uniq = Array.from(new Set(points.map(p => Math.round(p * 10) / 10))).sort((a, b) => a - b);
    return uniq;
  } catch {
    return [];
  }
}

function snapToBeat(target: number, beatPoints: number[], tolerance = 0.45, min = 0, max = Number.POSITIVE_INFINITY) {
  if (!beatPoints.length) return clamp(target, min, max);
  let best = target;
  let bestDist = tolerance + 1;
  for (const b of beatPoints) {
    const d = Math.abs(b - target);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  if (bestDist <= tolerance) return clamp(best, min, max);
  return clamp(target, min, max);
}

export async function buildMontagePlan(opts: {
  clips: MontageInputClip[];
  preset: MontagePreset;
  aspect: "16:9" | "9:16" | "1:1";
  fps?: number;
  mode?: "auto" | "custom";
  targetDuration?: number;
  customOrder?: string[];
  musicPath?: string | null;
  audioMode?: "music" | "original" | "mix" | "mute-original";
  autoBeat?: boolean;
}): Promise<MontagePlan> {
  const preset = opts.preset || "cinematic";
  const def = presetDefaults[preset] || presetDefaults.cinematic;
  const aspect = opts.aspect || "9:16";
  const wh = aspect === "9:16" ? { width: 1080, height: 1920 } : aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
  const fps = opts.fps && [24,30,60].includes(opts.fps) ? opts.fps : def.fps;

  // enrich/probe
  const enriched: (MontageInputClip & { effStart: number; effEnd: number; effDur: number })[] = [];
  for (const c of opts.clips) {
    let dur = c.duration || 0;
    if (!dur || !isFinite(dur)) {
      try { dur = (await probeVideo(c.filePath)).duration || 0; } catch { dur = 0; }
    }
    const effStart = clamp(c.trimStart ?? 0, 0, Math.max(0, dur - 0.2));
    const rawEnd = c.trimEnd != null ? clamp(c.trimEnd, effStart + 0.2, dur || effStart + 0.2) : dur || effStart + 2;
    const effEnd = clamp(rawEnd, effStart + 0.2, dur || rawEnd);
    enriched.push({ ...c, duration: dur, effStart, effEnd, effDur: Math.max(0.2, effEnd - effStart) });
  }

  let ordered = enriched.slice();
  if (opts.mode === "custom" && opts.customOrder?.length) {
    const map = new Map(ordered.map(o => [o.id, o]));
    const seq = opts.customOrder.map(id => map.get(id)).filter(Boolean) as typeof ordered;
    const rest = ordered.filter(o => !opts.customOrder!.includes(o.id));
    ordered = [...seq, ...rest];
  } else {
    ordered.sort((a,b)=> (a.order ?? 0) - (b.order ?? 0));
    const long = ordered.filter(c=>c.effDur>=5);
    const mid = ordered.filter(c=>c.effDur>=2.5 && c.effDur<5);
    const short = ordered.filter(c=>c.effDur<2.5);
    ordered = [...long.slice(0,1), ...mid, ...short, ...long.slice(1)].filter(Boolean);
    if (!ordered.length) ordered = enriched;
  }

  let beatPoints: number[] = [];
  const autoBeat = !!opts.autoBeat;
  if (autoBeat) {
    const analysisTarget = opts.musicPath || (ordered.find(c => c.hasAudio)?.filePath) || ordered[0]?.filePath;
    if (analysisTarget) {
      try { beatPoints = await analyzeAudioEnergyPoints(analysisTarget); } catch { beatPoints = []; }
    }
  }

  const transitions: TransitionType[] = preset === "amv" || preset === "hype"
    ? ["cut", "cut", "zoom", "crossfade", "blur", "cut"]
    : preset === "cinematic" || preset === "emotional" || preset === "story"
    ? ["crossfade", "crossfade", "fadeblack", "crossfade"]
    : ["cut", "crossfade", "cut"];

  const planItems: MontagePlanItem[] = [];
  let musicCursor = 0;
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    let desired = def.seg + (preset === "story" ? (i === 0 ? 0.8 : i === ordered.length - 1 ? 1.0 : 0) : preset === "amv" ? -0.4 : 0);
    if (autoBeat && beatPoints.length) desired = Math.max(1.0, desired); // keep pacing natural
    let segDur = clamp(desired, 1.2, Math.max(1.2, c.effDur));
    // snap segment duration/end timing to beat points (energy changes) when possible
    if (autoBeat && beatPoints.length) {
      const targetBoundary = musicCursor + segDur;
      const snappedBoundary = snapToBeat(targetBoundary, beatPoints, 0.5, musicCursor + 1.0, musicCursor + Math.min(c.effDur, segDur + 1.2));
      if (snappedBoundary > musicCursor + 0.8) segDur = clamp(snappedBoundary - musicCursor, 1.0, Math.max(1.0, c.effDur));
    }
    const maxStart = Math.max(c.effStart, c.effEnd - segDur);
    let start = c.effStart;
    if (c.effDur > segDur + 0.1) {
      const ratio = ordered.length <= 1 ? 0 : i / (ordered.length - 1);
      const bias = preset === "story" ? (ratio < 0.5 ? 0.2 : 0.55) : preset === "emotional" ? 0.35 : 0.3 + ratio * 0.4;
      start = clamp(c.effStart + (c.effDur - segDur) * bias, c.effStart, maxStart);
    }
    const end = clamp(start + segDur, start + 1.0, c.effEnd);
    const tr = i === 0 ? "cut" : transitions[i % transitions.length];
    const td = tr === "cut" ? 0 : clamp(def.td, 0.2, Math.min(1.0, (end - start) / 3));
    planItems.push({ sourceId: c.id, start, end, transition: tr, transitionDuration: td, effects: [] });
    musicCursor += Math.max(0.5, (end - start) - (td > 0 && tr !== "cut" ? td : 0));
  }

  return {
    preset,
    clips: planItems,
    aspect,
    fps,
    width: wh.width,
    height: wh.height,
    music: opts.musicPath ? { filePath: opts.musicPath, mode: opts.audioMode || "mix", volume: 1, originalVolume: 0.8 } : null,
    autoBeat,
    beatPoints: autoBeat ? beatPoints.slice(0, 300) : undefined,
    notes: [
      `Auto plan generated for ${planItems.length} clip(s) with ${preset} preset.`,
      autoBeat ? `Auto beat/energy sync ${beatPoints.length ? `aktif (${beatPoints.length} titik energi terdeteksi).` : "diaktifkan (analisis energi terbatas, fallback pacing)."}` : "Transitions and segment windows selected heuristically for pacing.",
    ],
  };
}

function scaleCropFilter(w: number, h: number) {
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,format=yuv420p`;
}

function xfadeName(t: TransitionType) {
  switch (t) {
    case "crossfade": return "fade";
    case "fadeblack": return "fadeblack";
    case "fadewhite": return "fadewhite";
    case "zoom": return "zoomin";
    case "blur": return "fade";
    case "slide": return "slideleft";
    default: return "fade";
  }
}

export async function renderMontage(opts: {
  plan: MontagePlan;
  sources: Record<string, { filePath: string; hasAudio?: boolean }>;
  outputPath: string;
  workDir: string;
  quality?: "high" | "medium" | "fast";
  onProgress?: (stage: string, progress: number) => Promise<void> | void;
}) {
  const { plan } = opts;
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  await fs.mkdir(opts.workDir, { recursive: true });
  const fps = plan.fps || 30;
  const w = plan.width, h = plan.height;
  const crf = opts.quality === "high" ? "20" : opts.quality === "fast" ? "28" : "23";
  const presetEnc = opts.quality === "fast" ? "veryfast" : "medium";

  const segs = plan.clips.filter(c => opts.sources[c.sourceId]?.filePath);
  if (segs.length === 0) throw new Error("No valid clips to render");

  await opts.onProgress?.("Preparing Media", 20);
  const interVideos: string[] = [];
  const interAudios: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const src = opts.sources[s.sourceId];
    const dur = Math.max(0.5, s.end - s.start);
    const vOut = path.join(opts.workDir, `seg-${i}.mp4`);
    const aOut = path.join(opts.workDir, `seg-${i}.wav`);
    const vf = `fps=${fps},${scaleCropFilter(w,h)}`;
    let args = ["-y", "-ss", String(s.start), "-t", String(dur), "-i", src.filePath, "-an", "-vf", vf, "-c:v", "libx264", "-preset", presetEnc, "-crf", crf, "-pix_fmt", "yuv420p", vOut];
    let r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", args);
    if (r.code !== 0) throw new Error(`Failed to prepare segment ${i + 1}: ${r.stderr.slice(-400)}`);
    interVideos.push(vOut);
    const hasAudio = src.hasAudio !== false;
    if (hasAudio) {
      args = ["-y", "-ss", String(s.start), "-t", String(dur), "-i", src.filePath, "-vn", "-af", "aformat=sample_rates=44100:channel_layouts=stereo,aresample=async=1", "-c:a", "pcm_s16le", aOut];
      r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", args);
      if (r.code !== 0) {
        args = ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(dur), "-c:a", "pcm_s16le", aOut];
        r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", args);
      }
    } else {
      args = ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(dur), "-c:a", "pcm_s16le", aOut];
      r = await runProcess(process.env.FFMPEG_PATH || "ffmpeg", args);
    }
    if (r.code !== 0) throw new Error(`Failed to prepare audio for segment ${i + 1}`);
    interAudios.push(aOut);
    await opts.onProgress?.("Processing Transitions", 20 + Math.round(((i + 1) / segs.length) * 35));
  }

  await opts.onProgress?.("Synchronizing Audio", 60);
  const ff = process.env.FFMPEG_PATH || "ffmpeg";
  const inArgs: string[] = [];
  for (let i = 0; i < interVideos.length; i++) { inArgs.push("-i", interVideos[i], "-i", interAudios[i]); }

  const durs: number[] = [];
  for (let i = 0; i < segs.length; i++) durs.push(Math.max(0.5, segs[i].end - segs[i].start));
  const tds = segs.map((s, i) => i === 0 ? 0 : clamp(s.transitionDuration || 0, 0, Math.min(1.2, durs[i] / 3, durs[i - 1] / 3)));

  let filter = "";
  for (let i = 0; i < segs.length; i++) {
    filter += `[${i * 2}:v]settb=AVTB[v${i}];`;
    filter += `[${i * 2 + 1}:a]asetpts=PTS-STARTPTS[a${i}];`;
  }
  let curV = "v0", curA = "a0", curDur = durs[0];
  if (segs.length === 1) {
    // single segment: expose expected pre-output labels for music/original handling
    filter += `[v0]null[voutpre];[a0]anull[aoutpre];`;
    curV = "voutpre"; curA = "aoutpre";
  }
  for (let i = 1; i < segs.length; i++) {
    const td = tds[i];
    const tr = segs[i].transition || "crossfade";
    const offset = Math.max(0, curDur - td);
    const outV = i === segs.length - 1 ? "voutpre" : `vx${i}`;
    const outA = i === segs.length - 1 ? "aoutpre" : `ax${i}`;
    if (td > 0.01 && tr !== "cut") {
      const xf = xfadeName(tr);
      filter += `[${curV}][v${i}]xfade=transition=${xf}:duration=${td.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}];`;
      filter += `[${curA}][a${i}]acrossfade=d=${td.toFixed(3)}:c1=tri:c2=tri[${outA}];`;
    } else {
      filter += `[${curV}][v${i}]concat=n=2:v=1:a=0[${outV}];`;
      filter += `[${curA}][a${i}]concat=n=2:v=0:a=1[${outA}];`;
    }
    curV = outV; curA = outA; curDur = curDur + durs[i] - (td > 0.01 && tr !== "cut" ? td : 0);
  }

  const brand = await getBrandKit().catch(() => null);
  const loud = brand && brand.loudnessNormalize === false ? "alimiter=limit=0.95" : loudnormFilter(brand || { loudnessTargetI: -14, loudnessTargetTP: -1.5, loudnessTargetLRA: 11 } as any);
  const music = plan.music && plan.music.filePath && (plan.music.mode === "music" || plan.music.mode === "mix" || plan.music.mode === "mute-original") ? plan.music : null;
  if (music) {
    const musicIdx = segs.length * 2;
    inArgs.push("-i", music.filePath);
    const mvol = music.volume ?? 1.0;
    const ovol = music.mode === "music" ? 0 : (music.originalVolume ?? 0.8);
    if (music.mode === "music" || ovol === 0) {
      filter += `[${musicIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${mvol}[m1];`;
      filter += `[m1]atrim=0:${curDur.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, curDur - 0.8).toFixed(3)}:d=0.8,${loud}[aout];`;
      filter += `[voutpre]null[vout];`;
    } else {
      filter += `[${musicIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${mvol}[m1];`;
      filter += `[m1]atrim=0:${curDur.toFixed(3)},asetpts=PTS-STARTPTS[m2];`;
      filter += `[aoutpre]volume=${ovol}[aorig];`;
      filter += `[aorig][m2]amix=inputs=2:duration=first:dropout_transition=2,afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, curDur - 0.8).toFixed(3)}:d=0.8,${loud}[aout];`;
      filter += `[voutpre]null[vout];`;
    }
  } else if (plan.music && plan.music.mode === "original") {
    filter += `[aoutpre]${loud}[aout];[voutpre]null[vout];`;
  } else {
    filter += `[aoutpre]${loud}[aout];[voutpre]null[vout];`;
  }

  await opts.onProgress?.("Rendering", 75);
  const args = ["-y", ...inArgs, "-filter_complex", filter.replace(/;$/, ""), "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", presetEnc, "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", opts.outputPath];
  const res = await runProcess(ff, args);
  if (res.code !== 0) throw new Error(`Montage render failed: ${res.stderr.slice(-800)}`);

  await opts.onProgress?.("Finalizing", 98);
  let duration = 0, width = w, height = h;
  try { const p = await probeVideo(opts.outputPath); duration = p.duration || curDur; width = p.width || w; height = p.height || h; } catch { duration = curDur; }
  await opts.onProgress?.("Finalizing", 100);
  return { outputPath: opts.outputPath, duration, width, height };
}
