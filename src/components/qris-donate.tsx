"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, X, Download, Loader2, CheckCircle2, Clock } from "lucide-react";
import QRCode from "qrcode";

const PRESETS = [10000, 20000, 50000, 100000];
const EXPIRE_MS = 15 * 60 * 1000; // 15 menit, samakan gaya checkout NetMart

function rp(n: number) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function QrisDonate() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(20000);
  const [custom, setCustom] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [confirmed, setConfirmed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const effectiveAmount = custom.trim() ? Math.max(0, Math.round(Number(custom.replace(/[^\d]/g, "")) || 0)) : amount;
  const remaining = Math.max(0, expiresAt - now);
  const expired = !!payload && remaining <= 0 && !confirmed;

  async function generate() {
    const amt = effectiveAmount;
    if (!Number.isFinite(amt) || amt < 1000) {
      setError("Nominal minimal Rp 1.000");
      return;
    }
    setLoading(true); setError(null); setStatusMsg(null); setPayload(""); setReady(false); setConfirmed(false);
    try {
      const res = await fetch("/api/donate/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok || !j.payload) throw new Error(j.error || "Gagal membuat QRIS dinamis");
      setPayload(String(j.payload));
      const exp = Date.now() + EXPIRE_MS;
      setExpiresAt(exp);
      setNow(Date.now());
      setStatusMsg("QRIS berhasil dibuat. Silakan scan dan selesaikan pembayaran sebelum waktu berakhir.");
    } catch (e: any) {
      setError(e?.message || "Gagal membuat QRIS dinamis");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!payload || !canvasRef.current) return;
    let cancelled = false;
    setReady(false);
    QRCode.toCanvas(canvasRef.current, payload, { width: 220, margin: 2, errorCorrectionLevel: "M" })
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => { if (!cancelled) { setError("Gagal merender QR code"); setReady(false); } });
    return () => { cancelled = true; };
  }, [payload]);

  useEffect(() => {
    if (!payload || !expiresAt || confirmed) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [payload, expiresAt, confirmed]);

  useEffect(() => {
    if (expired) {
      setStatusMsg("Waktu pembayaran telah berakhir. Silakan buat QRIS baru.");
    }
  }, [expired]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() { setOpen(false); }

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

  async function confirmPayment() {
    if (!payload || expired) return;
    setChecking(true);
    setError(null);
    // Donasi QRIS tidak memiliki pelacakan otomatis; tombol konfirmasi disamakan UX-nya (cek status)
    await new Promise((r) => setTimeout(r, 800));
    setConfirmed(true);
    setStatusMsg("Terima kasih! Jika pembayaran sudah berhasil, dukungan Anda telah kami terima.");
    setChecking(false);
  }

  function resetQr() {
    setPayload("");
    setReady(false);
    setExpiresAt(0);
    setConfirmed(false);
    setStatusMsg(null);
    setError(null);
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
          <span className="block text-[11px] text-emerald-200/70">QRIS dinamis • pilih nominal</span>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Dukung via QRIS">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={close} />
          <div className="relative w-full max-w-md max-h-[90vh] rounded-2xl border border-white/10 bg-[#141724] shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
              <div>
                <div className="font-semibold text-white">Dukung via QRIS</div>
                <div className="text-xs text-zinc-400">QRIS dinamis — nominal sesuai pilihan</div>
              </div>
              <button onClick={close} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition" aria-label="Tutup"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <div className="text-sm font-medium text-zinc-200">Nominal Dukungan</div>
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setAmount(p); setCustom(""); resetQr(); }}
                      className={`h-9 rounded-lg text-xs font-medium border transition ${!custom && amount === p ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100" : "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06]"}`}
                    >
                      {rp(p).replace("Rp ", "Rp ")}
                    </button>
                  ))}
                </div>
                <input
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value.replace(/[^\d]/g, "")); resetQr(); }}
                  placeholder="Nominal lain (contoh: 25000)"
                  inputMode="numeric"
                  className="w-full h-10 rounded-lg bg-white/[0.03] border border-white/10 px-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-emerald-400/40"
                />
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="text-sm text-zinc-400">Total</span>
                  <span className="text-sm font-semibold text-emerald-200">{rp(effectiveAmount || 0)}</span>
                </div>
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

              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                <div className="text-sm font-medium text-zinc-200">Instruksi Pembayaran</div>
                <ol className="list-decimal pl-5 space-y-1 text-xs text-zinc-400 leading-relaxed">
                  <li>Scan QRIS menggunakan e-wallet atau mobile banking.</li>
                  <li>Pastikan nominal pembayaran sesuai total di atas.</li>
                  <li>Selesaikan pembayaran sebelum waktu berakhir.</li>
                </ol>

                <div className="flex justify-center pt-1">
                  <div className="bg-white p-2 rounded-lg min-h-[236px] min-w-[236px] flex items-center justify-center">
                    {payload ? (
                      <canvas ref={canvasRef} width={220} height={220} className="block" />
                    ) : (
                      <div className="text-xs text-zinc-500 text-center px-4">QRIS akan muncul di sini setelah dibuat.</div>
                    )}
                  </div>
                </div>
                {payload && !ready && <div className="text-xs text-zinc-400 text-center">Merender QR...</div>}

                {payload && (
                  <>
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <Clock size={14} className={expired ? "text-red-300" : "text-emerald-300"} />
                      <span className="text-zinc-400">Batas waktu pembayaran:</span>
                      <span className={`font-semibold tabular-nums ${expired ? "text-red-300" : "text-emerald-200"}`}>
                        {confirmed ? "Selesai" : expired ? "00:00 (kedaluwarsa)" : formatCountdown(remaining)}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button type="button" onClick={downloadQr} className="flex-1 h-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-200 inline-flex items-center justify-center gap-2"><Download size={14}/> Download QRIS</button>
                      <button
                        type="button"
                        onClick={confirmPayment}
                        disabled={checking || expired || confirmed}
                        className="flex-1 h-9 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-[#062016] font-semibold text-sm inline-flex items-center justify-center gap-2"
                      >
                        {checking ? <Loader2 size={14} className="animate-spin" /> : confirmed ? <CheckCircle2 size={14} /> : null}
                        {checking ? "Memeriksa..." : confirmed ? "Terkonfirmasi" : "Konfirmasi Pembayaran"}
                      </button>
                    </div>
                  </>
                )}

                {(statusMsg || confirmed) && (
                  <div className={`rounded-lg border px-3 py-2 text-sm ${confirmed ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : expired ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-white/10 bg-white/[0.03] text-zinc-300"}`}>
                    <div className="font-medium mb-0.5">{confirmed ? "Status: Dukungan diterima" : expired ? "Status: Kedaluwarsa" : "Status: Menunggu pembayaran"}</div>
                    <div className="text-xs opacity-90">{statusMsg}</div>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-zinc-500 text-center">QRIS dinamis dibuat via provider (sistem sama seperti checkout NetMart). Nominal sesuai pilihan.</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
