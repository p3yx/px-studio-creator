import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const item = await prisma.audioAsset.findFirst({ where: { id, userId: user.id } });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.audioAsset.delete({ where: { id } });
    await fs.unlink(item.filePath).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const item = await prisma.audioAsset.findFirst({ where: { id, userId: user.id } });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const updated = await prisma.audioAsset.update({ where: { id }, data: { name: body.name ?? item.name } });
    return NextResponse.json({ ok: true, item: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
