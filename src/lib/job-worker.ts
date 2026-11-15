import path from "path";
import fs from "fs/promises";
import { prisma } from "./db";
import { analyzeVideoForHighlights } from "./analysis";
import { renderClip, probeVideo, generateThumbnail } from "./ffmpeg";
import { clipsDir, tempDir, ensureProjectDirs } from "./storage";
import { safeJsonParse } from "./utils";
import { buildMontagePlan, renderMontage } from "./montage";
import { downloadYouTubeVideo, isYouTubeUrl } from "./youtube";

async function getSetting(key: string, envKey?: string) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value || (envKey ? (process.env as any)[envKey] : undefined) || undefined;
}

async function updateJob(jobId: string, data: any) { await prisma.job.update({ where: { id: jobId }, data }); }
async function updateProject(projectId: string, data: any) { await prisma.project.update({ where: { id: projectId }, data }); }

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

async function processJob(job: any) {
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { clips: true } });
  if (!project) throw new Error("Project missing");
  const p: any = project;
  if (p.type === "montage" || job.type === "montage") {
    return processMontageJob(job);
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
      await renderClip({ input: project.sourcePath, output: outPath, start: c.startTime, end: c.endTime, aspect: (config.aspect as any) || "9:16" });
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
