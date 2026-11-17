"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Textarea, Select, Input, PageHeader, Badge } from "@/components/ui";
import { Wand2, Sparkles } from "lucide-react";

const presets: Record<string, string> = {
  cinematic: "Buat montage cinematic yang halus. Gunakan transisi crossfade lembut, pacing emosional, pembukaan menarik, dan ending yang kuat.",
  amv: "Buat AMV energik dengan potongan cepat, ritme dinamis, transisi tegas, dan fokus pada momen aksi terbaik.",
  hype: "Buat edit hype/epic dengan tempo cepat, transisi impact/zoom, bagian klimaks kuat, dan energi tinggi.",
  emotional: "Buat montage emosional dengan pacing pelan, transisi halus, nuansa lembut, dan penutup yang menyentuh.",
  story: "Susun clip menjadi alur cerita: pembukaan, pengembangan, klimaks, dan penutup yang jelas.",
};

function inferConfigFromPrompt(prompt: string) {
  const p = prompt.toLowerCase();
  let preset = "cinematic";
  if (/(amv|beat|cepat|energi|dynamic|fast)/.test(p)) preset = "amv";
  else if (/(hype|epic|intens|aksi|action)/.test(p)) preset = "hype";
  else if (/(emosi|emotional|sedih|lembut|slow)/.test(p)) preset = "emotional";
  else if (/(story|cerita|alur|naratif)/.test(p)) preset = "story";
  else if (/(clean|minimal|simple)/.test(p)) preset = "clean";

  let aspect: "16:9"|"9:16"|"1:1" = "9:16";
  if (/(16:9|landscape|horizontal|youtube)/.test(p)) aspect = "16:9";
  else if (/(1:1|square)/.test(p)) aspect = "1:1";

  let audioMode = "mix";
  if (/(musik saja|music only|tanpa audio asli|mute original)/.test(p)) audioMode = "music";
  else if (/(audio asli|original audio|tanpa musik)/.test(p)) audioMode = "original";

  return { preset, aspect, audioMode };
}

