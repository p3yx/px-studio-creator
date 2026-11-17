import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { publicFileUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const items = await prisma.audioAsset.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
    return NextResponse.json({ items: items.map(i => ({ ...i, fileUrl: publicFileUrl(i.filePath) })) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
