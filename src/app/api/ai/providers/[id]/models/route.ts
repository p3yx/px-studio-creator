import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listModelsForActiveProvider, setActiveProvider } from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    if (id && id !== "builtin-9router") await setActiveProvider(decodeURIComponent(id));
    const result = await listModelsForActiveProvider();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed", models: [] }, { status: 500 });
  }
}
