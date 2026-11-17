import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { testProviderConnection } from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const result = await testProviderConnection(decodeURIComponent(id), body.model);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Test failed" }, { status: 500 });
  }
}
