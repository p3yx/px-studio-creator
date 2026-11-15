import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";
import { STORAGE_ROOT } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { Readable } from "stream";

function contentType(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".gif") return "image/gif";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".vtt") return "text/vtt; charset=utf-8";
  if (ext === ".srt") return "application/x-subrip; charset=utf-8";
  if (ext === ".txt" || ext === ".log") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rel = req.nextUrl.searchParams.get("path") || "";
    if (!rel) return NextResponse.json({ error: "Missing path" }, { status: 400 });
    const root = path.resolve(STORAGE_ROOT);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const st = await fs.stat(abs).catch(() => null);
    if (!st || !st.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const size = st.size;
    const type = contentType(abs);
    const range = req.headers.get("range");
    const common = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    } as Record<string, string>;

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : size - 1;
        if (isNaN(start)) start = 0;
        if (isNaN(end) || end >= size) end = size - 1;
        if (start > end || start >= size) {
          return new NextResponse(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${size}` } });
        }
        const chunkSize = end - start + 1;
        const stream = createReadStream(abs, { start, end });
        return new NextResponse(Readable.toWeb(stream) as any, {
          status: 206,
          headers: {
            ...common,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(chunkSize),
          },
        });
      }
    }

    // small files: read into memory; large: stream
    if (size <= 8 * 1024 * 1024) {
      const data = await fs.readFile(abs);
      return new NextResponse(data, { headers: { ...common, "Content-Length": String(size) } });
    }
    const stream = createReadStream(abs);
    return new NextResponse(Readable.toWeb(stream) as any, { headers: { ...common, "Content-Length": String(size) } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}