import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { concatCallTool, concatRoot } from "@/lib/concat-mcp";
import { STORAGE_ROOT } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "concat_version", "project_list", "project_create", "project_open", "project_save", "project_close",
  "timeline_read", "project_get", "project_set_video", "media_probe", "media_import",
  "edit_apply", "edit_undo", "edit_redo", "clip_add", "clips_add_sequence", "clip_trim",
  "clips_split", "clips_move", "clips_remove", "clip_update", "clip_transform", "clip_speed",
  "title_add", "captions_add", "keyframe_set", "keyframe_clear", "effect_layer_add", "effect_key_set",
  "track_add", "effects_list", "template_list", "template_instantiate",
  "export_start", "export_status", "export_wait", "export_cancel", "preview_frame",
]);

function safePath(p: any) {
  const s = String(p || "");
  if (!s) return s;
  const abs = path.resolve(s);
  const roots = [path.resolve(STORAGE_ROOT), path.resolve(concatRoot()), path.resolve("C:/Users/Peyx/AppData/Local/Temp/opencode")];
  if (!roots.some(r => abs === r || abs.startsWith(r + path.sep))) throw new Error("Path di luar workspace PX Studio tidak diizinkan.");
  return abs;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.tool || "");
    if (!ALLOWED.has(name)) return NextResponse.json({ ok: false, error: `Tool tidak diizinkan: ${name}` }, { status: 400 });
    const args: any = { ...(body.args || {}) };
    for (const k of ["path", "file", "output", "location"]) if (args[k]) args[k] = safePath(args[k]);
    const result = await concatCallTool(name, args);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Concat call gagal" }, { status: 500 });
  }
}
