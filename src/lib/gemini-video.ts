import fs from "fs/promises";
import { getProvider, getModelForCapability } from "./ai-providers";

function cleanBase(url: string) {
  return String(url || "").replace(/\/+$/, "");
}

async function api(pathname: string, init: RequestInit = {}, timeoutMs = 120000) {
  const provider = await getProvider();
  if (!provider.id || provider.type !== "google_gemini") throw new Error("Provider aktif bukan Gemini native.");
  if (!provider.apiKey) throw new Error("API key Gemini belum diisi.");
  const base = cleanBase(provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/${pathname.replace(/^\//, "")}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": provider.apiKey, ...(init.headers || {}) },
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `Gemini API error (${res.status})`;
      throw new Error(msg);
    }
    return data;
  } finally {
    if (t) clearTimeout(t);
  }
}

async function pickVideoModel() {
  const model = await getModelForCapability("video");
  if (!model) throw new Error("Model video Gemini belum dipilih.");
  return model;
}

async function fileToBase64(p: string) {
  const buf = await fs.readFile(p);
  return buf.toString("base64");
}

function mimeFor(p: string) {
  const ext = p.toLowerCase().split(".").pop() || "";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "png") return "image/png";
  return "video/mp4";
}

export async function geminiVideoAvailable() {
  try {
    const provider = await getProvider();
    return !!provider.id && provider.type === "google_gemini" && !!provider.apiKey;
  } catch { return false; }
}

export async function startGeminiVideo(input: {
  prompt: string;
  images?: string[];
  video?: string | null;
  aspect?: string;
  durationSeconds?: number;
}) {
  const model = await pickVideoModel();
  // Gemini video accepts only 16:9 or 9:16. Map 1:1 to 16:9 instead of failing.
  const aspect = input.aspect === "1:1" ? "16:9" : (input.aspect || "16:9");
  const content: any[] = [];
  for (const img of (input.images || []).slice(0, 3)) {
    content.push({ type: "image", data: await fileToBase64(img), mime_type: mimeFor(img) });
  }
  if (input.video) content.push({ type: "video", data: await fileToBase64(input.video), mime_type: mimeFor(input.video) });
  content.push({ type: "text", text: input.prompt });

  const payload = {
    model,
    input: content.length === 1 ? input.prompt : content,
    background: true,
    response_format: {
      type: "video",
      aspect_ratio: aspect,
      duration: `${Math.max(5, Math.min(10, Number(input.durationSeconds || 10)))}s`,
      resolution: "720p",
    },
  };
  const r: any = await api("interactions", { method: "POST", body: JSON.stringify(payload) });
  return { interactionId: String(r?.id || ""), status: String(r?.status || "processing"), model, raw: r };
}

export async function pollGeminiVideo(interactionId: string) {
  const r: any = await api(`interactions/${encodeURIComponent(interactionId)}`, { method: "GET" }, 60000);
  const status = String(r?.status || "processing");
  let video: { kind: "base64" | "uri"; data?: string; uri?: string; mimeType?: string } | null = null;
  if (r?.output_video?.data) video = { kind: "base64", data: r.output_video.data, mimeType: r.output_video.mime_type || "video/mp4" };
  else if (r?.output_video?.uri) video = { kind: "uri", uri: r.output_video.uri, mimeType: r.output_video.mime_type || "video/mp4" };
  else {
    const steps = [...(r?.steps || []), ...(r?.outputs || [])].reverse();
    for (const step of steps) {
      for (const c of (step?.content || step?.contents || [])) {
        if (c?.type === "video" && (c.data || c.uri)) {
          video = c.data ? { kind: "base64", data: c.data, mimeType: c.mime_type || "video/mp4" } : { kind: "uri", uri: c.uri, mimeType: c.mime_type || "video/mp4" };
          break;
        }
      }
      if (video) break;
    }
  }
  return { status, video, raw: r };
}

export async function saveGeminiVideo(video: { kind: "base64" | "uri"; data?: string; uri?: string }, outPath: string) {
  if (video.kind === "base64" && video.data) {
    await fs.writeFile(outPath, Buffer.from(video.data, "base64"));
    return outPath;
  }
  if (video.kind === "uri" && video.uri) {
    const provider = await getProvider();
    const res = await fetch(video.uri, { headers: { "x-goog-api-key": provider.apiKey } });
    if (!res.ok) throw new Error(`Gagal mengunduh video Gemini (${res.status})`);
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return outPath;
  }
  throw new Error("Hasil video Gemini tidak ditemukan.");
}
