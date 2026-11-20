"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { UploadCloud, Sparkles, Link2, Loader2 } from "lucide-react";

export default function CreateClient() {
  const router = useRouter();
  const [sourceMode, setSourceMode] = useState<"upload" | "youtube">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState("Best Moments");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("30");
  const [aspect, setAspect] = useState("9:16");
  const [quantity, setQuantity] = useState("3");
  const [style, setStyle] = useState("Cinematic Anime");
  const [removeWm, setRemoveWm] = useState(false);
  const [wmMethod, setWmMethod] = useState<"delogo" | "lama">("lama");
  const [wmRects, setWmRects] = useState([{ x: 70, y: 5, w: 25, h: 12 }]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [vidDuration, setVidDuration] = useState(0);
  const dragRef = useRef<{ mode: "move" | "se" | "new"; idx: number; startX: number; startY: number; start: { x: number; y: number; w: number; h: number } } | null>(null);
  const [audioMode, setAudioMode] = useState<"original" | "auto" | "replace" | "mix">("original");
  const [audioAssetId, setAudioAssetId] = useState("");
  const [audioItems, setAudioItems] = useState<any[]>([]);
  const [musicVolume, setMusicVolume] = useState(1);
  const [originalVolume, setOriginalVolume] = useState(0.35);
  useEffect(() => {
    fetch("/api/audio/library").then(r => r.json()).then(d => {
      if (Array.isArray(d?.items)) { setAudioItems(d.items); if (!audioAssetId && d.items[0]) setAudioAssetId(d.items[0].id); }
    }).catch(() => {});
  }, []);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  function onFileChange(f: File | null) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(f);
    setVideoUrl(f ? URL.createObjectURL(f) : null);
  }
  function clampRect(r: { x: number; y: number; w: number; h: number }) {
    const w = Math.max(1, Math.min(99, r.w));
    const h = Math.max(1, Math.min(99, r.h));
    return { x: Math.max(0, Math.min(100 - w, r.x)), y: Math.max(0, Math.min(100 - h, r.y)), w, h };
  }
  function updateField(idx: number, key: "x" | "y" | "w" | "h", val: string) {
    const n = Number(val);
    setWmRects(rs => rs.map((r, i) => i === idx ? clampRect({ ...r, [key]: Number.isFinite(n) ? n : r[key] }) : r));
  }
  function pctPos(e: React.PointerEvent) {
    const el = boxRef.current; if (!el) return null;
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null;
    return { x: ((e.clientX - b.left) / b.width) * 100, y: ((e.clientY - b.top) / b.height) * 100 };
  }
  function onBoxDown(e: React.PointerEvent, mode: "move" | "se" | "new", idx = 0) {
    const el = boxRef.current; if (!el) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    let start = { ...wmRects[idx] };
    if (mode === "new") {
      const p = pctPos(e); if (!p) return;
      if (wmRects.length >= 8) return;
      start = { x: Math.max(0, Math.min(98, p.x)), y: Math.max(0, Math.min(98, p.y)), w: 2, h: 2 };
      setWmRects(rs => [...rs, clampRect(start)]);
      idx = wmRects.length;
    }
    dragRef.current = { mode, idx, startX: e.clientX, startY: e.clientY, start };
  }
  function onBoxMove(e: React.PointerEvent) {
    const d = dragRef.current; const el = boxRef.current;
    if (!d || !el) return;
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
    const dx = ((e.clientX - d.startX) / b.width) * 100;
    const dy = ((e.clientY - d.startY) / b.height) * 100;
    const next = d.mode === "move" ? clampRect({ ...d.start, x: d.start.x + dx, y: d.start.y + dy })
      : d.mode === "se" ? clampRect({ ...d.start, w: d.start.w + dx, h: d.start.h + dy })
      : clampRect({ x: d.start.x, y: d.start.y, w: d.start.w + dx, h: d.start.h + dy });
    setWmRects(rs => rs.map((r, i) => i === d.idx ? next : r));
  }
  function onBoxUp() { dragRef.current = null; }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [info, setInfo] = useState<string|null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    const config: any = { duration: Number(duration), aspect, quantity: Number(quantity), mode, prompt, style, subtitle: true };
    if (removeWm) {
      const regions = wmRects.map(r => ({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h), blur: 0 }));
      config.removeWatermarks = regions;
      config.removeWatermark = regions[0];
      config.watermarkMethod = wmMethod;
    }
    if (audioMode !== "original") config.audioTrack = { mode: audioMode, audioAssetId, musicVolume: Number(musicVolume), originalVolume: Number(originalVolume) };

    try {
      if (sourceMode === "youtube") {
        const url = youtubeUrl.trim();
        if (!url) { setError("Masukkan link YouTube terlebih dahulu."); return; }
        setLoading(true); setInfo("Membuat project AutoClip dari YouTube. Video akan diunduh dan diproses di background...");
        const res = await fetch("/api/projects/create-from-youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, name: name || "YouTube AutoClip", config }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Gagal memulai AutoClip dari YouTube");
        setInfo("Project dibuat. Unduhan & analisis clip sedang diproses.");
        router.push(`/projects/${data.projectId}`);
        return;
      }

      if (!file) { setError("Pilih video sumber terlebih dahulu."); return; }
      setLoading(true); setInfo("Mengunggah video dan menyiapkan project...");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name || file.name.replace(/\.[^.]+$/, ""));
      fd.append("config", JSON.stringify(config));
      const res = await fetch("/api/projects/create-and-generate", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal memulai proses pembuatan clip");
      setInfo("Project dibuat. Proses analisis dan rendering sedang dipersiapkan.");
      router.push(`/projects/${data.projectId}`);
    } catch (err: any) { setError(err.message || "Gagal memproses"); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={onSubmit} className="grid xl:grid-cols-[1.15fr_.85fr] gap-6 lg:gap-8 items-start">
      <Card className="p-5 sm:p-6 lg:p-7 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-base">Sumber Video</div>
              <div className="text-sm text-zinc-400 mt-1">Unggah file video atau gunakan link YouTube untuk AutoClip.</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/10">
            <button type="button" onClick={()=>setSourceMode("upload")} className={`rounded-lg px-3 py-2 text-sm transition ${sourceMode==="upload" ? "bg-violet-600/30 text-violet-100 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200"}`}>Upload File</button>
            <button type="button" onClick={()=>setSourceMode("youtube")} className={`rounded-lg px-3 py-2 text-sm transition ${sourceMode==="youtube" ? "bg-violet-600/30 text-violet-100 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200"}`}>Link YouTube</button>
          </div>

          {sourceMode === "upload" ? (
            <label className="group block border border-dashed border-white/15 rounded-2xl p-8 sm:p-10 text-center hover:border-violet-400/40 hover:bg-white/[0.02] cursor-pointer transition-all duration-200">
              <input type="file" accept="video/mp4,video/x-matroska,video/quicktime,video/webm,.mkv" className="hidden" onChange={e=>onFileChange(e.target.files?.[0] || null)} />
              <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-300 grid place-items-center group-hover:scale-105 transition-transform"><UploadCloud size={22} /></div>
              <div className="font-medium text-base">{file ? file.name : "Pilih atau seret video ke sini"}</div>
              <div className="text-sm text-zinc-400 mt-2">Format yang didukung: MP4, MKV, MOV, WEBM</div>
              {file && <div className="inline-flex mt-4 text-xs text-zinc-300 bg-white/[0.04] border border-white/10 rounded-full px-3 py-1.5">Ukuran: {(file.size/1024/1024).toFixed(2)} MB</div>}
            </label>
          ) : (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-300"><Link2 size={16} className="text-violet-300"/> Link Video YouTube</div>
              <Input value={youtubeUrl} onChange={e=>setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=... atau https://youtu.be/..." />
              <div className="text-xs text-zinc-500 leading-relaxed">Server akan mengunduh video YouTube (membutuhkan <code>yt-dlp</code> terpasang di server) lalu otomatis menganalisis highlight dan merender clip. Pastikan Anda memiliki hak untuk menggunakan konten tersebut.</div>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 lg:gap-5">
          <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Nama Project</label><Input value={name} onChange={e=>setName(e.target.value)} placeholder={sourceMode === "youtube" ? "Contoh: AutoClip dari YouTube" : "Contoh: Project Clip Episode 1"} /></div>
          <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Mode Editing</label><Select value={mode} onChange={e=>setMode(e.target.value)}>
            {['Best Moments','Action','Emotional','Funny','Romance','Custom Prompt','Epic Moments','Fight Scenes','Dialogue Highlights','Dramatic Scenes'].map(m=> <option key={m}>{m}</option>)}
          </Select></div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">Instruksi Tambahan</label>
          <Textarea rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder='Contoh: "Pilih momen paling intens dan buat 3 clip berdurasi 30 detik."'/>
          <div className="text-xs text-zinc-500">Berikan arahan singkat agar hasil clip lebih sesuai dengan gaya yang Anda inginkan.</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium text-zinc-200">Pengaturan Render Lanjutan (Watermark &amp; Audio)</div>
              <div className="text-xs text-zinc-500 mt-0.5">Hapus watermark sumber dan/atau ganti audio klip dengan musik berlisensi dari Audio Library — diterapkan ke semua clip hasil AutoClip.</div>
            </div>
            <Select value={removeWm ? "on" : "off"} onChange={e=>setRemoveWm(e.target.value === "on")} className="min-w-[130px]">
              <option value="off">Nonaktif</option>
              <option value="on">Aktif</option>
            </Select>
          </div>
          {removeWm && (
            <>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Metode hapus watermark</label>
                <Select value={wmMethod} onChange={e => setWmMethod(e.target.value as "delogo" | "lama")}>
                  <option value="lama">AI LaMa — bersih tanpa blur (render jauh lebih lama)</option>
                  <option value="delogo">Delogo + Median — cepat, blur tipis masih mungkin</option>
                </Select>
                <div className="text-xs text-zinc-500">Geser kotak seleksi agar pas di atas watermark.</div>
              </div>
              {sourceMode === "upload" && videoUrl ? (
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Pratinjau &amp; Atur Area Watermark</label>
                  <div
                    ref={boxRef}
                    className="relative w-full aspect-video bg-black/60 rounded-xl overflow-hidden border border-white/10 select-none touch-none cursor-crosshair"
                    onPointerDown={e => onBoxDown(e, "new")}
                    onPointerMove={onBoxMove}
                    onPointerUp={onBoxUp}
                    onPointerLeave={onBoxUp}
                  >
                    <video ref={videoRef} src={videoUrl} className="absolute inset-0 w-full h-full object-contain pointer-events-none" muted playsInline onTimeUpdate={e=>setCurTime(e.currentTarget.currentTime)} onLoadedMetadata={e=>setVidDuration(e.currentTarget.duration || 0)} onEnded={()=>setPlaying(false)} />
                    {wmRects.map((r, i) => (
                      <div
                        key={i}
                        className="absolute border-2 border-violet-400/90 bg-violet-500/10 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                        style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
                        onPointerDown={e => { e.stopPropagation(); onBoxDown(e, "move", i); }}
                      >
                        <div className="absolute -top-6 left-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/80 text-white whitespace-nowrap pointer-events-none">Area {i + 1}</div>
                        <div className="absolute -right-1.5 -bottom-1.5 w-4 h-4 rounded-sm bg-white border border-violet-500 cursor-se-resize" onPointerDown={e => { e.stopPropagation(); onBoxDown(e, "se", i); }} title="Ubah ukuran" />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={()=>{ const v=videoRef.current; if(!v) return; if(v.paused){ v.play().then(()=>setPlaying(true)).catch(()=>{}); } else { v.pause(); setPlaying(false); } }} className="shrink-0 px-3 h-8 rounded-lg border border-white/10 bg-white/[0.05] hover:bg-white/[0.1] text-xs text-zinc-200">
                      {playing ? "❚❚ Jeda" : "▶ Putar"}
                    </button>
                    <input type="range" min={0} max={Math.max(0.1, vidDuration)} step={0.1} value={curTime} onChange={e=>{ const t=Number(e.target.value); setCurTime(t); if(videoRef.current) videoRef.current.currentTime=t; }} className="flex-1 min-w-0" />
                    <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">{curTime.toFixed(1)}s / {vidDuration.toFixed(1)}s</span>
                  </div>
                  <div className="text-xs text-zinc-500">Seret di area kosong preview untuk menambah kotak (maks. 8) · geser kotak untuk pindah · pegangan kanan-bawah untuk ubah ukuran. Nilai di bawah otomatis mengikuti (dalam % dari video sumber).</div>
                </div>
              ) : (
                <div className="text-xs text-amber-300">{sourceMode === "youtube" ? "Pratinjau tidak tersedia untuk sumber YouTube — isi X/Y/Lebar/Tinggi manual setelah video terunduh." : "Pilih file video di atas untuk melihat pratinjau dan menggeser kotak delogo."}</div>
              )}
              <div className="space-y-3">
                {wmRects.map((r, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-violet-300">Area Delogo {i + 1}</div>
                      <button type="button" onClick={()=>setWmRects(rs=>rs.filter((_, j)=>j!==i))} disabled={wmRects.length<=1} className="text-[11px] px-2 h-6 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-40 text-zinc-300">Hapus</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="space-y-1"><label className="text-[11px] text-zinc-500">X (%)</label><Input type="number" value={Math.round(r.x)} onChange={e=>updateField(i, "x", e.target.value)} /></div>
                      <div className="space-y-1"><label className="text-[11px] text-zinc-500">Y (%)</label><Input type="number" value={Math.round(r.y)} onChange={e=>updateField(i, "y", e.target.value)} /></div>
                      <div className="space-y-1"><label className="text-[11px] text-zinc-500">Lebar (%)</label><Input type="number" value={Math.round(r.w)} onChange={e=>updateField(i, "w", e.target.value)} /></div>
                      <div className="space-y-1"><label className="text-[11px] text-zinc-500">Tinggi (%)</label><Input type="number" value={Math.round(r.h)} onChange={e=>updateField(i, "h", e.target.value)} /></div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={()=>setWmRects(rs=>rs.length<8 ? [...rs, { x: 5, y: 5, w: 15, h: 8 }] : rs)} disabled={wmRects.length>=8} className="w-full h-9 rounded-xl border border-dashed border-violet-400/30 bg-violet-500/[0.04] hover:bg-violet-500/[0.1] text-xs text-violet-200 disabled:opacity-40">+ Tambah Area Delogo ({wmRects.length}/8)</button>
              </div>
            </>
          )}

          <div className="pt-3 border-t border-white/10 space-y-3">
            <div className="grid sm:grid-cols-[1fr_1.4fr] gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Audio Klip</label>
                <Select value={audioMode} onChange={e=>setAudioMode(e.target.value as any)}>
                  <option value="original">Audio asli dari klip (default)</option>
                  <option value="reprocess">Audio asli diproses ulang (bersih + normalize, tetap ada suara)</option>
                  <option value="auto">Musik otomatis + sedikit audio asli (tidak sunyi)</option>
                  <option value="replace">Ganti dengan musik dari Audio Library</option>
                  <option value="mix">Campur: musik + audio asli pelan</option>
                </Select>
              </div>
              {(audioMode === "replace" || audioMode === "mix") && (
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Musik (Audio Library)</label>
                  <Select value={audioAssetId} onChange={e=>setAudioAssetId(e.target.value)}>
                    {audioItems.length === 0 && <option value="">Belum ada musik di Audio Library</option>}
                    {audioItems.map((a:any)=>(<option key={a.id} value={a.id}>{a.name}{a.duration ? ` — ${Math.round(a.duration)}s` : ""}</option>))}
                  </Select>
                </div>
              )}
            </div>
            {audioMode !== "original" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><label className="text-xs text-zinc-400">Volume Musik (0-4)</label><Input type="number" min={0} max={4} step={0.1} value={musicVolume} onChange={e=>setMusicVolume(Number(e.target.value))} /></div>
                  {(audioMode === "mix" || audioMode === "auto") && <div className="space-y-1"><label className="text-xs text-zinc-400">Volume Audio Asli (0-4)</label><Input type="number" min={0} max={4} step={0.1} value={originalVolume} onChange={e=>setOriginalVolume(Number(e.target.value))} /></div>}
                </div>
                {audioMode === "reprocess" && <div className="text-xs text-cyan-300">Audio bawaan klip tetap dipakai, lalu diproses ulang: noise reduction ringan + loudness normalize + re-encode AAC. Tidak ada penggantian trek, jadi suara tidak hilang.</div>}
                {audioMode === "auto" && <div className="text-xs text-cyan-300">Musik sintesis lokal dipakai sebagai latar, dicampur dengan audio asli klip pada volume 0.35 agar suara tetap terdengar (tidak sunyi). Bisa diatur lewat slider volume musik/audio.</div>}
                {(audioMode === "replace" || audioMode === "mix") && audioItems.length === 0 && <div className="text-xs text-amber-300">Belum ada trek di Audio Library. Tambahkan lewat menu <b>Audio Extractor</b>, <b>Text to Speech</b>, atau pilih <b>Musik otomatis</b> agar tidak perlu ekstrak.</div>}
                <div className="text-xs text-zinc-500">Audio diganti/campur setelah render; video tidak di-encode ulang. Kalau trek tidak ditemukan, clip tetap memakai audio aslinya.</div>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-6 xl:sticky xl:top-24">
        <Card className="p-5 sm:p-6 lg:p-7 space-y-5">
          <div>
            <div className="font-medium text-base">Pengaturan Clip</div>
            <div className="text-sm text-zinc-400 mt-1">Atur durasi, rasio, jumlah clip, dan gaya editing sebelum memulai.</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-5">
            <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Durasi</label><Select value={duration} onChange={e=>setDuration(e.target.value)}><option value="15">15 detik</option><option value="30">30 detik</option><option value="45">45 detik</option><option value="60">60 detik</option></Select></div>
            <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Rasio Aspek</label><Select value={aspect} onChange={e=>setAspect(e.target.value)}><option value="9:16">9:16 (Vertikal)</option><option value="16:9">16:9 (Horizontal)</option><option value="1:1">1:1 (Persegi)</option></Select></div>
            <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Jumlah Clip</label><Select value={quantity} onChange={e=>setQuantity(e.target.value)}><option value="1">1 clip</option><option value="3">3 clip</option><option value="5">5 clip</option><option value="10">10 clip</option></Select></div>
            <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Gaya Editing</label><Select value={style} onChange={e=>setStyle(e.target.value)}><option>Cinematic Anime</option><option>Clean Edit</option><option>Fast-Paced</option><option>Social Media Edit</option><option>Minimalist</option></Select></div>
          </div>

          {loading && <div className="text-sm text-violet-200 bg-violet-500/10 border border-violet-500/20 rounded-xl px-3.5 py-3 flex items-center gap-2"><Loader2 size={16} className="animate-spin"/> {info || "Memproses..."}</div>}
          {!loading && info && <div className="text-sm text-cyan-200 bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-3.5 py-3">{info}</div>}
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-3">{error}</div>}

          <div className="pt-1 space-y-3">
            <Button disabled={loading || (sourceMode === "upload" ? !file : !youtubeUrl.trim())} className="w-full py-3 text-base" type="submit">{loading ? <Loader2 size={18} className="animate-spin"/> : <Sparkles size={18}/>} {loading ? "Memproses..." : (sourceMode === "youtube" ? "Mulai AutoClip dari YouTube" : "Buat Clip Otomatis")}</Button>
            <div className="text-xs text-zinc-500 leading-relaxed">{sourceMode === "youtube" ? "Video akan diunduh dari YouTube, dianalisis, dan diproses otomatis. Progres dapat dipantau di halaman project." : "Video akan dianalisis dan diproses sesuai pengaturan project. Anda dapat memantau progresnya di halaman project."}</div>
          </div>
        </Card>
      </div>
    </form>
  );
}
