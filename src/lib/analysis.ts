import path from "path";
import fs from "fs/promises";
import { extractAudioWav, extractFrames, probeVideo } from "./ffmpeg";
import { chatCompletion, getAIConfigFromEnv, AIConfig } from "./ai";
import { resolveTaskConfig } from "./ai-providers";
import { safeJsonParse } from "./utils";

export type HighlightCandidate = {
  start: number;
  end: number;
  title: string;
  description: string;
  category: string;
  score: number;
  reason: string;
};

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

export async function analyzeVideoForHighlights(params: {
  videoPath: string;
  workDir: string;
  config: { duration: number; quantity: number; mode: string; prompt?: string; aspect: string };
  ai?: AIConfig;
  onProgress?: (stage: string, progress: number) => Promise<void> | void;
}): Promise<HighlightCandidate[]> {
  const { videoPath, workDir, config } = params;
  const ai = params.ai || getAIConfigFromEnv();
  await params.onProgress?.("Analyzing", 15);
  const info = await probeVideo(videoPath);
  const total = info.duration || 0;

  // Extract lightweight signals: frames (sampled) and audio for STT if configured
  await params.onProgress?.("Finding Highlights", 35);
  const framesDir = path.join(workDir, "frames");
  let frames: string[] = [];
  try {
    // sample ~ up to 24 frames across video for semantic hints (or 1fps capped)
    const fps = total > 120 ? 0.2 : total > 60 ? 0.5 : 1;
    frames = await extractFrames(videoPath, framesDir, { fps, maxFrames: 24 });
  } catch { frames = []; }

  let transcriptSnippet = "";
  try {
    let hasStt = !!ai.sttModel;
    try { const stt = await resolveTaskConfig("speech_to_text"); hasStt = !!stt?.model?.modelId; } catch {}
    if (hasStt) {
      const wav = path.join(workDir, "audio.wav");
      await extractAudioWav(videoPath, wav);
      const tr = await transcribeAudioSafe(ai, wav);
      transcriptSnippet = typeof tr?.text === "string" ? tr.text.slice(0, 4000) : "";
    }
  } catch { /* optional */ }

  await params.onProgress?.("Finding Highlights", 55);

  // Ask AI (text model) to propose highlights based on metadata/signals; if unavailable, fallback heuristic.
  const desired = Math.max(1, Math.min(config.quantity || 3, 20));
  const clipDur = Math.max(5, Math.min(config.duration || 30, 180));

  let hasTextModel = !!ai.textModel;
  try { const resolved = await resolveTaskConfig("highlight_detection"); hasTextModel = !!resolved?.model?.modelId; } catch {}

  if (hasTextModel) {
    try {
      const prompt = buildHighlightPrompt({ total, desired, clipDur, mode: config.mode, userPrompt: config.prompt, framesCount: frames.length, transcriptSnippet });
      const resp = await chatCompletion(ai, [
        { role: "system", content: "You are an expert anime video editor and highlight detector. Return strict JSON only." },
        { role: "user", content: prompt },
      ], { model: ai.textModel, temperature: 0.2, json: true, task: "highlight_detection" });
      const content = resp?.choices?.[0]?.message?.content || "{}";
      const parsed = typeof content === "string" ? safeJsonParse<any>(content, {}) : content;
      const list = Array.isArray(parsed?.highlights) ? parsed.highlights : [];
      const cleaned = normalizeHighlights(list, total, clipDur, desired);
      if (cleaned.length) {
        await params.onProgress?.("Finding Highlights", 70);
        return cleaned;
      }
    } catch {
      // fall through to heuristic
    }
  }

  await params.onProgress?.("Finding Highlights", 70);
  return heuristicHighlights(total, desired, clipDur, config.mode);
}

async function transcribeAudioSafe(ai: AIConfig, wav: string) {
  const { transcribeAudio } = await import("./ai");
  return transcribeAudio(ai, wav);
}

function buildHighlightPrompt(ctx: { total: number; desired: number; clipDur: number; mode: string; userPrompt?: string; framesCount: number; transcriptSnippet: string }) {
  return `Analyze an anime source video and propose the best clip moments.
Video duration (seconds): ${ctx.total}
Requested clips: ${ctx.desired}
Target clip duration (seconds): ${ctx.clipDur}
Mode: ${ctx.mode}
User instruction: ${ctx.userPrompt || "(none)"}
Sampled frames extracted: ${ctx.framesCount}
Transcript snippet (may be empty): ${ctx.transcriptSnippet ? `\n"""${ctx.transcriptSnippet}"""` : "(unavailable)"}

Rules:
- Do NOT choose random timestamps; distribute and select plausible highlight windows (action/emotional/dialogue peaks) spread across the video.
- start/end must be within [0, duration], end>start, and each clip length close to target duration when possible.
- Return JSON object: {"highlights":[{"start":number,"end":number,"title":string,"description":string,"category":string,"score":number,"reason":string}]}
- category should reflect the moment (Epic, Action, Fight, Emotional, Funny, Romance, Dialogue, Dramatic, or Custom).
- score 0-100.`;
}

function normalizeHighlights(list: any[], total: number, clipDur: number, desired: number): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const h of list) {
    let start = Number(h.start);
    let end = Number(h.end);
    if (!isFinite(start) || !isFinite(end)) continue;
    start = clamp(start, 0, Math.max(0, total - 1));
    end = clamp(end, start + 2, total || start + clipDur);
    if (end - start < 3) end = clamp(start + clipDur, start + 3, total || start + clipDur);
    if (end - start > clipDur * 2) end = start + clipDur;
    out.push({
      start, end,
      title: String(h.title || "Highlight").slice(0, 80),
      description: String(h.description || "").slice(0, 240),
      category: String(h.category || "Highlight").slice(0, 40),
      score: clamp(Number(h.score) || 70, 0, 100),
      reason: String(h.reason || "Selected as a strong moment based on available signals.").slice(0, 240),
    });
  }
  // de-overlap simple
  out.sort((a,b)=>b.score-a.score || a.start-b.start);
  const picked: HighlightCandidate[] = [];
  for (const c of out) {
    if (picked.some(p => !(c.end <= p.start + 1 || c.start >= p.end - 1))) continue;
    picked.push(c);
    if (picked.length >= desired) break;
  }
  return picked.sort((a,b)=>a.start-b.start);
}

function heuristicHighlights(total: number, desired: number, clipDur: number, mode: string): HighlightCandidate[] {
  const t = Math.max(total, clipDur * desired);
  const step = t / (desired + 1);
  const res: HighlightCandidate[] = [];
  const cat = mode && mode !== "Best Moments" && mode !== "Custom Prompt" ? mode : "Highlight";
  for (let i = 0; i < desired; i++) {
    const center = step * (i + 1);
    let start = clamp(center - clipDur / 2, 0, Math.max(0, t - clipDur));
    let end = clamp(start + clipDur, start + 3, t);
    res.push({
      start, end,
      title: `${cat} #${i + 1}`,
      description: `Auto-detected ${cat.toLowerCase()} segment based on scene distribution.`,
      category: cat,
      score: Math.max(50, 90 - i * 5),
      reason: "Heuristic selection distributed across the video (configure AI model for semantic analysis).",
    });
  }
  return res;
}
