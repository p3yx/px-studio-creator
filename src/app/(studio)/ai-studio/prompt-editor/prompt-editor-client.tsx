"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Textarea, Select, Input, PageHeader, Badge } from "@/components/ui";
import { Wand2, Sparkles, ImagePlus, Film, Music2 } from "lucide-react";

type Created = { projectId: string; jobId: string } | null;

export default function AiVideoClient() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("Buat video cinematic dari foto-foto ini, transisi halus dan nuansa dramatis.");
  const [name, setName] = useState("AI Video dari Gambar");
  const [aspect, setAspect] = useState("9:16");
  const [seconds, setSeconds] = useState("3");
  const [music, setMusic] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created>(null);
  const [analysis, setAnalysis] = useState<any>(null);

  async function analyze() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/ai/prompt-understanding", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Gagal menganalisis prompt");
      const v = j.result || {};
      if (v.aspect) setAspect(v.aspect);
      if (v.suggestedName && !name.trim()) setName(v.suggestedName);
      setAnalysis({ ...v, note: "Interpretasi prompt berhasil. Anda tetap bisa mengubah pengaturan sebelum membuat video." });
    } catch (e: any) { setError(e.message || "Analisis gagal"); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!prompt.trim() && !files.length) { setError("Isi prompt atau pilih minimal satu foto/video."); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("prompt", prompt);
      fd.append("name", name);
      fd.append("aspect", aspect);
      fd.append("secondsPerImage", seconds);
      fd.append("music", music ? "1" : "0");
      for (const f of files) fd.append("files", f);
      const r = await fetch("/api/ai-video/create", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Gagal membuat video");
      setCreated({ projectId: j.projectId, jobId: j.jobId });
    } catch (e: any) { setError(e.message || "Gagal membuat video"); }
    finally { setBusy(false); }
  }

  const imageCount = files.filter(f => f.type.startsWith("image/")).length;
  const videoCount = files.filter(f => f.type.startsWith("video/")).length;

  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="Buat Video dari AI & Gambar" description="Tulis prompt, unggah foto atau video, lalu hasilkan video ke dalam Project Workspace. Judul dan deskripsi dibantu AI aktif." />
      {error && <Card className="p-4 border-red-500/20 bg-red-500/10 text-red-300 text-sm">{error}</Card>}

      <div className="grid xl:grid-cols-[1.2fr_.8fr] gap-6 lg:gap-8 items-start">
        <Card className="p-5 sm:p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Prompt / Cerita Video</label>
            <Textarea rows={6} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder='Contoh: "Foto liburan ke gunung, suasana pagi berkabut, transisi lembut, akhir epik."' />
            <div className="text-xs text-zinc-500">Prompt dipakai AI untuk judul & deskripsi, dan sebagai arahan gaya video.</div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Foto / Video</label>
            <label className="block rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center cursor-pointer hover:border-violet-400/40 transition">
              <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={e=>setFiles(Array.from(e.target.files || []))} />
              <ImagePlus size={20} className="mx-auto mb-2 text-violet-300" />
              <div className="text-sm text-zinc-200">{files.length ? `${files.length} file dipilih` : "Opsional — klik untuk pilih foto/video"}</div>
              <div className="text-xs text-zinc-500 mt-1">Bisa dikosongkan. Tanpa file → video dibuat dari prompt (motion typography + AI narration). Gambar → slideshow animasi; video → diproses masuk project.</div>
            </label>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, i) => <Badge key={i}>{f.type.startsWith("image/") ? <ImagePlus size={11} className="mr-1 inline" /> : <Film size={11} className="mr-1 inline" />}{f.name.slice(0, 28)}</Badge>)}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-sm text-zinc-300">Nama Project</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Rasio</label><Select value={aspect} onChange={e=>setAspect(e.target.value)}><option value="9:16">9:16 (Vertikal)</option><option value="16:9">16:9 (Horizontal)</option><option value="1:1">1:1 (Persegi)</option></Select></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Durasi per Gambar (detik)</label><Input type="number" min={1.5} max={10} step={0.5} value={seconds} onChange={e=>setSeconds(e.target.value)} /></div>
            <div className="flex items-end gap-2 pb-2">
              <input id="wm" type="checkbox" checked={music} onChange={e=>setMusic(e.target.checked)} className="accent-violet-500" />
              <label htmlFor="wm" className="text-sm text-zinc-300 flex items-center gap-1"><Music2 size={13} /> Tambah musik otomatis</label>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="secondary" className="flex-1" onClick={analyze} disabled={busy}><Sparkles size={16}/> {busy ? "Memproses..." : "Analisis Prompt"}</Button>
            <Button className="flex-1" onClick={create} disabled={busy}><Wand2 size={16}/> {busy ? "Membuat..." : "Buat Video"}</Button>
          </div>
        </Card>

        <Card className="p-5 sm:p-6 space-y-4">
          <div className="font-medium">Ringkasan</div>
          <div className="flex flex-wrap gap-2"><Badge>{aspect}</Badge><Badge>{imageCount} gambar</Badge><Badge>{videoCount} video</Badge><Badge>{music ? "Musik aktif" : "Tanpa musik"}</Badge></div>
          {analysis ? (
            <div className="space-y-2 text-sm">
              <div className="text-zinc-300">{analysis.note}</div>
              {analysis.preset && <div className="text-xs text-zinc-500">Gaya terdeteksi: <b>{analysis.preset}</b></div>}
              {Array.isArray(analysis.notes) && <ul className="list-disc pl-5 text-zinc-400 text-xs">{analysis.notes.map((n:string,i:number)=><li key={i}>{n}</li>)}</ul>}
            </div>
          ) : <div className="text-sm text-zinc-500">Klik <b>Analisis Prompt</b> untuk melihat interpretasi, lalu <b>Buat Video</b>.</div>}

          {created && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200 space-y-2">
              <div>Project & job berhasil dibuat. Video sedang dirender di background.</div>
              <Button className="w-full" onClick={()=>router.push(`/projects/${created.projectId}`)}>Buka Project</Button>
            </div>
          )}

          <div className="text-xs text-zinc-500 leading-relaxed border-t border-white/10 pt-3">
            Fungsi nyata: <b>tanpa file</b> → prompt jadi video motion-typography (judul + narasi AI, latar animatif, musik). <b>Dengan gambar</b> → slideshow zoom halus + musik. <b>Dengan video</b> → masuk project. Text-to-video sinematik penuh (adegan baru dari teks) belum tersedia di perangkat ini — tidak saya klaim.
          </div>
        </Card>
      </div>
    </div>
  );
}
