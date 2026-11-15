"use client";
import { useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { Upload, Captions, Download, Film, Loader2, FileText } from "lucide-react";

export default function AutoCaptionClient() {
  const [video, setVideo] = useState<File | null>(null);
  const [language, setLanguage] = useState("auto");
  const [name, setName] = useState("Video Caption");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function submit() {
    if (!video) { setError("Pilih file video terlebih dahulu."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("video", video);
      fd.append("language", language);
      fd.append("name", name);
      const res = await fetch("/api/tools/auto-caption", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal membuat auto caption");
      setResult(j);
    } catch (e: any) {
      setError(e.message || "Gagal membuat auto caption");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-8 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
        {busy && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-violet-200"><Loader2 size={16} className="animate-spin"/> Membuat caption & memproses video...</div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full w-1/2 bg-gradient-to-r from-violet-500 to-cyan-400 animate-pulse rounded-full" /></div>
            <div className="text-xs text-zinc-400">Proses meliputi transkripsi (AI/fallback) dan burn-in subtitle ke video. Mohon tunggu.</div>
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
          <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Bahasa Caption</label>
            <Select value={language} onChange={e=>setLanguage(e.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="id">Indonesia (id)</option>
              <option value="en">English (en)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="ko">Korean (ko)</option>
              <option value="zh">Chinese (zh)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="ar">Arabic (ar)</option>
              <option value="hi">Hindi (hi)</option>
              <option value="pt">Portuguese (pt)</option>
              <option value="ru">Russian (ru)</option>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Nama Output</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
        </div>

        <Button className="w-full" onClick={submit} disabled={busy || !video}>
          {busy ? <Loader2 size={16} className="animate-spin"/> : <Captions size={16}/>} {busy ? "Memproses..." : "Generate Auto Caption & Burn-in"}
        </Button>
        <div className="text-xs text-zinc-500">Sistem akan membuat transkrip (AI, dengan fallback jika gagal), menghasilkan file SRT, dan memasukkan caption ke video (burn-in). Hasil bergantung pada kejernihan audio dan dukungan model/bahasa.</div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="font-medium">Hasil</div>
        {busy ? (
          <div className="py-10 text-center space-y-3">
            <Loader2 size={28} className="animate-spin mx-auto text-violet-400" />
            <div className="text-sm text-zinc-300">Sedang memproses caption...</div>
          </div>
        ) : !result ? <div className="text-sm text-zinc-500 py-8 text-center">Belum ada hasil. Unggah video lalu klik generate.</div> : (
          <div className="space-y-4">
            {result.videoUrl ? (
              <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10">
                <video key={result.videoUrl} src={result.videoUrl} controls className="w-full h-full object-contain" />
              </div>
            ) : <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">Video ber-caption tidak tersedia, tetapi file SRT mungkin berhasil dibuat.</div>}
            <div className="text-sm text-zinc-400 space-y-1">
              {result.duration != null && <div>Durasi: <span className="text-zinc-200">{Number(result.duration).toFixed(2)}s</span></div>}
              {result.fileSize != null && <div>Ukuran video: <span className="text-zinc-200">{(result.fileSize/1024/1024).toFixed(2)} MB</span></div>}
              {result.note && <div className="text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 break-words">{result.note}</div>}
              {result.text ? <div className="text-xs text-zinc-500 line-clamp-4">Teks terdeteksi: <span className="text-zinc-300">{result.text}</span></div> : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {result.videoUrl && <a href={result.videoUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download Video</Button></a>}
              {result.srtUrl && <a href={result.srtUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><FileText size={16}/> Download SRT</Button></a>}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
