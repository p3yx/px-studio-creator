import fs from "fs/promises";
import path from "path";
import { prisma } from "./db";
import { STORAGE_ROOT } from "./storage";

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

export type ProviderType = "google_gemini" | "openai" | "anthropic" | "groq" | "openrouter" | "custom_gateway";
export type ProviderConfig = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
};

export const PROVIDER_PRESETS: Array<{ type: ProviderType; name: string; baseUrl: string; models: string[] }> = [
  { type: "google_gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"] },
  { type: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"] },
  { type: "anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", models: ["claude-3-5-haiku-latest", "claude-sonnet-4-5", "claude-opus-4-1"] },
  { type: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"] },
  { type: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-4o-mini", "google/gemini-2.0-flash-001", "anthropic/claude-3.5-haiku"] },
  { type: "custom_gateway", name: "Custom Gateway (OpenAI-compatible)", baseUrl: "", models: [] },
];

export const EMPTY_PROVIDER: ProviderConfig = {
  id: "",
  name: "Belum ada provider",
  type: "custom_gateway",
  baseUrl: "",
  apiKey: "",
  enabled: false,
  createdAt: "",
};

function presetFor(type: string) {
  return PROVIDER_PRESETS.find(p => p.type === type);
}

function normalizeApiKey(raw: string) {
  let key = String(raw || "").trim();
  key = key.replace(/^(api[\s_-]?key|api|key|token|secret|bearer)\s*[:=]?\s*/i, "").trim();
  key = key.replace(/^["'`]+|["'`]+$/g, "").trim();
  return key.split(/\s+/)[0] || "";
}

export async function listProviders(): Promise<ProviderConfig[]> {
  const raw = await getSetting("aiProvidersConfig");
  let saved: ProviderConfig[] = [];
  try { saved = raw ? JSON.parse(raw) : []; } catch { saved = []; }
  return Array.isArray(saved) ? saved : [];
}

export async function getProvider(id?: string | null): Promise<ProviderConfig> {
  const explicit = String(id || "").trim();
  const target = explicit || String((await getSetting("aiActiveProvider")) || "");
  const all = await listProviders();
  const found = target ? all.find(p => p.id === target) : all[0];
  if (found) return { ...found, apiKey: normalizeApiKey(found.apiKey) };
  if (explicit) throw new Error(`Provider tidak ditemukan: ${target}`);
  return EMPTY_PROVIDER;
}

export async function upsertProvider(input: Partial<ProviderConfig> & { id?: string }): Promise<ProviderConfig> {
  const raw = await getSetting("aiProvidersConfig");
  let saved: ProviderConfig[] = [];
  try { saved = raw ? JSON.parse(raw) : []; } catch { saved = []; }
  const preset = presetFor(String(input.type || "custom_gateway"));
  const id = String(input.id || `p-${Date.now().toString(36)}`);
  const item: ProviderConfig = {
    id,
    name: String(input.name || preset?.name || "Custom Provider").trim(),
    type: (preset?.type || "custom_gateway") as ProviderType,
    baseUrl: cleanBaseUrl(String(input.baseUrl || preset?.baseUrl || "")),
    apiKey: normalizeApiKey(input.apiKey || ""),
    enabled: input.enabled !== false,
    createdAt: String(input.createdAt || new Date().toISOString()),
  };
  if (!item.baseUrl && item.type !== "custom_gateway") item.baseUrl = preset?.baseUrl || "";
  const idx = saved.findIndex(p => p.id === id);
  if (idx >= 0) saved[idx] = item; else saved.push(item);
  await setSetting("aiProvidersConfig", JSON.stringify(saved));
  return item;
}

export async function deleteProviderImpl(id: string) {
  const raw = await getSetting("aiProvidersConfig");
  let saved: ProviderConfig[] = [];
  try { saved = raw ? JSON.parse(raw) : []; } catch { saved = []; }
  saved = saved.filter(p => p.id !== id);
  await setSetting("aiProvidersConfig", JSON.stringify(saved));
  if ((await getSetting("aiActiveProvider")) === id) {
    await setSetting("aiActiveProvider", "");
    await setSetting("aiSelectedModel", "");
  }
  return { ok: true };
}

export async function setActiveProvider(id: string) {
  const provider = await getProvider(id);
  await setSetting("aiActiveProvider", provider.id);
  // Each provider owns its model list and active model. Switching provider must switch both.
  let models: string[] = [];
  try { models = (await listModelsForActiveProvider()).models; } catch {}
  const current = String((await getSetting("aiSelectedModel")) || "").trim();
  if (!models.includes(current) && models.length) await setSetting("aiSelectedModel", String(models[0]));
  await setSetting("aiGatewayLastStatus", "unknown");
  await setSetting("aiGatewayLastError", "");
  return { ok: true, provider, models, selectedModel: String((await getSetting("aiSelectedModel")) || models[0] || "") };
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
  const provider = await getProvider();
  if (!provider.id) return "";
  const cacheKey = `aiModels:${provider.id}`;
  try {
    const cached = JSON.parse(String(await getSetting(cacheKey) || "[]"));
    if (Array.isArray(cached) && cached.length) return String(cached[0]);
  } catch {}
  return presetFor(provider.type)?.models?.[0] || "";
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
  const selectedModel = await getActiveModelId();
  const lastUpdated = await getSetting("aiModelsLastUpdated");
  const lastStatus = await getSetting("aiGatewayLastStatus");
  const lastError = await getSetting("aiGatewayLastError");
  const provider = await getProvider();
  const cached = provider.id ? await getSetting(`aiModels:${provider.id}`) : null;
  let models: string[] = [];
  try { models = cached ? JSON.parse(cached) : []; } catch { models = []; }
  return {
    gateway: provider.name,
    providerId: provider.id || null,
    providerType: provider.type,
    providers: await listProviders(),
    baseUrlConfigured: !!provider.baseUrl,
    activeModel: selectedModel || null,
    defaultModel: null,
    connectionStatus: !provider.id ? "no_provider" : (lastStatus || "unknown"),
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
  try { models = (await listModelsForActiveProvider()).models; } catch {
    const cached = await getSetting("aiAvailableModels");
    try { models = cached ? JSON.parse(cached) : []; } catch { models = []; }
  }
  if (models.length && !models.includes(model)) {
    throw new Error("Model tidak tersedia pada provider aktif. Muat ulang daftar model dan pilih model yang valid.");
  }
  await setSetting("aiSelectedModel", model);
  return { ok: true, activeModel: model };
}

export async function testAIConnection(modelOverride?: string) {
  const provider = await getProvider();
  if (!provider.id) return { ok: false, status: "no_provider", error: "Belum ada provider. Tambahkan provider di Settings." };
  const model = String(modelOverride || (await getActiveModelId()) || "").trim();
  const start = Date.now();
  try {
    await listModelsForActiveProvider();
    if (model) {
      await chatCompletionRaw(model, [{ role: "user", content: "Reply with exactly: OK" }], { temperature: 0, maxTokens: 8, timeout: 30000 });
    }
    await setSetting("aiGatewayLastStatus", "connected");
    await setSetting("aiGatewayLastError", "");
    await logUsage({ providerId: null, model: model || null, task: "connection_test", success: true, status: "success", durationMs: Date.now() - start });
    return { ok: true, status: "connected", model: model || null, provider: provider.name };
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
export async function listProvidersAdmin() { return listProviders(); }
export async function getTaskRoutes() { return {}; }
export async function createOrUpdateProvider(input: any) { return upsertProvider(input); }
export async function setTaskRoute() { throw new Error("Task-based routing is disabled."); }
export async function deleteProvider(id: string) { return deleteProviderImpl(id); }
export async function getUsageStats() {
  const logs = await prisma.aiUsageLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }).catch(() => [] as any[]);
  return logs.map((l: any) => ({ id: l.id, provider: "9Router", providerId: null, model: l.model, task: l.task, success: l.success, status: l.status, tokensIn: l.tokensIn, tokensOut: l.tokensOut, tokensTotal: l.tokensTotal, cost: l.cost, durationMs: l.durationMs, usedFallback: false, createdAt: l.createdAt }));
}
export async function testProviderConnection(id?: string, model?: string) {
  if (id && id !== (await getProvider()).id) await setActiveProvider(id);
  return testAIConnection(model);
}
export async function fetchProviderModels() {
  const r = await listModelsForActiveProvider();
  return { models: r.models.map(id => ({ modelId: id, label: id })) };
}

function normalizeMessages(messages: any[]) {
  const system: string[] = [];
  const items: Array<{ role: string; parts: any[] }> = [];
  for (const m of messages || []) {
    const role = String(m?.role || "user");
    if (role === "system") {
      const c = m?.content;
      system.push(typeof c === "string" ? c : (Array.isArray(c) ? c.map((x: any) => x?.text || "").join("\n") : ""));
      continue;
    }
    const parts: any[] = [];
    const c = m?.content;
    if (typeof c === "string") parts.push({ text: c });
    else if (Array.isArray(c)) {
      for (const x of c) {
        if (x?.type === "image_url") {
          const url = String(x?.image_url?.url || "");
          const match = url.match(/^data:([^;]+);base64,(.*)$/s);
          if (match) parts.push({ image: { mime: match[1], data: match[2] } });
          else parts.push({ text: `[image: ${url}]` });
        } else if (x?.text) parts.push({ text: String(x.text) });
      }
    }
    items.push({ role: role === "assistant" ? "model" : "user", parts });
  }
  return { system: system.join("\n").trim(), items };
}

function asOpenAIResponse(content: string, usage?: any) {
  return { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage };
}

async function openAICompatibleChat(baseUrl: string, apiKey: string, modelId: string, messages: any[], opts: any) {
  const body: any = { model: modelId, messages, temperature: opts.temperature ?? 0.2 };
  if (opts.json) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const res = await requestWithTimeout(`${baseUrl}/chat/completions`, { method: "POST", headers: authHeaders(apiKey, true), body: JSON.stringify(body) }, Number(opts.timeout || 45000));
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `AI request failed (${res.status})`);
  return data;
}

async function geminiChat(baseUrl: string, apiKey: string, modelId: string, messages: any[], opts: any) {
  const { system, items } = normalizeMessages(messages);
  const contents = items.map(i => ({ role: i.role, parts: i.parts.map((p: any) => p.image ? { inline_data: { mime_type: p.image.mime, data: p.image.data } } : { text: p.text }) }));
  const body: any = {
    contents,
    generationConfig: { temperature: opts.temperature ?? 0.2, ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}), ...(opts.json ? { responseMimeType: "application/json" } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
  const res = await requestWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body) }, Number(opts.timeout || 45000));
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `Gemini request failed (${res.status})`);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p: any) => String(p?.text || "")).join("\n");
  return asOpenAIResponse(content, data?.usageMetadata ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount, total_tokens: data.usageMetadata.totalTokenCount } : undefined);
}

