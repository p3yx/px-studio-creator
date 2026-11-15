import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listGatewayModels } from "@/lib/ai-providers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const refresh = false;
    const result = await listGatewayModels({ refresh });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    // try to return cached info on failure
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const result = await listGatewayModels({ refresh: false });
      return NextResponse.json({ ok: false, error: e?.message || "Failed to load models", ...result }, { status: 200 });
    } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Failed to load models", models: [] }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await listGatewayModels({ refresh: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed to refresh models", models: [] }, { status: 500 });
  }
}
