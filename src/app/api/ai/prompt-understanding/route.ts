import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runTaskChat } from "@/lib/ai-providers";
import { safeJsonParse } from "@/lib/utils";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

    const resp = await runTaskChat("prompt_understanding", [
      { role: "system", content: "You interpret video editing prompts into structured settings. Return strict JSON only." },
      { role: "user", content: `Interpret this editing prompt and return JSON with keys: preset (cinematic|amv|hype|emotional|clean|story), aspect (16:9|9:16|1:1), audioMode (mix|music|original|mute-original), notes (string array), suggestedName (string).\nPrompt: ${prompt}` },
    ], { temperature: 0.2, json: true });
    const content = resp?.choices?.[0]?.message?.content || "{}";
    const parsed = typeof content === "string" ? safeJsonParse<any>(content, {}) : content;
    const allowedPresets = new Set(["cinematic","amv","hype","emotional","clean","story"]);
    const allowedAspect = new Set(["16:9","9:16","1:1"]);
    const allowedAudio = new Set(["mix","music","original","mute-original"]);
    const result = {
      preset: allowedPresets.has(parsed?.preset) ? parsed.preset : null,
      aspect: allowedAspect.has(parsed?.aspect) ? parsed.aspect : null,
      audioMode: allowedAudio.has(parsed?.audioMode) ? parsed.audioMode : null,
      notes: Array.isArray(parsed?.notes) ? parsed.notes.filter((x:any)=>typeof x === "string").slice(0,6) : [],
      suggestedName: typeof parsed?.suggestedName === "string" ? parsed.suggestedName.slice(0,80) : null,
    };
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to analyze prompt" }, { status: 500 });
  }
}
