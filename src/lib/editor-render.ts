import path from "path";
import fs from "fs/promises";
import { runProcess } from "./ffmpeg";
import { EditorTimeline, EditorClip, timelineDuration } from "./editor";

const FF = () => process.env.FFMPEG_PATH || "ffmpeg";
const FONT = process.platform === "win32" ? "C\\\\\\:/Windows/Fonts/arial.ttf" : "Arial";

function aspectOf(t: EditorTimeline): "16:9" | "9:16" | "1:1" {
  if (t.width === t.height) return "1:1";
  return t.height > t.width ? "9:16" : "16:9";
}
function escapeConcat(p: string) { return p.replace(/\\/g, "/").replace(/'/g, "'\\''"); }
function esc(s: string) { return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\r?\n/g, " "); }
function hexColor(c: string) { return String(c || "#FFFFFF").replace(/^#/, "0x"); }

function easeExpr(p: string, mode: string) {
  if (mode === "easeIn") return `(${p})*(${p})`;
  if (mode === "easeOut") return `1-(1-(${p}))*(1-(${p}))`;
  if (mode === "easeInOut") return `if(lt(${p},0.5),2*${p}*${p},1-2*(1-${p})*(1-${p}))`;
  return p;
}

function animExpr(base: number, keyframes: any[], duration: number) {
  const kfs = (keyframes || []).filter(k => Number.isFinite(Number(k.time)) && k.time >= 0 && k.time <= duration + 0.01);
  if (!kfs.length) return String(base);
  kfs.sort((a: any, b: any) => Number(a.time) - Number(b.time));
  let expr = String(base);
  const last = kfs[kfs.length - 1];
  expr = `${Number(last.value)}`;
  for (let i = kfs.length - 1; i >= 0; i--) {
    const k = kfs[i];
    const prevValue = i > 0 ? Number(kfs[i - 1].value) : Number(base);
    const t0 = i > 0 ? Number(kfs[i - 1].time) : 0;
    const t1 = Math.max(Number(k.time), t0 + 0.001);
    const span = Math.max(0.001, t1 - t0).toFixed(3);
    const prog = `min(max((T-${t0.toFixed(3)})/${span},0),1)`;
    const e = easeExpr(prog, String(k.interpolation || "linear"));
    const seg = `(${prevValue}+(${Number(k.value)}-${prevValue})*${e})`;
    expr = `if(lt(T,${t1.toFixed(3)}),${seg},${expr})`;
  }
  void last;
  return expr;
}

async function makeFiller(out: string, seconds: number, t: EditorTimeline) {
  const r = await runProcess(FF(), [
    "-y", "-f", "lavfi", "-i", `color=c=black:s=${t.width}x${t.height}:r=${t.fps}:d=${seconds}`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest", out,
  ]);
  if (r.code !== 0) throw new Error(`Filler gagal: ${String(r.stderr).slice(-300)}`);
}

async function renderSegment(c: EditorClip, t: EditorTimeline, texts: EditorClip[], out: string) {
  const speed = Math.max(0.25, Math.min(4, Number(c.speed || 1)));
  const raw = Math.max(0.1, c.sourceOut - c.sourceIn);
  const dur = raw / speed;
  const vf: string[] = [`scale=${t.width}:${t.height}:force_original_aspect_ratio=increase,crop=${t.width}:${t.height}`];
  if (speed !== 1) vf.push(`setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`);
  if (c.brightness || c.contrast !== 1 || c.saturation !== 1) {
    vf.push(`eq=brightness=${(Number(c.brightness || 0) * 0.2).toFixed(3)}:contrast=${Number(c.contrast || 1).toFixed(3)}:saturation=${Number(c.saturation || 1).toFixed(3)}`);
  }
  const opKfs = (c.keyframes || []).filter(k => k.property === "opacity");
  const opExpr = animExpr(Number(c.opacity ?? 1), opKfs, dur);
  if (opExpr !== String(Number(c.opacity ?? 1)) || Number(c.opacity ?? 1) < 1) {
    vf.push(`format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(max(${opExpr},0),1)',format=yuv420p`);
  }
  const inten = Math.max(0, Math.min(100, Number(c.effectIntensity || 30)));
  if (c.effect === "blur") vf.push(`gblur=sigma=${(inten / 10).toFixed(2)}`);
  if (c.effect === "vignette") vf.push("vignette=PI/4");
  if (c.effect === "grain") vf.push(`noise=alls=${Math.max(1, Math.round(inten / 3))}:allf=t`);
  if (c.effect === "shake") {
    vf.push(`scale=${t.width + 40}:${t.height + 40},crop=${t.width}:${t.height}:x='20+${(inten / 5).toFixed(1)}*sin(T*18)':y='20+${(inten / 5).toFixed(1)}*cos(T*15)'`);
  }
  const trDur = c.transitionIn === "fade" ? Math.max(0, Number(c.transitionDuration || 0)) : 0;
  const fi = Math.max(0, Number(c.fadeIn || 0), trDur);
  const fo = Math.max(0, Number(c.fadeOut || 0));
  if (fi > 0) vf.push(`fade=t=in:st=0:d=${Math.min(fi, dur).toFixed(3)}`);
  if (fo > 0) vf.push(`fade=t=out:st=${Math.max(0, dur - Math.min(fo, dur)).toFixed(3)}:d=${Math.min(fo, dur).toFixed(3)}`);

  // Text overlays that are active during this clip.
  for (const tx of texts) {
    if (!tx.text) continue;
    const ts = Math.max(0, tx.start - c.start);
    const te = Math.min(dur, tx.start + tx.duration - c.start);
    if (te <= ts) continue;
    const xExpr = `(w-text_w)*${Math.max(0, Math.min(100, Number(tx.x ?? 50)))}/100`;
    const yExpr = `(h-text_h)*${Math.max(0, Math.min(100, Number(tx.y ?? 50)))}/100`;
    vf.push(`drawtext=fontfile=${FONT}:text='${esc(tx.text)}':fontcolor=${hexColor(tx.color)}:fontsize=${Math.round(tx.fontSize || 48)}:x='${xExpr}':y='${yExpr}':enable='between(t,${ts.toFixed(3)},${te.toFixed(3)})'`);
  }

  const af: string[] = [];
  if (speed !== 1) af.push(`atempo=${speed.toFixed(4)}`);
  const volKfs = (c.keyframes || []).filter(k => k.property === "volume");
  const volExpr = animExpr(Number(c.volume ?? 1), volKfs, dur);
  if (volExpr !== String(Number(c.volume ?? 1)) || Number(c.volume ?? 1) !== 1) {
    af.push(`volume='${volExpr}':eval=frame`);
  }
  if (fi > 0) af.push(`afade=t=in:st=0:d=${Math.min(fi, dur).toFixed(3)}`);
  if (fo > 0) af.push(`afade=t=out:st=${Math.max(0, dur - Math.min(fo, dur)).toFixed(3)}:d=${Math.min(fo, dur).toFixed(3)}`);

  const args = [
    "-y", "-ss", String(c.sourceIn), "-t", String(raw), "-i", c.path,
    "-vf", vf.join(","), "-map", "0:v:0", "-map", "0:a?",
    ...(af.length ? ["-af", af.join(",")] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", out,
  ];
  const r = await runProcess(FF(), args);
  if (r.code !== 0) throw new Error(`Segment gagal (${c.name}): ${String(r.stderr).slice(-500)}`);
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
  const texts = t.tracks.flatMap(tr => tr.clips).filter(c => c.kind === "text" && c.text);
  const videos = t.tracks
    .filter(tr => tr.type === "video" && !tr.hidden)
    .flatMap(tr => tr.clips.filter(c => c.path && c.kind !== "text"))
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
    await renderSegment(c, t, texts, seg);
    segs.push(seg);
    cursor = c.start + c.duration;
    index++;
    await opts.onProgress?.("Rendering", Math.round((index / videos.length) * 70));
  }
  const tail = Math.max(0, total - cursor);
  if (tail > 0.05) {
    const filler = path.join(segDir, "tail.mp4");
    await makeFiller(filler, Math.min(tail, 60), t);
    segs.push(filler);
  }

  const listPath = path.join(opts.workDir, "concat.txt");
  await fs.writeFile(listPath, segs.map(s => `file '${escapeConcat(s)}'`).join("\n"), "utf8");
  const joined = path.join(opts.workDir, "joined.mp4");
  let r = await runProcess(FF(), ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", joined]);
  if (r.code !== 0) throw new Error(`Concat gagal: ${String(r.stderr).slice(-500)}`);

  // Multi-track compositing: every video track after the first becomes a transparent overlay lane.
  const videoTracks = t.tracks.filter(tr => tr.type === "video" && !tr.hidden);
  const overlays = videoTracks.slice(1).flatMap(tr => tr.clips.filter(c => c.path && c.kind !== "text"));
  if (overlays.length) {
    const movs: { file: string; start: number; duration: number }[] = [];
    for (let i = 0; i < overlays.length; i++) {
      const c = overlays[i];
      const mov = path.join(segDir, `overlay-${i}.mov`);
      const raw = Math.max(0.1, c.sourceOut - c.sourceIn);
      const op = Number(c.opacity ?? 1);
      const vf = `scale=iw*0.45:-2,format=rgba,colorchannelmixer=aa=${op.toFixed(3)},format=argb`;
      const mr = await runProcess(FF(), [
        "-y", "-ss", String(c.sourceIn), "-t", String(raw), "-i", c.path,
        "-vf", vf, "-an", "-c:v", "qtrle", mov,
      ]);
      if (mr.code === 0) movs.push({ file: mov, start: c.start, duration: c.duration });
    }
    if (movs.length) {
      const inputs = [joined, ...movs.map(m => m.file)].flatMap(f => ["-i", f]);
      let fc = "[0:v]format=rgba[b0]";
      let cur = "b0";
      movs.forEach((m, i) => {
        const x = `(W-w)*${Math.max(0, Math.min(100, Number(overlays[i].x ?? 50)))}/100`;
        const y = `(H-h)*${Math.max(0, Math.min(100, Number(overlays[i].y ?? 50)))}/100`;
        const out = i === movs.length - 1 ? "[vcomp]" : `[b${i + 1}]`;
        fc += `;[${i + 1}:v]format=rgba[ov${i}];[${cur}][ov${i}]overlay=x='${x}':y='${y}':enable='between(t,${m.start.toFixed(3)},${(m.start + m.duration).toFixed(3)})':format=auto${out}`;
        cur = `b${i + 1}`;
      });
      const composed = path.join(opts.workDir, "composed.mp4");
      const cr = await runProcess(FF(), [...inputs, "-filter_complex", fc, "-map", "[vcomp]", "-map", "0:a?", "-t", String(total), "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", composed]);
      if (cr.code === 0) {
        await fs.copyFile(composed, joined);
        await opts.onProgress?.("Compositing", 85);
      }
    }
  }

  const audios = t.tracks
    .filter(tr => tr.type === "audio" && !tr.muted)
    .flatMap(tr => tr.clips.filter(c => c.path).map(c => ({ ...c, volume: c.volume ?? tr.volume ?? 1 })));
  if (audios.length) {
    const wavs: string[] = [];
    for (let i = 0; i < audios.length; i++) {
      const c = audios[i];
      const wav = path.join(segDir, `audio-${i}.wav`);
      const delay = Math.max(0, Math.round(c.start * 1000));
      const af = `atrim=${c.sourceIn}:${c.sourceOut},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${Number(c.volume || 1).toFixed(3)}` +
        (c.fadeIn ? `,afade=t=in:st=0:d=${c.fadeIn}` : "") + (c.fadeOut ? `,afade=t=out:st=${Math.max(0, c.sourceOut - c.sourceIn - c.fadeOut).toFixed(2)}:d=${c.fadeOut}` : "");
      const ar = await runProcess(FF(), ["-y", "-i", c.path, "-af", af, "-ac", "2", "-ar", "44100", wav]);
      if (ar.code === 0) wavs.push(wav);
    }
    if (wavs.length) {
      const mix = path.join(opts.workDir, "mix.wav");
      const inputs = wavs.flatMap(w => ["-i", w]);
      const filter = wavs.map((_, i) => `[${i}:a]`).join("") + `amix=inputs=${wavs.length}:duration=longest:normalize=0[aout]`;
      const mr = await runProcess(FF(), [...inputs, "-filter_complex", filter, "-map", "[aout]", "-ac", "2", "-ar", "44100", mix]);
      if (mr.code === 0) {
        r = await runProcess(FF(), ["-y", "-i", joined, "-i", mix, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", opts.output]);
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
