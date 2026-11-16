"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { Upload, Download, Film, Loader2, Eraser, Square, Brush, Trash2, Eye, Wand2, Crop, Droplets, Info, CheckCircle2, AlertTriangle } from "lucide-react";

type Rect = { x: number; y: number; w: number; h: number };
type Region = { id: string; type: "rect" | "mask"; rect?: Rect; startTime?: number | null; endTime?: number | null; maskData?: string | null };
type Mode = "rect" | "brush" | "eraser";

const METHODS = [
  { id: "ai_inpainting", label: "AI Inpainting" },
  { id: "smart_crop", label: "Smart Crop" },
  { id: "soft_blur", label: "Soft Blur" },
] as const;

function uid() { return Math.random().toString(36).slice(2, 9); }
function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

export default function WatermarkRemoverClient() {
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [method, setMethod] = useState<"ai_inpainting" | "smart_crop" | "soft_blur">("soft_blur");
  const [mode, setMode] = useState<Mode>("rect");
  const [regions, setRegions] = useState<Region[]>([]);
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<Rect | null>(null);
  const [brushSize, setBrushSize] = useState(18);
  const [blurStrength, setBlurStrength] = useState(12);
  const [delogoBand, setDelogoBand] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [job, setJob] = useState<any>(null);
  const [name, setName] = useState("Watermark Removed");
  const [methodsInfo, setMethodsInfo] = useState<any>(null);
  const [showAfter, setShowAfter] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPainting = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/tools/watermark-remover", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok) setMethodsInfo(j);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!video) { setVideoUrl(null); return; }
    const u = URL.createObjectURL(video);
    setVideoUrl(u);
    setResult(null); setJob(null); setShowAfter(false); setRegions([]); clearBrush();
    return () => URL.revokeObjectURL(u);
  }, [video]);

  useEffect(() => {
    // reset result view when config changes
    setResult(null); setJob(null); setShowAfter(false);
  }, [method, blurStrength, delogoBand]);

  function clearBrush() {
    const c = brushCanvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
  }

  function syncCanvasSize() {
    const ov = overlayRef.current; const c = brushCanvasRef.current;
    if (!ov || !c) return;
    const r = ov.getBoundingClientRect();
    if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) {
      // preserve drawing? for simplicity clear on resize
      c.width = Math.round(r.width); c.height = Math.round(r.height);
    }
  }

  useEffect(() => { syncCanvasSize(); window.addEventListener("resize", syncCanvasSize); return () => window.removeEventListener("resize", syncCanvasSize); }, [videoUrl]);

  function relPos(e: React.MouseEvent) {
    const el = overlayRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / Math.max(1, r.width)), y: clamp01((e.clientY - r.top) / Math.max(1, r.height)) };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!videoUrl) return;
    syncCanvasSize();
    if (mode === "rect") {
      const p = relPos(e); if (!p) return;
      setDrawing(p); setCurrent({ x: p.x, y: p.y, w: 0, h: 0 });
    } else if (mode === "brush" || mode === "eraser") {
      isPainting.current = true;
      paintAt(e);
    }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (mode === "rect" && drawing) {
      const p = relPos(e); if (!p) return;
      const x = Math.min(drawing.x, p.x), y = Math.min(drawing.y, p.y);
      const w = Math.abs(p.x - drawing.x), h = Math.abs(p.y - drawing.y);
      setCurrent({ x, y, w, h });
    } else if ((mode === "brush" || mode === "eraser") && isPainting.current) {
      paintAt(e);
    }
  }
  function onMouseUp() {
    if (mode === "rect" && current && current.w > 0.005 && current.h > 0.005) {
      setRegions(prev => [...prev, { id: uid(), type: "rect", rect: current }]);
    }
    if (mode === "brush" && isPainting.current) {
      // capture brush bounding area as a rect region approximation for ffmpeg methods
      captureBrushBounds();
    }
    setDrawing(null); setCurrent(null); isPainting.current = false;
  }
  function paintAt(e: React.MouseEvent) {
    const c = brushCanvasRef.current; const ov = overlayRef.current; if (!c || !ov) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const r = ov.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(239,68,68,0.45)";
    ctx.beginPath(); ctx.arc(x, y, brushSize, 0, Math.PI * 2); ctx.fill();
  }
  function captureBrushBounds() {
    const c = brushCanvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const a = img[(y * c.width + x) * 4 + 3];
        if (a > 10) { found = true; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
      }
    }
    if (!found) return;
    const pad = 4;
    const rect: Rect = { x: clamp01((minX - pad) / c.width), y: clamp01((minY - pad) / c.height), w: clamp01((maxX - minX + pad * 2) / c.width), h: clamp01((maxY - minY + pad * 2) / c.height) };
    // keep as an updated brush-mask region (single) plus store mask data
    const maskData = c.toDataURL("image/png");
    setRegions(prev => {
      const others = prev.filter(r => r.type !== "mask");
      return [...others, { id: prev.find(r=>r.type==="mask")?.id || uid(), type: "mask", rect, maskData }];
    });
  }

  const inpaintingStatus = methodsInfo?.inpainting;
  const inpaintingAvailable = !!inpaintingStatus?.configured;

  async function submit() {
    if (!video) { setError("Pilih file video terlebih dahulu."); return; }
    if (!regions.length) { setError("Pilih area watermark terlebih dahulu (rectangle/brush)."); return; }
    if (method === "ai_inpainting" && !inpaintingAvailable) { setError("AI Inpainting belum dikonfigurasi di server. Gunakan Smart Crop atau Soft Blur, atau konfigurasi backend inpainting."); return; }
    setBusy(true); setError(null); setResult(null); setJob(null); setShowAfter(false);
    try {
      const fd = new FormData();
      fd.append("video", video);
      fd.append("method", method);
      fd.append("regions", JSON.stringify(regions));
      fd.append("blurStrength", String(blurStrength));
      fd.append("delogoBand", String(delogoBand));
      fd.append("name", name);
      const res = await fetch("/api/tools/watermark-remover", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal memproses");
      if (j.async && j.projectId) {
        setJob({ projectId: j.projectId, progress: 0, stage: "Queued", status: "WAITING" });
        const projectId = j.projectId as string;
        let done = false;
        for (let i = 0; i < 1200; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const pr = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
          const pj = await pr.json().catch(() => ({}));
          if (!pr.ok) throw new Error(pj.error || "Gagal memuat status");
          const p = pj.project || {};
          const jb = (p.jobs && p.jobs[0]) || null;
          const st = String(jb?.status || p.status || "WAITING");
          const prog = Number(jb?.progress ?? 0) || 0;
          const stage = String(jb?.stage || st);
          setJob({ projectId, progress: prog, stage, status: st });
          if (st === "COMPLETED") {
            const fileUrl = p.outputUrl || (p.clips && p.clips[0] && p.clips[0].downloadUrl) || null;
            if (!fileUrl) throw new Error("Render selesai tetapi file hasil tidak ditemukan");
            setResult({ fileUrl, duration: p.outputDuration || null, fileSize: p.outputSize || null, width: p.outputWidth, height: p.outputHeight, method });
            done = true; break;
          }
          if (st === "FAILED") throw new Error(jb?.error || p.errorMessage || "Proses gagal");
        }
        if (!done) throw new Error("Render masih berjalan lama. Cek status di Projects.");
        return;
      }
      setResult(j);
    } catch (e: any) { setError(e.message || "Gagal memproses"); }
    finally { setBusy(false); }
  }

  const regionRects = regions.filter(r => r.rect).map(r => r.rect!) as Rect[];
  const methodDesc: Record<string, string> = {
    ai_inpainting: "Merekonstruksi area terpilih menggunakan backend/model inpainting (jika dikonfigurasi). Kualitas tergantung model & scene.",
    smart_crop: "Memotong frame agar area watermark keluar dari gambar. Dapat mengubah komposisi/rasio/ukuran.",
    soft_blur: "Menyamarkan area terpilih (FFmpeg delogo/interpolasi). Cepat untuk VPS tanpa GPU, hasil bervariasi.",
  };

  return (
    <div className="grid xl:grid-cols-[1.15fr_.85fr] gap-6 lg:gap-8 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">Editor & Area Selection</div>
            <div className="text-sm text-zinc-400">Pilih area watermark/logo/overlay milik Anda sendiri, lalu pratinjau dan render.</div>
          </div>
          <span className="text-[11px] px-2 py-1 rounded-lg border border-amber-400/20 bg-amber-400/10 text-amber-200">Gunakan bertanggung jawab</span>
        </div>

        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
        {busy && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-violet-200"><Loader2 size={16} className="animate-spin"/> Render diproses di background (worker)...</div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500 rounded-full" style={{width:`${Math.max(5, Math.min(100, job?.progress || 10))}%`}} /></div>
            <div className="text-xs text-zinc-300 flex flex-wrap gap-x-3 gap-y-1"><span>{job?.stage || 'Queued'}</span><span>{Math.max(0, Math.min(100, job?.progress || 0))}%</span></div>
            <div className="text-xs text-zinc-500">Hasil muncul otomatis saat selesai (tanpa status sukses palsu).</div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm text-zinc-300">1. Upload Video</label>
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-zinc-300"><Film size={16} className="text-violet-300"/> {video ? video.name : "Belum ada video dipilih"}</div>
            <Input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv" onChange={e => setVideo(e.target.files?.[0] || null)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between"><label className="text-sm text-zinc-300">2. Preview & Pilih Area (Manual)</label>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setMode("rect")} className={`h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 ${mode==='rect'?'bg-violet-500/20 border-violet-400/40 text-violet-100':'border-white/10 text-zinc-300 hover:bg-white/5'}`}><Square size={13}/> Rectangle</button>
              <button type="button" onClick={() => setMode("brush")} className={`h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 ${mode==='brush'?'bg-violet-500/20 border-violet-400/40 text-violet-100':'border-white/10 text-zinc-300 hover:bg-white/5'}`}><Brush size={13}/> Brush</button>
              <button type="button" onClick={() => setMode("eraser")} className={`h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 ${mode==='eraser'?'bg-violet-500/20 border-violet-400/40 text-violet-100':'border-white/10 text-zinc-300 hover:bg-white/5'}`}><Eraser size={13}/> Eraser</button>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
            <div className="relative aspect-video bg-black select-none" ref={overlayRef}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
              {videoUrl ? (
                <video ref={videoRef} src={videoUrl} controls className="w-full h-full object-contain" onLoadedMetadata={(e)=>{ const v=e.currentTarget; setDims({w:v.videoWidth,h:v.videoHeight}); syncCanvasSize(); }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-zinc-500">Upload video untuk preview & seleksi area</div>
              )}
              {videoUrl && (
                <>
                  <canvas ref={brushCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                  <div className="absolute inset-0 pointer-events-none">
                    {regionRects.map((r, i) => (
                      <div key={i} className="absolute border-2 border-red-400/90 bg-red-500/10" style={{ left: `${r.x*100}%`, top: `${r.y*100}%`, width: `${r.w*100}%`, height: `${r.h*100}%` }} />
                    ))}
                    {current && <div className="absolute border-2 border-emerald-400/90 bg-emerald-500/10" style={{ left: `${current.x*100}%`, top: `${current.y*100}%`, width: `${current.w*100}%`, height: `${current.h*100}%` }} />}
                  </div>
                </>
              )}
            </div>
            <div className="px-3 py-2 border-t border-white/10 flex flex-wrap items-center gap-2 justify-between">
              <div className="text-xs text-zinc-400">{regions.length} area dipilih {dims ? `• ${dims.w}x${dims.h}` : ""} • Mode: {mode === "rect" ? "Rectangle (drag)" : mode === "brush" ? "Brush (cat area)" : "Eraser"}</div>
              <div className="flex items-center gap-2">
                {(mode === "brush" || mode === "eraser") && <label className="text-xs text-zinc-400 flex items-center gap-1.5">Ukuran <input type="range" min={6} max={60} value={brushSize} onChange={e=>setBrushSize(Number(e.target.value))} /></label>}
                <Button variant="secondary" onClick={() => { setRegions([]); clearBrush(); }} className="h-8 px-2.5 text-xs"><Trash2 size={13}/> Reset Area</Button>
              </div>
            </div>
          </div>
          <div className="text-xs text-zinc-500">Gunakan <b>Rectangle</b> untuk seleksi manual presisi. <b>Brush/Eraser</b> membantu menandai area (mask visual) dan area batasnya disertakan untuk proses FFmpeg (Soft Blur/Smart Crop). Untuk overlay bergerak, pilih area yang mencakup pergerakan (tracking otomatis penuh memerlukan model yang dikonfigurasi).</div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm text-zinc-300">3. Metode Penghapusan</label>
            <div className="grid sm:grid-cols-3 gap-2">
              {METHODS.map(m => {
                const info = methodsInfo?.methods?.find((x:any)=>x.id===m.id);
                const disabled = m.id === "ai_inpainting" && !inpaintingAvailable;
                const active = method === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => setMethod(m.id as any)} className={`text-left rounded-xl border p-3 transition ${active ? 'bg-violet-500/15 border-violet-400/40' : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'} ${disabled ? 'opacity-80' : ''}`}>
                    <div className="flex items-center gap-2 text-sm font-medium">{m.id==='ai_inpainting'?<Wand2 size={15}/>:m.id==='smart_crop'?<Crop size={15}/>:<Droplets size={15}/>} {m.label}</div>
                    <div className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{methodDesc[m.id]}</div>
                    {m.id === 'ai_inpainting' && (
                      <div className={`mt-2 text-[11px] inline-flex items-center gap-1 ${inpaintingAvailable ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {inpaintingAvailable ? <CheckCircle2 size={12}/> : <AlertTriangle size={12}/>} {inpaintingAvailable ? 'Backend terkonfigurasi' : 'Belum dikonfigurasi'}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {method === 'ai_inpainting' && !inpaintingAvailable && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-200 text-sm px-4 py-3 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5"/><div><div className="font-medium">Status konfigurasi AI Inpainting</div><div className="text-amber-100/90 text-sm mt-0.5">{inpaintingStatus?.reason || 'Model/backend inpainting tidak tersedia. Konfigurasi server diperlukan (WATERMARK_INPAINT_CMD / WATERMARK_INPAINT_SCRIPT).'}</div><div className="text-xs text-amber-100/70 mt-1">Tidak ada simulasi AI. Pilih Smart Crop atau Soft Blur untuk memproses sekarang.</div></div></div>
            )}
            {method === 'ai_inpainting' && inpaintingAvailable && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 text-sm px-4 py-3 flex gap-2"><Info size={16} className="shrink-0 mt-0.5"/><div><div className="font-medium">Backend inpainting terdeteksi</div><div className="text-sm mt-0.5">{inpaintingStatus?.reason}</div></div></div>
            )}
          </div>

          {method === 'soft_blur' && (
            <>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Kekuatan Band (delogo)</label><input type="range" min={1} max={10} value={delogoBand} onChange={e=>setDelogoBand(Number(e.target.value))} className="w-full" /><div className="text-xs text-zinc-500">{delogoBand} (interpolasi tepi)</div></div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Intensitas Blur</label><input type="range" min={1} max={30} value={blurStrength} onChange={e=>setBlurStrength(Number(e.target.value))} className="w-full" /><div className="text-xs text-zinc-500">{blurStrength}</div></div>
            </>
          )}
          {method === 'smart_crop' && (
            <div className="sm:col-span-2 text-xs text-zinc-400 rounded-xl border border-white/10 bg-white/[0.02] p-3">Smart Crop akan menghitung area potong untuk mengeluarkan watermark dari frame berdasarkan seleksi. Resolusi/aspect dapat berubah; audio & durasi dipertahankan.</div>
          )}
          <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Nama Output</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button className="flex-1" onClick={submit} disabled={busy || !video || !regions.length || (method==='ai_inpainting' && !inpaintingAvailable)}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Wand2 size={16}/>} {busy ? "Memproses..." : "Apply / Render"}</Button>
          <Button variant="secondary" onClick={() => { setRegions([]); clearBrush(); setError(null); }} disabled={busy}><Trash2 size={16}/> Reset</Button>
        </div>
        <div className="text-xs text-zinc-500">Render berjalan di background (FFmpeg). Video asli tidak diubah; hasil disimpan sebagai file terpisah. Konfigurasi disimpan di project agar bisa di-render ulang. Hanya untuk konten/watermark milik sendiri atau yang Anda berizin menghapusnya.</div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="font-medium flex items-center justify-between">Preview & Hasil
          {result?.fileUrl && (
            <div className="flex items-center gap-1.5 text-xs">
              <button onClick={()=>setShowAfter(false)} className={`px-2 py-1 rounded-lg border ${!showAfter?'bg-white/10 border-white/20':'border-white/10 text-zinc-400'}`}>Original</button>
              <button onClick={()=>setShowAfter(true)} className={`px-2 py-1 rounded-lg border ${showAfter?'bg-emerald-500/20 border-emerald-400/30 text-emerald-100':'border-white/10 text-zinc-400'}`}>Processed</button>
            </div>
          )}
        </div>
        {busy ? <div className="py-10 text-center space-y-3"><Loader2 size={28} className="animate-spin mx-auto text-violet-400" /><div className="text-sm text-zinc-300">Memproses video...</div><div className="text-xs text-zinc-500">Jangan tutup halaman; status diperbarui otomatis.</div></div> : !result ? (
          <div className="space-y-3">
            <div className="aspect-video bg-black/40 rounded-xl border border-white/10 overflow-hidden flex items-center justify-center">
              {videoUrl ? <video src={videoUrl} controls className="w-full h-full object-contain" /> : <div className="text-sm text-zinc-500 px-6 text-center">Preview Before/After akan muncul di sini setelah render selesai.</div>}
            </div>
            <div className="text-xs text-zinc-500">Pilih area, metode, lalu klik <b>Apply / Render</b> untuk menghasilkan preview processed & file output.</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10">
              {showAfter ? (
                <video key={result.fileUrl} src={result.fileUrl} controls className="w-full h-full object-contain" />
              ) : (
                videoUrl ? <video src={videoUrl} controls className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-sm text-zinc-500">Original tidak tersedia</div>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-lg border ${!showAfter?'bg-white/10 border-white/20':'border-white/10 text-zinc-400'}`}>Original</span>
              <span className="text-zinc-600">→</span>
              <span className={`px-2 py-1 rounded-lg border ${showAfter?'bg-emerald-500/20 border-emerald-400/30 text-emerald-100':'border-white/10 text-zinc-400'}`}>Processed ({result.method})</span>
            </div>
            <div className="text-sm text-zinc-400 space-y-1">
              {result.duration != null && <div>Durasi: <span className="text-zinc-200">{Number(result.duration).toFixed(2)}s</span></div>}
              {result.width && result.height && <div>Resolusi: <span className="text-zinc-200">{result.width}x{result.height}</span></div>}
              {result.fileSize != null && <div>Ukuran: <span className="text-zinc-200">{(result.fileSize/1024/1024).toFixed(2)} MB</span></div>}
              <div className="text-xs text-zinc-500">Video asli tidak diubah; hasil adalah file terpisah.</div>
            </div>
            {result.fileUrl && <a href={result.fileUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download Hasil (MP4)</Button></a>}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-400 space-y-1.5">
          <div className="font-medium text-zinc-300 flex items-center gap-1.5"><Info size={13}/> Catatan metode & batasan</div>
          <ul className="list-disc pl-4 space-y-1">
            <li><b>AI Inpainting</b>: butuh backend/model terkonfigurasi di server; tanpa itu, status ditampilkan jelas dan render tidak disimulasikan.</li>
            <li><b>Smart Crop</b>: efektif jika watermark di tepi; dapat mengubah framing/rasio.</li>
            <li><b>Soft Blur</b>: interpolasi area (delogo) cocok untuk watermark statis/kecil; hasil bergantung kompleksitas background.</li>
            <li>Untuk overlay bergerak, pilih area yang mencakup lintasan gerak; tracking otomatis penuh memerlukan integrasi model pelacak.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
