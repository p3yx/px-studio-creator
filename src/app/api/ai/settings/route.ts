import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAISettings, saveAISettings, autoDetectActiveModel, setActiveProvider, getCapabilityModels, saveCapabilityModels } from "@/lib/ai-providers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const settings = await getAISettings();
    return NextResponse.json({ ok: true, ...settings, capabilityModels: await getCapabilityModels() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to load AI settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    if (body.provider) await setActiveProvider(String(body.provider));
    if (body.capabilityModels) await saveCapabilityModels(body.capabilityModels);
    if (body.auto) {
      const detected = await autoDetectActiveModel();
      const settings = await getAISettings();
      return NextResponse.json({ ok: true, ...detected, ...settings });
    }
    const result = body.model ? await saveAISettings({ model: body.model }) : { ok: true, activeModel: (await getAISettings()).activeModel };
    const settings = await getAISettings();
    return NextResponse.json({ ok: true, ...result, ...settings, capabilityModels: await getCapabilityModels() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to save AI settings" }, { status: 400 });
  }
}
