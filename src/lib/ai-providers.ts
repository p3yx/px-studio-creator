import fs from "fs/promises";
import { prisma } from "./db";

export type TaskKey =
  | "prompt_understanding"
  | "editing_plan"
  | "vision_analysis"
  | "highlight_detection"
  | "speech_to_text"
  | "text_to_speech"
  | "translation"
  | "audio_analysis"
  | "metadata_generation"
  | "default_text"
  | "default_vision"
  | "default_stt"
  | "default_audio"
  | string;

type GatewayConfig = {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};

function cleanBaseUrl(url: string) {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function getGatewayConfig(): GatewayConfig {
  // Reuse existing env vars; support AI_DEFAULT_MODEL as preferred default selector.
  const baseUrl = cleanBaseUrl(process.env.AI_API_BASE_URL || "http://192.168.0.157:20128/v1");
  const apiKey = String(process.env.AI_API_KEY || "").trim();
  const defaultModel = String(process.env.AI_DEFAULT_MODEL || process.env.AI_TEXT_MODEL || "").trim();
  return { baseUrl, apiKey, defaultModel };
}

async function getSetting(key: string) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value ?? null;
}
async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getActiveModelId(): Promise<string> {
  const saved = String((await getSetting("aiSelectedModel")) || "").trim();
  if (saved) return saved;
  const { defaultModel } = getGatewayConfig();
  return defaultModel;
}

function authHeaders(apiKey: string, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

async function requestWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

function statusFromError(msg: string) {
  const m = (msg || "").toLowerCase();
  if (m.includes("401") || m.includes("403") || m.includes("auth") || m.includes("unauthorized") || m.includes("api key") || m.includes("invalid key")) return "auth_failed";
  if (m.includes("404") && m.includes("model") || (m.includes("model") && (m.includes("not found") || m.includes("not exist") || m.includes("unknown")))) return "model_not_found";
  if (m.includes("endpoint") || m.includes("enotfound") || m.includes("econnrefused") || m.includes("fetch failed") || m.includes("network")) return "gateway_unavailable";
  if (m.includes("timeout") || m.includes("aborted")) return "timeout";
  if (m.includes("unsupported") || m.includes("not support") || m.includes("capability") || m.includes("does not support")) return "unsupported";
  return "error";
}

async function logUsage(entry: any) {
  try { await prisma.aiUsageLog.create({ data: entry }); } catch {}
}

export async function listGatewayModels(opts?: { refresh?: boolean }) {
  const { baseUrl, apiKey } = getGatewayConfig();
  if (!baseUrl) throw new Error("AI_BASE_URL is not configured on server");
  // Always try live fetch from gateway; if fails, fall back to last cached list (do not delete).
  try {
    const res = await requestWithTimeout(`${baseUrl}/models`, { method: "GET", headers: authHeaders(apiKey) }, 20000);
    const text = await res.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `Failed to fetch models (${res.status})`;
      throw new Error(msg);
    }
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const models = list.map((m: any) => String(m?.id || m?.name || "")).filter(Boolean);
    const uniq = Array.from(new Set(models)).sort((a,b)=>a.localeCompare(b));
    await setSetting("aiAvailableModels", JSON.stringify(uniq));
    await setSetting("aiModelsLastUpdated", new Date().toISOString());
    await setSetting("aiGatewayLastStatus", "connected");
    await setSetting("aiGatewayLastError", "");
    return { models: uniq, lastUpdated: new Date().toISOString(), fromCache: false };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Timeout" : (e?.message || "Failed to fetch models");
    await setSetting("aiGatewayLastStatus", statusFromError(msg));
    await setSetting("aiGatewayLastError", msg.slice(0, 300));
    const cached = await getSetting("aiAvailableModels");
    let models: string[] = [];
    try { models = cached ? JSON.parse(cached) : []; } catch { models = []; }
    if (models.length) {
      const lastUpdated = await getSetting("aiModelsLastUpdated");
      return { models, lastUpdated, fromCache: true, error: msg };
    }
    throw new Error(msg);
  }
}

export async function getAISettings() {
  const { baseUrl, defaultModel } = getGatewayConfig();
  const selectedModel = await getActiveModelId();
  const lastUpdated = await getSetting("aiModelsLastUpdated");
  const lastStatus = await getSetting("aiGatewayLastStatus");
  const lastError = await getSetting("aiGatewayLastError");
  const cached = await getSetting("aiAvailableModels");
  let models: string[] = [];
  try { models = cached ? JSON.parse(cached) : []; } catch { models = []; }
  return {
    gateway: "9Router",
    baseUrlConfigured: !!baseUrl,
    activeModel: selectedModel || null,
    defaultModel: defaultModel || null,
    connectionStatus: lastStatus || "unknown",
    connectionError: lastError || null,
    lastUpdated: lastUpdated || null,
    models,
  };
}

