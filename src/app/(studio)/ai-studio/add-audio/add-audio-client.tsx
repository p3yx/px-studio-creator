"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { Upload, Music, Download, Film, Loader2, Activity, Play, Pause, Wand2, RotateCcw, Plus, Trash2, Lock, Unlock, ChevronRight } from "lucide-react";

type AudioAsset = { id: string; name: string; format?: string; duration?: number | null; fileUrl?: string };
type BeatSection = { start: number; end: number; type: string };
type BeatAnalysis = {
  bpm: number; duration: number; beats: number[]; strong_beats: number[]; sections: BeatSection[];
  confidence: number; total_beats: number; strong_beat_count: number; waveform: [number, number][]; source?: string;
};

type Marker = { id: string; t: number; strong?: boolean; locked?: boolean; manual?: boolean };

type SyncSettings = {
  preset: string;
  syncMode: string;
  intensity: string;
  offset: number; // seconds
  beatCut: boolean;
  beatTransition: boolean;
  beatZoom: boolean;
  beatImpact: boolean;
  minSegment: number;
};

const PRESETS: Record<string, Partial<SyncSettings>> = {
  CLEAN: { syncMode: "every_4", intensity: "subtle", beatCut: true, beatTransition: true, beatZoom: false, beatImpact: false, minSegment: 2.5 },
  CINEMATIC: { syncMode: "strong", intensity: "balanced", beatCut: true, beatTransition: true, beatZoom: false, beatImpact: false, minSegment: 3.0 },
  AMV: { syncMode: "every_2", intensity: "dynamic", beatCut: true, beatTransition: true, beatZoom: true, beatImpact: true, minSegment: 1.2 },
  HYPE: { syncMode: "every_beat", intensity: "aggressive", beatCut: true, beatTransition: true, beatZoom: true, beatImpact: true, minSegment: 0.8 },
  SOFT: { syncMode: "every_4", intensity: "subtle", beatCut: true, beatTransition: true, beatZoom: false, beatImpact: false, minSegment: 3.5 },
  SMART: { syncMode: "smart", intensity: "balanced", beatCut: true, beatTransition: true, beatZoom: true, beatImpact: true, minSegment: 1.8 },
};

function uid() { return Math.random().toString(36).slice(2, 10); }

