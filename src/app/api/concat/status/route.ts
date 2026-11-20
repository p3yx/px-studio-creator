import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { concatRoot, concatTools } from "@/lib/concat-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tools = await concatTools();
    return NextResponse.json({ ok: true, root: concatRoot(), tools: tools.map(t => t.name) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Concat tidak tersedia" }, { status: 500 });
  }
}