export async function saveAISettings(input: { model?: string }) {
  const model = String(input?.model || "").trim();
  if (!model) throw new Error("Model is required");
  // validate against available models if we have a cached/fetched list
  let models: string[] = [];
  try { models = (await listGatewayModels({ refresh: false })).models; } catch {
    const cached = await getSetting("aiAvailableModels");
    try { models = cached ? JSON.parse(cached) : []; } catch { models = []; }
  }
  if (models.length && !models.includes(model)) {
    throw new Error("Model tidak tersedia pada gateway 9Router. Muat ulang daftar model dan pilih model yang valid.");
  }
  await setSetting("aiSelectedModel", model);
  return { ok: true, activeModel: model };
}

export async function testAIConnection(modelOverride?: string) {
  const { baseUrl, apiKey } = getGatewayConfig();
  const model = String(modelOverride || (await getActiveModelId()) || "").trim();
  const start = Date.now();
  if (!baseUrl) {
    return { ok: false, status: "gateway_unavailable", error: "AI_BASE_URL is not configured on server" };
  }
  try {
    // Basic gateway reachability/auth via /models
    const res = await requestWithTimeout(`${baseUrl}/models`, { method: "GET", headers: authHeaders(apiKey) }, 20000);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      let d: any = null; try { d = t ? JSON.parse(t) : null; } catch {}
      throw new Error(d?.error?.message || d?.message || `Gateway check failed (${res.status})`);
    }
    // If model selected, do a real chat request with that model
    if (model) {
      const cres = await requestWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: authHeaders(apiKey, true),
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK" }], temperature: 0, max_tokens: 5 }),
      }, 20000);
      const ct = await cres.text();
      let cd: any = null; try { cd = ct ? JSON.parse(ct) : null; } catch { cd = ct; }
      if (!cres.ok) throw new Error(cd?.error?.message || cd?.message || `Model request failed (${cres.status})`);
    }
    await setSetting("aiGatewayLastStatus", "connected");
    await setSetting("aiGatewayLastError", "");
    await logUsage({ providerId: null, model: model || null, task: "connection_test", success: true, status: "success", durationMs: Date.now() - start });
    return { ok: true, status: "connected", model: model || null };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Timeout" : (e?.message || "Connection error");
    const status = statusFromError(msg);
    await setSetting("aiGatewayLastStatus", status);
    await setSetting("aiGatewayLastError", msg.slice(0, 300));
    await logUsage({ providerId: null, model: model || null, task: "connection_test", success: false, status, errorMessage: msg.slice(0, 300), durationMs: Date.now() - start });
    return { ok: false, status, error: msg };
  }
}

// Compatibility helpers (kept simple; multi-provider UI removed)
export async function ensureLegacyProviderMigrated() { return; }
export async function listProvidersAdmin() { return []; }
export async function getTaskRoutes() { return {}; }
export async function createOrUpdateProvider(_input: any) { throw new Error("Provider management is disabled. Configure 9Router via server .env and select model in Settings."); }
export async function setTaskRoute() { throw new Error("Task-based routing is disabled."); }
export async function deleteProvider() { throw new Error("Provider management is disabled."); }
export async function getUsageStats() {
  const logs = await prisma.aiUsageLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }).catch(() => [] as any[]);
  return logs.map((l: any) => ({ id: l.id, provider: "9Router", providerId: null, model: l.model, task: l.task, success: l.success, status: l.status, tokensIn: l.tokensIn, tokensOut: l.tokensOut, tokensTotal: l.tokensTotal, cost: l.cost, durationMs: l.durationMs, usedFallback: false, createdAt: l.createdAt }));
}
export async function testProviderConnection() { return testAIConnection(); }
export async function fetchProviderModels() { return { models: (await listGatewayModels()).models.map(id => ({ modelId: id, label: id })) }; }