export default function PromptEditorClient() {
  const router = useRouter();
  const [prompt, setPrompt] = useState(presets.cinematic);
  const [name, setName] = useState("Prompt-Based Montage");
  const [preset, setPreset] = useState("cinematic");
  const [aspect, setAspect] = useState("9:16");
  const [audioMode, setAudioMode] = useState("mix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [planPreview, setPlanPreview] = useState<any>(null);

  function applyPreset(key: string) {
    setPreset(key);
    setPrompt(presets[key] || prompt);
    const inferred = inferConfigFromPrompt(presets[key] || "");
    setAspect(inferred.aspect); setAudioMode(inferred.audioMode);
  }

  async function analyzePrompt() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/ai/prompt-understanding", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menganalisis prompt");
      const r = data.result || {};
      if (r.preset) setPreset(r.preset);
      if (r.aspect) setAspect(r.aspect);
      if (r.audioMode) setAudioMode(r.audioMode);
      if (r.suggestedName && !name.trim()) setName(r.suggestedName);
      setPlanPreview((prev: any) => ({ ...(prev || {}), ai: r, inferred: inferConfigFromPrompt(prompt), note: "Prompt dianalisis menggunakan task routing AI (Prompt Understanding). Anda bisa menyesuaikan hasil sebelum membuat project." }));
    } catch (e:any) {
      const inferred = inferConfigFromPrompt(prompt);
      setPreset(inferred.preset); setAspect(inferred.aspect); setAudioMode(inferred.audioMode);
      setError(e.message || "Analisis AI gagal, menggunakan interpretasi lokal.");
      setPlanPreview({ inferred, note: "Menggunakan interpretasi lokal karena analisis AI tidak tersedia." });
    } finally { setBusy(false); }
  }

  async function createAndPlan() {
    setBusy(true); setError(null);
    try {
      const inferred = inferConfigFromPrompt(prompt);
      const config = { preset: preset || inferred.preset, aspect, fps: 30, editMode: "auto", audioMode, quality: "medium", prompt };
      const createRes = await fetch("/api/montage/create", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name, config }) });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || "Failed to create project");
      // plan will be meaningful after adding clips in montage editor; store prompt/config now
      setPlanPreview({ projectId: createData.projectId, config, inferred, ai: planPreview?.ai || null, note: "Project berhasil dibuat dengan pengaturan awal. Lanjutkan ke AI Montage Maker untuk menambahkan clip dan merender video." });
    } catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="AI Prompt Editor" description="Tulis arahan editing dengan bahasa alami, lalu mulai project dengan pengaturan yang sesuai." />
      {error && <Card className="p-4 border-red-500/20 bg-red-500/10 text-red-300 text-sm">{error}</Card>}
      <div className="grid xl:grid-cols-[1.2fr_.8fr] gap-6 lg:gap-8 items-start">
        <Card className="p-5 sm:p-6 space-y-5">
          <div className="space-y-2"><div className="font-medium">Prompt Instruksi Editing</div>
            <Textarea rows={10} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder='Contoh: "Gabungkan semua clip menjadi video cinematic, gunakan transisi halus, sesuaikan tempo dengan musik, dan buat penutup yang kuat."' />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-zinc-300">Prompt Templates</div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(presets).map(k => <button key={k} type="button" onClick={()=>applyPreset(k)} className={`px-3 py-1.5 rounded-full text-xs border transition ${preset===k ? 'bg-violet-500/20 border-violet-500/30 text-violet-200' : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06]'}`}>{k}</button>)}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-sm text-zinc-300">Nama Project</label><Input value={name} onChange={e=>setName(e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Preset</label><Select value={preset} onChange={e=>{setPreset(e.target.value);}}><option value="cinematic">Cinematic</option><option value="amv">AMV Style</option><option value="hype">Hype/Epic</option><option value="emotional">Emotional</option><option value="clean">Clean</option><option value="story">Story</option></Select></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Aspect Ratio</label><Select value={aspect} onChange={e=>setAspect(e.target.value as any)}><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></Select></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Audio Mode</label><Select value={audioMode} onChange={e=>setAudioMode(e.target.value)}><option value="mix">Mixed Audio</option><option value="music">Music Only</option><option value="original">Original Audio</option><option value="mute-original">Mute Original Audio</option></Select></div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="secondary" className="flex-1" onClick={analyzePrompt} disabled={busy}><Sparkles size={16}/> {busy ? 'Processing...' : 'Analisis Prompt (AI)'}</Button>
            <Button className="flex-1" onClick={createAndPlan} disabled={busy}><Wand2 size={16}/> {busy ? 'Processing...' : 'Buat Project dari Prompt'}</Button>
          </div>
          <Button variant="secondary" className="w-full" onClick={()=>router.push('/ai-studio/montage')}>Buka AI Montage Maker</Button>
        </Card>

        <Card className="p-5 sm:p-6 space-y-4">
          <div className="font-medium">Hasil Interpretasi Prompt</div>
          {!planPreview ? <div className="text-sm text-zinc-500">Analisis prompt atau buat project untuk melihat ringkasan pengaturan.</div> : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2"><Badge>{(planPreview.config?.preset || preset)}</Badge><Badge>{(planPreview.config?.aspect || aspect)}</Badge><Badge>{(planPreview.config?.audioMode || audioMode)}</Badge></div>
              <div className="text-zinc-300">{planPreview.note}</div>
              {Array.isArray(planPreview.ai?.notes) && planPreview.ai.notes.length > 0 && (
                <ul className="list-disc pl-5 text-zinc-400 space-y-1">{planPreview.ai.notes.map((n:string,i:number)=><li key={i}>{n}</li>)}</ul>
              )}
              {planPreview.projectId && <Button className="w-full" onClick={()=>router.push('/ai-studio/montage')}>Lanjut ke AI Montage Maker</Button>}
              <div className="text-xs text-zinc-500">Hasil AI mengikuti routing task "Prompt Understanding" bila provider/model dikonfigurasi; jika gagal, sistem menggunakan interpretasi lokal.</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
