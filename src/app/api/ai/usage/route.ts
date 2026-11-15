import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUsageStats } from "@/lib/ai-providers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const logs = await getUsageStats();
    return NextResponse.json({ logs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