async function chatCompletionRaw(modelId: string, messages: any[], opts: any = {}) {
  const { baseUrl, apiKey } = getGatewayConfig();
  if (!baseUrl) throw new Error("AI gateway (AI_BASE_URL) is not configured on server");
  if (!modelId) throw new Error("AI model is not configured. Pilih model AI di Settings.");
  const body: any = { model: modelId, messages, temperature: opts.temperature ?? 0.2 };
  if (opts.json) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const res = await requestWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: authHeaders(apiKey, true),
    body: JSON.stringify(body),
  }, Number(opts.timeout || 45000));
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `AI request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Keep compatible signatures used by existing features
export async function resolveTaskConfig(task: TaskKey | string) {
  const { baseUrl, apiKey } = getGatewayConfig();
  const modelId = await getActiveModelId();
  return {
    legacy: false,
    provider: { id: "9router", name: "9Router", type: "openai_compatible", baseUrl, encryptedApiKey: apiKey || null, configJson: JSON.stringify({ timeout: 45000 }) },
    model: { id: "active-model", modelId: modelId || "" },
    route: { task },
  };
}

export async function runTaskChat(task: TaskKey | string, messages: any[], opts: any = {}) {
  const modelId = String(opts.model || (await getActiveModelId()) || "").trim();
  if (!modelId) throw new Error("AI model belum dipilih. Buka Settings dan pilih model AI.");
  const start = Date.now();
  try {
    const data = await chatCompletionRaw(modelId, messages, opts);
    const usage = data?.usage || {};
    await logUsage({ providerId: null, model: modelId, task, success: true, status: "success", tokensIn: usage.prompt_tokens ?? usage.input_tokens ?? null, tokensOut: usage.completion_tokens ?? usage.output_tokens ?? null, tokensTotal: usage.total_tokens ?? null, durationMs: Date.now() - start });
    return data;
  } catch (e: any) {
    const msg = e?.message || "AI request failed";
    await logUsage({ providerId: null, model: modelId, task, success: false, status: statusFromError(msg), errorMessage: msg.slice(0, 300), durationMs: Date.now() - start });
    throw e;
  }
}

export async function transcribeWithTask(task: TaskKey | string, filePath: string, opts: { language?: string; prompt?: string } = {}) {
  const { baseUrl, apiKey } = getGatewayConfig();
  const modelId = await getActiveModelId();
  if (!baseUrl) throw new Error("AI gateway (AI_BASE_URL) is not configured on server");
  if (!modelId) throw new Error("AI model belum dipilih. Buka Settings dan pilih model AI.");
  const start = Date.now();
  try {
    const buf = await fs.readFile(filePath);
    const form = new FormData();
    form.append("model", modelId);
    form.append("file", new Blob([buf]), filePath.split(/[/\\]/).pop() || "audio.wav");
    // OpenAI-compatible transcription options (best-effort; gateway/model may ignore unsupported fields)
    if (opts.language && opts.language !== "auto") form.append("language", String(opts.language));
    if (opts.prompt) form.append("prompt", String(opts.prompt));
    const headers: any = {}; if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await requestWithTimeout(`${baseUrl}/audio/transcriptions`, { method: "POST", headers, body: form as any }, 120000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = data?.error?.message || data?.message || `Transcription failed (${res.status})`;
      if (/invalid model format/i.test(String(msg || ""))) {
        msg = `Format model tidak valid untuk transkripsi di gateway 9Router ("${modelId}"). ${msg}. Buka Settings > AI dan pilih model yang mendukung speech-to-text/transkripsi (sesuai format yang diterima gateway), lalu coba lagi.`;
      }
      throw new Error(msg);
    }
    await logUsage({ providerId: null, model: modelId, task, success: true, status: "success", durationMs: Date.now() - start });
    return data;
  } catch (e: any) {
    const msg = e?.message || "Transcription failed";
    await logUsage({ providerId: null, model: modelId, task, success: false, status: statusFromError(msg), errorMessage: msg.slice(0, 300), durationMs: Date.now() - start });
    const status = statusFromError(msg);
    if (status === "unsupported") throw new Error("Model aktif tidak mendukung speech-to-text/transkripsi audio melalui gateway ini. Pilih model yang mendukung audio atau sesuaikan kemampuan fitur.");
    throw e;
  }
}

export async function synthesizeSpeechWithTask(task: TaskKey | string, text: string, opts: any = {}) {
  const { baseUrl, apiKey } = getGatewayConfig();
  const modelId = String(opts.model || (await getActiveModelId()) || "").trim();
  if (!baseUrl) throw new Error("AI gateway (AI_BASE_URL) is not configured on server");
  if (!String(text || "").trim()) throw new Error("Text is required");
  if (!modelId) throw new Error("AI model belum dipilih. Buka Settings dan pilih model AI.");
  const start = Date.now();
  try {
    const res = await requestWithTimeout(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: authHeaders(apiKey, true),
      body: JSON.stringify({ model: modelId, input: String(text), voice: opts.voice || "alloy", format: opts.format || "mp3", ...(opts.speed ? { speed: opts.speed } : {}) }),
    }, 90000);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let data: any = null; try { data = errText ? JSON.parse(errText) : null; } catch {}
      const msg = data?.error?.message || data?.message || errText?.slice(0, 300) || `TTS failed (${res.status})`;
      throw new Error(msg);
    }
    const arrayBuf = await res.arrayBuffer();
    await logUsage({ providerId: null, model: modelId, task, success: true, status: "success", durationMs: Date.now() - start });
    return { buffer: Buffer.from(arrayBuf), contentType: res.headers.get("content-type") || "audio/mpeg" };
  } catch (e: any) {
    const msg = e?.message || "Text-to-speech failed";
    await logUsage({ providerId: null, model: modelId, task, success: false, status: statusFromError(msg), errorMessage: msg.slice(0, 300), durationMs: Date.now() - start });
    if (statusFromError(msg) === "unsupported") throw new Error("Model aktif tidak mendukung text-to-speech melalui gateway ini. Pilih model yang mendukung TTS.");
    throw e;
  }
}

