"use client";
import { useState } from "react";
import { Card, Button, Input, Select, PageHeader } from "@/components/ui";
import { Upload, Music, Download, Save } from "lucide-react";

export default function AudioExtractorClient() {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState("mp3");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [result, setResult] = useState<any>(null);

  async function extract(saveToLibrary: boolean) {
    if (!file) { setError("Pilih file sumber terlebih dahulu."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("format", format);
      if (name) fd.append("name", name);
      if (start) fd.append("start", start);
      if (end) fd.append("end", end);
      fd.append("saveToLibrary", String(saveToLibrary));
      const res = await fetch("/api/audio/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setResult(data);
    } catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="Audio Extractor" description="Ekstrak audio dari video, atur rentang waktu, lalu simpan ke Audio Library atau unduh hasilnya." />
      {error && <Card className="p-4 border-red-500/20 bg-red-500/10 text-red-300 text-sm">{error}</Card>}
      <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-8 items-start">
        <Card className="p-5 sm:p-6 space-y-5">
          <div className="space-y-2">
            <div className="font-medium">Source Media</div>
            <label className="group block border border-dashed border-white/15 rounded-2xl p-8 text-center hover:border-violet-400/40 hover:bg-white/[0.02] cursor-pointer transition-all">
              <input type="file" accept="video/mp4,video/x-matroska,video/quicktime,video/webm,audio/*,.mkv" className="hidden" onChange={e=>setFile(e.target.files?.[0] || null)} />
              <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-300 grid place-items-center"><Upload size={22}/></div>
              <div className="font-medium">{file ? file.name : "Pilih video untuk diekstrak audionya"}</div>
              <div className="text-sm text-zinc-400 mt-1">Mendukung MP4, MKV, MOV, WEBM, dan format audio umum</div>
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-sm text-zinc-300">Nama Audio</label><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Contoh: Musik latar scene 1" /></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Format Output</label><Select value={format} onChange={e=>setFormat(e.target.value)}><option value="mp3">MP3</option><option value="wav">WAV</option><option value="aac">AAC</option><option value="m4a">M4A</option></Select></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Mulai (detik, opsional)</label><Input type="number" min={0} step="0.1" value={start} onChange={e=>setStart(e.target.value)} placeholder="0" /></div>
            <div className="space-y-2"><label className="text-sm text-zinc-300">Selesai (detik, opsional)</label><Input type="number" min={0} step="0.1" value={end} onChange={e=>setEnd(e.target.value)} placeholder="Otomatis hingga akhir" /></div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button className="flex-1" onClick={()=>extract(true)} disabled={busy || !file}><Save size={16}/> {busy ? 'Mengekstrak...' : 'Ekstrak & Simpan'}</Button>
            <Button variant="secondary" className="flex-1" onClick={()=>extract(false)} disabled={busy || !file}><Music size={16}/> Ekstrak Saja</Button>
          </div>
          <div className="text-xs text-zinc-500">Proses ekstraksi membutuhkan waktu beberapa saat tergantung durasi dan ukuran file.</div>
        </Card>

        <Card className="p-5 sm:p-6 space-y-4">
          <div className="font-medium">Hasil Ekstraksi</div>
          {!result ? <div className="text-sm text-zinc-500 py-8 text-center">Belum ada hasil. Pilih file dan mulai proses ekstraksi.</div> : (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2 text-sm">
                <div>Format: <span className="text-zinc-200 uppercase">{format}</span></div>
                {result.duration != null && <div>Durasi: <span className="text-zinc-200">{Number(result.duration).toFixed(2)}s</span></div>}
                {result.fileSize != null && <div>Ukuran: <span className="text-zinc-200">{(result.fileSize/1024/1024).toFixed(2)} MB</span></div>}
                {result.asset && <div className="text-emerald-300">Audio disimpan ke Audio Library.</div>}
              </div>
              {result.fileUrl && <>
                <audio controls src={result.fileUrl} className="w-full" />
                <a href={result.fileUrl} download className="inline-flex w-full"><Button variant="secondary" className="w-full"><Download size={16}/> Download Audio</Button></a>
              </>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
