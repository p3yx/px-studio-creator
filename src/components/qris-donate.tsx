"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, X, Copy, Download, Loader2 } from "lucide-react";
import QRCode from "qrcode";

const PRESETS = [10000, 20000, 50000, 100000];

function rp(n: number) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

export function QrisDonate() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(20000);
  const [custom, setCustom] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<string>("");
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const effectiveAmount = custom.trim() ? Math.max(0, Math.round(Number(custom.replace(/[^\d]/g, "")) || 0)) : amount;

  async function generate() {
    const amt = effectiveAmount;
    if (!Number.isFinite(amt) || amt < 1000) {
      setError("Nominal minimal Rp 1.000");
      return;
    }
    setLoading(true); setError(null); setPayload(""); setReady(false);
    try {
      const res = await fetch("/api/donate/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok || !j.payload) throw new Error(j.error || "Gagal membuat QRIS dinamis");
      setPayload(String(j.payload));
    } catch (e: any) {
      setError(e?.message || "Gagal membuat QRIS dinamis");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!payload || !canvasRef.current) return;
    let cancelled = false;
    QRCode.toCanvas(canvasRef.current, payload, { width: 240, margin: 2, errorCorrectionLevel: "M" })
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => { if (!cancelled) { setError("Gagal merender QR code"); setReady(false); } });
    return () => { cancelled = true; };
  }, [payload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() { setOpen(false); }

  async function copyPayload() {
    if (!payload) return;
    try { await navigator.clipboard.writeText(payload); } catch {}
  }

  function downloadQr() {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    try {
      const a = document.createElement("a");
      a.download = `qris-donasi-${effectiveAmount}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch {}
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group w-full flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 hover:bg-emerald-400/15 hover:border-emerald-300/30 px-3.5 py-2.5 transition text-left"
        aria-label="Dukung via QRIS"
        title="Dukung via QRIS (Dinamis)"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400 text-[#062016] shadow-sm shrink-0">
          <QrCode size={16} strokeWidth={2.5} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-emerald-100">Dukung via QRIS</span>
          <span className="block text-[11px] text-emerald-200/70">QRIS dinamis (pilih nominal)</span>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Dukung via QRIS">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#141724] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <div className="font-semibold text-white">Dukung via QRIS</div>
                <div className="text-xs text-zinc-400">QRIS dinamis — nominal sesuai pilihan</div>
              </div>
              <button onClick={close} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition" aria-label="Tutup"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <div className="text-sm text-zinc-300">Pilih nominal</div>
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setAmount(p); setCustom(""); setPayload(""); setReady(false); setError(null); }}
                      className={`h-9 rounded-lg text-xs font-medium border transition ${!custom && amount === p ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100" : "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06]"}`}
                    >
                      {rp(p).replace("Rp ", "Rp")}
                    </button>
                  ))}
                </div>
                <input
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value.replace(/[^\d]/g, "")); setPayload(""); setReady(false); setError(null); }}
                  placeholder="Nominal lain (contoh: 25000)"
                  inputMode="numeric"
                  className="w-full h-10 rounded-lg bg-white/[0.03] border border-white/10 px-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-emerald-400/40"
                />
                <div className="text-xs text-zinc-400">Total: <span className="text-emerald-200 font-medium">{rp(effectiveAmount || 0)}</span></div>
              </div>

              <button
                type="button"
                onClick={generate}
                disabled={loading || effectiveAmount < 1000}
                className="w-full h-10 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-[#062016] font-semibold text-sm transition inline-flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                {loading ? "Membuat QRIS..." : "Buat QRIS Dinamis"}
              </button>

              {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-3 py-2">{error}</div>}

              <div className="rounded-xl border border-white/10 bg-black/20 p-4 flex flex-col items-center gap-3 min-h-[220px] justify-center">
                {!payload ? (
                  <div className="text-sm text-zinc-500 text-center">QRIS akan muncul di sini setelah dibuat.</div>
                ) : (
                  <>
                    <div className="bg-white p-2 rounded-lg">
                      <canvas ref={canvasRef} width={240} height={240} className="block" />
                    </div>
                    {!ready && <div className="text-xs text-zinc-400">Merender QR...</div>}
                    <div className="text-xs text-zinc-400 text-center">Scan dengan aplikasi e-wallet / mobile banking (QRIS). Nominal: <span className="text-zinc-200 font-medium">{rp(effectiveAmount)}</span></div>
                    <div className="flex gap-2 w-full">
                      <button type="button" onClick={downloadQr} className="flex-1 h-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-200 inline-flex items-center justify-center gap-2"><Download size={14}/> Download</button>
                      <button type="button" onClick={copyPayload} className="flex-1 h-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-200 inline-flex items-center justify-center gap-2"><Copy size={14}/> Salin Payload</button>
                    </div>
                  </>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 text-center">QRIS dinamis dibuat via provider (sistem sama seperti checkout NetMart) dengan nominal sesuai input.</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
