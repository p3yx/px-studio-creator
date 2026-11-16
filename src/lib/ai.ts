import fs from "fs/promises";
import { runTaskChat, transcribeWithTask, resolveTaskConfig } from "./ai-providers";

export type AIConfig = {
  baseUrl: string;
  apiKey?: string;
  textModel?: string;
  visionModel?: string;
  sttModel?: string;
};

export function getAIConfigFromEnv(): AIConfig {
  return {
    baseUrl: (process.env.AI_API_BASE_URL || "http://192.168.0.157:20128/v1").replace(/\/$/, ""),
    apiKey: process.env.AI_API_KEY || undefined,
    textModel: process.env.AI_TEXT_MODEL || undefined,
    visionModel: process.env.AI_VISION_MODEL || undefined,
    sttModel: process.env.AI_STT_MODEL || undefined,
  };
}

// Backward-compatible wrappers now routed through task-based provider system
export async function chatCompletion(_cfg: AIConfig, messages: any[], options?: { model?: string; temperature?: number; json?: boolean; task?: string }) {
  const task = options?.task || "highlight_detection";
  return runTaskChat(task, messages, { model: options?.model, temperature: options?.temperature ?? 0.2, json: options?.json });
}

export async function transcribeAudio(_cfg: AIConfig, filePath: string) {
  return transcribeWithTask("speech_to_text", filePath);
}

export async function getResolvedAIConfig() {
  const text = await resolveTaskConfig("highlight_detection").catch(() => null);
  const vision = await resolveTaskConfig("vision_analysis").catch(() => null);
  const stt = await resolveTaskConfig("speech_to_text").catch(() => null);
  return { text, vision, stt };
}

