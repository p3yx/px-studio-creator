import path from "path";
import fs from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

export const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR || "storage");

export function projectDir(projectId: string) {
  return path.join(STORAGE_ROOT, "projects", projectId);
}
export function sourceDir(projectId: string) {
  return path.join(projectDir(projectId), "source");
}
export function clipsDir(projectId: string) {
  return path.join(projectDir(projectId), "clips");
}
export function tempDir(projectId: string) {
  return path.join(projectDir(projectId), "temp");
}

export async function ensureProjectDirs(projectId: string) {
  await fs.mkdir(sourceDir(projectId), { recursive: true });
  await fs.mkdir(clipsDir(projectId), { recursive: true });
  await fs.mkdir(tempDir(projectId), { recursive: true });
}

export async function saveUploadedFile(projectId: string, file: File, subdir?: "source" | "temp") {
  await ensureProjectDirs(projectId);
  const ext = path.extname(file.name) || ".mp4";
  const safeBase = path.basename(file.name, ext).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "source";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2,7)}-${safeBase}${ext}`;
  const baseDir = subdir === "temp" ? tempDir(projectId) : sourceDir(projectId);
  const dest = path.join(baseDir, filename);
  const nodeStream = Readable.fromWeb(file.stream() as any);
  await pipeline(nodeStream, createWriteStream(dest));
  return { path: dest, filename, size: file.size };
}

export async function removeProjectStorage(projectId: string) {
  const dir = projectDir(projectId);
  if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true });
}

export function publicFileUrl(absPath: string | null | undefined) {
  if (!absPath) return null;
  // served via /api/files?path=... (authorized/controlled)
  const rel = path.relative(STORAGE_ROOT, absPath).replace(/\\/g, "/");
  if (rel.startsWith("..")) return null;
  return `/api/files?path=${encodeURIComponent(rel)}`;
}
