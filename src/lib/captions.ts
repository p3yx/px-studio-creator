function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }

export function toSrtTimestamp(seconds: number) {
  const s = Math.max(0, seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, "0")}`;
}

function splitText(text: string, maxLen = 72) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxLen && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  // wrap into 1-2 lines per cue
  const cues: string[] = [];
  for (let i = 0; i < lines.length; i += 2) cues.push(lines.slice(i, i + 2).join("\n"));
  return cues.length ? cues : [String(text || "").trim()];
}

export function transcriptToSrt(transcript: any, durationFallback = 10) {
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : Array.isArray(transcript?.words) ? null : null;
  let items: { start: number; end: number; text: string }[] = [];
  if (segments) {
    items = segments.map((s: any) => ({
      start: Number(s.start ?? s.timestamp?.[0] ?? 0) || 0,
      end: Number(s.end ?? s.timestamp?.[1] ?? (Number(s.start ?? 0) + 2)) || (Number(s.start ?? 0) + 2),
      text: String(s.text || "").trim(),
    })).filter(s => s.text);
  }
  if (!items.length) {
    const text = String(transcript?.text || transcript || "").trim();
    if (!text) return "";
    const cues = splitText(text);
    const total = Math.max(durationFallback, cues.length * 3);
    const step = total / cues.length;
    items = cues.map((t, i) => ({ start: i * step, end: Math.min(total, (i + 1) * step - 0.05), text: t }));
  }
  return items.map((it, i) => {
    const start = Math.max(0, it.start);
    const end = Math.max(start + 0.2, it.end);
    return `${i + 1}\n${toSrtTimestamp(start)} --> ${toSrtTimestamp(end)}\n${it.text}\n`;
  }).join("\n").trim() + "\n";
}
