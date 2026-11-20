import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { STORAGE_ROOT } from "./storage";

const EXE = process.env.CONCAT_EXE || "C:/Users/Peyx/concat-app/PFiles64/Concat/concat.exe";
const ROOT = process.env.CONCAT_ROOT || path.join(STORAGE_ROOT, "concat-work");

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: any };

let child: any = null;
let buf = "";
let nextId = 1;
const pending = new Map<number, Pending>();
let initPromise: Promise<void> | null = null;

function send(method: string, params: any = {}, id?: number) {
  if (!child || child.killed) throw new Error("Concat MCP tidak aktif.");
  const msg: any = { jsonrpc: "2.0", method, params };
  if (id != null) msg.id = id;
  child.stdin.write(JSON.stringify(msg) + "\n");
}

function request(method: string, params: any = {}, timeoutMs = 120000): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Concat MCP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send(method, params, id);
  });
}

function ensure(): Promise<void> {
  if (child && !child.killed && initPromise) return initPromise;
  initPromise = (async () => {
    await fs.mkdir(ROOT, { recursive: true });
    child = spawn(EXE, ["--mcp", "headless"], {
      cwd: path.dirname(EXE),
      env: { ...process.env, CONCAT_MCP_ROOTS: ROOT } as any,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", () => {});
    child.stdout.on("data", d => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: any; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      }
    });
    child.on("exit", () => {
      child = null; initPromise = null;
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error("Concat MCP keluar")); }
      pending.clear();
    });
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "px-studio", version: "1" } }, 20000);
    send("notifications/initialized");
  })();
  return initPromise;
}

export function concatRoot() { return ROOT; }

export async function concatCallTool(name: string, args: any = {}) {
  await ensure();
  const r: any = await request("tools/call", { name, arguments: args }, 180000);
  if (r?.isError) throw new Error(r?.content?.map((c: any) => c?.text || "").join("\n") || "Concat tool error");
  try {
    const txt = r?.content?.find((c: any) => c?.type === "text")?.text;
    return txt ? JSON.parse(txt) : r;
  } catch { return r; }
}

export async function concatTools() {
  await ensure();
  const r: any = await request("tools/list", {}, 20000);
  return (r?.tools || []).map((t: any) => ({ name: t.name, description: t.description }));
}

export function stopConcat() { if (child && !child.killed) child.kill(); child = null; initPromise = null; }
