import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { STORAGE_ROOT } from "@/lib/storage";

function contentType(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".vtt") return "text/vtt";
  if (ext === ".srt") return "application/x-subrip";
  return "application/octet-stream";
}

export async function GET(req: NextRequest) {
  try {
    const rel = req.nextUrl.searchParams.get("path") || "";
    const abs = path.resolve(STORAGE_ROOT, rel);
    if (!abs.startsWith(path.resolve(STORAGE_ROOT))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const data = await fs.readFile(abs);
    return new NextResponse(data, { headers: { "Content-Type": contentType(abs), "Content-Length": String(data.length), "Cache-Control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}