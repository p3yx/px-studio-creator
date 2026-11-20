export const EDITOR_TOOLS = ["split", "setSpeed", "setEffect", "addText", "move", "trim", "delete", "addKeyframe", "duplicate", "rippleDelete", "setTransition", "setTrack"] as const;
export const KEYFRAME_PROPERTIES = ["volume", "opacity", "scale", "x", "y"] as const;

export type EditorKeyframe = {
  id: string;
  time: number;
  property: "volume" | "opacity" | "scale" | "x" | "y";
  value: number;
  interpolation: "linear" | "easeIn" | "easeOut" | "easeInOut";
};

export type EditorMotion = {
  type: "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight" | "panUp" | "panDown" | "kenBurns";
  intensity?: number;
};

export type EditorTextAnim = "none" | "fade" | "slideUp" | "typewriter" | "zoom";

export type EditorClip = {
  id: string;
  name: string;
  path: string;
  sourceIn: number;
  sourceOut: number;
  start: number;
  duration: number;
  trackId: string;
  kind?: "video" | "audio" | "text";
  speed?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  x?: number;
  y?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  effect?: "none" | "blur" | "vignette" | "grain" | "shake" | "zoom";
  effectIntensity?: number;
  transitionIn?: "none" | "fade";
  transition?: "none" | "fade" | "slideleft" | "slideright" | "slideup" | "zoom" | "flash" | "blur" | "wipe";
  transitionDuration?: number;
  motion?: EditorMotion;
  scale?: number;
  textAnim?: EditorTextAnim;
  font?: string;
  fontWeight?: number;
  keyframes?: EditorKeyframe[];
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
        kind: c?.kind === "text" ? "text" : tr?.type === "audio" ? "audio" : "video",
        speed: Math.max(0.25, Math.min(4, Number(c?.speed || 1))),
        volume: Math.max(0, Math.min(2, Number(c?.volume ?? 1))),
        fadeIn: Math.max(0, Number(c?.fadeIn || 0)),
        fadeOut: Math.max(0, Number(c?.fadeOut || 0)),
        opacity: Math.max(0, Math.min(1, Number(c?.opacity ?? 1))),
        text: String(c?.text || ""),
        fontSize: Math.max(12, Math.min(160, Number(c?.fontSize || 48))),
        color: String(c?.color || "#FFFFFF"),
        x: Number(c?.x ?? 50), y: Number(c?.y ?? 50),
        brightness: Math.max(-1, Math.min(1, Number(c?.brightness || 0))),
        contrast: Math.max(0, Math.min(3, Number(c?.contrast ?? 1))),
        saturation: Math.max(0, Math.min(3, Number(c?.saturation ?? 1))),
        effect: ["blur","vignette","grain","shake","zoom"].includes(String(c?.effect)) ? String(c.effect) as any : "none",
        effectIntensity: Math.max(0, Math.min(100, Number(c?.effectIntensity || 30))),
        transitionIn: String(c?.transitionIn) === "fade" ? "fade" : "none",
        transition: ["fade","slideleft","slideright","slideup","zoom","flash","blur","wipe"].includes(String(c?.transition)) ? String(c.transition) as any : "none",
        transitionDuration: Math.max(0, Math.min(5, Number(c?.transitionDuration || 0))),
        motion: c?.motion && ["zoomIn","zoomOut","panLeft","panRight","panUp","panDown","kenBurns"].includes(String(c.motion.type))
          ? { type: String(c.motion.type) as any, intensity: Math.max(0, Math.min(100, Number(c.motion.intensity ?? 30))) }
          : { type: "none", intensity: 0 },
        scale: Math.max(0.1, Math.min(3, Number(c?.scale ?? 1))),
        textAnim: ["fade","slideUp","typewriter","zoom"].includes(String(c?.textAnim)) ? String(c.textAnim) as any : "none",
        font: String(c?.font || "arial"),
        fontWeight: Math.max(300, Math.min(900, Number(c?.fontWeight || 400))),
        keyframes: Array.isArray(c?.keyframes) ? c.keyframes.map((k: any) => ({
          id: String(k?.id || `k-${Math.random().toString(36).slice(2, 8)}`),
          time: Math.max(0, Number(k?.time || 0)),
          property: ["volume","opacity","scale","x","y"].includes(String(k?.property)) ? String(k.property) as any : "volume",
          value: Number(k?.value || 0),
          interpolation: ["linear","easeIn","easeOut","easeInOut"].includes(String(k?.interpolation)) ? String(k.interpolation) as any : "linear",
        })).sort((a: any, b: any) => a.time - b.time) : [],
      })) : [],
    })),
  };
}
