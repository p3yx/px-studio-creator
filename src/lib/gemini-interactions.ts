import fs from "fs/promises";
import { getProvider, getModelForCapability } from "./ai-providers";

export async function geminiApi(pathname: string, init: RequestInit = {}, timeoutMs = 120000) {
  const provider = await getProvider();
  if (!provider.id || provider.type !== "google_gemini") throw new Error("Provider aktif bukan Gemini native.");
  if (!provider.apiKey) throw new Error("API key Gemini belum diisi.");
  const base = String(provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
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

export async function extractImageResult(interaction: any) {
  const out = interaction?.output_image;
  if (out?.data) return { kind: "base64" as const, data: out.data, mimeType: out.mime_type || "image/png" };
  if (out?.uri) return { kind: "uri" as const, uri: out.uri, mimeType: out.mime_type || "image/png" };
  const steps = [...(interaction?.steps || []), ...(interaction?.outputs || [])].reverse();
  for (const step of steps) {
    for (const c of (step?.content || step?.contents || [])) {
      if (c?.type === "image" && (c.data || c.uri)) {
        return c.data
          ? { kind: "base64" as const, data: c.data, mimeType: c.mime_type || "image/png" }
          : { kind: "uri" as const, uri: c.uri, mimeType: c.mime_type || "image/png" };
      }
    }
  }
  return null;
}

export async function saveImageResult(img: { kind: "base64" | "uri"; data?: string; uri?: string; mimeType?: string }, outPath: string) {
  if (img.kind === "base64" && img.data) {
    await fs.writeFile(outPath, Buffer.from(img.data, "base64"));
    return outPath;
  }
  if (img.kind === "uri" && img.uri) {
    const provider = await getProvider();
    const r = await fetch(img.uri, { headers: { "x-goog-api-key": provider.apiKey } });
    if (!r.ok) throw new Error(`Gagal mengunduh gambar Gemini (${r.status})`);
    await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer()));
    return outPath;
  }
  throw new Error("Hasil gambar Gemini tidak ditemukan.");
}

export async function generateGeminiImage(opts: { prompt: string; aspect?: string; size?: string }) {
  const model = await getModelForCapability("image");
  if (!model) throw new Error("Model image Gemini belum dipilih.");
  const payload = {
    model,
    input: opts.prompt,
    response_format: {
      type: "image",
      aspect_ratio: opts.aspect || "1:1",
      image_size: opts.size || "1K",
    },
  };
  const result: any = await geminiApi("interactions", { method: "POST", body: JSON.stringify(payload) }, 180000);
  const image = await extractImageResult(result);
  if (!image) throw new Error("Model tidak mengembalikan gambar.");
  return { model, image, interactionId: String(result?.id || ""), status: String(result?.status || "completed") };
}
