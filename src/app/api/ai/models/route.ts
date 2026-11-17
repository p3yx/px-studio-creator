import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listModelsForActiveProvider } from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await listModelsForActiveProvider();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to load models", models: [] }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
