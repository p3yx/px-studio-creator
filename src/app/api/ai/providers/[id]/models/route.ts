import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listModelsForProvider } from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const result = await listModelsForProvider(decodeURIComponent(id));
    return Response.json({ ok: true, ...result });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Failed", models: [] }, { status: 500 });
  }
}
