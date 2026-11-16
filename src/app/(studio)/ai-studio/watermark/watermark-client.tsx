"use client";
import { useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { Upload, Download, Loader2, Eraser, Stamp, ImagePlus, Film } from "lucide-react";

type Tab = "blur" | "create" | "apply";

export default function WatermarkClient() {
  const [tab, setTab] = useState<Tab>("blur");
  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "blur", label: "Hapus (Soft Blur)", icon: Eraser },
    { id: "create", label: "Buat Watermark", icon: ImagePlus },
    { id: "apply", label: "Pasang Watermark", icon: Stamp },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`inline-flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-medium border transition ${active ? "bg-violet-500/20 text-white border-violet-400/30" : "bg-white/[0.03] text-zinc-300 border-white/10 hover:bg-white/[0.06]"}`}>
              <Icon size={16} className={active ? "text-violet-300" : "text-zinc-400"} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "blur" && <BlurTab />}
      {tab === "create" && <CreateTab />}
      {tab === "apply" && <ApplyTab />}
    </div>
  );
}

function BlurTab() {
  const [video, setVideo] = useState<File | null>(null);
  const [x, setX] = useState("70"); const [y, setY] = useState("80"); const [w, setW] = useState("25"); const [h, setH] = useState("12");
  const [blur, setBlur] = useState("20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function submit() {
    if (!video) { setError("Pilih video terlebih dahulu."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("video", video);
      fd.append("x", x); fd.append("y", y); fd.append("w", w); fd.append("h", h); fd.append("blur", blur);
      const res = await fetch("/api/tools/watermark/blur", { method: "POST", body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || "Gagal menghapus watermark");
      setResult(j);
    } catch (e:any) { setError(e.message || "Gagal memproses"); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
        <div className="space-y-2">
          <label className="text-sm text-zinc-300">Video</label>
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-zinc-300"><Film size={16} className="text-violet-300"/> {video ? video.name : "Belum ada video dipilih"}</div>
            <Input type="file" accept="video/*" onChange={e=>setVideo(e.target.files?.[0]||null)} />
          </div>
        </div>
        <div className="text-xs text-zinc-400">Atur area watermark yang akan di-blur (dalam persen dari ukuran video). Contoh: pojok kanan bawah sering X=70, Y=80, Lebar=25, Tinggi=12.</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><label className="text-xs text-zinc-400">X (%)</label><Input type="number" value={x} onChange={e=>setX(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs text-zinc-400">Y (%)</label><Input type="number" value={y} onChange={e=>setY(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs text-zinc-400">Lebar (%)</label><Input type="number" value={w} onChange={e=>setW(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs text-zinc-400">Tinggi (%)</label><Input type="number" value={h} onChange={e=>setH(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><label className="text-sm text-zinc-300">Kekuatan Blur</label>
          <Select value={blur} onChange={e=>setBlur(e.target.value)}>
            <option value="10">Ringan</option>
            <option value="20">Sedang (Soft Blur)</option>
            <option value="35">Kuat</option>
            <option value="50">Sangat Kuat</option>
          </Select>
        </div>
        <Button className="w-full" onClick={submit} disabled={busy || !video}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Eraser size={16}/>} {busy ? "Memproses..." : "Hapus dengan Soft Blur"}</Button>
      </Card>
      <ResultCard busy={busy} result={result} label="Hasil blur akan muncul di sini." />
    </div>
  );
}

function CreateTab() {
  const [text, setText] = useState("PX STUDIO");
  const [fontSize, setFontSize] = useState("48");
  const [color, setColor] = useState("#ffffff");
  const [opacity, setOpacity] = useState("0.7");
  const [bg, setBg] = useState("transparent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function submit() {
    if (!text.trim()) { setError("Masukkan teks watermark."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("text", text); fd.append("fontSize", fontSize); fd.append("color", color); fd.append("opacity", opacity); fd.append("bg", bg);
      const res = await fetch("/api/tools/watermark/create", { method: "POST", body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || "Gagal membuat watermark");
      setResult(j);
    } catch (e:any) { setError(e.message || "Gagal membuat watermark"); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
        <div className="space-y-2"><label className="text-sm text-zinc-300">Teks Watermark</label><Input value={text} onChange={e=>setText(e.target.value)} placeholder="Teks watermark" /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1"><label className="text-sm text-zinc-300">Ukuran Font</label><Input type="number" value={fontSize} onChange={e=>setFontSize(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm text-zinc-300">Warna</label><Input type="color" value={color} onChange={e=>setColor(e.target.value)} className="h-10 p-1" /></div>
          <div className="space-y-1"><label className="text-sm text-zinc-300">Opasitas (0-1)</label><Input type="number" step="0.1" min="0.1" max="1" value={opacity} onChange={e=>setOpacity(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm text-zinc-300">Latar</label>
            <Select value={bg} onChange={e=>setBg(e.target.value)}>
              <option value="transparent">Transparan</option>
              <option value="dark">Gelap (semi-transparan)</option>
              <option value="black">Hitam</option>
            </Select>
          </div>
        </div>
        <Button className="w-full" onClick={submit} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin"/> : <ImagePlus size={16}/>} {busy ? "Membuat..." : "Buat Watermark (PNG)"}</Button>
        <div className="text-xs text-zinc-500">Hasil berupa gambar PNG yang bisa dipakai di tab "Pasang Watermark".</div>
      </Card>
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="font-medium">Hasil Watermark</div>
        {busy ? <div className="py-10 text-center"><Loader2 size={28} className="animate-spin mx-auto text-violet-400" /></div> : !result?.fileUrl ? <div className="text-sm text-zinc-500 py-8 text-center">Belum ada watermark dibuat.</div> : (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22><rect width=%2210%22 height=%2210%22 fill=%22%23333%22/><rect x=%2210%22 y=%2210%22 width=%2210%22 height=%2210%22 fill=%22%23333%22/></svg>')] p-4 flex items-center justify-center min-h-[160px]">
              <img src={result.fileUrl} alt="watermark" className="max-w-full max-h-[240px] object-contain" />
            </div>
            <a href={result.fileUrl} download className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm"><Download size={16}/> Download PNG</a>
          </div>
        )}
      </Card>
    </div>
  );
}

function ApplyTab() {
  const [video, setVideo] = useState<File | null>(null);
  const [wm, setWm] = useState<File | null>(null);
  const [position, setPosition] = useState("bottom-right");
  const [scale, setScale] = useState("0.18");
  const [opacity, setOpacity] = useState("0.8");
  const [margin, setMargin] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function submit() {
    if (!video) { setError("Pilih video terlebih dahulu."); return; }
    if (!wm) { setError("Pilih gambar watermark (PNG/JPG). Buat dulu di tab 'Buat Watermark' jika belum ada."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("video", video);
      fd.append("watermark", wm);
      fd.append("position", position); fd.append("scale", scale); fd.append("opacity", opacity); fd.append("margin", margin);
      const res = await fetch("/api/tools/watermark/apply", { method: "POST", body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || "Gagal memasang watermark");
      setResult(j);
    } catch (e:any) { setError(e.message || "Gagal memproses"); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><label className="text-sm text-zinc-300">Video</label><Input type="file" accept="video/*" onChange={e=>setVideo(e.target.files?.[0]||null)} /><div className="text-xs text-zinc-500 truncate">{video?.name || "Belum dipilih"}</div></div>
          <div className="space-y-2"><label className="text-sm text-zinc-300">Gambar Watermark (PNG/JPG)</label><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setWm(e.target.files?.[0]||null)} /><div className="text-xs text-zinc-500 truncate">{wm?.name || "Belum dipilih"}</div></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1"><label className="text-sm text-zinc-300">Posisi</label>
            <Select value={position} onChange={e=>setPosition(e.target.value)}>
              <option value="top-left">Kiri Atas</option>
              <option value="top-right">Kanan Atas</option>
              <option value="bottom-left">Kiri Bawah</option>
              <option value="bottom-right">Kanan Bawah</option>
              <option value="center">Tengah</option>
            </Select>
          </div>
          <div className="space-y-1"><label className="text-sm text-zinc-300">Ukuran (skala 0.05-0.6)</label><Input type="number" step="0.01" value={scale} onChange={e=>setScale(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm text-zinc-300">Opasitas (0-1)</label><Input type="number" step="0.1" value={opacity} onChange={e=>setOpacity(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-sm text-zinc-300">Margin (px)</label><Input type="number" value={margin} onChange={e=>setMargin(e.target.value)} /></div>
        </div>
        <Button className="w-full" onClick={submit} disabled={busy || !video || !wm}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Stamp size={16}/>} {busy ? "Memproses..." : "Pasang Watermark"}</Button>
      </Card>
      <ResultCard busy={busy} result={result} label="Hasil video akan muncul di sini." />
    </div>
  );
}

function ResultCard({ busy, result, label }: { busy: boolean; result: any; label: string }) {
  return (
    <Card className="p-5 sm:p-6 space-y-4">
      <div className="font-medium">Hasil</div>
      {busy ? <div className="py-10 text-center space-y-3"><Loader2 size={28} className="animate-spin mx-auto text-violet-400" /><div className="text-sm text-zinc-300">Sedang memproses...</div></div> : !result?.fileUrl ? <div className="text-sm text-zinc-500 py-8 text-center">{label}</div> : (
        <div className="space-y-4">
          {/\.(png|jpg|jpeg|webp)$/i.test(result.fileUrl || "") ? (
            <div className="rounded-xl border border-white/10 p-3 flex items-center justify-center min-h-[160px]"><img src={result.fileUrl} alt="result" className="max-w-full max-h-[320px] object-contain" /></div>
          ) : (
            <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10"><video key={result.fileUrl} src={result.fileUrl} controls className="w-full h-full object-contain" /></div>
          )}
          <a href={result.fileUrl} download className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm"><Download size={16}/> Download Hasil</a>
        </div>
      )}
    </Card>
  );
}
