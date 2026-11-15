import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { testAIConnection } from "@/lib/ai-providers";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const model = body?.model ? String(body.model) : undefined;
    const result = await testAIConnection(model);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, status: "error", error: e?.message || "Connection test failed" }, { status: 500 });
  }
}
