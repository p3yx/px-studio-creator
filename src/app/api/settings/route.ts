import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const KEYS = ["maxUploadMb","maxConcurrentJobs","maxVideoDurationSeconds","ffmpegPath"] as const;

export async function GET() {
  const user = await getCurrentUser();
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS as any } } }).catch(() => [] as any[]);
  const map: Record<string,string> = {};
  for (const r of rows) map[r.key] = r.value;
  return NextResponse.json({
    maxUploadMb: map.maxUploadMb || process.env.MAX_UPLOAD_MB || "2048",
    maxConcurrentJobs: map.maxConcurrentJobs || process.env.MAX_CONCURRENT_JOBS || "1",
    maxVideoDurationSeconds: map.maxVideoDurationSeconds || process.env.MAX_VIDEO_DURATION_SECONDS || "7200",
    ffmpegPath: map.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg",
    role: user?.role || null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    for (const k of KEYS) {
      if (body[k] == null) continue;
      const value = String(body[k]);
      await prisma.setting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Failed" }, { status: 500 }); }
}
