import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STORAGE_ROOT, publicFileUrl } from "@/lib/storage";
import { generateGeminiImage, saveImageResult } from "@/lib/gemini-interactions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return NextResponse.json({ ok: false, error: "Prompt wajib diisi" }, { status: 400 });
    const aspect = ["1:1", "16:9", "9:16", "4:3", "3:4"].includes(String(body.aspect)) ? String(body.aspect) : "1:1";
    const size = ["1K", "2K", "4K"].includes(String(body.size)) ? String(body.size) : "1K";

    const generated = await generateGeminiImage({ prompt, aspect, size });
    const dir = path.join(STORAGE_ROOT, "ai-images", user.id);
    await fs.mkdir(dir, { recursive: true });
    const ext = (generated.image.mimeType || "image/png").includes("jpeg") ? ".jpg" : ".png";
    const filename = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`;
    const abs = path.join(dir, filename);
    await saveImageResult(generated.image, abs);
    const st = await fs.stat(abs).catch(() => null);

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: prompt.slice(0, 80),
        type: "ai-image",
        status: "COMPLETED",
        outputPath: abs,
        outputSize: st?.size || null,
        configJson: JSON.stringify({ prompt, aspect, size, model: generated.model, interactionId: generated.interactionId }),
      },
    });
    await prisma.clip.create({
      data: {
        projectId: project.id,
        title: prompt.slice(0, 80),
        description: `Gambar dibuat dengan ${generated.model} (Gemini), rasio ${aspect}, ukuran ${size}.`,
        startTime: 0, endTime: 0.1, duration: 0.1,
        outputPath: abs, status: "completed", fileSize: st?.size || null,
      },
    });

    return NextResponse.json({
      ok: true,
      url: publicFileUrl(abs),
      projectId: project.id,
      model: generated.model,
      size: st?.size || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuat gambar" }, { status: 500 });
  }
}
