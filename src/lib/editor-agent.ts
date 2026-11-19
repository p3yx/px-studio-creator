import { prisma } from "./db";
import { runTaskChat } from "./ai-providers";
import { EditorTimeline, EditorClip, EDITOR_TOOLS } from "./editor";
import { safeJsonParse } from "./utils";

export type AgentOp = { tool: string; args?: Record<string, any> };

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a)); }

export function applyEditorOps(timeline: EditorTimeline, ops: AgentOp[]) {
  const out: EditorTimeline = JSON.parse(JSON.stringify(timeline));
  const notes: string[] = [];
  const allClips = () => out.tracks.flatMap(tr => tr.clips);
  const find = (idOrIndex: any) => {
    const clips = allClips();
    const byIndex = Number(idOrIndex);
    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= clips.length) return clips[byIndex - 1];
    return clips.find(c => c.id === String(idOrIndex)) || clips.find(c => c.name === String(idOrIndex));
  };
  for (const op of ops) {
    const a = op.args || {};
    const c = find(a.clipId ?? a.clip ?? a.index);
    switch (op.tool) {
      case "split": {
        if (!c) break;
        const t = clamp(Number(a.time ?? 0), c.sourceIn + 0.1, c.sourceOut - 0.1);
        const at = clamp(Number(a.at ?? t), c.start + 0.1, c.start + c.duration - 0.1);
        const left = { ...c, sourceOut: t, duration: at - c.start };
        const right = { ...c, id: `c-${Math.random().toString(36).slice(2, 9)}`, sourceIn: t, start: at, duration: c.start + c.duration - at };
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.flatMap(x => x.id === c.id ? [left, right] : [x]) }));
        notes.push(`Split "${c.name}" di ${at.toFixed(2)}s`);
        break;
      }
      case "setSpeed": {
        if (!c) break;
        const speed = clamp(Number(a.speed || 1), 0.25, 4);
        const dur = (c.sourceOut - c.sourceIn) / speed;
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.map(x => x.id === c.id ? { ...x, speed, duration: dur } : x) }));
        notes.push(`Speed "${c.name}" = ${speed}x`);
        break;
      }
      case "setEffect": {
        if (!c) break;
        const allowed = ["none", "blur", "vignette", "grain", "shake", "zoom"];
        const effect = allowed.includes(String(a.effect)) ? String(a.effect) : "none";
        const intensity = clamp(Number(a.intensity ?? 30), 0, 100);
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.map(x => x.id === c.id ? { ...x, effect, effectIntensity: intensity } : x) }));
        notes.push(`Efek ${effect} pada "${c.name}"`);
        break;
      }
      case "addText": {
        const text = String(a.text || "").slice(0, 200);
        if (!text) break;
        const start = clamp(Number(a.start ?? 0), 0, Math.max(0, out.tracks.flatMap(t => t.clips).reduce((m, x) => Math.max(m, x.start + x.duration), 0) - 1));
        const duration = clamp(Number(a.duration || 3), 0.2, 30);
        const track = out.tracks.find(t => t.type === "video")!;
        const clip: EditorClip = {
          id: `c-${Math.random().toString(36).slice(2, 9)}`, name: "Teks", path: "",
          sourceIn: 0, sourceOut: duration, start, duration, trackId: track.id, kind: "text",
          text, fontSize: clamp(Number(a.fontSize || 48), 12, 160),
          color: String(a.color || "#FFFFFF").slice(0, 24),
          x: clamp(Number(a.x ?? 50), 0, 100), y: clamp(Number(a.y ?? 70), 0, 100),
        };
        out.tracks = out.tracks.map(t => t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t);
        notes.push(`Teks "${text}" ditambahkan`);
        break;
      }
      case "move": {
        if (!c) break;
        const start = clamp(Number(a.start ?? 0), 0, 7200);
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.map(x => x.id === c.id ? { ...x, start } : x) }));
        notes.push(`"${c.name}" dipindah ke ${start.toFixed(2)}s`);
        break;
      }
      case "trim": {
        if (!c) break;
        const start = a.start != null ? clamp(Number(a.start), 0, c.start + c.duration - 0.2) : c.start;
        const end = a.end != null ? clamp(Number(a.end), start + 0.2, c.start + c.duration) : c.start + c.duration;
        const patch = { start, duration: end - start, sourceIn: c.sourceIn + (start - c.start), sourceOut: c.sourceIn + (end - c.start) };
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.map(x => x.id === c.id ? { ...x, ...patch } : x) }));
        notes.push(`Trim "${c.name}"`);
        break;
      }
      case "delete": {
        if (!c) break;
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.filter(x => x.id !== c.id) }));
        notes.push(`Hapus "${c.name}"`);
        break;
      }
      case "addKeyframe": {
        if (!c) break;
        const props = ["volume", "opacity"];
        const property = props.includes(String(a.property)) ? String(a.property) : "volume";
        const kf = {
          id: `k-${Math.random().toString(36).slice(2, 9)}`,
          time: clamp(Number(a.time ?? 0), 0, c.duration),
          property, value: Number(a.value ?? 1),
          interpolation: ["linear","easeIn","easeOut","easeInOut"].includes(String(a.interpolation)) ? String(a.interpolation) : "linear",
        } as any;
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.map(x => x.id === c.id ? { ...x, keyframes: [...(x.keyframes || []), kf].sort((p, q) => p.time - q.time) } : x) }));
        notes.push(`Keyframe ${property} ditambahkan`);
        break;
      }
      case "duplicate": {
        if (!c) break;
        const copy = { ...c, id: `c-${Math.random().toString(36).slice(2, 9)}`, name: `${c.name} (copy)`, start: c.start + c.duration };
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.flatMap(x => x.id === c.id ? [x, copy] : [x]) }));
        notes.push(`Duplikat "${c.name}"`);
        break;
      }
      case "rippleDelete": {
        if (!c) break;
        const dur = c.duration;
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.filter(x => x.id !== c.id).map(x => x.start > c.start ? { ...x, start: Math.max(0, x.start - dur) } : x) }));
        notes.push(`Ripple delete "${c.name}"`);
        break;
      }
      case "setTransition": {
        if (!c) break;
        const transition = String(a.transition || "none") === "fade" ? "fade" : "none";
        const duration = clamp(Number(a.duration || 0.5), 0, 5);
        out.tracks = out.tracks.map(tr => ({ ...tr, clips: tr.clips.map(x => x.id === c.id ? { ...x, transitionIn: transition as any, transitionDuration: duration } : x) }));
        notes.push(`Transisi ${transition} pada "${c.name}"`);
        break;
      }
      case "setTrack": {
        const key = String(a.property || "");
        if (!["locked", "hidden", "muted"].includes(key)) break;
        const t = out.tracks.find(tr => tr.id === (a.trackId || find(a.track)?.trackId));
        if (t) { (t as any)[key] = !!a.value; notes.push(`Track ${t.name}: ${key}=${!!a.value}`); }
        break;
      }
      default:
        notes.push(`Tool tidak dikenal: ${op.tool}`);
    }
  }
  return { timeline: out, notes };
}

