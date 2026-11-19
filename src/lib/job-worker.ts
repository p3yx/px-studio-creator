import path from "path";
import fs from "fs/promises";
import { prisma } from "./db";
import { analyzeVideoForHighlights } from "./analysis";
import { renderClip, probeVideo, generateThumbnail, convertResizeVideo, createImageSlideshow, createPromptVideo, ensureAutoMusicTrack } from "./ffmpeg";
import { runTaskChat } from "./ai-providers";
import { geminiVideoAvailable, startGeminiVideo, pollGeminiVideo, saveGeminiVideo } from "./gemini-video";
import { clipsDir, tempDir, ensureProjectDirs } from "./storage";
import { safeJsonParse } from "./utils";
import { buildMontagePlan, renderMontage } from "./montage";
import { downloadYouTubeVideo, isYouTubeUrl } from "./youtube";
import { renderBeatSync } from "./beat/beat-render";
import { getBrandKit, loudnormFilter } from "./brand";

async function getSetting(key: string, envKey?: string) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value || (envKey ? (process.env as any)[envKey] : undefined) || undefined;
}

async function updateJob(jobId: string, data: any) { await prisma.job.update({ where: { id: jobId }, data }); }
async function updateProject(projectId: string, data: any) { await prisma.project.update({ where: { id: projectId }, data }); }


async function processAutoBeatJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId } });
  if (!project) throw new Error("Project missing");
  await ensureProjectDirs(project.id);
  const payload = safeJsonParse(job.payloadJson, {} as any);
  const plan = payload.plan;
  if (!project.sourcePath) throw new Error("Source video missing");
  if (!payload.audioPath) throw new Error("Audio/musik untuk Auto Beat tidak ditemukan");
  if (!plan || !Array.isArray(plan.cuts) || plan.cuts.length < 2) throw new Error("Sync plan tidak valid");

  await updateJob(job.id, { status: "RENDERING", stage: "Preparing", progress: 5, startedAt: job.startedAt || new Date(), error: null });
  await updateProject(project.id, { status: "RENDERING", errorMessage: null });

  const outDir = clipsDir(project.id);
  await fs.mkdir(outDir, { recursive: true });
  const safe = String(payload.name || "auto-beat").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "auto-beat";
  const outPath = path.join(outDir, `${Date.now()}-${safe}.mp4`);

  const result = await renderBeatSync({
    videoPath: project.sourcePath,
    audioPath: payload.audioPath,
    outputPath: outPath,
    plan,
    mode: payload.mode || "replace",
    musicVolume: Number(payload.musicVolume ?? 1),
    originalVolume: Number(payload.originalVolume ?? 0.8),
    onProgress: async (stage, progress) => {
      await updateJob(job.id, { stage, progress, status: "RENDERING" as any });
    },
  });

  const st = await fs.stat(outPath).catch(() => null);
  await prisma.clip.deleteMany({ where: { projectId: project.id } });
  await prisma.clip.create({
    data: {
      projectId: project.id,
      title: project.name || "Auto Beat",
      description: result.note || "Auto Beat render",
      category: "auto-beat",
      startTime: 0,
      endTime: result.duration || 0,
      duration: result.duration || 0,
      relevance: 100,
      reason: result.note || "",
      aspectRatio: result.width && result.height ? `${result.width}:${result.height}` : null,
      resolution: result.width && result.height ? `${result.width}x${result.height}` : null,
      fileSize: st?.size || result.fileSize || null,
      outputPath: outPath,
      status: "completed",
    } as any,
  });

  await updateProject(project.id, {
    status: "COMPLETED",
    outputPath: outPath,
    outputDuration: result.duration || null,
    outputSize: st?.size || result.fileSize || null,
    outputWidth: result.width || null,
    outputHeight: result.height || null,
    errorMessage: null,
  } as any);
  await updateJob(job.id, { status: "COMPLETED", stage: "Completed", progress: 100, finishedAt: new Date(), resultJson: JSON.stringify({ outputPath: outPath, duration: result.duration, note: result.note }) });
}