export default function AddAudioClient() {
  const [tab, setTab] = useState<"add" | "library" | "extract" | "autobeat">("add");

  // Shared/add-audio state
  const [video, setVideo] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [audioAssetId, setAudioAssetId] = useState("");
  const [library, setLibrary] = useState<AudioAsset[]>([]);
  const [mode, setMode] = useState("mix");
  const [musicVolume, setMusicVolume] = useState("1");
  const [originalVolume, setOriginalVolume] = useState("0.8");
  const [name, setName] = useState("Video dengan Suara");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // Extract tab state (simple)
  const [extractFile, setExtractFile] = useState<File | null>(null);
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState<any>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Auto Beat state
  const [beatAudioFile, setBeatAudioFile] = useState<File | null>(null);
  const [beatAudioAssetId, setBeatAudioAssetId] = useState("");
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null);
  const [analysisDirty, setAnalysisDirty] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [markersHistory, setMarkersHistory] = useState<Marker[][]>([]);
  const [markersFuture, setMarkersFuture] = useState<Marker[][]>([]);
  const [sync, setSync] = useState<SyncSettings>({ preset: "SMART", syncMode: "smart", intensity: "balanced", offset: 0, beatCut: true, beatTransition: true, beatZoom: true, beatImpact: false, minSegment: 1.8 });
  const [syncPlan, setSyncPlan] = useState<any>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyResult, setApplyResult] = useState<any>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/audio/library", { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (Array.isArray(j.items)) setLibrary(j.items);
        else if (Array.isArray(j.assets)) setLibrary(j.assets);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (beatAudioFile) {
      const u = URL.createObjectURL(beatAudioFile);
      setAudioPreviewUrl(u);
      return () => URL.revokeObjectURL(u);
    } else if (beatAudioAssetId) {
      const a = library.find(x => x.id === beatAudioAssetId);
      setAudioPreviewUrl(a?.fileUrl || null);
    } else {
      setAudioPreviewUrl(null);
    }
  }, [beatAudioFile, beatAudioAssetId, library]);

  useEffect(() => { setAnalysisDirty(true); setAnalysis(null); setMarkers([]); setSyncPlan(null); setApplyResult(null); }, [beatAudioFile, beatAudioAssetId]);

  function pushHistory(next: Marker[]) {
    setMarkersHistory(h => [...h.slice(-30), markers]);
    setMarkersFuture([]);
    setMarkers(next);
  }
  function undoMarkers() { setMarkersHistory(h => { if (!h.length) return h; const prev = h[h.length-1]; setMarkersFuture(f => [markers, ...f].slice(0,30)); setMarkers(prev); return h.slice(0,-1); }); }
  function redoMarkers() { setMarkersFuture(f => { if (!f.length) return f; const next = f[0]; setMarkersHistory(h => [...h, markers].slice(-30)); setMarkers(next); return f.slice(1); }); }

  function markersFromAnalysis(a: BeatAnalysis, offset: number): Marker[] {
    const bs = new Set((a.strong_beats || []).map(x => Math.round(x*1000)));
    return (a.beats || []).map(t => ({ id: uid(), t: +(t + offset).toFixed(3), strong: bs.has(Math.round(t*1000)), locked: false, manual: false }))
      .filter(m => m.t >= 0 && m.t <= (a.duration || 0) + Math.max(0, offset) + 0.1);
  }

  async function analyzeBeat() {
    if (!beatAudioFile && !beatAudioAssetId) { setError("Pilih audio/musik untuk dianalisis."); return; }
    setAnalyzing(true); setError(null); setSyncPlan(null); setApplyResult(null);
    try {
      const fd = new FormData();
      if (beatAudioFile) fd.append("audio", beatAudioFile);
      else if (beatAudioAssetId) fd.append("audioAssetId", beatAudioAssetId);
      const res = await fetch("/api/tools/beat-analysis", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Gagal menganalisis beat");
      setAnalysis(j);
      setMarkers(markersFromAnalysis(j, 0));
      setAnalysisDirty(false);
    } catch (e: any) { setError(e.message || "Gagal menganalisis beat"); }
    finally { setAnalyzing(false); }
  }

  function applyPreset(p: string) {
    const base = PRESETS[p] || PRESETS.SMART;
    setSync(s => ({ ...s, preset: p, ...base } as SyncSettings));
  }

  useEffect(() => {
    if (analysis) {
      // rebase auto markers when offset changes, preserve manual/locked positions by not regenerating if manually edited? keep manual/locked
      const auto = markersFromAnalysis(analysis, sync.offset);
      setMarkers(prev => {
        const manualLocked = prev.filter(m => m.manual || m.locked);
        if (!manualLocked.length) return auto;
        // merge: keep manual/locked, replace others
        const others = auto.filter(a => !manualLocked.some(m => Math.abs(m.t - a.t) < 0.05));
        return [...manualLocked, ...others].sort((a,b)=>a.t-b.t);
      });
      setSyncPlan(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.offset]);

  function computeSyncPlan() {
    if (!analysis) { setError("Analisis beat belum tersedia."); return null; }
    const dur = analysis.duration || 0;
    const sorted = [...markers].sort((a,b)=>a.t-b.t).filter(m => m.t >= 0 && m.t <= dur + 1);
    let candidates = sorted.map(m=>m.t);
    const mode = sync.syncMode;
    if (mode === "every_2") candidates = candidates.filter((_,i)=>i%2===0);
    else if (mode === "every_4") candidates = candidates.filter((_,i)=>i%4===0);
    else if (mode === "strong") candidates = sorted.filter(m=>m.strong).map(m=>m.t);
    else if (mode === "music_sections") {
      const sec = analysis.sections || [];
      candidates = sec.map(s=>s.start).filter(t=>t>=0);
      if (sec.length) candidates.push(sec[sec.length-1].end);
    } else if (mode === "smart") {
      // prefer strong beats and section boundaries, fallback to every 2
      const set = new Set<number>();
      sorted.filter(m=>m.strong).forEach(m=>set.add(+m.t.toFixed(3)));
      (analysis.sections||[]).forEach(s=>{ set.add(+s.start.toFixed(3)); });
      candidates = Array.from(set).sort((a,b)=>a-b);
      if (candidates.length < 4) candidates = candidates.concat(sorted.filter((_,i)=>i%2===0).map(m=>m.t)).sort((a,b)=>a-b);
    }
    // ensure bounds and min segment
    const minSeg = Math.max(0.5, sync.minSegment || 1.2);
    candidates = Array.from(new Set(candidates.map(t=>+t.toFixed(3)))).sort((a,b)=>a-b);
    const cuts: number[] = [0];
    for (const t of candidates) {
      if (t - cuts[cuts.length-1] >= minSeg && t < dur - 0.2) cuts.push(t);
    }
    if (dur - cuts[cuts.length-1] < 0.4 && cuts.length > 1) cuts[cuts.length-1] = dur; else cuts.push(dur);
    const plan = {
      preset: sync.preset, syncMode: sync.syncMode, intensity: sync.intensity, offset: sync.offset,
      beatCut: sync.beatCut, beatTransition: sync.beatTransition, beatZoom: sync.beatZoom, beatImpact: sync.beatImpact,
      cuts, bpm: analysis.bpm, confidence: analysis.confidence, duration: dur,
      strongBeats: (analysis.strong_beats||[]).length, totalBeats: (analysis.beats||[]).length,
    };
    setSyncPlan(plan);
    return plan;
  }

  async function autoSync() { computeSyncPlan(); }
  async function applyAutoBeat() {
    const plan = syncPlan || computeSyncPlan();
    if (!plan) return;
    if (!video) { setError("Pilih video terlebih dahulu untuk menerapkan Auto Beat."); return; }
    if (!beatAudioFile && !beatAudioAssetId) { setError("Pilih audio/musik untuk Auto Beat."); return; }
    setApplyBusy(true); setError(null); setApplyResult(null);
    try {
      const fd = new FormData();
      fd.append("video", video);
      if (beatAudioFile) fd.append("audio", beatAudioFile);
      else if (beatAudioAssetId) fd.append("audioAssetId", beatAudioAssetId);
      fd.append("mode", mode);
      fd.append("musicVolume", musicVolume);
      fd.append("originalVolume", originalVolume);
      fd.append("name", name || "Auto Beat Video");
      fd.append("plan", JSON.stringify(plan));
      const res = await fetch("/api/tools/beat-sync", { method: "POST", body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || "Gagal menerapkan Auto Beat");
      setApplyResult(j);
    } catch (e:any) { setError(e.message || "Gagal menerapkan Auto Beat"); }
    finally { setApplyBusy(false); }
  }

  // playback time tracking
  useEffect(() => {
    const a = audioPreviewRef.current; if (!a) return;
    let raf = 0;
    const tick = () => { setPlayhead(a.currentTime || 0); raf = requestAnimationFrame(tick); };
    const onPlay = () => { setPlaying(true); raf = requestAnimationFrame(tick); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf); setPlayhead(a.currentTime||0); };
    a.addEventListener('play', onPlay); a.addEventListener('pause', onPause); a.addEventListener('ended', onPause);
    return () => { a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause); a.removeEventListener('ended', onPause); cancelAnimationFrame(raf); };
  }, [audioPreviewUrl]);

  // draw waveform
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const w = c.width = c.clientWidth * (window.devicePixelRatio || 1);
    const h = c.height = 160 * (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0,0,w,h);
    if (!analysis) {
      ctx.fillStyle = '#71717a'; ctx.font = `${12*(window.devicePixelRatio||1)}px sans-serif`; ctx.fillText('Jalankan Analyze Beat untuk melihat waveform & marker', 16, h/2); return;
    }
    const dur = analysis.duration || 1;
    const wf = analysis.waveform || [];
    const mid = h/2;
    // waveform
    ctx.fillStyle = 'rgba(167,139,250,0.35)';
    if (wf.length) {
      const step = w / wf.length;
      for (let i=0;i<wf.length;i++) {
        const [mn,mx] = wf[i];
        const x = i*step;
        const y1 = mid + mn * mid * 0.9;
        const y2 = mid + mx * mid * 0.9;
        ctx.fillRect(x, Math.min(y1,y2), Math.max(1, step-0.5), Math.max(1, Math.abs(y2-y1)));
      }
    } else {
      ctx.strokeStyle = 'rgba(167,139,250,0.4)'; ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(w,mid); ctx.stroke();
    }
    // sections background hints
    (analysis.sections||[]).forEach(s => {
      const x1 = (s.start/dur)*w, x2=(s.end/dur)*w;
      ctx.fillStyle = s.type==='drop' ? 'rgba(34,211,238,0.08)' : s.type==='build-up' ? 'rgba(124,58,237,0.08)' : s.type==='high' ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x1,0,Math.max(1,x2-x1),h);
    });
    // beat markers
    const strongSet = new Set(markers.filter(m=>m.strong).map(m=>m.id));
    markers.forEach(m => {
      const x = (m.t/dur)*w; if (x<0||x>w) return;
      const strong = m.strong || strongSet.has(m.id);
      ctx.strokeStyle = strong ? 'rgba(34,211,238,0.9)' : 'rgba(167,139,250,0.55)';
      ctx.lineWidth = strong ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    });
    // playhead
    const px = (Math.max(0, Math.min(playhead, dur))/dur)*w;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,h); ctx.stroke();
  }, [analysis, markers, playhead]);

  // existing add-audio submit (mix mode) - keep working
  async function submitAddAudio() {
    if (!video) { setError("Pilih file video terlebih dahulu."); return; }
    if (!audio && !audioAssetId) { setError("Pilih/unggah file audio atau pilih dari Audio Library."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("video", video);
      if (audio) fd.append("audio", audio);
      if (!audio && audioAssetId) fd.append("audioAssetId", audioAssetId);
      fd.append("mode", mode);
      fd.append("musicVolume", musicVolume);
      fd.append("originalVolume", originalVolume);
      fd.append("name", name);
      const res = await fetch("/api/tools/mix-audio", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal memproses video");
      setResult(j);
    } catch (e: any) { setError(e.message || "Gagal memproses video"); }
    finally { setBusy(false); }
  }

  // simple extract
  async function doExtract() {
    if (!extractFile) { setExtractError("Pilih file video terlebih dahulu."); return; }
    setExtractBusy(true); setExtractError(null); setExtractResult(null);
    try {
      const fd = new FormData(); fd.append("file", extractFile);
      const res = await fetch("/api/audio/extract", { method: "POST", body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || "Gagal mengekstrak audio");
      setExtractResult(j);
      // refresh library
      const lr = await fetch("/api/audio/library", { cache: "no-store" }); const lj = await lr.json().catch(()=>({}));
      if (Array.isArray(lj.items)) setLibrary(lj.items); else if (Array.isArray(lj.assets)) setLibrary(lj.assets);
    } catch(e:any){ setExtractError(e.message || "Gagal mengekstrak audio"); }
    finally { setExtractBusy(false); }
  }

  const tabs: {id: typeof tab; label: string}[] = [
    { id: "add", label: "Add Audio" },
    { id: "library", label: "Audio Library" },
    { id: "extract", label: "Extract Audio" },
    { id: "autobeat", label: "Auto Beat" },
  ];

  const selectedBeatAudioName = beatAudioFile?.name || (library.find(a=>a.id===beatAudioAssetId)?.name) || "Belum dipilih";

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
      <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/10 w-full md:w-fit">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={()=>setTab(t.id)} className={`rounded-lg px-3.5 py-2 text-sm transition ${tab===t.id ? "bg-violet-600/30 text-violet-100 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200 border border-transparent"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "add" && (
        <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-8 items-start">
          <Card className="p-5 sm:p-6 space-y-5">
            {busy && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-violet-200"><Loader2 size={16} className="animate-spin"/> Memproses & merender video dengan FFmpeg...</div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full w-1/2 bg-gradient-to-r from-violet-500 to-cyan-400 animate-pulse rounded-full" /></div>
                <div className="text-xs text-zinc-400">Proses berjalan di server. Mohon tunggu, jangan tutup halaman ini sampai selesai.</div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm text-zinc-300">1. Video</label>
              <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-zinc-300"><Film size={16} className="text-violet-300"/> {video ? video.name : "Belum ada video dipilih"}</div>
                <Input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv" onChange={e => setVideo(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-zinc-300">2. Suara / Musik</label>
              <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
                <div className="space-y-2">
                  <div className="text-xs text-zinc-400">Upload audio</div>
                  <Input type="file" accept="audio/*,.m4a,.aac,.wav,.mp3,.ogg,.flac" onChange={e => { setAudio(e.target.files?.[0] || null); if (e.target.files?.[0]) setAudioAssetId(""); }} />
                </div>
                <div className="text-xs text-zinc-500 text-center">atau</div>
                <div className="space-y-2">
                  <div className="text-xs text-zinc-400">Pilih dari Audio Library</div>
                  <Select value={audioAssetId} onChange={e => { setAudioAssetId(e.target.value); if (e.target.value) setAudio(null); }}>
                    <option value="">-- Pilih audio --</option>
                    {library.map(a => <option key={a.id} value={a.id}>{a.name}{a.format ? ` (${a.format})` : ""}</option>)}
                  </Select>
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Mode Audio</label>
                <Select value={mode} onChange={e=>setMode(e.target.value)}>
                  <option value="mix">Mix (gabung dengan audio asli video)</option>
                  <option value="replace">Replace (ganti audio asli dengan audio baru)</option>
                  <option value="music">Music Only (gunakan audio baru)</option>
                </Select>
              </div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Volume Audio Asli</label><Input type="number" min={0} max={2} step="0.1" value={originalVolume} onChange={e=>setOriginalVolume(e.target.value)} disabled={mode !== "mix"} /></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Volume Audio/Musik Baru</label><Input type="number" min={0} max={2} step="0.1" value={musicVolume} onChange={e=>setMusicVolume(e.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Nama Output</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
            </div>
            <Button className="w-full" onClick={submitAddAudio} disabled={busy || !video || (!audio && !audioAssetId)}>
              {busy ? <Loader2 size={16} className="animate-spin"/> : <Music size={16}/>} {busy ? "Memproses & Merender..." : "Tambahkan Suara & Render Video"}
            </Button>
            <div className="text-xs text-zinc-500">Durasi output mengikuti video (audio menyesuaikan/loop jika lebih pendek, dipotong jika lebih panjang). Proses menggunakan FFmpeg di server. Gunakan tab <b>Auto Beat</b> untuk sinkronisasi musik berbasis beat.</div>
          </Card>
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="font-medium">Hasil</div>
            {busy ? (
              <div className="py-10 text-center space-y-3"><Loader2 size={28} className="animate-spin mx-auto text-violet-400" /><div className="text-sm text-zinc-300">Sedang merender video...</div></div>
            ) : !result ? <div className="text-sm text-zinc-500 py-8 text-center">Belum ada hasil. Unggah video & audio lalu klik render.</div> : (
              <div className="space-y-4">
                <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10">
                  {result.fileUrl ? <video key={result.fileUrl} src={result.fileUrl} controls className="w-full h-full object-contain" /> : null}
                </div>
                <div className="text-sm text-zinc-400 space-y-1">
                  {result.duration != null && <div>Durasi: <span className="text-zinc-200">{Number(result.duration).toFixed(2)}s</span></div>}
                  {result.fileSize != null && <div>Ukuran: <span className="text-zinc-200">{(result.fileSize/1024/1024).toFixed(2)} MB</span></div>}
                </div>
                {result.fileUrl && <a href={result.fileUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download MP4</Button></a>}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "library" && (
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3"><div className="font-medium">Audio Library</div><Button variant="secondary" onClick={async()=>{ const r=await fetch('/api/audio/library',{cache:'no-store'}); const j=await r.json().catch(()=>({})); if(Array.isArray(j.items)) setLibrary(j.items); else if(Array.isArray(j.assets)) setLibrary(j.assets); }}>Refresh</Button></div>
          <div className="text-sm text-zinc-400">Pilih audio dari library untuk digunakan di tab Add Audio atau Auto Beat.</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {library.length ? library.map(a => (
              <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
                <div className="font-medium text-sm truncate">{a.name}</div>
                <div className="text-xs text-zinc-500">{a.format || 'audio'} {a.duration ? ` |  ${Number(a.duration).toFixed(1)}s` : ''}</div>
                {a.fileUrl && <audio controls src={a.fileUrl} className="w-full h-8" />}
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1 text-xs" onClick={()=>{ setAudioAssetId(a.id); setAudio(null); setTab('add'); }}>Pakai (Add Audio)</Button>
                  <Button variant="secondary" className="flex-1 text-xs" onClick={()=>{ setBeatAudioAssetId(a.id); setBeatAudioFile(null); setTab('autobeat'); }}>Pakai (Auto Beat)</Button>
                </div>
              </div>
            )) : <div className="text-sm text-zinc-500">Belum ada audio di library. Ekstrak audio dari video atau hasilkan TTS lalu simpan ke library.</div>}
          </div>
          <div className="text-xs text-zinc-500">Kelola library lengkap di menu <b>Audio Library</b>.</div>
        </Card>
      )}

      {tab === "extract" && (
        <Card className="p-5 sm:p-6 space-y-4 max-w-2xl">
          <div className="font-medium">Extract Audio</div>
          {extractError && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{extractError}</div>}
          <div className="space-y-2"><label className="text-sm text-zinc-300">Pilih Video</label><Input type="file" accept="video/*" onChange={e=>setExtractFile(e.target.files?.[0]||null)} /></div>
          <Button onClick={doExtract} disabled={extractBusy || !extractFile}>{extractBusy ? <Loader2 size={16} className="animate-spin"/> : <Music size={16}/>} {extractBusy ? 'Mengekstrak...' : 'Extract Audio ke Library'}</Button>
          {extractResult && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">Audio berhasil diekstrak dan disimpan ke library. {extractResult.fileUrl ? <a className="underline ml-1" href={extractResult.fileUrl} target="_blank">Download</a> : null}</div>}
          <div className="text-xs text-zinc-500">Untuk opsi ekstraksi lanjutan, gunakan menu <b>Audio Extractor</b>.</div>
        </Card>
      )}

      {tab === "autobeat" && (
        <div className="space-y-5">
          {analysisDirty && (beatAudioFile || beatAudioAssetId) && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-200 text-sm px-4 py-3">Audio/musik berubah atau belum dianalisis. Hasil analisis/plan sebelumnya tidak berlaku - jalankan <b>Analyze Beat</b> untuk audio ini.</div>}
          <div className="grid xl:grid-cols-[1.05fr_.95fr] gap-5 items-start">
            <Card className="p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between gap-3"><div className="font-medium flex items-center gap-2"><Activity size={16} className="text-violet-300"/> Auto Beat Analysis</div>{analysis && <div className="text-xs text-zinc-400">Confidence: <span className={analysis.confidence >= 0.6 ? 'text-emerald-300' : 'text-amber-300'}>{Math.round((analysis.confidence||0)*100)}%</span></div>}</div>

              <div className="space-y-2">
                <label className="text-sm text-zinc-300">Video (untuk Apply/Render Auto Beat)</label>
                <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-zinc-300"><Film size={15} className="text-violet-300"/> {video ? video.name : "Belum ada video dipilih"}</div>
                  <Input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv" onChange={e => setVideo(e.target.files?.[0] || null)} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-zinc-300">Musik / Audio (untuk analisis & sinkronisasi)</label>
                <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3 space-y-2">
                  <div className="text-sm text-zinc-300 truncate">{selectedBeatAudioName}</div>
                  <Input type="file" accept="audio/*,video/mp4,.m4a,.aac,.wav,.mp3,.ogg,.flac" onChange={e => { setBeatAudioFile(e.target.files?.[0] || null); if (e.target.files?.[0]) setBeatAudioAssetId(""); }} />
                  <div className="text-xs text-zinc-500 text-center">atau pilih dari Audio Library</div>
                  <Select value={beatAudioAssetId} onChange={e => { setBeatAudioAssetId(e.target.value); if (e.target.value) setBeatAudioFile(null); }}>
                    <option value="">-- Pilih audio library --</option>
                    {library.map(a => <option key={a.id} value={a.id}>{a.name}{a.format ? ` (${a.format})` : ""}</option>)}
                  </Select>
                  {audioPreviewUrl && <audio ref={audioPreviewRef} controls src={audioPreviewUrl} className="w-full" />}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={analyzeBeat} disabled={analyzing || (!beatAudioFile && !beatAudioAssetId)}>{analyzing ? <Loader2 size={16} className="animate-spin"/> : <Activity size={16}/>} {analyzing ? 'Menganalisis...' : 'Analyze Beat'}</Button>
                <Button variant="secondary" onClick={autoSync} disabled={!analysis}><Wand2 size={16}/> Auto Sync</Button>
                <Button variant="secondary" onClick={()=>{ setSyncPlan(null); setApplyResult(null); }} disabled={!analysis && !syncPlan}>Reset Plan</Button>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400"><span>Waveform & Beat Markers</span><span>{analysis ? `${analysis.bpm || 0} BPM | ${analysis.duration || 0}s` : ' - '}</span></div>
                <canvas ref={canvasRef} className="w-full rounded-lg border border-white/10" style={{height: 160}} onClick={(e)=>{
                  if(!analysis) return; const r=(e.target as HTMLCanvasElement).getBoundingClientRect(); const x=e.clientX-r.left; const t=(x/r.width)*(analysis.duration||0);
                  pushHistory([...markers, {id:uid(), t:+t.toFixed(3), strong:false, locked:false, manual:true}].sort((a,b)=>a.t-b.t)); setSyncPlan(null);
                }} />
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400"><span className="inline-flex items-center gap-1"><span className="w-3 h-[2px] bg-violet-400 inline-block"/> Beat</span><span className="inline-flex items-center gap-1"><span className="w-3 h-[2px] bg-cyan-300 inline-block"/> Strong Beat</span><span className="inline-flex items-center gap-1"><span className="w-3 h-[2px] bg-white inline-block"/> Playhead</span><span>Klik waveform untuk menambah marker manual</span></div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="secondary" onClick={undoMarkers} disabled={!markersHistory.length}><RotateCcw size={14}/> Undo</Button>
                  <Button variant="secondary" onClick={redoMarkers} disabled={!markersFuture.length}><ChevronRight size={14}/> Redo</Button>
                  <Button variant="secondary" onClick={()=>{ if(!analysis){return;} pushHistory(markersFromAnalysis(analysis, sync.offset)); setSyncPlan(null); }}>Reset Markers</Button>
                </div>
              </div>

              {analysis && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3"><div className="text-xs text-zinc-500">BPM</div><div className="text-zinc-100 font-medium">{analysis.bpm || 'N/A'}</div></div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3"><div className="text-xs text-zinc-500">Beats</div><div className="text-zinc-100 font-medium">{analysis.total_beats}</div></div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3"><div className="text-xs text-zinc-500">Strong Beats</div><div className="text-zinc-100 font-medium">{analysis.strong_beat_count}</div></div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3"><div className="text-xs text-zinc-500">Durasi</div><div className="text-zinc-100 font-medium">{Number(analysis.duration||0).toFixed(2)}s</div></div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 col-span-2"><div className="text-xs text-zinc-500">Sections</div><div className="text-zinc-200 text-xs truncate">{(analysis.sections||[]).map(s=>`${s.type}(${s.start}-${s.end})`).join(', ') || ' - '}</div></div>
                </div>
              )}
              {analysis && analysis.confidence < 0.45 && <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">BPM/beat confidence rendah - hasil deteksi bersifat perkiraan. Anda bisa menyesuaikan marker/offset secara manual.</div>}
            </Card>

            <div className="space-y-5">
              <Card className="p-5 sm:p-6 space-y-4">
                <div className="font-medium">Auto Sync Settings</div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1 sm:col-span-2"><label className="text-sm text-zinc-300">Preset</label>
                    <Select value={sync.preset} onChange={e=>applyPreset(e.target.value)}>
                      <option value="CLEAN">CLEAN BEAT</option>
                      <option value="CINEMATIC">CINEMATIC BEAT</option>
                      <option value="AMV">AMV BEAT</option>
                      <option value="HYPE">HYPE BEAT</option>
                      <option value="SOFT">SOFT BEAT</option>
                      <option value="SMART">SMART AI BEAT</option>
                    </Select>
                  </div>
                  <div className="space-y-1"><label className="text-sm text-zinc-300">Sync Mode</label>
                    <Select value={sync.syncMode} onChange={e=>{ setSync(s=>({...s,syncMode:e.target.value})); setSyncPlan(null); }}>
                      <option value="every_beat">Every Beat</option>
                      <option value="every_2">Every 2 Beats</option>
                      <option value="every_4">Every 4 Beats</option>
                      <option value="strong">Strong Beats</option>
                      <option value="music_sections">Music Sections</option>
                      <option value="smart">Smart Sync</option>
                    </Select>
                  </div>
                  <div className="space-y-1"><label className="text-sm text-zinc-300">Sync Intensity</label>
                    <Select value={sync.intensity} onChange={e=>{ setSync(s=>({...s,intensity:e.target.value})); setSyncPlan(null); }}>
                      <option value="subtle">Subtle</option>
                      <option value="balanced">Balanced</option>
                      <option value="dynamic">Dynamic</option>
                      <option value="aggressive">Aggressive</option>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2"><label className="text-sm text-zinc-300">Beat Offset (detik)</label><Input type="number" step="0.05" value={sync.offset} onChange={e=>setSync(s=>({...s,offset:Number(e.target.value||0)}))} /></div>
                  <div className="space-y-1"><label className="text-sm text-zinc-300">Min Segment (s)</label><Input type="number" step="0.1" min={0.5} value={sync.minSegment} onChange={e=>{ setSync(s=>({...s,minSegment:Math.max(0.5,Number(e.target.value||1))})); setSyncPlan(null); }} /></div>
                  <div className="space-y-1"><label className="text-sm text-zinc-300">Audio Mode (Apply)</label>
                    <Select value={mode} onChange={e=>setMode(e.target.value)}>
                      <option value="mix">Mix</option>
                      <option value="replace">Replace</option>
                      <option value="music">Music Only</option>
                    </Select>
                  </div>
                  <div className="space-y-1"><label className="text-sm text-zinc-300">Vol Musik</label><Input type="number" min={0} max={2} step="0.1" value={musicVolume} onChange={e=>setMusicVolume(e.target.value)} /></div>
                  <div className="space-y-1"><label className="text-sm text-zinc-300">Vol Asli</label><Input type="number" min={0} max={2} step="0.1" value={originalVolume} onChange={e=>setOriginalVolume(e.target.value)} disabled={mode!=="mix"} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[['beatCut','Beat Cut'],['beatTransition','Beat Transition'],['beatZoom','Beat Zoom'],['beatImpact','Beat Impact']].map(([k,l])=> (
                    <label key={k} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 cursor-pointer"><input type="checkbox" checked={(sync as any)[k]} onChange={e=>{ setSync(s=>({...s,[k]:e.target.checked} as any)); setSyncPlan(null); }} /> {l}</label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={autoSync} disabled={!analysis}><Wand2 size={16}/> Auto Sync (Plan)</Button>
                  <Button variant="secondary" onClick={()=>{ if(audioPreviewRef.current){ if(playing) audioPreviewRef.current.pause(); else audioPreviewRef.current.play().catch(()=>{}); } }} disabled={!audioPreviewUrl}>{playing ? <Pause size={16}/> : <Play size={16}/>} Preview Audio</Button>
                  <Button onClick={applyAutoBeat} disabled={!analysis || !video || applyBusy || (!beatAudioFile && !beatAudioAssetId)}>{applyBusy ? <Loader2 size={16} className="animate-spin"/> : <Activity size={16}/>} Apply & Render</Button>
                </div>
                <div className="text-xs text-zinc-500">Auto Sync membuat rencana cut/transisi berbasis beat. Apply & Render menghasilkan video baru dengan musik & sinkronisasi beat (FFmpeg). Undo/Redo tersedia untuk marker.</div>
              </Card>

              <Card className="p-5 sm:p-6 space-y-3">
                <div className="flex items-center justify-between"><div className="font-medium">Beat Markers</div><div className="text-xs text-zinc-500">{markers.length} marker</div></div>
                <div className="max-h-48 overflow-auto space-y-1 pr-1">
                  {markers.length ? markers.sort((a,b)=>a.t-b.t).map(m => (
                    <div key={m.id} className="flex items-center gap-2 text-xs rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
                      <span className={`w-2 h-2 rounded-full ${m.strong ? 'bg-cyan-300' : 'bg-violet-400'}`}></span>
                      <span className="w-16 text-zinc-300">{m.t.toFixed(2)}s</span>
                      <button className="text-zinc-400 hover:text-white" onClick={()=>{ pushHistory(markers.map(x=>x.id===m.id?{...x,strong:!x.strong}:x)); setSyncPlan(null); }} title="Toggle strong">Strong</button>
                      <button className="text-zinc-400 hover:text-white" onClick={()=>{ pushHistory(markers.map(x=>x.id===m.id?{...x,locked:!x.locked}:x)); }} title="Lock">{m.locked ? <Lock size={12}/> : <Unlock size={12}/>}</button>
                      <button className="ml-auto text-red-300 hover:text-red-200" onClick={()=>{ if(m.locked) return; pushHistory(markers.filter(x=>x.id!==m.id)); setSyncPlan(null); }} disabled={m.locked}><Trash2 size={12}/></button>
                    </div>
                  )) : <div className="text-xs text-zinc-500">Belum ada marker. Jalankan analisis atau klik waveform untuk menambah.</div>}
                </div>
                <div className="flex gap-2"><Button variant="secondary" onClick={()=>{ if(!analysis) return; const t = playhead; pushHistory([...markers,{id:uid(),t:+t.toFixed(3),manual:true,strong:false}].sort((a,b)=>a.t-b.t)); setSyncPlan(null); }} disabled={!analysis}><Plus size={14}/> Add Marker (Playhead)</Button></div>
              </Card>

              <Card className="p-5 sm:p-6 space-y-3">
                <div className="font-medium">Sync Plan / Hasil</div>
                {syncPlan && <div className="text-sm text-zinc-300 bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-1"><div>Preset: <span className="text-zinc-100">{syncPlan.preset}</span> | Mode: {syncPlan.syncMode} | Intensity: {syncPlan.intensity}</div><div>Cut points: {syncPlan.cuts?.length || 0} | Durasi musik: {Number(syncPlan.duration||0).toFixed(2)}s | Offset: {syncPlan.offset}s</div></div>}
                {applyBusy && <div className="flex items-center gap-2 text-sm text-violet-200"><Loader2 size={16} className="animate-spin"/> Merender Auto Beat...</div>}
                {applyResult?.fileUrl ? (
                  <div className="space-y-3">
                    <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10"><video key={applyResult.fileUrl} src={applyResult.fileUrl} controls className="w-full h-full object-contain" /></div>
                    <a href={applyResult.fileUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download Hasil Auto Beat</Button></a>
                    {applyResult.note && <div className="text-xs text-zinc-400">{applyResult.note}</div>}
                  </div>
                ) : !syncPlan && <div className="text-sm text-zinc-500">Belum ada plan. Jalankan Analyze Beat lalu Auto Sync / Apply.</div>}
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
