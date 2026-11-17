"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Input, Select, Badge, PageHeader } from "@/components/ui";
import { Upload, Wand2, Play, Download, Trash2, ArrowUp, ArrowDown, Music, Film, RefreshCw, Sparkles, Loader2 } from "lucide-react";

type Asset = { id: string; kind: string; name: string; fileUrl?: string; duration?: number|null; width?: number|null; height?: number|null; order: number; trimStart?: number; trimEnd?: number|null; hasAudio?: boolean };
type SourceClip = { id: string; projectId: string; projectName: string; title: string; duration?: number; resolution?: string; fileUrl?: string; outputPath?: string };
type Plan = any;

export default function MontageClient() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<any>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [output, setOutput] = useState<any>(null);
  const [sources, setSources] = useState<SourceClip[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);

  const [name, setName] = useState("AI Montage Project");
  const [preset, setPreset] = useState("cinematic");
  const [aspect, setAspect] = useState("9:16");
  const [fps, setFps] = useState("30");
  const [editMode, setEditMode] = useState("auto");
  const [audioMode, setAudioMode] = useState("mix");
  const [quality, setQuality] = useState("medium");
  const [autoBeat, setAutoBeat] = useState(false);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  const videoAssets = useMemo(() => assets.filter(a => a.kind === "video").sort((a,b)=>a.order-b.order), [assets]);
  const musicAsset = useMemo(() => assets.find(a => a.kind === "music") || null, [assets]);

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadSources() {
    try { const d = await api("/api/montage/sources", { cache: "no-store" }); setSources(d.items || []); } catch {}
  }
  async function loadProject(id: string, opts?: { syncForm?: boolean }) {
    const d = await api(`/api/montage/${id}`, { cache: "no-store" });
    setProject(d.project); setAssets(d.assets || []); setJobs(d.jobs || []); setOutput(d.outputClip || null);
    const cfg = (() => { try { return JSON.parse(d.project?.configJson || "{}"); } catch { return {}; } })();
    if (cfg.plan) setPlan(cfg.plan);
    const syncForm = opts?.syncForm !== false;
    if (syncForm) {
      if (cfg.preset) setPreset(cfg.preset);
      if (cfg.aspect) setAspect(cfg.aspect);
      if (cfg.fps) setFps(String(cfg.fps));
      if (cfg.editMode) setEditMode(cfg.editMode);
      if (cfg.audioMode) setAudioMode(cfg.audioMode);
      if (cfg.quality) setQuality(cfg.quality);
      if (typeof cfg.autoBeat === "boolean") setAutoBeat(cfg.autoBeat);
      if (d.project?.name) setName(d.project.name);
    }
    return d;
  }

  useEffect(() => { loadSources(); }, []);
  useEffect(() => {
    if (!projectId) return;
    loadProject(projectId, { syncForm: true }).catch(()=>{});
    const t = setInterval(() => { loadProject(projectId, { syncForm: false }).catch(()=>{}); }, 3000);
    return () => clearInterval(t);
  }, [projectId]);

  async function ensureProject() {
    if (projectId) return projectId;
    setBusy("create");
    try {
      const d = await api("/api/montage/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, config: { preset, aspect, fps: Number(fps), editMode, audioMode, quality } }) });
      setProjectId(d.projectId); setProject(d.project);
      return d.projectId as string;
    } finally { setBusy(null); }
  }

  async function uploadAssets(kind: "video" | "music", files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null); setInfo(null);
    try {
      const id = await ensureProject();
      setBusy(kind === "music" ? "music" : "upload");
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      fd.append("kind", kind);
      await api(`/api/montage/${id}/assets`, { method: "POST", body: fd });
      setInfo(kind === "music" ? "Music uploaded." : `${files.length} clip(s) uploaded.`);
      await loadProject(id);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); if (videoInputRef.current) videoInputRef.current.value = ""; if (musicInputRef.current) musicInputRef.current.value = ""; }
  }

  async function addExistingSource(sourceClipId: string) {
    setError(null);
    try {
      const id = await ensureProject();
      setBusy("add-source");
      await api(`/api/montage/${id}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceClipId }) });
      await loadProject(id);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function removeAsset(assetId: string) {
    if (!projectId) return;
    try {
      await api(`/api/montage/${projectId}/assets?assetId=${assetId}`, { method: "DELETE" });
      await loadProject(projectId);
    } catch (e: any) { setError(e.message); }
  }

  async function moveAsset(assetId: string, dir: -1 | 1) {
    if (!projectId) return;
    const list = [...videoAssets];
    const idx = list.findIndex(a => a.id === assetId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    const reordered = list.map((a, i) => ({ ...a, order: i }));
    setAssets(prev => [...prev.filter(a=>a.kind!=="video"), ...reordered]);
    try {
      await api(`/api/montage/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { customOrder: reordered.map(a=>a.id) }, assets: reordered.map(a=>({ id:a.id, order:a.order })) }) });
    } catch {}
  }

  async function saveConfigAndPlan(doRender = false) {
    setError(null); setInfo(null);
    try {
      const id = await ensureProject();
      setBusy(doRender ? "render" : "plan");
      const config = { preset, aspect, fps: Number(fps), editMode, audioMode, quality, autoBeat, customOrder: videoAssets.map(a=>a.id) };
      await api(`/api/montage/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, config }) });
      const d = await api(`/api/montage/${id}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
      setPlan(d.plan);
      setInfo(doRender ? "Rencana editing dibuat. Proses render sedang dipersiapkan..." : "Rencana editing berhasil dibuat.");
      if (doRender) {
        await api(`/api/montage/${id}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...config, plan: d.plan }, plan: d.plan }) });
        setInfo("Render montage sedang diproses. Pantau progres di bawah.");
      }
      await loadProject(id);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const activeJob = jobs?.[0] || null;

  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="AI Montage Maker"
        description="Gabungkan beberapa clip, atur urutan, dan hasilkan video montage dengan transisi serta pengaturan audio yang sesuai."
        actions={<Button onClick={() => saveConfigAndPlan(true)} disabled={busy !== null || videoAssets.length < 1}><Sparkles size={16}/> {busy === 'render' ? 'Menyiapkan...' : 'Buat & Render Montage'}</Button>}
      />

      {error && <Card className="p-4 border-red-500/20 bg-red-500/10 text-red-300 text-sm">{error}</Card>}
      {info && <Card className="p-4 border-cyan-500/20 bg-cyan-500/10 text-cyan-200 text-sm">{info}</Card>}
      {busy && <Card className="p-4 border-violet-500/20 bg-violet-500/10 text-violet-200 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin"/> {busy === "render" ? "Menyiapkan & memproses render montage..." : busy === "plan" ? "Menyusun rencana editing..." : busy === "upload" ? "Mengunggah clip..." : busy === "music" ? "Mengunggah musik..." : "Memproses..."}</Card>}

      <div className="grid xl:grid-cols-[1.2fr_.8fr] gap-6 lg:gap-8 items-start">
        <div className="space-y-6 min-w-0">
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3"><div className="font-medium">1. Pilih / Upload Clip</div><Badge>{videoAssets.length} video</Badge></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm text-zinc-300">Upload beberapa video</label>
                <input ref={videoInputRef} type="file" multiple accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv" className="hidden" onChange={e=>uploadAssets("video", e.target.files)} />
                <Button variant="secondary" className="w-full" onClick={()=>videoInputRef.current?.click()} disabled={busy!==null}><Upload size={16}/> Upload Clips</Button>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-zinc-300">Upload musik (opsional)</label>
                <input ref={musicInputRef} type="file" accept="audio/*,video/mp4,video/webm" className="hidden" onChange={e=>uploadAssets("music", e.target.files)} />
                <Button variant="secondary" className="w-full" onClick={()=>musicInputRef.current?.click()} disabled={busy!==null}><Music size={16}/> {musicAsset ? 'Ganti Musik' : 'Upload Musik'}</Button>
              </div>
            </div>
            {musicAsset && <div className="text-sm text-zinc-300 bg-white/[0.03] border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3 min-w-0"><span className="truncate min-w-0 flex-1"><Music size={14} className="inline mr-2 text-violet-300"/>{musicAsset.name}</span><Button variant="ghost" className="shrink-0" onClick={()=>removeAsset(musicAsset.id)}>Hapus</Button></div>}

            <div className="space-y-2">
              <div className="text-sm font-medium text-zinc-300">Pilih dari clip hasil project sebelumnya</div>
              <div className="max-h-56 overflow-auto space-y-2 pr-1">
                {sources.length === 0 ? <div className="text-sm text-zinc-500">Belum ada clip yang tersedia dari project lain.</div> : sources.map(s => (
                                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 min-w-0">
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{s.title}</div><div className="text-xs text-zinc-500 truncate">{s.projectName} · {s.resolution || '-'} · {s.duration ? `${Math.round(s.duration)}s` : '-'}</div></div>
                    <Button variant="secondary" className="shrink-0" onClick={()=>addExistingSource(s.id)} disabled={busy!==null}>Tambah</Button>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3"><div className="font-medium">2. Urutan Clip & Trim</div><div className="text-xs text-zinc-500">Atur urutan (naik/turun) dan trim awal/akhir</div></div>
            {videoAssets.length === 0 ? <div className="text-sm text-zinc-500">Tambahkan clip untuk mulai menyusun montage.</div> : (
              <div className="space-y-3">
                {videoAssets.map((a, idx) => (
                  <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 flex items-center gap-3"><div className="h-9 w-9 shrink-0 rounded-lg bg-violet-500/15 text-violet-300 grid place-items-center text-sm font-medium">{idx+1}</div><div className="min-w-0 flex-1"><div className="font-medium truncate">{a.name}</div><div className="text-xs text-zinc-500 truncate">{a.duration ? `${a.duration.toFixed(1)}s` : 'durasi ?'} · {a.width&&a.height ? `${a.width}x${a.height}` : 'res ?'} · {a.hasAudio ? 'audio' : 'no audio'}</div></div></div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="ghost" onClick={()=>moveAsset(a.id,-1)} disabled={idx===0}><ArrowUp size={15}/></Button>
                        <Button variant="ghost" onClick={()=>moveAsset(a.id,1)} disabled={idx===videoAssets.length-1}><ArrowDown size={15}/></Button>
                        <Button variant="ghost" onClick={()=>removeAsset(a.id)}><Trash2 size={15}/></Button>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1"><label className="text-xs text-zinc-400">Trim Start (s)</label><Input type="number" min={0} step="0.1" value={String(a.trimStart ?? 0)} onChange={e=>{
                        const v = Math.max(0, Number(e.target.value||0));
                        setAssets(prev => prev.map(x=>x.id===a.id?{...x, trimStart:v}:x));
                      }} onBlur={async ()=>{ if(projectId) await api(`/api/montage/${projectId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({assets:[{id:a.id, trimStart:a.trimStart||0}]})}).catch(()=>{}); }} /></div>
                      <div className="space-y-1"><label className="text-xs text-zinc-400">Trim End (s)</label><Input type="number" min={0} step="0.1" value={String(a.trimEnd ?? a.duration ?? 0)} onChange={e=>{
                        const v = Math.max(0, Number(e.target.value||0));
                        setAssets(prev => prev.map(x=>x.id===a.id?{...x, trimEnd:v}:x));
                      }} onBlur={async ()=>{ if(projectId) await api(`/api/montage/${projectId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({assets:[{id:a.id, trimEnd:a.trimEnd ?? null}]})}).catch(()=>{}); }} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {plan && <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3"><div className="font-medium">AI Editing Plan</div><Badge>{plan.preset}</Badge></div>
            <div className="text-sm text-zinc-400">Segmen: {plan.clips?.length || 0} · Aspect: {plan.aspect} · FPS: {plan.fps} · Musik: {plan.music ? plan.music.mode : 'tidak ada'}</div>
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {(plan.clips||[]).map((c:any,i:number)=>(
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm flex flex-wrap items-center justify-between gap-2">
                  <div className="text-zinc-200">#{i+1} · {c.start?.toFixed?.(2)}s - {c.end?.toFixed?.(2)}s</div>
                  <div className="text-zinc-400">transition: {c.transition} ({c.transitionDuration || 0}s)</div>
                </div>
              ))}
            </div>
            {Array.isArray(plan.notes) && plan.notes.length > 0 && <div className="text-xs text-zinc-500 space-y-1">{plan.notes.map((n:string,i:number)=><div key={i}>• {n}</div>)}</div>}
          </Card>}
        </div>

        <div className="space-y-6 min-w-0">
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="font-medium">3. Gaya & Pengaturan</div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Nama Project</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><label className="text-sm text-zinc-300">Preset</label><Select value={preset} onChange={e=>setPreset(e.target.value)}><option value="cinematic">CINEMATIC</option><option value="amv">AMV STYLE</option><option value="hype">HYPE / EPIC</option><option value="emotional">EMOTIONAL</option><option value="clean">CLEAN EDIT</option><option value="story">STORY MODE</option></Select></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Mode</label><Select value={editMode} onChange={e=>setEditMode(e.target.value)}><option value="auto">AUTO EDIT</option><option value="custom">CUSTOM EDIT</option></Select></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Aspect Ratio</label><Select value={aspect} onChange={e=>setAspect(e.target.value)}><option value="9:16">9:16 Vertical</option><option value="16:9">16:9 Landscape</option><option value="1:1">1:1 Square</option></Select></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">FPS</label><Select value={fps} onChange={e=>setFps(e.target.value)}><option value="24">24 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></Select></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Audio Mode</label><Select value={audioMode} onChange={e=>setAudioMode(e.target.value)}><option value="mix">Mixed Audio</option><option value="music">Music Only</option><option value="original">Original Audio</option><option value="mute-original">Mute Original Audio</option></Select></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Quality</label><Select value={quality} onChange={e=>setQuality(e.target.value)}><option value="fast">Fast</option><option value="medium">Medium</option><option value="high">High</option></Select></div>
              <div className="space-y-2 col-span-2"><label className="text-sm text-zinc-300">Auto Beat Sync</label><Select value={autoBeat ? "on" : "off"} onChange={e=>setAutoBeat(e.target.value === "on")}><option value="off">Off (Pacing default)</option><option value="on">On (Sinkron energi/beat musik/audio)</option></Select><div className="text-xs text-zinc-500">Analisis energi audio (FFmpeg) untuk membantu penyesuaian durasi/transisi agar lebih selaras dengan musik.</div></div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Button variant="secondary" onClick={()=>saveConfigAndPlan(false)} disabled={busy!==null || videoAssets.length < 1}><Wand2 size={16}/> {busy==='plan' ? 'Menyusun rencana...' : 'Buat Rencana Editing'}</Button>
              <Button onClick={()=>saveConfigAndPlan(true)} disabled={busy!==null || videoAssets.length < 1}><Sparkles size={16}/> {busy==='render' ? 'Menyiapkan...' : 'Render Montage'}</Button>
              <div className="text-xs text-zinc-500">Video akan diproses otomatis dan diekspor sebagai file MP4.</div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3"><div className="font-medium">Status & Hasil</div>{projectId && <Button variant="ghost" onClick={()=>loadProject(projectId, { syncForm: true })}><RefreshCw size={14}/></Button>}</div>
            {!projectId ? <div className="text-sm text-zinc-500">Tambahkan clip untuk membuat project montage Anda.</div> : (
              <div className="space-y-3">
                <div className="text-sm text-zinc-300">Project: <span className="text-white">{project?.name || name}</span></div>
                {activeJob && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm"><span>{activeJob.stage || activeJob.status}</span><span>{activeJob.progress || 0}%</span></div>
                    <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500" style={{width:`${activeJob.progress||0}%`}}/></div>
                    {activeJob.error && <div className="text-xs text-red-300">{activeJob.error}</div>}
                  </div>
                )}
                {output?.downloadUrl ? (
                  <div className="space-y-3">
                    <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10">
                      <video src={output.downloadUrl} controls className="w-full h-full object-contain" preload="metadata" />
                    </div>
                    <div className="text-sm text-zinc-400">Durasi: {output.duration?.toFixed?.(1) || '-'}s · {output.resolution || '-'} · {output.fileSize ? `${(output.fileSize/1024/1024).toFixed(2)} MB` : ''}</div>
                    <a href={output.downloadUrl} download className="inline-flex w-full"><Button className="w-full"><Download size={16}/> Download MP4</Button></a>
                  </div>
                ) : <div className="text-sm text-zinc-500">Belum ada hasil render. Klik "Buat & Render Montage" untuk menghasilkan video final.</div>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
