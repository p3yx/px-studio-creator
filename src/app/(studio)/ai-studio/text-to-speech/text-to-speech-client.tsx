"use client";
import { useEffect, useState } from "react";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { Volume2, Download, Save, Loader2 } from "lucide-react";

type LocalVoice = { name: string; culture: string; gender: string; language: string };

export default function TextToSpeechClient() {
  const [text, setText] = useState("");
  const [name, setName] = useState("Narasi TTS");
  const [voice, setVoice] = useState("alloy");
  const [localVoice, setLocalVoice] = useState("auto-id");
  const [fallbackLang, setFallbackLang] = useState("id");
  const [localVoices, setLocalVoices] = useState<LocalVoice[]>([]);
  const [hasIndonesianVoice, setHasIndonesianVoice] = useState<boolean | null>(null);
  const [format, setFormat] = useState("mp3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/audio/tts", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.localVoices)) setLocalVoices(data.localVoices);
        if (typeof data.hasIndonesianVoice === "boolean") setHasIndonesianVoice(data.hasIndonesianVoice);
      } catch {}
    })();
  }, []);

  async function generate(saveToLibrary: boolean) {
    if (!text.trim()) { setError("Masukkan teks terlebih dahulu."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, name, voice, localVoice, fallbackLang, format, saveToLibrary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal membuat audio");
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Gagal membuat audio");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-8 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3 break-words">{error}</div>}
        <div className="space-y-2">
          <label className="text-sm text-zinc-300">Teks</label>
          <Textarea rows={10} value={text} onChange={e=>setText(e.target.value)} placeholder="Tulis teks yang ingin diubah menjadi suara..." />
          <div className="text-xs text-zinc-500">Prioritas: <span className="text-zinc-300">AI TTS</span> → fallback <span className="text-zinc-300">Google TTS</span> (mendukung Bahasa Indonesia) → fallback <span className="text-zinc-300">TTS lokal Windows</span>.</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><label className="text-sm text-zinc-300">Nama Audio</label><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Contoh: Narasi intro" /></div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Format</label>
            <Select value={format} onChange={e=>setFormat(e.target.value)}>
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </Select>
          </div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Voice AI (jika provider mendukung)</label>
            <Select value={voice} onChange={e=>setVoice(e.target.value)}>
              <option value="alloy">alloy</option>
              <option value="echo">echo</option>
              <option value="fable">fable</option>
              <option value="onyx">onyx</option>
              <option value="nova">nova</option>
              <option value="shimmer">shimmer</option>
            </Select>
          </div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Bahasa Fallback Google TTS</label>
            <Select value={fallbackLang} onChange={e=>setFallbackLang(e.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="id">Indonesia (id)</option>
              <option value="en">English (en)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="ko">Korean (ko)</option>
              <option value="zh-CN">Chinese (zh-CN)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="ar">Arabic (ar)</option>
              <option value="hi">Hindi (hi)</option>
              <option value="pt">Portuguese (pt)</option>
              <option value="ru">Russian (ru)</option>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2"><label className="text-sm text-zinc-300">Suara Fallback Lokal Windows (cadangan terakhir)</label>
            <Select value={localVoice} onChange={e=>setLocalVoice(e.target.value)}>
              <option value="auto-id">Otomatis (Prioritas Bahasa Indonesia)</option>
              <option value="auto-en">Otomatis (English)</option>
              {localVoices.map(v => (
                <option key={v.name} value={v.name}>{v.name} {v.culture ? `(${v.culture})` : ""}</option>
              ))}
            </Select>
            {hasIndonesianVoice === false && (
              <div className="text-xs text-zinc-400">Voice id-ID Windows tidak terdeteksi; jika fallback lokal terpakai, pelafalan Indonesia bisa kurang lancar (fallback Google TTS biasanya lebih baik untuk Indonesia).</div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="flex-1" onClick={()=>generate(true)} disabled={busy || !text.trim()}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} {busy ? 'Membuat audio...' : 'Generate & Simpan'}</Button>
          <Button variant="secondary" className="flex-1" onClick={()=>generate(false)} disabled={busy || !text.trim()}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Volume2 size={16}/>} Generate Saja</Button>
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="font-medium">Hasil Audio</div>
        {busy ? (
          <div className="py-10 text-center space-y-3">
            <Loader2 size={28} className="animate-spin mx-auto text-violet-400" />
            <div className="text-sm text-zinc-300">Sedang membuat audio...</div>
          </div>
        ) : !result ? <div className="text-sm text-zinc-500 py-8 text-center">Belum ada hasil. Masukkan teks dan klik Generate.</div> : (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2 text-sm">
              <div>Format: <span className="text-zinc-200 uppercase">{result.format || format}</span></div>
              {result.duration != null && <div>Durasi: <span className="text-zinc-200">{Number(result.duration).toFixed(2)}s</span></div>}
              {result.fileSize != null && <div>Ukuran: <span className="text-zinc-200">{(result.fileSize/1024/1024).toFixed(2)} MB</span></div>}
              {result.provider && <div>Engine: <span className="text-zinc-200">{result.provider === 'google' ? 'Google TTS (fallback)' : result.provider === 'local' ? 'Lokal Windows (fallback)' : 'AI TTS'}</span></div>}
              {result.asset && <div className="text-emerald-300">Audio disimpan ke Audio Library.</div>}
              {result.fallback && <div className="text-amber-300 break-words">{result.note || "Menggunakan fallback TTS."}</div>}
              {!result.fallback && <div className="text-emerald-300">Audio dibuat dengan AI TTS.</div>}
              {result.voiceUsed && result.provider === 'local' ? <div className="text-zinc-400">Suara lokal: {result.voiceUsed}</div> : null}
            </div>
            {result.fileUrl && <>
              <audio controls src={result.fileUrl} className="w-full" />
              <a href={result.fileUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download Audio</Button></a>
            </>}
          </div>
        )}
      </Card>
    </div>
  );
}
