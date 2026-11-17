"use client";
import { useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { Upload, Download, Film, Loader2, Scaling } from "lucide-react";

export default function ConvertResizeClient() {
  const [video, setVideo] = useState<File | null>(null);
  const [aspect, setAspect] = useState("9:16");
  const [fit, setFit] = useState("crop");
  const [quality, setQuality] = useState("medium");
  const [keepAudio, setKeepAudio] = useState(true);
  const [name, setName] = useState("Converted Video");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [job, setJob] = useState<any>(null);

  async function submit() {
    if (!video) { setError("Pilih file video terlebih dahulu."); return; }
    setBusy(true); setError(null); setResult(null); setJob(null);
    try {
      const fd = new FormData();
      fd.append("video", video);
      fd.append("aspect", aspect);
      fd.append("fit", fit);
      fd.append("quality", quality);
      fd.append("keepAudio", keepAudio ? "true" : "false");
      fd.append("name", name);
      const res = await fetch("/api/tools/convert-resize", { method: "POST", body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || "Gagal memproses video");
      if (j.async && j.projectId) {
        setJob({ projectId: j.projectId, progress: 0, stage: "Queued", status: "WAITING" });
        const projectId = j.projectId as string;
        let done = false;
        for (let i=0;i<900;i++) {
          await new Promise(r=>setTimeout(r,2000));
          const pr = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
          const pj = await pr.json().catch(()=>({}));
          if (!pr.ok) throw new Error(pj.error || "Gagal memuat status render");
          const p = pj.project || {};
          const jb = (p.jobs && p.jobs[0]) || null;
          const st = String(jb?.status || p.status || "WAITING");
          const prog = Number(jb?.progress ?? 0) || 0;
          const stage = String(jb?.stage || st);
          setJob({ projectId, progress: prog, stage, status: st });
          if (st === "COMPLETED") {
            const fileUrl = p.outputUrl || (p.clips && p.clips[0] && p.clips[0].downloadUrl) || null;
            if (!fileUrl) throw new Error("Render selesai tetapi file hasil tidak ditemukan");
            setResult({ fileUrl, duration: p.outputDuration || null, fileSize: p.outputSize || null, width: p.outputWidth, height: p.outputHeight });
            done = true; break;
          }
          if (st === "FAILED") throw new Error(jb?.error || p.errorMessage || "Gagal convert/resize");
        }
        if (!done) throw new Error("Render masih berjalan terlalu lama. Cek status di Projects.");
        return;
      }
      setResult(j);
    } catch (e: any) { setError(e.message || "Gagal memproses video"); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-8 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
        {busy && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-violet-200"><Loader2 size={16} className="animate-spin"/> {job ? 'Render diproses di background (worker)...' : 'Menyiapkan render...'}</div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500 rounded-full" style={{width:`${Math.max(5, Math.min(100, job?.progress || 10))}%`}} /></div>
            <div className="text-xs text-zinc-300 flex flex-wrap gap-x-3 gap-y-1"><span>{job?.stage || 'Queued'}</span><span>{Math.max(0, Math.min(100, job?.progress || 0))}%</span></div>
            <div className="text-xs text-zinc-500">Hasil akan muncul otomatis saat selesai.</div>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm text-zinc-300">1. Upload Video</label>
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-zinc-300"><Film size={16} className="text-violet-300"/> {video ? video.name : "Belum ada video dipilih"}</div>
            <Input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv" onChange={e => setVideo(e.target.files?.[0] || null)} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><label className="text-sm text-zinc-300">Rasio Aspek</label>
            <Select value={aspect} onChange={e=>setAspect(e.target.value)}>
              <option value="9:16">9:16 (Vertical)</option>
              <option value="16:9">16:9 (Landscape)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="original">Original (normalisasi)</option>
            </Select>
          </div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Mode Fit</label>
            <Select value={fit} onChange={e=>setFit(e.target.value)}>
              <option value="crop">Crop (isi penuh)</option>
              <option value="pad">Pad (tanpa crop, letterbox)</option>
            </Select>
          </div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Kualitas</label>
            <Select value={quality} onChange={e=>setQuality(e.target.value)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="fast">Fast</option>
            </Select>
          </div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Audio</label>
            <Select value={keepAudio ? "yes" : "no"} onChange={e=>setKeepAudio(e.target.value === "yes")}>
              <option value="yes">Pertahankan (loudness normalized)</option>
              <option value="no">Hapus audio</option>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Nama Output</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
        </div>
        <Button className="w-full" onClick={submit} disabled={busy || !video}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Scaling size={16}/>} {busy ? "Memproses..." : "Convert & Resize"}</Button>
        <div className="text-xs text-zinc-500">Render berjalan di background (worker) via FFmpeg dengan loudness normalization. Hasil juga tersimpan di Projects.</div>
      </Card>
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="font-medium">Hasil</div>
        {busy ? <div className="py-10 text-center space-y-3"><Loader2 size={28} className="animate-spin mx-auto text-violet-400" /><div className="text-sm text-zinc-300">Sedang memproses...</div></div> : !result ? <div className="text-sm text-zinc-500 py-8 text-center">Belum ada hasil.</div> : (
          <div className="space-y-4">
            <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10">{result.fileUrl && <video key={result.fileUrl} src={result.fileUrl} controls className="w-full h-full object-contain" />}</div>
            <div className="text-sm text-zinc-400 space-y-1">
              {result.duration != null && <div>Durasi: <span className="text-zinc-200">{Number(result.duration).toFixed(2)}s</span></div>}
              {result.width && result.height && <div>Resolusi: <span className="text-zinc-200">{result.width}x{result.height}</span></div>}
              {result.fileSize != null && <div>Ukuran: <span className="text-zinc-200">{(result.fileSize/1024/1024).toFixed(2)} MB</span></div>}
            </div>
            {result.fileUrl && <a href={result.fileUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download MP4</Button></a>}
          </div>
        )}
      </Card>
    </div>
  );
}
