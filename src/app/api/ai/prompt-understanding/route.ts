import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

    // Deterministic local interpretation — no gateway, no model, no quota.
    const p = prompt.toLowerCase();
    let preset = "cinematic";
    if (/(amv|beat|cepat|energi|dynamic|fast)/.test(p)) preset = "amv";
    else if (/(hype|epic|intens|aksi|action|pertarungan)/.test(p)) preset = "hype";
    else if (/(emosi|emotional|sedih|lembut|slow|haru)/.test(p)) preset = "emotional";
    else if (/(story|cerita|alur|naratif)/.test(p)) preset = "story";
    else if (/(clean|minimal|simple)/.test(p)) preset = "clean";

    let aspect = "9:16";
    if (/(16:9|landscape|horizontal|youtube)/.test(p)) aspect = "16:9";
    else if (/(1:1|square|persegi)/.test(p)) aspect = "1:1";

    let audioMode = "mix";
    if (/(musik saja|music only|tanpa audio asli|mute original)/.test(p)) audioMode = "music";
    else if (/(audio asli|original audio|tanpa musik)/.test(p)) audioMode = "original";

    const notes = [
      preset === "hype" ? "Fokus pada momen intens dengan pacing cepat." : `Gaya ${preset} diterapkan pada seluruh clip.`,
      `Rasio ${aspect} digunakan untuk render.`,
      `Audio: ${audioMode}.`,
    ];
    const result = {
      preset,
      aspect,
      audioMode,
      notes,
      suggestedName: prompt.replace(/\s+/g, " ").trim().slice(0, 80),
    };
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to analyze prompt" }, { status: 500 });
  }
}
