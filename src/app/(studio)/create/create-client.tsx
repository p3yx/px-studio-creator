"use client";
import { useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [info, setInfo] = useState<string|null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    const config = { duration: Number(duration), aspect, quantity: Number(quantity), mode, prompt, style, subtitle: true };

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
              <input type="file" accept="video/mp4,video/x-matroska,video/quicktime,video/webm,.mkv" className="hidden" onChange={e=>setFile(e.target.files?.[0] || null)} />
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