async function processMontageJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { montageAssets: true } as any });
  if (!project) throw new Error("Project missing");
  const p: any = project;
  await ensureProjectDirs(project.id);
  const config = safeJsonParse(project.configJson, {} as any);
  const work = tempDir(project.id);
  const payload = safeJsonParse(job.payloadJson, {} as any);


  await updateJob(job.id, { status: "ANALYZING", stage: "Preparing Media", progress: 5, startedAt: new Date(), error: null });
  await updateProject(project.id, { status: "ANALYZING", errorMessage: null });

  const videoAssets = (p.montageAssets || []).filter((a: any) => a.kind === "video").sort((a: any, b: any) => a.order - b.order);
  const musicAsset = (p.montageAssets || []).find((a: any) => a.kind === "music") || null;
  if (videoAssets.length < 1) throw new Error("No video clips selected for montage");

  await updateJob(job.id, { stage: "Analyzing Clips", progress: 15 });
  for (const a of videoAssets) {
    if (!a.duration || !a.width || !a.height) {
      try {
        const info = await probeVideo(a.filePath);
        await prisma.montageAsset.update({ where: { id: a.id }, data: { duration: info.duration || a.duration, width: info.width || a.width, height: info.height || a.height } as any }).catch(() => {});
        a.duration = info.duration || a.duration; a.width = info.width || a.width; a.height = info.height || a.height;
      } catch {}
    }
  }

  await updateJob(job.id, { stage: "Creating Editing Plan", progress: 30 });
  let plan = payload.plan || config.plan || null;
  if (!plan) {
    plan = await buildMontagePlan({
      clips: videoAssets.map((v: any) => ({ id: v.id, filePath: v.filePath, duration: v.duration, width: v.width, height: v.height, hasAudio: v.hasAudio, trimStart: v.trimStart, trimEnd: v.trimEnd ?? undefined, order: v.order, name: v.name })),
      preset: (config.preset || "cinematic"),
      aspect: (config.aspect || "9:16"),
      fps: Number(config.fps || 30),
      mode: config.editMode || "auto",
      customOrder: config.customOrder || videoAssets.map((v: any) => v.id),
      musicPath: musicAsset?.filePath || null,
      audioMode: config.audioMode || (musicAsset ? "mix" : "original"),
    });
  }

  await prisma.project.update({ where: { id: project.id }, data: { configJson: JSON.stringify({ ...config, plan }) } });

  const sources: Record<string, { filePath: string; hasAudio?: boolean }> = {};
  for (const v of videoAssets) sources[v.id] = { filePath: v.filePath, hasAudio: v.hasAudio };
  const outDir = clipsDir(project.id);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `montage-${Date.now()}.mp4`);

  await updateJob(job.id, { status: "RENDERING", stage: "Processing Transitions", progress: 45 });
  await updateProject(project.id, { status: "RENDERING" });

  const result = await renderMontage({
    plan,
    sources,
    outputPath: outPath,
    workDir: work,
    quality: (config.quality || "medium"),
    onProgress: async (stage, progress) => {
      const mapped = stage === "Finalizing" ? 98 : progress;
      const status = stage.includes("Analy") ? "ANALYZING" : "RENDERING";
      await updateJob(job.id, { stage, progress: mapped, status: status as any });
    }
  });

  const st = await fs.stat(outPath).catch(() => null);
  await prisma.clip.deleteMany({ where: { projectId: project.id } });
  await prisma.clip.create({
    data: {
      projectId: project.id,
      title: project.name || "Montage",
      description: `AI Montage (${plan.preset}) - ${plan.clips.length} clips`,
      category: plan.preset,
      startTime: 0,
      endTime: result.duration || 0,
      duration: result.duration || 0,
      relevance: 100,
      reason: (plan.notes || []).join(" "),
      aspectRatio: plan.aspect,
      resolution: `${result.width}x${result.height}`,
      fileSize: st?.size || null,
      outputPath: outPath,
      status: "completed",
    }
  });

  let montageThumbPath = (project as any).thumbnailPath || null;
  let montageThumbTs = (project as any).thumbnailTimestamp ?? null;
  let montageThumbStatus = (project as any).thumbnailStatus || "pending";
  try {
    const at = result.duration && result.duration > 2 ? Math.min(1.5, Math.max(0.5, result.duration * 0.1)) : 0.5;
    const thumbPath = path.join(tempDir(project.id), "thumbnail-montage.jpg");
    await generateThumbnail(outPath, thumbPath, at);
    await fs.access(thumbPath);
    montageThumbPath = thumbPath;
    montageThumbTs = at;
    montageThumbStatus = "ready";
  } catch {}

  await updateProject(project.id, { status: "COMPLETED", outputPath: outPath, outputDuration: result.duration || null, outputSize: st?.size || null, outputWidth: result.width, outputHeight: result.height, thumbnailPath: montageThumbPath, thumbnailTimestamp: montageThumbTs, thumbnailStatus: montageThumbStatus, thumbnailGeneratedAt: montageThumbStatus === "ready" ? new Date() : (project as any).thumbnailGeneratedAt || null, errorMessage: null } as any);
  await updateJob(job.id, { status: "COMPLETED", stage: "Completed", progress: 100, finishedAt: new Date(), resultJson: JSON.stringify({ outputPath: outPath, duration: result.duration, plan }) });
}

