export type EditorClip = {
  id: string;
  name: string;
  path: string;
  sourceIn: number;
  sourceOut: number;
  start: number;
  duration: number;
  trackId: string;
  kind?: "video" | "audio";
};

export type EditorTrack = {
  id: string;
  type: "video" | "audio";
  name: string;
  locked?: boolean;
  hidden?: boolean;
  muted?: boolean;
  volume?: number;
  clips: EditorClip[];
};

export type EditorTimeline = {
  fps: number;
  width: number;
  height: number;
  duration: number;
  tracks: EditorTrack[];
};

export function emptyTimeline(): EditorTimeline {
  return {
    fps: 30, width: 1920, height: 1080, duration: 0,
    tracks: [
      { id: "v1", type: "video", name: "Video 1", clips: [] },
      { id: "a1", type: "audio", name: "Audio 1", volume: 1, clips: [] },
    ],
  };
}

export function timelineDuration(t: EditorTimeline) {
  let max = 0;
  for (const tr of t.tracks) for (const c of tr.clips) max = Math.max(max, c.start + c.duration);
  return Math.max(0, Math.round(max * 100) / 100);
}

export function normalizeTimeline(raw: any): EditorTimeline {
  const base = emptyTimeline();
  if (!raw || typeof raw !== "object") return base;
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : base.tracks;
  return {
    fps: Math.max(1, Math.min(120, Number(raw.fps) || 30)),
    width: Number(raw.width) || 1920,
    height: Number(raw.height) || 1080,
    duration: Number(raw.duration) || 0,
    tracks: tracks.map((tr: any) => ({
      id: String(tr?.id || `t-${Math.random().toString(36).slice(2, 7)}`),
      type: tr?.type === "audio" ? "audio" : "video",
      name: String(tr?.name || "Track"),
      locked: !!tr?.locked,
      hidden: !!tr?.hidden,
      muted: !!tr?.muted,
      volume: Math.max(0, Math.min(2, Number(tr?.volume ?? 1))),
      clips: Array.isArray(tr?.clips) ? tr.clips.map((c: any) => ({
        id: String(c?.id || `c-${Math.random().toString(36).slice(2, 7)}`),
        name: String(c?.name || "Clip"),
        path: String(c?.path || ""),
        sourceIn: Math.max(0, Number(c?.sourceIn || 0)),
        sourceOut: Math.max(0.1, Number(c?.sourceOut || 1)),
        start: Math.max(0, Number(c?.start || 0)),
        duration: Math.max(0.1, Number(c?.duration || 1)),
        trackId: String(tr?.id || ""),
        kind: tr?.type === "audio" ? "audio" : "video",
      })) : [],
    })),
  };
}