export function parseNaturalCommand(command: string, timeline: EditorTimeline): AgentOp[] {
  const p = command.toLowerCase();
  const clips = timeline.tracks.flatMap(t => t.clips);
  const idx = (p.match(/clip\s*(\d+)/) || [])[1];
  const clipId = idx ? Number(idx) : undefined;
  const secs = (p.match(/(?:detik|di)\s*(\d+(?:\.\d+)?)/) || [])[1];
  const ops: AgentOp[] = [];
  if (/potong|split/.test(p)) ops.push({ tool: "split", args: { clipId, time: secs ? Number(secs) : 0, at: secs ? Number(secs) : 0 } });
  else if (/kecepatan|speed|percepat|lambat/.test(p)) {
    const m = p.match(/(\d+(?:\.\d+)?)\s*(?:x|kali)/);
    ops.push({ tool: "setSpeed", args: { clipId, speed: m ? Number(m[1]) : 2 } });
  } else if (/teks|tulis|caption/.test(p)) {
    const text = (command.match(/(?:teks|tulis)\s*["']?(.+?)["']?\s*$/i) || [])[1] || command.slice(0, 60);
    ops.push({ tool: "addText", args: { text, start: secs ? Number(secs) : 0, duration: 3 } });
  } else if (/blur|vignette|grain|shake|zoom/.test(p)) {
    const effect = (p.match(/blur|vignette|grain|shake|zoom/) || ["none"])[0];
    ops.push({ tool: "setEffect", args: { clipId, effect, intensity: 40 } });
  } else if (/duplikat|duplicate/.test(p)) ops.push({ tool: "duplicate", args: { clipId } });
  else if (/ripple/.test(p)) ops.push({ tool: "rippleDelete", args: { clipId } });
  else if (/transisi|transition|fade/.test(p)) ops.push({ tool: "setTransition", args: { clipId, transition: "fade", duration: secs ? Number(secs) : 0.5 } });
  else if (/hapus|delete/.test(p)) ops.push({ tool: "delete", args: { clipId } });
  else if (/pindah|move/.test(p)) ops.push({ tool: "move", args: { clipId, start: secs ? Number(secs) : 0 } });
  else if (/trim/.test(p)) ops.push({ tool: "trim", args: { clipId, end: secs ? Number(secs) : undefined } });
  return ops.slice(0, 4);
}

export async function runEditorAgent(command: string, timeline: EditorTimeline) {
  let ops: AgentOp[] = [];
  let source = "deterministik";
  try {
    const summary = timeline.tracks.map((t, ti) => `track ${ti + 1} ${t.type}: ` + t.clips.map((c, i) => `#${i + 1} id=${c.id} "${c.name}" start=${c.start} dur=${c.duration}`).join("; ")).join("\n");
    const resp: any = await runTaskChat("editing_plan", [
      { role: "system", content: `You are a video editing agent. Return ONLY JSON: {"operations":[{"tool":"split|setSpeed|setEffect|addText|move|trim|delete|addKeyframe","args":{...}}]}. Valid tools: ${EDITOR_TOOLS.join(",")}. No shell, no file paths.` },
      { role: "user", content: `Timeline:\n${summary}\nUser command: ${command}` },
    ], { temperature: 0.2, json: true, timeout: 60000 });
    const c = resp?.choices?.[0]?.message?.content;
    const parsed = typeof c === "string" ? safeJsonParse<any>(c, {}) : c;
    if (Array.isArray(parsed?.operations)) {
      ops = parsed.operations.filter((o: any) => EDITOR_TOOLS.includes(String(o?.tool))).map((o: any) => ({ tool: String(o.tool), args: o.args || {} })).slice(0, 8);
      source = "AI";
    }
  } catch {}
  if (!ops.length) ops = parseNaturalCommand(command, timeline);
  if (!ops.length) throw new Error("Perintah tidak dikenali. Contoh: 'potong di detik 5', 'terapkan blur pada clip 1', 'tambah teks halo', 'speed 2x'.");
  const result = applyEditorOps(timeline, ops);
  return { ...result, ops, source };
}
