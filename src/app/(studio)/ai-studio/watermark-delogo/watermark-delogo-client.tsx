"use client";
import React, { useEffect, useRef, useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { Film, Loader2, Eraser, Eye, Download, Info, Play, ShieldAlert, Wand2 } from "lucide-react";

type Method = "delogo" | "ai";
type Rect = { x: number; y: number; w: number; h: number };

export default function WatermarkDelogoClient() {
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("delogo");
  const [rect, setRect] = useState<Rect>({ x: 70, y: 80, w: 20, h: 12 });
  const [blur, setBlur] = useState(8);
  const [aiTime, setAiTime] = useState("1.5");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [comparePos, setComparePos] = useState(50);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: "move" | "se" | "new"; startX: number; startY: number; start: Rect } | null>(null);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  function onFile(f: File | null) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideo(f);
    setVideoUrl(f ? URL.createObjectURL(f) : null);
    setResult(null); setError(null); setNotice(null); setShowCompare(false);
  }

  function clampRect(r: Rect) {
    const w = Math.max(1, Math.min(99, r.w));
    const h = Math.max(1, Math.min(99, r.h));
    const x = Math.max(0, Math.min(100 - w, r.x));
    const y = Math.max(0, Math.min(100 - h, r.y));
    return { x, y, w, h };
  }
  function updateField(key: keyof Rect, val: string) {
    const n = Number(val);
    setRect(r => clampRect({ ...r, [key]: Number.isFinite(n) ? n : r[key] }));
  }
  function pctPos(e: React.PointerEvent) {
    const el = boxRef.current; if (!el) return null;
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null;
    return { x: ((e.clientX - b.left) / b.width) * 100, y: ((e.clientY - b.top) / b.height) * 100 };
  }
  function onBoxDown(e: React.PointerEvent, mode: "move" | "se" | "new") {
    const el = boxRef.current; if (!el) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    let start = { ...rect };
    if (mode === "new") {
      const p = pctPos(e);
      if (!p) return;
      start = { x: Math.max(0, Math.min(98, p.x)), y: Math.max(0, Math.min(98, p.y)), w: 2, h: 2 };
      setRect(clampRect(start));
    }
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start };
  }
  function onBoxMove(e: React.PointerEvent) {
    const d = dragRef.current; const el = boxRef.current;
    if (!d || !el) return;
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
    const dx = ((e.clientX - d.startX) / b.width) * 100;
    const dy = ((e.clientY - d.startY) / b.height) * 100;
    if (d.mode === "move") setRect(clampRect({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }));
    else if (d.mode === "se") setRect(clampRect({ ...d.start, w: d.start.w + dx, h: d.start.h + dy }));
    else setRect(clampRect({ x: d.start.x, y: d.start.y, w: d.start.w + dx, h: d.start.h + dy }));
  }
  function onBoxUp() { dragRef.current = null; }

  async function run(mode: "preview" | "apply") {
    if (!video) { setError("Pilih video terlebih dahulu."); return; }
    setBusy(true); setError(null); setNotice(null); setProgress("Preparing video...");
    try {
      setProgress(method === "delogo" ? "Processing (Delogo tanpa blur, FFmpeg)..." : "Processing (AI Gemini, satu frame)...");
      const fd = new FormData();
      fd.append("video", video);
      fd.append("method", method);
      fd.append("mode", mode);
      if (method === "ai") fd.append("time", aiTime);
      fd.append("x", String(Math.round(rect.x * 100) / 100));
      fd.append("y", String(Math.round(rect.y * 100) / 100));
      fd.append("w", String(Math.round(rect.w * 100) / 100));
      fd.append("h", String(Math.round(rect.h * 100) / 100));
      fd.append("blur", String(blur));
      const res = await fetch("/api/tools/watermark-delogo", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal memproses");
      setResult(j); setShowCompare(true);
      setNotice(j.note || "Selesai. Hasil disimpan sebagai file terpisah (sumber tidak diubah).");
    } catch (e: any) { setError(e.message || "Gagal memproses"); }
    finally { setBusy(false); setProgress(null); }
  }

  function resetAll() {
    setResult(null); setShowCompare(false); setError(null); setNotice(null);
    setRect({ x: 70, y: 80, w: 20, h: 12 });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-100 text-sm px-4 py-3 flex gap-2">
        <ShieldAlert size={16} className="shrink-0 mt-0.5 text-amber-300" />
        <div>
          <b>Penggunaan bertanggung jawab:</b> hanya untuk watermark/overlay/logo milik Anda sendiri atau yang Anda memiliki izin untuk menghapusnya.
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.15fr_.85fr] gap-6 items-start">
        <Card className="p-5 sm:p-6 space-y-5">
          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}
          {notice && <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-200 text-sm px-4 py-3">{notice}</div>}

          <div className="space-y-2">
            <label className="text-sm text-zinc-300">Video</label>
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-zinc-300"><Film size={16} className="text-violet-300" /> {video ? video.name : "Belum ada video dipilih"}</div>
              <Input type="file" accept="video/*" onChange={e => onFile(e.target.files?.[0] || null)} />
              <div className="text-xs text-zinc-500">Video sumber tidak akan diubah/dirusak; hasil disimpan sebagai file terpisah. Audio & durasi dipertahankan.</div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1"><label className="text-sm text-zinc-300">Metode</label>
              <Select value={method} onChange={e => setMethod(e.target.value as Method)}>
                <option value="delogo">Delogo — rekonstruksi tepi, TANPA blur</option>
                <option value="ai">AI (Gemini) — hapus watermark pada 1 frame</option>
              </Select>
            </div>
            {method === "ai" && (
              <div className="space-y-1"><label className="text-sm text-zinc-300">Detik frame yang dihapus (AI)</label>
                <Input type="number" min={0} step={0.5} value={aiTime} onChange={e => setAiTime(e.target.value)} />
              </div>
            )}
            {method === "delogo" && (
              <div className="text-xs text-zinc-500 self-end pb-2">Area delogo diisi dari piksel tepi — tidak ada blur, tidak ada bayangan.</div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] text-sm px-4 py-3 flex gap-2">
            <Info size={16} className="shrink-0 mt-0.5" />
            <div>
              <b>Delogo</b> mengisi area yang dipilih dengan interpolasi piksel dari tepi sekelilingnya — <b>totally tanpa blur</b>, jadi tidak ada siluet/bayangan. <b>AI (Gemini)</b> mengedit satu frame agar watermark hilang dengan inpainting (hasil gambar, bukan video penuh). Pilih area tepat di atas watermark untuk delogo.
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-zinc-300">Video Preview &amp; Seleksi Area</label>
            <div
              ref={boxRef}
              className="relative w-full aspect-video bg-black/60 rounded-xl overflow-hidden border border-white/10 select-none touch-none cursor-crosshair"
              onPointerDown={e => onBoxDown(e, "new")}
              onPointerMove={onBoxMove}
              onPointerUp={onBoxUp}
              onPointerLeave={onBoxUp}
            >
              {videoUrl ? (
                <video src={videoUrl} className="absolute inset-0 w-full h-full object-contain pointer-events-none" muted playsInline controls />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500 px-6 text-center">Pilih video untuk preview, lalu seret untuk menandai area watermark.</div>
              )}
              <div
                className="absolute border-2 border-violet-400/90 bg-violet-500/10 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
                onPointerDown={e => { e.stopPropagation(); onBoxDown(e, "move"); }}
              >
                <div className="absolute -top-6 left-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/80 text-white whitespace-nowrap pointer-events-none">Area Hapus</div>
                <div className="absolute -right-1.5 -bottom-1.5 w-4 h-4 rounded-sm bg-white border border-violet-500 cursor-se-resize" onPointerDown={e => { e.stopPropagation(); onBoxDown(e, "se"); }} title="Ubah ukuran" />
              </div>
            </div>
            <div className="text-xs text-zinc-400">Seret di preview untuk kotak baru; geser kotak untuk memindah; pegang pegangan kanan-bawah untuk ubah ukuran. Perubahan tidak disimpan permanen sebelum Apply/Export.</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1"><label className="text-xs text-zinc-400">X (%)</label><Input type="number" value={Math.round(rect.x)} onChange={e => updateField("x", e.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs text-zinc-400">Y (%)</label><Input type="number" value={Math.round(rect.y)} onChange={e => updateField("y", e.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs text-zinc-400">Lebar (%)</label><Input type="number" value={Math.round(rect.w)} onChange={e => updateField("w", e.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs text-zinc-400">Tinggi (%)</label><Input type="number" value={Math.round(rect.h)} onChange={e => updateField("h", e.target.value)} /></div>
          </div>

          {busy && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-200 text-sm px-4 py-3 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" /> <span>{progress || "Processing..."}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run("preview")} disabled={busy || !video} variant="secondary" className="flex-1 min-w-[160px]">{busy ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />} Preview Hasil</Button>
            <Button onClick={() => run("apply")} disabled={busy || !video} className="flex-1 min-w-[160px]">{busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Apply &amp; Export</Button>
            <Button onClick={resetAll} disabled={busy} variant="ghost" className="min-w-[110px]">Reset</Button>
          </div>
          <div className="text-xs text-zinc-500">Preview/Apply diproses via FFmpeg (ringan, tanpa GPU). Mempertahankan audio, durasi, resolusi &amp; frame rate; hasil disimpan sebagai file terpisah.</div>
        </Card>

        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">Preview Before / After</div>
            {result?.fileUrl && result?.kind !== "image" && <button type="button" onClick={() => setShowCompare(s => !s)} className="text-xs px-2.5 h-8 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06]">{showCompare ? "Tutup Compare" : "Buka Compare"}</button>}
          </div>
          {!result?.fileUrl ? (
            <div className="text-sm text-zinc-500 py-10 text-center space-y-2"><Play size={22} className="mx-auto text-zinc-600" /><div>Belum ada hasil. Pilih area &amp; metode, lalu klik <b>Preview Hasil</b> atau <b>Apply &amp; Export</b>.</div></div>
          ) : (
            <div className="space-y-4">
              {showCompare && videoUrl && result?.kind !== "image" ? (
                <div className="space-y-2">
                  <div className="relative aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10">
                    <video src={result.fileUrl} className="absolute inset-0 w-full h-full object-contain" controls />
                    <div className="absolute inset-y-0 left-0 overflow-hidden border-r-2 border-white/70 pointer-events-none" style={{ width: `${comparePos}%` }}>
                      <video src={videoUrl} className="absolute inset-y-0 left-0 h-full max-w-none object-contain" style={{ width: `${10000 / Math.max(1, comparePos)}%` }} muted />
                      <div className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">Before</div>
                    </div>
                    <div className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">After</div>
                  </div>
                  <input type="range" min={5} max={95} value={comparePos} onChange={e => setComparePos(Number(e.target.value))} className="w-full" />
                  <div className="text-xs text-zinc-500">Geser slider untuk perbandingan Before/After.</div>
                </div>
              ) : (
                <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center">
                  {result?.kind === "image"
                    ? <img key={result.fileUrl} src={result.fileUrl} alt="Hasil hapus watermark AI" className="w-full h-full object-contain" />
                    : <video key={result.fileUrl} src={result.fileUrl} controls className="w-full h-full object-contain" />}
                </div>
              )}
              <div className="text-xs text-zinc-400">{result.mode === "apply" ? "Hasil Apply/Export (file terpisah, video asli tidak diubah). " : "Hasil Preview. "}{result.note || ""}</div>
              <a href={result.fileUrl} download className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm"><Download size={16} /> Download Hasil</a>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
