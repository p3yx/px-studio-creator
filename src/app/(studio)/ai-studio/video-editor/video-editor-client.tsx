"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Select, Badge, PageHeader } from "@/components/ui";
import { Film, Music, Upload, Scissors, Trash2, Save, Play, Pause, Undo2, Redo2, Download, Plus } from "lucide-react";
import type { EditorTimeline, EditorClip } from "@/lib/editor";

const uid = () => `c-${Math.random().toString(36).slice(2, 9)}`;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export default function VideoEditorClient() {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState<EditorTimeline | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [px, setPx] = useState(80);
  const [playing, setPlaying] = useState(false);
  const [job, setJob] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<EditorTimeline[]>([]);
  const [future, setFuture] = useState<EditorTimeline[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ id: string; mode: "move" | "left" | "right"; startX: number; orig: EditorClip } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);

  const push = useCallback((next: EditorTimeline) => {
    setTimeline(prev => { if (prev) setPast(p => [...p.slice(-29), prev]); return next; });
    setFuture([]);
  }, []);

  const load = useCallback(async (id: string) => {
    const r = await fetch(`/api/video-editor/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "Gagal memuat");
    setTimeline(j.timeline); setName(j.project.name); setJob(j.job);
    const first = j.timeline?.tracks?.flatMap((t: any) => t.clips || [])[0];
    if (first) { setSelected(first.id); setPlayhead(first.start || 0); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("project");
    if (id) { setProjectId(id); load(id).catch(e => setMsg(e.message)); }
  }, [load]);

  useEffect(() => {
    if (!job || !["WAITING", "RENDERING", "ANALYZING"].includes(job.status)) return;
    const t = setInterval(async () => {
      if (!projectId) return;
      const j = await fetch(`/api/video-editor/${projectId}`, { cache: "no-store" }).then(r => r.json());
      setJob(j.job);
      if (j.outputUrl && j.job?.status === "COMPLETED") setMsg("Render selesai. Video tersedia di project.");
    }, 2500);
    return () => clearInterval(t);
  }, [job, projectId]);

  async function importVideo(file: File) {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("name", file.name);
      const r = await fetch("/api/video-editor/create", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Gagal import");
      setProjectId(j.projectId); setTimeline(j.timeline); setName(file.name);
      router.replace(`/ai-studio/video-editor?project=${j.projectId}`);
      setMsg("Media diimport. Timeline siap diedit.");
    } catch (e: any) { setMsg(e.message || "Gagal import"); }
    finally { setBusy(false); }
  }

  async function addAsset(file: File, kind: "audio" | "video") {
    if (!projectId || !timeline) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`/api/video-editor/${projectId}/assets`, { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Gagal upload");
      const track = timeline.tracks.find(t => t.type === (kind === "audio" ? "audio" : "video"))!;
      const clip: EditorClip = {
        id: uid(), name: j.name, path: j.path, sourceIn: 0, sourceOut: j.duration,
        start: kind === "audio" ? playhead : track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0),
        duration: j.duration, trackId: track.id, kind,
      };
      push({ ...timeline, tracks: timeline.tracks.map(t => t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t) });
      setMsg(`${kind === "audio" ? "Audio" : "Video"} ditambahkan ke timeline.`);
    } catch (e: any) { setMsg(e.message || "Gagal"); }
    finally { setBusy(false); }
  }

  function updateClip(id: string, patch: Partial<EditorClip>) {
    if (!timeline) return;
    push({ ...timeline, tracks: timeline.tracks.map(tr => ({ ...tr, clips: tr.clips.map(c => c.id === id ? { ...c, ...patch } : c) })) });
  }

  function split() {
    if (!timeline || !selected) return;
    for (const tr of timeline.tracks) {
      const c = tr.clips.find(x => x.id === selected);
      if (!c) continue;
      const offset = playhead - c.start;
      if (offset <= 0.1 || offset >= c.duration - 0.1) { setMsg("Playhead harus berada di dalam clip."); return; }
      const left = { ...c, duration: offset, sourceOut: c.sourceIn + offset };
      const right = { ...c, id: uid(), start: playhead, duration: c.duration - offset, sourceIn: c.sourceIn + offset };
      push({ ...timeline, tracks: timeline.tracks.map(t => t.id === tr.id ? { ...t, clips: [...t.clips.filter(x => x.id !== c.id), left, right] } : t) });
      setMsg("Clip dipotong di playhead."); return;
    }
  }

  function removeSelected() {
    if (!timeline || !selected) return;
    push({ ...timeline, tracks: timeline.tracks.map(tr => ({ ...tr, clips: tr.clips.filter(c => c.id !== selected) })) });
    setSelected(null);
  }

  function undo() {
    if (!past.length || !timeline) return;
    const prev = past[past.length - 1];
    setFuture(f => [timeline, ...f]); setPast(p => p.slice(0, -1)); setTimeline(prev);
  }
  function redo() {
    if (!future.length || !timeline) return;
    const next = future[0];
    setPast(p => [...p, timeline]); setFuture(f => f.slice(1)); setTimeline(next);
  }

  async function save() {
    if (!projectId || !timeline) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/video-editor/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeline, name }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Gagal menyimpan");
      setMsg("Project tersimpan.");
    } catch (e: any) { setMsg(e.message || "Gagal"); } finally { setBusy(false); }
  }

  async function renderVideo() {
    if (!projectId) return;
    await save();
    setBusy(true);
    try {
      const r = await fetch(`/api/video-editor/${projectId}/render`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Gagal render");
      setJob({ status: "WAITING", stage: "Waiting", progress: 0 });
      setMsg("Render dimulai di background.");
    } catch (e: any) { setMsg(e.message || "Gagal"); } finally { setBusy(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedClip = timeline?.tracks.flatMap(t => t.clips).find(c => c.id === selected) || null;
  const duration = Math.max(10, ...(timeline?.tracks.flatMap(t => t.clips).map(c => c.start + c.duration) || [0]));

  function onDown(e: React.PointerEvent, clip: EditorClip, mode: "move" | "left" | "right") {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: clip.id, mode, startX: e.clientX, orig: { ...clip } };
    setSelected(clip.id);
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d || !timeline) return;
    const delta = (e.clientX - d.startX) / px;
    if (d.mode === "move") updateClip(d.id, { start: Math.max(0, Math.round((d.orig.start + delta) * 10) / 10) });
    if (d.mode === "left") {
      const ns = clamp(d.orig.start + delta, 0, d.orig.start + d.orig.duration - 0.2);
      updateClip(d.id, { start: Math.round(ns * 10) / 10, duration: Math.round((d.orig.start + d.orig.duration - ns) * 10) / 10, sourceIn: Math.max(0, d.orig.sourceIn + (ns - d.orig.start)) });
    }
    if (d.mode === "right") {
      const nd = Math.max(0.2, d.orig.duration + delta);
      updateClip(d.id, { duration: Math.round(nd * 10) / 10, sourceOut: d.orig.sourceIn + nd });
    }
  }
  function onUp() { dragRef.current = null; }

  useEffect(() => {
    if (!videoRef.current || !selectedClip) return;
    const t = clamp(playhead - selectedClip.start + selectedClip.sourceIn, selectedClip.sourceIn, selectedClip.sourceOut);
    if (Math.abs(videoRef.current.currentTime - t) > 0.15) videoRef.current.currentTime = t;
  }, [playhead, selectedClip]);

  return (
    <div className="space-y-5">
      <PageHeader title="Video Editor" description="Workspace editing non-destructive: timeline multi-track, preview, dan render dari data timeline yang sama." />

      {msg && <Card className="p-3 text-sm text-violet-200 border-violet-400/20 bg-violet-500/10">{msg}</Card>}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importVideo(f); e.target.value = ""; }} />
        <input ref={audioRef} type="file" accept="audio/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) addAsset(f, "audio"); e.target.value = ""; }} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15}/> Import Video</Button>
        <Button variant="secondary" onClick={() => audioRef.current?.click()} disabled={busy || !projectId}><Music size={15}/> Add Audio</Button>
        <Button variant="secondary" onClick={undo} disabled={!past.length}><Undo2 size={15}/> Undo</Button>
        <Button variant="secondary" onClick={redo} disabled={!future.length}><Redo2 size={15}/> Redo</Button>
        <Button variant="secondary" onClick={save} disabled={!projectId || busy}><Save size={15}/> Save</Button>
        <Button onClick={renderVideo} disabled={!projectId || busy}><Download size={15}/> Export</Button>
        <div className="w-full sm:w-56"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Nama project" /></div>
      </div>

      {!timeline ? (
        <Card className="p-10 text-center text-zinc-400">Import video untuk mulai membuat timeline.</Card>
      ) : (
        <>
          <div className="grid xl:grid-cols-[1fr] gap-4">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="text-sm font-medium">Preview</div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? "Pause" : "Play"}</Button>
                  <Badge>{timeline.width}x{timeline.height} · {timeline.fps}fps</Badge>
                </div>
              </div>
              <div className="aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center">
                {selectedClip?.url ? (
                  <video ref={videoRef} src={selectedClip.url} className="w-full h-full object-contain" muted
                    onTimeUpdate={e => { if (playing && selectedClip) { const t = e.currentTarget.currentTime - selectedClip.sourceIn + selectedClip.start; setPlayhead(clamp(t, 0, duration)); } }}
                    onEnded={() => setPlaying(false)} />
                ) : <div className="text-sm text-zinc-500">Pilih clip di timeline untuk preview.</div>}
              </div>
              <input type="range" min={0} max={duration} step={0.1} value={playhead} onChange={e => setPlayhead(Number(e.target.value))} className="w-full mt-3" />
              <div className="text-xs text-zinc-500">{playhead.toFixed(1)}s / {duration.toFixed(1)}s</div>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-medium">Timeline</div>
                <div className="flex gap-2 items-center flex-wrap">
                  <Button variant="secondary" onClick={split}><Scissors size={15}/> Split</Button>
                  <Button variant="secondary" onClick={removeSelected}><Trash2 size={15}/> Delete</Button>
                  <Select value={String(px)} onChange={e => setPx(Number(e.target.value))} className="w-28">
                    <option value="40">Zoom 40</option><option value="80">Zoom 80</option><option value="140">Zoom 140</option><option value="220">Zoom 220</option>
                  </Select>
                  {job && <Badge>{job.stage || job.status} {job.progress ?? 0}%</Badge>}
                </div>
              </div>
              <div className="overflow-x-auto border border-white/10 rounded-xl bg-black/20" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
                <div style={{ width: Math.max(800, duration * px + 120) }} className="relative">
                  <div className="h-7 border-b border-white/10 relative" onPointerDown={e => setPlayhead(clamp((e.nativeEvent.offsetX) / px, 0, duration))}>
                    {Array.from({ length: Math.ceil(duration / 5) + 1 }).map((_, i) => (
                      <span key={i} className="absolute top-0 h-full text-[10px] text-zinc-500 border-l border-white/10 pl-1" style={{ left: i * 5 * px }}>{i * 5}s</span>
                    ))}
                  </div>
                  {timeline.tracks.map(tr => (
                    <div key={tr.id} className="h-20 border-b border-white/10 relative">
                      <div className="absolute left-0 top-0 h-full px-2 text-[10px] text-zinc-500 z-10 bg-[#0d0e15]/80 border-r border-white/10" style={{ width: 80 }}>{tr.type === "audio" ? <Music size={12} className="inline"/> : <Film size={12} className="inline"/>} {tr.name}</div>
                      <div className="absolute top-0 h-full" style={{ left: 80, right: 0 }}>
                        {tr.clips.map(c => (
                          <div key={c.id} onPointerDown={e => onDown(e, c, "move")}
                            className={`absolute top-2 h-16 rounded-lg border text-[11px] px-2 overflow-hidden cursor-grab select-none ${selected === c.id ? "border-violet-400 bg-violet-500/30" : "border-cyan-400/30 bg-cyan-500/15"}`}
                            style={{ left: c.start * px, width: Math.max(24, c.duration * px) }}>
                            <div className="truncate pointer-events-none">{c.name}</div>
                            <div className="absolute left-0 top-0 h-full w-2 bg-white/30 cursor-ew-resize" onPointerDown={e => onDown(e, c, "left")} />
                            <div className="absolute right-0 top-0 h-full w-2 bg-white/30 cursor-ew-resize" onPointerDown={e => onDown(e, c, "right")} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-rose-400 pointer-events-none" style={{ left: 80 + playhead * px }} />
                </div>
              </div>
              <div className="text-xs text-zinc-500">Geser clip untuk memindah · pinggir kiri/kanan untuk trim · klik ruler untuk playhead · Space play/pause · Delete hapus · Ctrl+S save · Ctrl+Z undo.</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
