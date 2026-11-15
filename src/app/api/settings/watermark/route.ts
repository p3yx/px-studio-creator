import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { defaultBrandKit, normalizeBrandKit } from "@/lib/brand";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "File watermark wajib diunggah" }, { status: 400 });
    const ext = (path.extname(file.name || "").toLowerCase() || ".png").replace(/[^a-z0-9.]/g, "") || ".png";
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
    if (!allowed.includes(ext)) return NextResponse.json({ error: "Format watermark tidak didukung. Gunakan PNG/JPG/WEBP/SVG." }, { status: 400 });

    const dir = path.join(STORAGE_ROOT, "brand");
    await fs.mkdir(dir, { recursive: true });
    const name = `watermark-${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`;
    const abs = path.join(dir, name);
    await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()));

    // update brandKit.watermarkPath
    const row = await prisma.setting.findUnique({ where: { key: "brandKit" } }).catch(() => null);
    let brand = { ...defaultBrandKit };
    try { if (row?.value) brand = normalizeBrandKit(JSON.parse(row.value)); } catch {}
    brand.watermarkPath = abs;
    brand.watermarkEnabled = true;
    const value = JSON.stringify(brand);
    await prisma.setting.upsert({ where: { key: "brandKit" }, update: { value }, create: { key: "brandKit", value } });

    return NextResponse.json({ ok: true, path: abs, brandKit: brand });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal upload watermark" }, { status: 500 });
  }
}
