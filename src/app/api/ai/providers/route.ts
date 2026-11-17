import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listProviders,
  upsertProvider,
  PROVIDER_PRESETS,
  getProvider,
  setActiveProvider,
} from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: true, providers: await listProviders(), presets: PROVIDER_PRESETS, active: await getProvider() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const item = await upsertProvider(body);
    if (body.activate) await setActiveProvider(item.id);
    return NextResponse.json({ ok: true, provider: item, providers: await listProviders() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  return POST(req);
}