async function anthropicChat(baseUrl: string, apiKey: string, modelId: string, messages: any[], opts: any) {
  const { system, items } = normalizeMessages(messages);
  const mapped = items.map(i => ({
    role: i.role === "model" ? "assistant" : "user",
    content: i.parts.map((p: any) => p.image
      ? { type: "image", source: { type: "base64", media_type: p.image.mime, data: p.image.data } }
      : { type: "text", text: p.text }),
  }));
  const body: any = { model: modelId, messages: mapped, max_tokens: opts.maxTokens || 4096, temperature: opts.temperature ?? 0.2 };
  if (system) body.system = system;
  const res = await requestWithTimeout(`${baseUrl}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  }, Number(opts.timeout || 45000));
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `Anthropic request failed (${res.status})`);
  const content = (data?.content || []).map((b: any) => String(b?.text || "")).join("\n");
  return asOpenAIResponse(content, data?.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : undefined);
}

async function chatCompletionRaw(modelId: string, messages: any[], opts: any = {}) {
  const provider = await getProvider();
  if (!provider.id) throw new Error("Belum ada provider AI. Tambahkan provider di Settings.");
  if (!modelId) throw new Error("AI model belum dipilih. Pilih model di Settings.");
  const baseUrl = cleanBaseUrl(provider.baseUrl);
  const apiKey = String(provider.apiKey);
  if (!baseUrl) throw new Error("Provider belum dikonfigurasi (Base URL kosong).");
  if (provider.type === "google_gemini") return geminiChat(baseUrl, apiKey, modelId, messages, opts);
  if (provider.type === "anthropic") return anthropicChat(baseUrl, apiKey, modelId, messages, opts);
  return openAICompatibleChat(baseUrl, apiKey, modelId, messages, opts);
}

export async function listModelsForProvider(id?: string | null) {
  const provider = await getProvider(id);
  if (!provider.id) return { models: [], lastUpdated: null, fromCache: true, noProvider: true };
  const presetModels = presetFor(provider.type)?.models || [];
  const baseUrl = cleanBaseUrl(provider.baseUrl);
  const cacheKey = `aiModels:${provider.id}`;
  if (!baseUrl) {
    try {
      const cached = JSON.parse(String(await getSetting(cacheKey) || "[]"));
      if (Array.isArray(cached) && cached.length) return { models: cached, lastUpdated: null, fromCache: true, preset: true };
    } catch {}
    return { models: presetModels, lastUpdated: null, fromCache: true, preset: true };
  }
  const headers = provider.type === "google_gemini"
    ? { "x-goog-api-key": provider.apiKey }
    : authHeaders(provider.apiKey);
  const url = `${baseUrl}/models`;
  try {
    const res = await requestWithTimeout(url, { method: "GET", headers }, 20000);
    const text = await res.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new Error(data?.error?.message || data?.message || `Failed to fetch models (${res.status})`);
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    let models = list.map((m: any) => String(m?.id || m?.name || "")).filter(Boolean) as string[];
    if (provider.type === "google_gemini") models = models.map((m: string) => m.replace(/^models\//, ""));
    const uniq = Array.from(new Set([...models, ...presetModels])).sort((a, b) => a.localeCompare(b));
    await setSetting(cacheKey, JSON.stringify(uniq));
    await setSetting("aiAvailableModels", JSON.stringify(uniq));
    await setSetting("aiModelsLastUpdated", new Date().toISOString());
    await setSetting("aiGatewayLastStatus", "connected");
    await setSetting("aiGatewayLastError", "");
    return { models: uniq, lastUpdated: new Date().toISOString(), fromCache: false };
  } catch (e: any) {
    let cached: string[] = [];
    try { cached = JSON.parse(String(await getSetting(cacheKey) || "[]")); } catch { cached = []; }
    // Non-builtin providers must never inherit the gateway's shared model list.
    const models = Array.from(new Set([...presetModels, ...cached])).sort((a, b) => a.localeCompare(b));
    if (models.length) await setSetting(cacheKey, JSON.stringify(models));
    return { models, lastUpdated: await getSetting("aiModelsLastUpdated"), fromCache: true, preset: presetModels.length > 0, error: e?.message || "Failed to fetch models" };
  }
}

export async function listModelsForActiveProvider() {
  return listModelsForProvider();
}

/**
 * Discover which models actually accept images by probing them with a local image containing
 * the word "AnimeXid". Results are cached for 24h. No model ID is hardcoded.
 */
export async function getCaptionRetryModels(): Promise<string[]> {
  const active = String((await getActiveModelId()) || "").trim();
  const cooledAt = await getSetting("aiVisionProbeUnsupportedAt");
  if (cooledAt && Date.now() - new Date(cooledAt).getTime() < 3600 * 1000) return [active].filter(Boolean);
  const cachedAt = await getSetting("aiVisionProbeAt");
  const cachedRaw = await getSetting("aiVisionProbeCache");
  if (cachedAt && cachedRaw && Date.now() - new Date(cachedAt).getTime() < 24 * 3600 * 1000) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (Array.isArray(cached) && cached.length) return [active, ...cached.filter((m: string) => m !== active)].filter(Boolean).slice(0, 4);
    } catch {}
  }

  let models: string[] = [];
  try { models = (await listModelsForActiveProvider()).models; } catch {}
  if (!models.length) {
    try { models = JSON.parse(String(await getSetting("aiAvailableModels") || "[]")); } catch { models = []; }
  }
  const visionLike = /nemotron|gemini|gpt-4o|claude|glm-5v|qwen.*vl|flash|vl|vision|omni/i;
  const score = (m: string) => (visionLike.test(m) ? 3 : 0) + (/flash/i.test(m) ? 1 : 0) + (/free/i.test(m) ? 1 : 0) - (/^combo\d*$/i.test(m) ? 2 : 0);
  const candidates = models.filter(m => m && m !== active).sort((a, b) => score(b) - score(a)).slice(0, 18);

  let b64 = "";
  try { b64 = (await fs.readFile(path.join(STORAGE_ROOT, "brand", "animexid-wm.png"))).toString("base64"); } catch {}
  if (!b64) return [active].filter(Boolean);

  const probeMsg = [{ role: "user", content: [
    { type: "text", text: "What word is written in this image? Reply with only that word." },
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "low" } },
  ] }];
  const working: string[] = [];
  for (const m of candidates) {
    try {
      const r: any = await chatCompletionRaw(m, probeMsg as any, { temperature: 0, maxTokens: 32, timeout: 20000 });
      const c = r?.choices?.[0]?.message?.content;
      const text = typeof c === "string" ? c : (Array.isArray(c) ? c.map((x: any) => x?.text || "").join("") : "");
      if (/animexid/i.test(text)) {
        working.push(m);
        if (working.length >= 3) break;
      }
    } catch { /* skip model */ }
  }
  if (!working.length) {
    await setSetting("aiVisionProbeUnsupportedAt", new Date().toISOString());
    return [active].filter(Boolean);
  }
  await setSetting("aiVisionProbeCache", JSON.stringify(working));
  await setSetting("aiVisionProbeAt", new Date().toISOString());
  return [active, ...working.filter(m => m !== active)].filter(Boolean).slice(0, 4);
}

/** Probe a small set of models and persist the first one that returns usable text. */
export async function autoDetectActiveModel() {
  const provider = await getProvider();
  let models: string[] = [];
  try { models = (await listModelsForActiveProvider()).models; } catch {}
  if (!models.length) {
    try { models = JSON.parse(String(await getSetting("aiAvailableModels") || "[]")); } catch { models = []; }
  }
  const score = (m: string) => {
    let s = 0;
    if (/nemotron|gemini|gpt-4o|claude|glm-5v|qwen.*vl|flash|vl|vision|omni/i.test(m)) s += 3;
    if (/flash/i.test(m)) s += 1;
    if (/free/i.test(m)) s += 1;
    if (/^combo\d*$/i.test(m)) s -= 2;
    return s;
  };
  const candidates = models.filter(Boolean).sort((a, b) => score(b) - score(a)).slice(0, 8);
  if (!candidates.length) throw new Error("Tidak ada model untuk diuji. Muat ulang daftar model terlebih dahulu.");
  const tried: Array<{ model: string; error?: string }> = [];
  for (const model of candidates) {
    try {
      const r: any = await chatCompletionRaw(model, [{ role: "user", content: "Reply with exactly: OK" }], { temperature: 0, maxTokens: 64, timeout: 30000 });
      const c = r?.choices?.[0]?.message?.content;
      const text = typeof c === "string" ? c : (Array.isArray(c) ? c.map((x: any) => x?.text || "").join("") : "");
      if (text.trim()) {
        await setSetting("aiSelectedModel", model);
        await setSetting("aiAutoDetectedAt", new Date().toISOString());
        return { ok: true, model, provider: provider.name, tried };
      }
      tried.push({ model, error: "empty response" });
    } catch (e: any) {
      tried.push({ model, error: String(e?.message || e).slice(0, 160) });
    }
  }
  throw new Error(`Tidak ada model yang merespons. Detail: ${JSON.stringify(tried.slice(0, 4))}`);
}

// Keep compatible signatures used by existing features
export async function resolveTaskConfig(task: TaskKey | string) {
  const provider = await getProvider();
  const modelId = await getActiveModelId();
  return {
    legacy: false,
    provider: {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      encryptedApiKey: provider.apiKey || null,
      configJson: JSON.stringify({ timeout: 45000 }),
    },
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
  if (!baseUrl) throw new Error("AI gateway (AI_BASE_URL) is not configured on server");
  // STT may use a dedicated model (AI_STT_MODEL); otherwise fall back to the active chat model
  const preferred = String(process.env.AI_STT_MODEL || (await getActiveModelId()) || "").trim();
  if (!preferred) throw new Error("AI model belum dipilih. Buka Settings dan pilih model AI.");

  async function transcribeOnce(modelId: string) {
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
      const msg = data?.error?.message || data?.message || `Transcription failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  const start = Date.now();
  // Candidate ASR models from the cached gateway model list (auto-detect "model bebas" support)
  const candidates = [preferred];
  try {
    const cached = await getSetting("aiAvailableModels");
    const models: string[] = cached ? JSON.parse(cached) : [];
    const asrModels = models.filter(m => /voxtral|parakeet|whisper|asr|gpt-audio|omni/i.test(m));
    if (asrModels.length) {
      // If preferred already looks like an ASR model, keep it first; otherwise append ASR candidates
      const isAsr = /voxtral|parakeet|whisper|asr|gpt-audio|omni/i.test(preferred);
      if (!isAsr) candidates.push(...asrModels);
    }
  } catch {}
  // Previously-working auto-detected model wins (cache)
  const cachedStt = await getSetting("aiSttWorkingModel").catch(() => null);
  if (cachedStt && !candidates.includes(cachedStt)) candidates.unshift(cachedStt);

  let lastErr: any = null;
  // If a previous attempt showed the gateway has no STT-capable provider, skip fast instead of retrying every model
  const sttUnsupportedSince = await getSetting("aiSttUnsupportedAt").catch(() => null);
  if (sttUnsupportedSince) {
    const age = Date.now() - Date.parse(sttUnsupportedSince);
    if (Number.isFinite(age) && age < 24 * 60 * 60 * 1000) {
      throw new Error("Gateway 9Router tidak mendukung speech-to-text saat ini (semua kandidat model ASR ditolak provider). Fitur berjalan tanpa transkrip; set AI_STT_MODEL di .env bila gateway Anda menambah model ASR.");
    }
  }
  for (const modelId of candidates.slice(0, 4)) {
    try {
      const data = await transcribeOnce(modelId);
      await setSetting("aiSttWorkingModel", modelId).catch(() => {});
      await logUsage({ providerId: null, model: modelId, task, success: true, status: "success", durationMs: Date.now() - start });
      return data;
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message || "Transcription failed";
      await logUsage({ providerId: null, model: modelId, task, success: false, status: statusFromError(msg), errorMessage: msg.slice(0, 300), durationMs: Date.now() - start });
      // If auth/network/gateway-level failure, don't brute force other models with the same problem
      if (statusFromError(msg) === "gateway_unavailable" || statusFromError(msg) === "auth_failed") break;
    }
  }
  const status = statusFromError(lastErr?.message || "");
  if (status === "unsupported" && !cachedStt) {
    await setSetting("aiSttUnsupportedAt", new Date().toISOString()).catch(() => {});
    throw new Error("Model aktif tidak mendukung speech-to-text/transkripsi audio melalui gateway ini. Set AI_STT_MODEL di .env ke model ASR (mis. voxtral/whisper) yang tersedia di gateway, atau pilih model yang mendukung audio.");
  }
  if (status === "unsupported") throw new Error("Model STT yang tersimpan tidak lagi didukung gateway; reset otomatis. Coba lagi nanti.");
  throw lastErr || new Error("Transcription failed");
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