async function processMixAudioJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId } });
  if (!project) throw new Error("Project missing");
  await ensureProjectDirs(project.id);
  const payload = safeJsonParse(job.payloadJson, {} as any);
  if (!project.sourcePath) throw new Error("Source video missing");
  if (!payload.audioPath) throw new Error("Audio/musik tidak ditemukan");
  const mode = String(payload.mode || "mix");
  const musicVolume = Math.max(0, Math.min(2, Number(payload.musicVolume ?? 1)));
  const originalVolume = Math.max(0, Math.min(2, Number(payload.originalVolume ?? 0.8)));
  const ff = process.env.FFMPEG_PATH || "ffmpeg";

  await updateJob(job.id, { status: "RENDERING", stage: "Rendering", progress: 10, startedAt: job.startedAt || new Date(), error: null });
  await updateProject(project.id, { status: "RENDERING", errorMessage: null });

  const outDir = clipsDir(project.id);
  await fs.mkdir(outDir, { recursive: true });
  const safe = String(payload.name || "video-audio").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "video-audio";
  const outPath = path.join(outDir, `${Date.now()}-${safe}.mp4`);

  const { runProcess } = await import("./ffmpeg");
  let args: string[];
  if (mode === "replace" || mode === "music") {
    const brand = await getBrandKit().catch(() => null);
    const loudOn = brand ? brand.loudnessNormalize !== false : true;
    const loud = loudOn ? loudnormFilter(brand || { loudnessTargetI: -14, loudnessTargetTP: -1.5, loudnessTargetLRA: 11 } as any) : null;
    if (loud) {
      args = ["-y", "-i", project.sourcePath, "-stream_loop", "-1", "-i", payload.audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", loud, "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-shortest", "-movflags", "+faststart", outPath];
      let r = await runProcess(ff, args);
      if (r.code !== 0) {
        args = ["-y", "-i", project.sourcePath, "-stream_loop", "-1", "-i", payload.audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-af", loud, "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-shortest", "-movflags", "+faststart", outPath];
        r = await runProcess(ff, args);
        if (r.code !== 0) throw new Error(`Gagal merender video: ${(r.stderr || r.stdout || "").slice(-500)}`);
      }
    } else {
      args = ["-y", "-i", project.sourcePath, "-stream_loop", "-1", "-i", payload.audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
      let r = await runProcess(ff, args);
      if (r.code !== 0) {
        args = ["-y", "-i", project.sourcePath, "-stream_loop", "-1", "-i", payload.audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
        r = await runProcess(ff, args);
        if (r.code !== 0) throw new Error(`Gagal merender video: ${(r.stderr || r.stdout || "").slice(-500)}`);
      }
    }
  } else {
    const brand = await getBrandKit().catch(() => null);
    const loud = brand && brand.loudnessNormalize === false ? "alimiter=limit=0.95" : loudnormFilter(brand || { loudnessTargetI: -14, loudnessTargetTP: -1.5, loudnessTargetLRA: 11 } as any);
    const filter = `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${originalVolume}[a0];[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,${loud}[aout]`;
    args = ["-y", "-i", project.sourcePath, "-stream_loop", "-1", "-i", payload.audioPath, "-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
    let r = await runProcess(ff, args);
    if (r.code !== 0) {
      args = ["-y", "-i", project.sourcePath, "-stream_loop", "-1", "-i", payload.audioPath, "-filter_complex", `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,aresample=async=1,volume=${musicVolume},${loud}[aout]`, "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath];
      r = await runProcess(ff, args);
      if (r.code !== 0) throw new Error(`Gagal merender video: ${(r.stderr || r.stdout || "").slice(-500)}`);
    }
  }

  await updateJob(job.id, { stage: "Finalizing", progress: 90, status: "RENDERING" as any });
  let duration: number | null = null;
  try { duration = (await probeVideo(outPath)).duration || null; } catch {}
  const st = await fs.stat(outPath).catch(() => null);

  await prisma.clip.deleteMany({ where: { projectId: project.id } });
  await prisma.clip.create({
    data: {
      projectId: project.id,
      title: project.name || "Video dengan Suara",
      description: `Audio ${mode} diterapkan`,
      category: "add-audio",
      startTime: 0,
      endTime: duration || 0,
      duration: duration || 0,
      relevance: 100,
      reason: `mode=${mode}`,
      fileSize: st?.size || null,
      outputPath: outPath,
      status: "completed",
    } as any,
  });

  await updateProject(project.id, { status: "COMPLETED", outputPath: outPath, outputDuration: duration || null, outputSize: st?.size || null, errorMessage: null } as any);
  await updateJob(job.id, { status: "COMPLETED", stage: "Completed", progress: 100, finishedAt: new Date(), resultJson: JSON.stringify({ outputPath: outPath, duration, mode }) });
}

async function processConvertResizeJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId } });
  if (!project) throw new Error("Project missing");
  await ensureProjectDirs(project.id);
  const payload = safeJsonParse(job.payloadJson, {} as any);
  if (!project.sourcePath) throw new Error("Source video missing");
  const aspect = (payload.aspect || "16:9") as any;
  const fit = (payload.fit || "pad") as any;
  const quality = (payload.quality || "medium") as any;
  const keepAudio = payload.keepAudio !== false;

  await updateJob(job.id, { status: "RENDERING", stage: "Converting", progress: 10, startedAt: job.startedAt || new Date(), error: null });
  await updateProject(project.id, { status: "RENDERING", errorMessage: null });

  const outDir = clipsDir(project.id);
  await fs.mkdir(outDir, { recursive: true });
  const safe = String(payload.name || "converted").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "converted";
  const outPath = path.join(outDir, `${Date.now()}-${safe}.mp4`);

  await convertResizeVideo({ input: project.sourcePath, output: outPath, aspect, fit, quality, keepAudio });
  await updateJob(job.id, { stage: "Finalizing", progress: 90, status: "RENDERING" as any });
  let duration: number | null = null, width: number | null = null, height: number | null = null;
  try { const info = await probeVideo(outPath); duration = info.duration || null; width = info.width || null; height = info.height || null; } catch {}
  const st = await fs.stat(outPath).catch(() => null);

  await prisma.clip.deleteMany({ where: { projectId: project.id } });
  await prisma.clip.create({
    data: {
      projectId: project.id,
      title: project.name || "Converted Video",
      description: `Convert/Resize ${aspect} (${fit})`,
      category: "convert-resize",
      startTime: 0, endTime: duration || 0, duration: duration || 0,
      relevance: 100, reason: `aspect=${aspect},fit=${fit}`,
      resolution: width && height ? `${width}x${height}` : null,
      fileSize: st?.size || null, outputPath: outPath, status: "completed",
    } as any,
  });

  await updateProject(project.id, { status: "COMPLETED", outputPath: outPath, outputDuration: duration || null, outputSize: st?.size || null, outputWidth: width, outputHeight: height, errorMessage: null } as any);
  await updateJob(job.id, { status: "COMPLETED", stage: "Completed", progress: 100, finishedAt: new Date(), resultJson: JSON.stringify({ outputPath: outPath, duration, aspect, fit }) });
}

async function processAiVideoJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { clips: true } });
  if (!project) throw new Error("Project missing");
  const config: any = safeJsonParse((project as any).configJson, {});
  await updateJob(job.id, { status: "RENDERING", stage: "Rendering", progress: 20, startedAt: new Date(), error: null });
  await updateProject(project.id, { status: "RENDERING", errorMessage: null });
  await ensureProjectDirs(project.id);
  const out = path.join(clipsDir(project.id), "ai-video.mp4");

  const images: string[] = Array.isArray(config.images) ? config.images.filter(Boolean) : [];
  const music = config.music ? await ensureAutoMusicTrack().catch(() => null) : null;

  // AI-assisted title & story description from the active provider; deterministic fallback.
  let title = String(config.name || project.name || "AI Video").slice(0, 80);
  let description = `Video dibuat dari ${images.length ? images.length + " gambar" : (config.videoPath ? "video" : "prompt")} sesuai prompt: ${String(config.prompt || "").slice(0, 160)}`;
  try {
    const resp: any = await runTaskChat("metadata_generation", [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: `Buat judul singkat dan deskripsi 1-2 kalimat (bahasa Indonesia) untuk video dari prompt: "${config.prompt || ""}". Sumber: ${images.length ? images.length + " gambar" : (config.videoPath ? "video" : "hanya prompt")}. JSON: {"title":string,"description":string}` },
    ], { temperature: 0.4, json: true, timeout: 60000 });
    const c = resp?.choices?.[0]?.message?.content;
    const parsed = typeof c === "string" ? safeJsonParse<any>(c, {}) : c;
    if (parsed?.title) title = String(parsed.title).slice(0, 80);
    if (parsed?.description) description = String(parsed.description).slice(0, 400);
  } catch {}

  // Prefer real AI video generation when the active provider is Gemini native.
  let usedGemini = false;
  let aiModelLabel = "Gemini video";
  if (config.prompt && (await geminiVideoAvailable())) {
    try {
      await updateJob(job.id, { stage: "AI Video Generating", progress: 30 });
      const started = await startGeminiVideo({
        prompt: config.prompt,
        images,
        video: config.videoPath || null,
        aspect: config.aspect || "9:16",
        durationSeconds: Number(config.promptDuration || Number(config.secondsPerImage || 3) * 4),
      });
      aiModelLabel = started.model || aiModelLabel;
      if (started.interactionId) {
        for (let i = 0; i < 90; i++) {
          await new Promise(r => setTimeout(r, 10000));
          const poll = await pollGeminiVideo(started.interactionId);
          await updateJob(job.id, { progress: Math.min(90, 35 + Math.round((i / 90) * 55)), stage: `AI Video ${poll.status}` });
          if (poll.status === "completed") {
            if (!poll.video) throw new Error("Gemini selesai tetapi tidak mengembalikan video.");
            await saveGeminiVideo(poll.video, out);
            usedGemini = true;
            break;
          }
          if (poll.status === "failed" || poll.status === "cancelled" || poll.status === "error") {
            throw new Error("Generasi video Gemini gagal/dibatalkan.");
          }
        }
        if (!usedGemini) throw new Error("Timeout menunggu video Gemini.");
      }
    } catch (e: any) {
      console.error("[ai-video] Gemini generation failed, using local render:", e?.message || e);
    }
  }

  if (!usedGemini) {
    if (images.length) {
      await createImageSlideshow({
        images, output: out, aspect: config.aspect || "9:16",
        secondsPerImage: Number(config.secondsPerImage || 3), musicPath: music,
      });
    } else if (config.videoPath) {
      await fs.copyFile(config.videoPath, out);
    } else {
      await createPromptVideo({
        output: out, title, description, aspect: config.aspect || "9:16",
        duration: Number(config.promptDuration || Number(config.secondsPerImage || 3) * 4), musicPath: music,
      });
    }
  }

  const st = await fs.stat(out).catch(() => null);
  const finalDescription = usedGemini ? `[Dibuat Gemini AI: ${aiModelLabel}] ${description}` : description;
  await prisma.clip.updateMany({
    where: { projectId: project.id },
    data: { status: "completed", outputPath: out, fileSize: st?.size || null, title, description: finalDescription, resolution: config.aspect === "16:9" ? "1920x1080" : "1080x1920" },
  });
  await updateProject(project.id, { status: "COMPLETED", outputPath: out, outputSize: st?.size || null });
  await updateJob(job.id, { status: "COMPLETED", stage: "Completed", progress: 100, finishedAt: new Date() });
  return out;
}

