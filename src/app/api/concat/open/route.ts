import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { concatRoot } from "@/lib/concat-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const p = path.resolve(String(body.path || ""));
    const root = path.resolve(concatRoot());
    if (!p.startsWith(root + path.sep)) return NextResponse.json({ ok: false, error: "Path di luar workspace Concat" }, { status: 400 });
    const exe = process.env.CONCAT_EXE || "C:/Users/Peyx/concat-app/PFiles64/Concat/concat.exe";
    spawn(exe, ["--project", p], { cwd: path.dirname(exe), windowsHide: true, detached: true, stdio: "ignore" }).unref();
    return NextResponse.json({ ok: true, opened: p });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuka Concat" }, { status: 500 });
  }
}
