"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Textarea, Select, Input, PageHeader, Badge } from "@/components/ui";
import { Wand2, Sparkles, ImagePlus, Film, Music2 } from "lucide-react";

type Created = { projectId: string; jobId: string } | null;

export default function AiVideoClient() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("Buat video cinematic dari foto-foto ini, transisi halus dan nuansa dramatis.");
  const [name, setName] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [seconds, setSeconds] = useState("3");
  const [music, setMusic] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [tab, setTab] = useState<"video" | "image">("video");
  const [imagePrompt, setImagePrompt] = useState("Ilustrasi anime cinematic, seorang petarung berdiri di atas bukit saat matahari terbenam, detail tinggi.");
  const [imageAspect, setImageAspect] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageResult, setImageResult] = useState<{ url: string; projectId: string; model: string; size: number | null } | null>(null);

  async function generateImage() {
    if (!imagePrompt.trim()) { setImageError("Prompt gambar wajib diisi."); return; }
    setImageBusy(true); setImageError(null); setImageResult(null);
    try {
      const r = await fetch("/api/ai-image/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt, aspect: imageAspect, size: imageSize }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Gagal membuat gambar");
      setImageResult(j);
    } catch (e: any) { setImageError(e.message || "Gagal membuat gambar"); }
    finally { setImageBusy(false); }
  }

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
      const finalName = name.trim() || (prompt.trim().replace(/\s+/g, " ").slice(0, 80) || "AI Video");
      const fd = new FormData();
      fd.append("prompt", prompt);
      fd.append("name", finalName);
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
      <PageHeader title="Prompt AI" description="Buat gambar atau video dari prompt dengan model AI aktif. Hasil tersimpan di Project Workspace." />
      <div className="flex gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/10 w-fit">
        <button type="button" onClick={()=>setTab("video")} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition ${tab==="video" ? "bg-violet-600/30 text-violet-100 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200"}`}><Film size={14}/> Buat Video</button>
        <button type="button" onClick={()=>setTab("image")} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition ${tab==="image" ? "bg-violet-600/30 text-violet-100 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200"}`}><ImagePlus size={14}/> Buat Gambar</button>
      </div>
      {error && <Card className="p-4 border-red-500/20 bg-red-500/10 text-red-300 text-sm">{error}</Card>}

      {tab === "video" && (
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
            <div className="space-y-2"><label className="text-sm text-zinc-300">Nama Project (opsional)</label><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Kosongkan untuk pakai judul dari prompt" /></div>
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
            Jika provider aktif <b>Gemini native</b> dengan model video (omni/veo), prompt + gambar/video dikirim ke <b>Gemini Interactions API</b> dan hasil video asli diunduh ke project. Jika tidak tersedia/gagal, otomatis jatuh ke render lokal: motion-typography (prompt saja), slideshow zoom (gambar), atau salinan project (video). Tanpa API eksternal lain.
          </div>
        </Card>
      </div>
      )}

      {tab === "image" && (
      <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-8 items-start">
        <Card className="p-5 sm:p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Prompt Gambar</label>
            <Textarea rows={7} value={imagePrompt} onChange={e=>setImagePrompt(e.target.value)} placeholder='Contoh: "Ilustrasi anime, ksatria melindungi desa dari badai, cinematic lighting, detail tinggi."' />
            <div className="text-xs text-zinc-500">Dikirim ke model image Gemini aktif (mis. gemini-nano-banana-2.1) via Gemini Interactions API.</div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-sm text-zinc-300">Rasio</label>
              <Select value={imageAspect} onChange={e=>setImageAspect(e.target.value)}>
                <option value="1:1">1:1 (Persegi)</option><option value="16:9">16:9 (Horizontal)</option><option value="9:16">9:16 (Vertikal)</option>
                <option value="4:3">4:3</option><option value="3:4">3:4</option>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Ukuran</label>
              <Select value={imageSize} onChange={e=>setImageSize(e.target.value)}><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></Select>
            </div>
          </div>
          {imageError && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm p-3">{imageError}</div>}
          <Button className="w-full" onClick={generateImage} disabled={imageBusy}><ImagePlus size={16}/> {imageBusy ? "Membuat gambar..." : "Buat Gambar"}</Button>
        </Card>
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="font-medium">Hasil Gambar</div>
          {!imageResult ? (
            <div className="text-sm text-zinc-500 py-12 text-center">Belum ada gambar. Isi prompt lalu klik <b>Buat Gambar</b>.</div>
          ) : (
            <div className="space-y-3">
              <img src={imageResult.url || ""} alt="Hasil gambar AI" className="w-full rounded-xl border border-white/10" />
              <div className="text-xs text-zinc-400">Model: <b>{imageResult.model}</b> · {imageResult.size ? `${Math.round(imageResult.size/1024)} KB` : "-"}</div>
              <div className="flex gap-2">
                <a href={imageResult.url || ""} download className="inline-flex items-center gap-2 px-4 h-9 rounded-lg bg-white/10 hover:bg-white/15 text-sm"><Film size={14}/> Download</a>
                <Button variant="secondary" onClick={()=>router.push(`/projects/${imageResult.projectId}`)}>Buka Project</Button>
              </div>
            </div>
          )}
          <div className="text-xs text-zinc-500 border-t border-white/10 pt-3">Hasil disimpan otomatis sebagai project di workspace. Jika provider aktif bukan Gemini native, fitur ini tidak tersedia.</div>
        </Card>
      </div>
      )}
    </div>
  );
}