async function processJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { clips: true } });
  if (!project) throw new Error("Project missing");
  const p: any = project;
  if (p.type === "ai-video" || job.type === "ai_video") {
    return processAiVideoJob(job);
  }
  if (p.type === "montage" || job.type === "montage") {
    return processMontageJob(job);
  }
  if (p.type === "auto-beat" || job.type === "beat_sync") {
    return processAutoBeatJob(job);
  }
  if (p.type === "mix-audio" || job.type === "mix_audio") {
    return processMixAudioJob(job);
  }
  if (p.type === "convert-resize" || job.type === "convert_resize") {
    return processConvertResizeJob(job);
  }
  await ensureProjectDirs(project.id);
  const config = safeJsonParse(project.configJson, { duration: 30, quantity: 3, mode: "Best Moments", prompt: "", aspect: "9:16", style: "Cinematic Anime" });
  const work = tempDir(project.id);

  // AutoClip from YouTube link: download source if not yet available
  if (!project.sourcePath) {
    const youtubeUrl = String(config.youtubeUrl || config.youtube || config.sourceUrl || "");
    if (youtubeUrl && isYouTubeUrl(youtubeUrl)) {
      await updateJob(job.id, { status: "ANALYZING", stage: "Downloading YouTube Video", progress: 3, startedAt: new Date(), error: null });
      await updateProject(project.id, { status: "ANALYZING", errorMessage: null });
      const dlDir = path.join(work, "youtube");
      await fs.mkdir(dlDir, { recursive: true });
      const dl = await downloadYouTubeVideo({ url: youtubeUrl, outDir: dlDir, basename: `youtube-${project.id}`, onProgress: async (msg) => { await updateJob(job.id, { stage: msg }); } });
      let duration: number | null = null, width: number | null = null, height: number | null = null;
      try { const info = await probeVideo(dl.filePath); duration = info.duration || null; width = info.width; height = info.height; } catch {}
      let st: any = null; try { st = await fs.stat(dl.filePath); } catch {}
      let thumbnailPath: string | null = null, thumbnailTimestamp: number | null = null, thumbnailStatus = "failed";
      try {
        const at = duration && duration > 2 ? Math.min(1.5, Math.max(0.5, duration * 0.1)) : 0.5;
        thumbnailTimestamp = at;
        const thumbPath = path.join(tempDir(project.id), "thumbnail.jpg");
        await generateThumbnail(dl.filePath, thumbPath, at);
        await fs.access(thumbPath);
        thumbnailPath = thumbPath; thumbnailStatus = "ready";
      } catch {}
      await updateProject(project.id, { sourceFileName: dl.title || path.basename(dl.filePath), sourcePath: dl.filePath, sourceSize: st?.size || null, sourceDuration: duration, sourceWidth: width, sourceHeight: height, thumbnailPath, thumbnailTimestamp, thumbnailStatus, thumbnailGeneratedAt: thumbnailStatus === "ready" ? new Date() : null } as any);
      (project as any).sourcePath = dl.filePath; (project as any).sourceDuration = duration; (project as any).sourceWidth = width; (project as any).sourceHeight = height;
      if (dl.title && (!project.name || project.name === "YouTube AutoClip")) { try { await updateProject(project.id, { name: String(dl.title).slice(0, 120) } as any); } catch {} }
    } else {
      throw new Error("Project or source file missing");
    }
  }
  if (!project.sourcePath) throw new Error("Project or source file missing");

  await updateJob(job.id, { status: "ANALYZING", stage: "Analyzing", progress: 10, startedAt: job.startedAt || new Date(), error: null });
  await updateProject(project.id, { status: "ANALYZING", errorMessage: null });

  try { await probeVideo(project.sourcePath); } catch {}

  // Legacy config (routing/migration handled in ai-providers/analysis)
  const ai = {
    baseUrl: await getSetting("aiBaseUrl", "AI_API_BASE_URL") || "http://192.168.0.157:20128/v1",
    apiKey: await getSetting("aiApiKey", "AI_API_KEY"),
    textModel: await getSetting("aiTextModel", "AI_TEXT_MODEL"),
    visionModel: await getSetting("aiVisionModel", "AI_VISION_MODEL"),
    sttModel: await getSetting("aiSttModel", "AI_STT_MODEL"),
  } as any;

  await updateJob(job.id, { status: "FINDING_HIGHLIGHTS", stage: "Finding Highlights", progress: 30 });
  await updateProject(project.id, { status: "FINDING_HIGHLIGHTS" });
  const highlights = await analyzeVideoForHighlights({
    videoPath: project.sourcePath,
    workDir: work,
    config: { duration: Number(config.duration || 30), quantity: Number(config.quantity || 3), mode: config.mode || "Best Moments", prompt: config.prompt, aspect: config.aspect || "9:16" },
    ai,
    onProgress: async (stage, progress) => { await updateJob(job.id, { stage, progress, status: stage === "Analyzing" ? "ANALYZING" : "FINDING_HIGHLIGHTS" }); }
  });

  await prisma.clip.deleteMany({ where: { projectId: project.id } });
  for (const h of highlights) {
    await prisma.clip.create({ data: { projectId: project.id, title: h.title, description: h.description, category: h.category, startTime: h.start, endTime: h.end, duration: Math.max(0, h.end - h.start), relevance: h.score, reason: h.reason, aspectRatio: config.aspect || "9:16", status: "pending" } });
  }

  await updateJob(job.id, { status: "RENDERING", stage: "Rendering", progress: 75 });
  await updateProject(project.id, { status: "RENDERING" });
  const outDir = clipsDir(project.id);
  const clips = await prisma.clip.findMany({ where: { projectId: project.id }, orderBy: { startTime: "asc" } });
  let done = 0;
  for (const c of clips) {
    const safe = c.title.replace(/[^a-z0-9-_ ]+/gi, "").trim().replace(/\s+/g, "-").slice(0, 40) || "clip";
    const outPath = path.join(outDir, `${String(done + 1).padStart(2, '0')}-${safe}.mp4`);
    try {
      await renderClip({
        input: project.sourcePath, output: outPath, start: c.startTime, end: c.endTime,
        aspect: (config.aspect as any) || "9:16",
        ...(() => {
          const raw = Array.isArray(config?.removeWatermarks) && config.removeWatermarks.length
            ? config.removeWatermarks
            : (config?.removeWatermark ? [config.removeWatermark] : []);
          const regions = raw
            .filter((r: any) => r && Number.isFinite(Number(r.x)))
            .map((r: any) => ({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h), blur: Number(r.blur) || 0 }));
          return regions.length ? { delogos: regions } : {};
        })(),
      });
      // Optional: keep but clean the source audio, or swap/duck it with a licensed music track.
      if (config?.audioTrack?.mode === "reprocess") {
        try {
          const { reprocessClipAudio } = await import("./ffmpeg");
          await reprocessClipAudio({ input: outPath, duration: Math.max(0.1, c.endTime - c.startTime) });
        } catch { /* keep original audio if cleanup fails */ }
      }
      let musicPath = config?.audioTrack?.mode === "reprocess" ? null : (config?.audioTrack?.path ? String(config.audioTrack.path) : null);
      if (config?.audioTrack?.mode === "auto") {
        try {
          const { ensureAutoMusicTrack } = await import("./ffmpeg");
          musicPath = await ensureAutoMusicTrack();
        } catch { musicPath = null; }
      }
      if (!musicPath && config?.audioTrack?.audioAssetId) {
        const asset = await prisma.audioAsset.findFirst({ where: { id: String(config.audioTrack.audioAssetId) } }).catch(() => null);
        musicPath = asset?.filePath || null;
      }
      if (musicPath) {
        try {
          const { replaceClipAudio } = await import("./ffmpeg");
          await replaceClipAudio({
            input: outPath,
            musicPath,
            mode: (config.audioTrack.mode === "mix" || config.audioTrack.mode === "auto") ? "mix" : "replace",
            musicVolume: Number(config.audioTrack.musicVolume ?? 1),
            originalVolume: config.audioTrack.mode === "auto" ? Number(config.audioTrack.originalVolume ?? 0.35) : Number(config.audioTrack.originalVolume ?? 0.2),
            duration: Math.max(0.1, c.endTime - c.startTime),
          });
        } catch { /* keep original audio if track is invalid */ }
      }
      const st = await fs.stat(outPath).catch(() => null);
      const resolution = config.aspect === '9:16' ? '1080x1920' : config.aspect === '1:1' ? '1080x1080' : '1920x1080';
      await prisma.clip.update({ where: { id: c.id }, data: { status: "completed", outputPath: outPath, fileSize: st?.size || null, resolution } });
    } catch (e: any) {
      await prisma.clip.update({ where: { id: c.id }, data: { status: "failed", description: (c.description || '') + `\nRender error: ${e.message}` } });
    }
    done++;
    const prog = 75 + Math.round((done / Math.max(1, clips.length)) * 23);
    await updateJob(job.id, { progress: prog, stage: "Rendering" });
  }

  const completedCount = await prisma.clip.count({ where: { projectId: project.id, status: "completed" } });
  if (completedCount === 0) throw new Error("No clips were rendered successfully. Check FFmpeg installation and source video.");

  // Best-effort: set project thumbnail from first completed clip if missing/failed
  try {
    if (!(project as any).thumbnailPath || (project as any).thumbnailStatus !== "ready") {
      const firstClip = await prisma.clip.findFirst({ where: { projectId: project.id, status: "completed", outputPath: { not: null } }, orderBy: { startTime: "asc" } });
      if (firstClip?.outputPath) {
        const at = firstClip.duration && firstClip.duration > 2 ? Math.min(1.0, Math.max(0.3, firstClip.duration * 0.15)) : 0.5;
        const thumbPath = path.join(tempDir(project.id), "thumbnail-clip.jpg");
        await generateThumbnail(firstClip.outputPath, thumbPath, at);
        await fs.access(thumbPath);
        await updateProject(project.id, { thumbnailPath: thumbPath, thumbnailTimestamp: at, thumbnailStatus: "ready", thumbnailGeneratedAt: new Date() } as any);
      }
    }
  } catch {}

  await updateJob(job.id, { status: "COMPLETED", stage: "Completed", progress: 100, finishedAt: new Date(), resultJson: JSON.stringify({ clips: completedCount }) });
  await updateProject(project.id, { status: "COMPLETED" });
}

let running = false;
export async function runWorkerLoop() {
  const g = globalThis as any;
  if (g.__pxStudioWorkerRunning) return;
  g.__pxStudioWorkerRunning = true;
  running = true;
  console.log("[px-studio-worker] background worker started");
  while (running) {
    try {
      const job = await prisma.job.findFirst({ where: { status: "WAITING" }, orderBy: { createdAt: "asc" } });
      if (!job) { await new Promise(r => setTimeout(r, 2500)); continue; }
      console.log("[px-studio-worker] processing", job.id, job.type);
      try { await processJob(job); }
      catch (e: any) {
        console.error("job failed", e);
        await updateJob(job.id, { status: "FAILED", stage: "Failed", error: e.message || String(e), finishedAt: new Date() }).catch(() => {});
        await updateProject(job.projectId, { status: "FAILED", errorMessage: e.message || String(e) }).catch(() => {});
      }
    } catch (e) {
      console.error("worker loop error", e);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

export function isWorkerRunning() {
  return !!(globalThis as any).__pxStudioWorkerRunning;
}
