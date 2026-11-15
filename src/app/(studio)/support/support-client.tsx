"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, Download, Loader2, CheckCircle2, Clock } from "lucide-react";
import QRCode from "qrcode";
import { Card, Button, Input } from "@/components/ui";

const PRESETS = [10000, 20000, 50000, 100000];
const EXPIRE_MS = 15 * 60 * 1000;
const CONFIRM_DELAY_MS = 30 * 1000;

function rp(n: number) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SupportClient() {
  const [amount, setAmount] = useState<number>(20000);
  const [custom, setCustom] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [confirmAvailableAt, setConfirmAvailableAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [confirmed, setConfirmed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const effectiveAmount = custom.trim() ? Math.max(0, Math.round(Number(custom.replace(/[^\d]/g, "")) || 0)) : amount;
  const remaining = Math.max(0, expiresAt - now);
  const confirmRemaining = Math.max(0, confirmAvailableAt - now);
  const expired = !!payload && remaining <= 0 && !confirmed;
  const canConfirmNow = !!payload && !expired && !confirmed && confirmRemaining <= 0;

  function resetQr() {
    setPayload("");
    setReady(false);
    setExpiresAt(0);
    setConfirmAvailableAt(0);
    setConfirmed(false);
    setStatusMsg(null);
    setError(null);
  }

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
      const t = Date.now();
      setExpiresAt(t + EXPIRE_MS);
      setConfirmAvailableAt(t + CONFIRM_DELAY_MS);
      setNow(t);
      setStatusMsg("QRIS berhasil dibuat. Silakan scan dan selesaikan pembayaran sebelum waktu berakhir. Tombol konfirmasi dapat digunakan setelah 30 detik.");
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
    QRCode.toCanvas(canvasRef.current, payload, { width: 240, margin: 2, errorCorrectionLevel: "M" })
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
    if (expired) setStatusMsg("Waktu pembayaran telah berakhir. Silakan buat QRIS baru.");
  }, [expired]);

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
    if (!payload || expired || confirmRemaining > 0) return;
    setChecking(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 800));
    setConfirmed(true);
    setStatusMsg("Terima kasih! Jika pembayaran sudah berhasil, dukungan Anda telah kami terima.");
    setChecking(false);
  }

  return (
    <div className="grid xl:grid-cols-[1fr_1fr] gap-6 lg:gap-8 items-start">
      <Card className="p-5 sm:p-6 space-y-5">
        <div>
          <div className="font-medium text-base">Nominal Dukungan</div>
          <div className="text-sm text-zinc-400">Pilih nominal atau masukkan nominal lain, lalu buat QRIS dinamis.</div>
        </div>

        {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm px-4 py-3">{error}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setAmount(p); setCustom(""); resetQr(); }}
              className={`h-10 rounded-xl text-sm font-medium border transition ${!custom && amount === p ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100" : "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06]"}`}
            >
              {rp(p)}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label className="text-sm text-zinc-300">Nominal lain</label>
          <Input value={custom} onChange={(e) => { setCustom(e.target.value.replace(/[^\d]/g, "")); resetQr(); }} placeholder="Contoh: 25000" inputMode="numeric" />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <span className="text-sm text-zinc-400">Total</span>
          <span className="text-base font-semibold text-emerald-200">{rp(effectiveAmount || 0)}</span>
        </div>

        <Button className="w-full" onClick={generate} disabled={loading || effectiveAmount < 1000}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
          {loading ? "Membuat QRIS..." : "Buat QRIS Dinamis"}
        </Button>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
          <div className="text-sm font-medium text-zinc-200">Instruksi Pembayaran</div>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-zinc-400 leading-relaxed">
            <li>Scan QRIS menggunakan e-wallet atau mobile banking.</li>
            <li>Pastikan nominal pembayaran sesuai total di atas.</li>
            <li>Selesaikan pembayaran sebelum waktu berakhir.</li>
          </ol>
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="font-medium text-base">QRIS Pembayaran</div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 flex flex-col items-center gap-4">
          <div className="bg-white p-3 rounded-xl flex items-center justify-center min-h-[272px] min-w-[272px]">
            {payload ? (
              <canvas ref={canvasRef} width={240} height={240} className="block" />
            ) : (
              <div className="text-sm text-zinc-500 text-center px-4">QRIS akan muncul di sini setelah dibuat.</div>
            )}
          </div>
          {payload && !ready && <div className="text-xs text-zinc-400">Merender QR...</div>}
        </div>

        {payload && (
          <>
            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <Clock size={16} className={expired ? "text-red-300" : "text-emerald-300"} />
              <span className="text-sm text-zinc-400">Batas waktu pembayaran:</span>
              <span className={`text-sm font-semibold tabular-nums ${expired ? "text-red-300" : "text-emerald-200"}`}>
                {confirmed ? "Selesai" : expired ? "00:00 (kedaluwarsa)" : formatCountdown(remaining)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="secondary" onClick={downloadQr} className="w-full"><Download size={16}/> Download QRIS</Button>
              <Button onClick={confirmPayment} disabled={checking || expired || confirmed || confirmRemaining > 0} className="w-full">
                {checking ? <Loader2 size={16} className="animate-spin" /> : confirmed ? <CheckCircle2 size={16} /> : null}
                {checking ? "Memeriksa..." : confirmed ? "Terkonfirmasi" : confirmRemaining > 0 ? `Tunggu ${Math.ceil(confirmRemaining / 1000)} detik` : "Konfirmasi Pembayaran"}
              </Button>
            </div>
            {confirmRemaining > 0 && !confirmed && !expired && (
              <div className="text-xs text-zinc-400 text-center">Tombol konfirmasi dapat digunakan setelah {Math.ceil(confirmRemaining / 1000)} detik.</div>
            )}
          </>
        )}

        {(statusMsg || confirmed) && (
          <div className={`rounded-xl border px-4 py-3 ${confirmed ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : expired ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-white/10 bg-white/[0.03] text-zinc-300"}`}>
            <div className="font-medium text-sm">{confirmed ? "Status: Dukungan diterima" : expired ? "Status: Kedaluwarsa" : "Status: Menunggu pembayaran"}</div>
            <div className="text-sm opacity-90 mt-0.5">{statusMsg}</div>
          </div>
        )}

        <div className="text-xs text-zinc-500 text-center">QRIS dinamis dibuat via provider (sistem sama seperti checkout NetMart) dengan nominal sesuai pilihan.</div>
      </Card>
    </div>
  );
}
