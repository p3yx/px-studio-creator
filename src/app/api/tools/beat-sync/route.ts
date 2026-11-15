import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";
import { runProcess, probeVideo } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "autobeat-video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "autobeat-video"; }

export async function POST(req: NextRequest) {
  const cleanup: string[] = [];
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const video = form.get("video");
    const audio = form.get("audio");
    const audioAssetId = String(form.get("audioAssetId") || "");
    const mode = String(form.get("mode") || "replace"); // mix | replace | music
    const musicVolume = Math.max(0, Math.min(2, Number(form.get("musicVolume") || 1)));
    const originalVolume = Math.max(0, Math.min(2, Number(form.get("originalVolume") || 0.8)));
    const name = String(form.get("name") || "Auto Beat Video");
    let plan: any = null;
    try { plan = JSON.parse(String(form.get("plan") || "null")); } catch { plan = null; }

    if (!(video instanceof File)) return NextResponse.json({ error: "File video wajib diunggah" }, { status: 400 });
    if (!plan || !Array.isArray(plan.cuts) || plan.cuts.length < 2) return NextResponse.json({ error: "Sync plan tidak valid. Jalankan Auto Sync terlebih dahulu." }, { status: 400 });

    const workDir = path.join(STORAGE_ROOT, "temp", user.id, `beatsync-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    await fs.mkdir(workDir, { recursive: true });
    cleanup.push(workDir);
    const videoPath = path.join(workDir, `input${path.extname(video.name || ".mp4") || ".mp4"}`);
    await fs.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));

    let audioPath: string | null = null;
    let audioIsTemp = false;
    if (audio instanceof File && audio.size > 0) {
      audioPath = path.join(workDir, `music${path.extname(audio.name || ".mp3") || ".mp3"}`);
      await fs.writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));
      audioIsTemp = true;
    } else if (audioAssetId) {
      const asset = await prisma.audioAsset.findFirst({ where: { id: audioAssetId, userId: user.id } });
      if (!asset) return NextResponse.json({ error: "Audio dari library tidak ditemukan" }, { status: 404 });
      audioPath = asset.filePath;
    }
    if (!audioPath) return NextResponse.json({ error: "Audio/musik diperlukan untuk Auto Beat" }, { status: 400 });

    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const probe = await probeVideo(videoPath);
    const vDur = Math.max(0.5, probe.duration || 0.5);
    const targetDur = Math.max(1, Math.min(Number(plan.duration) || 99999, 600)); // safety cap 10 min

    // Scale down very large videos to keep filter graph manageable
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

    // Build & cap segments from cuts
    let cuts: number[] = plan.cuts.map((x: any) => Number(x)).filter((x: number) => isFinite(x)).sort((a: number,b: number)=>a-b);
    cuts = cuts.map(c => Math.max(0, Math.min(c, targetDur)));
    // enforce monotonic and minimum segment length to avoid huge segment counts
    const minSeg = Math.max(0.8, Math.min(4, Number(plan.minSegment) > 0 ? Number(plan.minSegment) : 1.2));
    const merged: number[] = [0];
    for (let i = 1; i < cuts.length; i++) {
      const c = cuts[i];
      if (c - merged[merged.length - 1] >= minSeg) merged.push(c);
    }
    if (merged[merged.length - 1] < targetDur - 0.2) merged.push(Math.min(targetDur, Number(plan.duration) || targetDur));
    // hard cap segment count to keep ffmpeg responsive
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
    if (!segments.length) return NextResponse.json({ error: "Tidak ada segmen yang dapat dibuat dari plan" }, { status: 400 });

    const intensity = String(plan.intensity || "balanced");
    const wantZoom = !!plan.beatZoom;
    const wantTransition = !!plan.beatTransition && segments.length > 1;
    const n = segments.length;
    // avoid heavy filters for many segments to prevent hangs/crashes
    const useXfade = wantTransition && n <= 24;
    const useZoom = wantZoom && n <= 20;
    const xfadeDur = intensity === "aggressive" ? 0.15 : intensity === "dynamic" ? 0.22 : intensity === "subtle" ? 0.35 : 0.25;

    const totalDur = segments.reduce((a, s) => a + s.dur, 0);
    const renderDur = Math.max(1, Math.min(totalDur, targetDur));

    const outDir = path.join(STORAGE_ROOT, "auto-beat", user.id);
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${Date.now()}-${safeName(name)}.mp4`);

    const buildFilter = (simple: boolean) => {
      let filter = "";
      const vLabels: string[] = [];
      for (let i = 0; i < n; i++) {
        const s = segments[i];
        const label = `v${i}`;
        const base = `[0:v]trim=start=${s.srcStart.toFixed(3)}:duration=${s.dur.toFixed(3)},setpts=PTS-STARTPTS,scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
        const doZ = !simple && useZoom && (intensity === "aggressive" || intensity === "dynamic" || (plan.beatImpact && i % 2 === 0));
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
        filter += `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${originalVolume}[a0];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[aout]`;
      } else {
        filter += `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume},alimiter=limit=0.95[aout]`;
      }
      return filter;
    };

    const runRender = async (filter: string) => runProcess(ff, [
      "-y",
      "-i", videoPath,
      "-stream_loop", "-1", "-i", audioPath as string,
      "-filter_complex", filter,
      "-map", "[vout]", "-map", "[aout]",
      "-t", String(renderDur),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-movflags", "+faststart",
      outPath,
    ]);

    let r = await runRender(buildFilter(false));
    if (r.code !== 0) {
      // robust fallback: no xfade/zoompan, concat only
      r = await runRender(buildFilter(true));
    }
    if (r.code !== 0) {
      // last resort: simple cut-less overlay of music on video trimmed to duration
      const fallbackFilter = mode === "mix"
        ? `[0:v]scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[vout];[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${originalVolume}[a0];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`
        : `[0:v]scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[vout];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume}[aout]`;
      r = await runRender(fallbackFilter);
      if (r.code !== 0) throw new Error(`Gagal merender Auto Beat: ${(r.stderr || r.stdout || "").slice(-800)}`);
    }

    let duration: number | null = null;
    try { duration = (await probeVideo(outPath)).duration || null; } catch {}
    const st = await fs.stat(outPath).catch(() => null);
    const rel = path.relative(STORAGE_ROOT, outPath).replace(/\\/g, "/");

    const simplified = !useXfade || !useZoom || merged.length - 1 > MAX_SEG ? " (disederhanakan agar render stabil)" : "";
    return NextResponse.json({ ok: true, fileUrl: `/api/files?path=${encodeURIComponent(rel)}`, duration, fileSize: st?.size || null, note: `Auto Beat diterapkan (${plan.preset || 'preset'}, ${segments.length} segmen, mode ${mode})${simplified}.` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Beat sync failed" }, { status: 500 });
  } finally {
    await Promise.allSettled(cleanup.map(p => fs.rm(p, { recursive: true, force: true }).catch(() => {})));
  }
}
