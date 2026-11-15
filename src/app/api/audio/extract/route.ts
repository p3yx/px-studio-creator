import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT, ensureProjectDirs, projectDir } from "@/lib/storage";
import { extractAudioFile, probeVideo } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function safeName(s: string) { return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "audio"; }

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const format = (String(form.get("format") || "mp3") as "mp3"|"wav"|"aac"|"m4a");
    const start = form.get("start") ? Number(form.get("start")) : undefined;
    const end = form.get("end") ? Number(form.get("end")) : undefined;
    const name = String(form.get("name") || (file?.name?.replace(/\.[^.]+$/, "") || "extracted-audio"));
    const saveToLibrary = String(form.get("saveToLibrary") || "true") !== "false";
    if (!file) return NextResponse.json({ error: "Video/audio source file is required" }, { status: 400 });
    if (!["mp3","wav","aac","m4a"].includes(format)) return NextResponse.json({ error: "Unsupported format" }, { status: 400 });

    const tempProjectId = `audio-${user.id}`;
    await ensureProjectDirs(tempProjectId);
    const ext = path.extname(file.name) || ".mp4";
    const inputPath = path.join(projectDir(tempProjectId), "source", `${Date.now()}-${safeName(path.basename(file.name, ext))}${ext}`);
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    const outDir = path.join(STORAGE_ROOT, "audio", user.id);
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${Date.now()}-${safeName(name)}.${format}`);
    await extractAudioFile({ input: inputPath, output: outPath, format, start, end });

    let duration: number | null = null;
    try { duration = (await probeVideo(outPath)).duration || null; } catch {}
    const st = await fs.stat(outPath).catch(() => null);
    let asset: any = null;
    if (saveToLibrary) {
      asset = await prisma.audioAsset.create({ data: { userId: user.id, name, format, filePath: outPath, duration, fileSize: st?.size || null, sourceName: file.name } });
    }

    const rel = path.relative(STORAGE_ROOT, outPath).replace(/\\/g, "/");
    return NextResponse.json({ ok: true, asset, fileUrl: `/api/files?path=${encodeURIComponent(rel)}`, duration, fileSize: st?.size || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Audio extraction failed" }, { status: 500 });
  }
}
