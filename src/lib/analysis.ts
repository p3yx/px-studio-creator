import path from "path";
import fs from "fs/promises";
import { extractAudioWav, extractFrames, probeVideo } from "./ffmpeg";
import { chatCompletion, getAIConfigFromEnv, AIConfig } from "./ai";
import { resolveTaskConfig, getCaptionRetryModels } from "./ai-providers";
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

function isMetaNarration(s: string | null | undefined) {
  return /sesuai permintaan|permintaan pengguna|sesuai instruksi|berdasarkan instruksi|sekitar detik|detik\s*\d+|momen aksi menarik|clip ini dipilih|highlight\s*#\d+/i.test(String(s || ""));
}

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

  // Local-only mode: no STT/gateway calls.
  const transcriptSnippet = "";

  await params.onProgress?.("Finding Highlights", 55);

  // Heuristic-only highlight selection: deterministic, offline, no model calls, no quota.
  const desiredHeuristic = Math.max(1, Math.min(config.quantity || 3, 20));
  const clipDurHeuristic = Math.max(5, Math.min(config.duration || 30, 180));
  await params.onProgress?.("Finding Highlights", 70);
  return heuristicHighlights(total, desiredHeuristic, clipDurHeuristic, config.mode, false, config.prompt);

  // Ask AI (text model) to propose highlights based on metadata/signals; if unavailable, fallback heuristic.
  const desired = Math.max(1, Math.min(config.quantity || 3, 20));
  const clipDur = Math.max(5, Math.min(config.duration || 30, 180));

  let hasTextModel = !!ai.textModel;
  try { const resolved = await resolveTaskConfig("highlight_detection"); hasTextModel = !!resolved?.model?.modelId; } catch {}

  let aiFailure: string | null = null;
  if (hasTextModel) {
    try {
      const prompt = buildHighlightPrompt({ total, desired, clipDur, mode: config.mode, userPrompt: config.prompt, framesCount: frames.length, transcriptSnippet });
      // frames were extracted with known fps -> approximate timestamp of each sampled frame
      const frameFps = total > 120 ? 0.2 : total > 60 ? 0.5 : 1;
      // Pre-read sampled frames as base64 (vision-capable models accept this)
      async function sampledFramesBase64(maxFrames: number) {
        const pick = frames.length > maxFrames
          ? frames.filter((_, i) => i % Math.ceil(frames.length / maxFrames) === 0).slice(0, maxFrames)
          : frames;
        const out: { ts: number; b64: string }[] = [];
        for (const f of pick) {
          const idx = Number(path.basename(f).match(/\d+/)?.[0] || "0");
          const ts = Math.min(total, Math.max(0, idx / frameFps));
          const b64 = await fs.readFile(f).then(b => b.toString("base64")).catch(() => null);
          if (b64) out.push({ ts, b64 });
        }
        return out;
      }
      const messagesFor = (imgs: { ts: number; b64: string }[]) => {
        if (!imgs.length) return [
          { role: "system", content: "You are an expert video editor and highlight detector. Return strict JSON only." },
          { role: "user", content: prompt },
        ];
        const content: any[] = [{ type: "text", text: prompt }];
        for (const im of imgs) {
          content.push({ type: "text", text: `Frame at ~${im.ts.toFixed(1)}s of ${total.toFixed(0)}s:` });
          content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${im.b64}`, detail: "low" } });
        }
        return [
          { role: "system", content: "You are an expert video editor and highlight detector. You receive frame images with timestamps and optional transcript. Return strict JSON only." },
          { role: "user", content },
        ];
      };
      // Staged attempts: 8 frames -> 4 frames -> text-only (longer timeout for multimodal)
      const all8 = await sampledFramesBase64(12);
      const all4 = all8.length ? all8.filter((_, i) => i % 2 === 0) : [];
      const attempts = [
        { imgs: all8, timeout: 300000 },
        ...(all4.length ? [{ imgs: all4, timeout: 180000 }] : []),
        { imgs: [] as { ts: number; b64: string }[], timeout: 90000 },
      ];
      let resp: any = null; let lastErr: any = null;
      for (const a of attempts) {
        try {
          resp = await chatCompletion(ai, messagesFor(a.imgs), { model: ai.textModel, temperature: 0.2, json: true, task: "highlight_detection", timeout: a.timeout });
          break;
        } catch (e) { lastErr = e; }
      }
      // If the active model (or a combo) is quota-limited, returns no content, or returns no usable
      // highlights, try known-free vision-capable models directly before giving up.
      const freeVision = await getCaptionRetryModels();
      const probeMsgs = messagesFor(all4.length ? all4 : all8);
      function parseHighlights(r: any) {
        const c = r?.choices?.[0]?.message?.content;
        const s = typeof c === "string" ? c : (Array.isArray(c) ? c.map((x: any) => x?.text || "").join("\n") : "{}");
        const p = typeof s === "string" ? safeJsonParse<any>(s, {}) : (s || {});
        return Array.isArray(p?.highlights) ? p.highlights : [];
      }
      async function tryFreeVision() {
        for (const m of freeVision) {
          try {
            const r = await chatCompletion(ai, probeMsgs, { model: m, temperature: 0.2, json: true, task: "highlight_detection", timeout: 180000 });
            if (r && parseHighlights(r).length) return r;
            console.error("[analysis] candidate produced no highlights:", m, JSON.stringify(r?.choices?.[0]?.message || r).slice(0, 400));
          } catch (e) { lastErr = e; }
        }
        return null;
      }
      if (!resp) resp = await tryFreeVision();
      if (!resp && lastErr) throw lastErr;
      if (!parseHighlights(resp).length) console.error("[analysis] primary candidate no highlights:", JSON.stringify(resp?.choices?.[0]?.message || resp).slice(0, 400));
      const rawList = parseHighlights(resp);
      let cleaned = normalizeHighlights(rawList, total, clipDur, desired, config.prompt);
      if (rawList.length && !cleaned.length) {
        console.error("[analysis] AI highlights dropped by normalize:", JSON.stringify(rawList.slice(0, 2)).slice(0, 600));
      }
      if (!cleaned.length) {
        const alt = await tryFreeVision();
        if (alt) cleaned = normalizeHighlights(parseHighlights(alt), total, clipDur, desired, config.prompt);
        if (!cleaned.length) console.error("[analysis] no AI candidate produced usable highlights; using heuristic");
      }
      // Some gateway models answer with a report about the selection instead of a scene caption.
      // If so, retry once with the strongest known free vision model for frame-grounded captions.
      if (cleaned.length && cleaned.some(c => isMetaNarration(c.description))) {
        for (const model of freeVision.slice(0, 5)) {
          try {
            const r = await chatCompletion(ai, messagesFor(all8), { model, temperature: 0.2, json: true, task: "highlight_detection", timeout: 240000 });
            const alt = normalizeHighlights(parseHighlights(r), total, clipDur, desired, config.prompt);
            if (alt.length && !alt.some(c => isMetaNarration(c.description))) { cleaned = alt; break; }
          } catch { /* try next ranked model */ }
        }
      }
      if (cleaned.length) {
        await params.onProgress?.("Finding Highlights", 70);
        return cleaned;
      }
    } catch (e: any) {
      aiFailure = String(e?.message || e || "AI error").slice(0, 180);
      console.error("[analysis] highlight AI unavailable, using fallback:", aiFailure);
    }
  }

  await params.onProgress?.("Finding Highlights", 70);
  const fallback = heuristicHighlights(total, desired, clipDur, config.mode, !!transcriptSnippet, config.prompt);
  if (aiFailure && fallback.length) {
    fallback[0].reason = `AI tidak merespons (${aiFailure}); analisis memakai heuristik lokal. ${fallback[0].reason}`;
  }
  return fallback;
}

async function transcribeAudioSafe(ai: AIConfig, wav: string) {
  const { transcribeAudio } = await import("./ai");
  return transcribeAudio(ai, wav);
}

function buildHighlightPrompt(ctx: { total: number; desired: number; clipDur: number; mode: string; userPrompt?: string; framesCount: number; transcriptSnippet: string }) {
  return `Analyze a source video and propose the best clip moments.
Video duration (seconds): ${ctx.total}
Requested clips: ${ctx.desired}
Target clip duration (seconds): ${ctx.clipDur}
Mode: ${ctx.mode}
User instruction (HIGHEST PRIORITY — if it conflicts with the default distribution rules below, follow the user instruction):
${ctx.userPrompt || "(none)"}
Sampled frames extracted: ${ctx.framesCount}${ctx.framesCount ? " (attached as images below when supported; each image is preceded by its approximate timestamp)" : ""}
Transcript snippet (may be empty): ${ctx.transcriptSnippet ? `\n"""${ctx.transcriptSnippet}"""` : "(unavailable)"}

Rules:
- Use the attached frame images (with their timestamps) and the transcript as the primary evidence of content.
- Follow the User instruction above strictly, including any exclusions (e.g. "avoid action"): category and chosen windows must respect it.
- Do NOT choose random timestamps; distribute and select plausible highlight windows (action/emotional/dialogue peaks) spread across the video.
- start/end must be within [0, duration], end>start, and each clip length close to target duration when possible.
- Return JSON object: {"highlights":[{"start":number,"end":number,"title":string,"description":string,"category":string,"score":number,"reason":string}]}
- category should reflect the moment (Epic, Action, Fight, Emotional, Funny, Romance, Dialogue, Dramatic, or Custom).
- CRITICAL — title and description are SCENE CAPTIONS, not reports about your selection:
  * title: a short specific label derived ONLY from the attached frames of THIS clip, ideally "<Visible subject> — <Visible action>". Never copy a sample title; invent one that matches these frames.
  * description: 1-2 sentences narrating the actual visible events in that window: who is present, what they do, what changes. Name characters only if they can be identified from the frames. Write in the same language as the User instruction.
  * Use the attached FRAME IMAGES as primary evidence. Do NOT describe the instruction, the timestamp, or your own selection process.
  * FORBIDDEN in title/description: "sesuai permintaan pengguna", "sesuai instruksi", "permintaan pengguna", "sekitar detik", "detik 85", "momen aksi menarik", "action", "clip ini dipilih", "Highlight #1".
  * BAD: "Momen aksi menarik terjadi sekitar detik 85-100, sesuai permintaan pengguna memilih momen action."
  * GOOD pattern: "<Subject in these frames> — <Action in these frames>. <What actually happens across these frames>."
- The User instruction only steers WHICH moments to pick; it must NOT be echoed in the title/description text.
- Do NOT reuse titles/descriptions from any example, prior clip, or well-known scene; describe only what these frames show.
- score 0-100.`;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function inferScene(prompt: string | undefined, mode: string): { label: string; detail: string; category: string } {
  const text = `${prompt || ""} ${mode || ""}`.toLowerCase();
  const has = (...words: string[]) => words.some(w => text.includes(w));
  if (has("pertarungan", "tarung", "pedang", "fight", "action", "aksi", "lawan", "duel", "hype"))
    return { label: "Adegan Pertarungan", detail: "Fokus pada tensi dan pertukaran serangan antar karakter.", category: "Action" };
  if (has("romantis", "romance", "cinta", "jodoh", "kiss", "sayang"))
    return { label: "Momen Romantis", detail: "Fokus pada interaksi emosional dan kedekatan antar karakter.", category: "Romance" };
  if (has("lucu", "comedy", "funny", "ngakak", "kocak", "humor"))
    return { label: "Momen Lucu", detail: "Fokus pada reaksi dan situasi komedis yang menonjol.", category: "Funny" };
  if (has("sedih", "emosi", "emotional", "menangis", "haru", "dramatis", "drama"))
    return { label: "Momen Emosional", detail: "Fokus pada ekspresi dan momen emosional yang kuat.", category: "Emotional" };
  if (has("dialog", "bicara", "ngobrol", "obrolan", "percakapan", "story", "cerita"))
    return { label: "Cuplikan Dialog", detail: "Fokus pada percakapan dan informasi penting dari tokoh.", category: "Dialogue" };
  if (has("epik", "epic", "seru", "klimaks", "heroik"))
    return { label: "Momen Epik", detail: "Fokus pada momen menonjol dengan energi dan skala besar.", category: "Epic" };
  return { label: "Momen Menarik", detail: "Fokus pada bagian yang paling menonjol di segmen ini.", category: "Highlight" };
}

function flowLabel(i: number, desired: number): string {
  if (desired <= 1) return "segmen utama";
  if (i === 0) return "pembukaan alur";
  if (i === desired - 1) return "penutup alur";
  if (i === Math.floor(desired / 2)) return "tengah/klimaks alur";
  return "kelanjutan alur";
}

function promptLabel(prompt?: string): string {
  const raw = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!raw) return "Custom";
  const stripped = raw
    .replace(/^(pilih|ambil|buat|temukan|cari|show|find|select|take|make|give|highlight)\b[:\s,]+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  const label = (stripped || raw).slice(0, 56);
  return label.length < (stripped || raw).length ? `${label}…` : label;
}

function promptDescription(prompt: string | undefined, cat: string, modeBias: string, hasTranscript: boolean): string {
  const p = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!p) return `Auto-selected ${cat.toLowerCase()} segment using ${modeBias}${hasTranscript ? " with transcript-aware context" : ""}.`;
  return `Dipilih berdasarkan instruksi Anda: "${p.slice(0, 180)}"${hasTranscript ? " (dengan konteks transkrip)." : "."}`;
}

function normalizeHighlights(list: any[], total: number, clipDur: number, desired: number, userPrompt?: string): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const h of list) {
    let start = Number(h.start);
    let end = Number(h.end);
    if (!isFinite(start) || !isFinite(end)) continue;
    start = clamp(start, 0, Math.max(0, total - 1));
    end = clamp(end, start + 2, total || start + clipDur);
    if (end - start < 3) end = clamp(start + clipDur, start + 3, total || start + clipDur);
    if (end - start > clipDur * 2) end = start + clipDur;
    const idx = out.length + 1;
    const rawTitle = String(h.title || "").trim();
    const genericTitle = !rawTitle || /^highlight\s*#?\d*$/i.test(rawTitle) || /^clip\s*#?\d*$/i.test(rawTitle) || /^(auto-selected|heuristic)/i.test(rawTitle);
    const rawDesc = String(h.description || "").trim();
    const scene = inferScene(userPrompt, "");
    const aiGenericDesc = /^auto-selected/i.test(rawDesc);
    const fallbackDesc = `Bagian ${idx} (${flowLabel(idx - 1, desired)}) · ${formatClock(start)}–${formatClock(end)}. ${scene.detail} Sesuai instruksi: "${String(userPrompt || "").slice(0, 140)}".`;
    out.push({
      start, end,
      title: genericTitle ? `${scene.label} #${idx}`.slice(0, 80) : rawTitle.slice(0, 80),
      description: (!rawDesc || aiGenericDesc ? (userPrompt ? fallbackDesc : promptDescription(undefined, "highlight", "selection", false)) : rawDesc).slice(0, 240),
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

function heuristicHighlights(total: number, desired: number, clipDur: number, mode: string, hasTranscript = false, userPrompt?: string): HighlightCandidate[] {
  const dur = Math.max(3, Math.min(clipDur, total > 0 ? total / desired : clipDur));
  const t = Math.max(total, dur * desired);
  const step = t / (desired + 1);
  const res: HighlightCandidate[] = [];
  const cat = mode && mode !== "Best Moments" && mode !== "Custom Prompt" ? mode : "Highlight";
  const modeBias = /dialog|story|emotion/i.test(mode) ? "dialogue pacing" : /action|fight|hype|amv/i.test(mode) ? "energy pacing" : "balanced pacing";
  for (let i = 0; i < desired; i++) {
    // Spread across timeline with slight bias away from absolute edges and toward early/mid peaks
    const pos = (i + 1) / (desired + 1);
    const bias = pos < 0.5 ? (0.95 + pos * 0.1) : (1.05 - (pos - 0.5) * 0.1);
    const center = step * (i + 1) * bias;
    let start = clamp(center - dur / 2, 0, Math.max(0, t - dur));
    let end = clamp(start + dur, start + 3, t);
    // Nudge away from very start/end for better highlight likelihood
    if (start < 1 && t > dur + 2) { start = Math.min(1.5, Math.max(0, t - dur)); end = clamp(start + dur, start + 3, t); }
    const score = clamp(Math.round(86 - i * 4 + (hasTranscript ? 4 : 0) + (/action|fight|hype/i.test(mode) && pos > 0.2 && pos < 0.85 ? 3 : 0)), 45, 96);
    const scene = inferScene(userPrompt, mode);
    const instr = String(userPrompt || "").replace(/\s+/g, " ").trim();
    const desc = instr
      ? `Bagian ${i + 1} dari ${desired} — ${flowLabel(i, desired)} (${formatClock(start)}–${formatClock(end)}). ${scene.detail}${hasTranscript ? " Konteks transkrip tersedia." : ""} Sesuai instruksi Anda: "${instr.slice(0, 140)}".`
      : promptDescription(undefined, cat, modeBias, hasTranscript);
    res.push({
      start, end,
      title: userPrompt ? `${scene.label} #${i + 1}` : `${cat} #${i + 1}`,
      description: desc.slice(0, 240),
      category: userPrompt ? scene.category : cat,
      score,
      reason: instr
        ? `Heuristic timeline selection guided by the custom instruction and ${flowLabel(i, desired)}; enable a vision-capable AI model for frame-level verification.`
        : (hasTranscript
          ? "Heuristic selection distributed across the timeline with transcript/audio context available (configure a capable AI model for deeper semantic scoring)."
          : "Heuristic selection distributed across the timeline using pacing signals (configure AI/STT for richer audio+transcript scoring)."),
    });
  }
  return res.sort((a,b)=>a.start-b.start);
}
