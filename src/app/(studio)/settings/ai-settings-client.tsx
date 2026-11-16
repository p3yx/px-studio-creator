"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, Button, Select, Badge, Toast } from "@/components/ui";

type AiSettings = {
  gateway?: string;
  activeModel?: string | null;
  defaultModel?: string | null;
  connectionStatus?: string;
  connectionError?: string | null;
  lastUpdated?: string | null;
  models?: string[];
};

function statusLabel(s?: string | null) {
  if (!s || s === "unknown") return "Unknown";
  if (s === "connected") return "Connected";
  if (s === "auth_failed") return "Authentication Failed";
  if (s === "gateway_unavailable") return "Gateway Unavailable";
  if (s === "model_not_found") return "Model Not Found";
  if (s === "timeout") return "Timeout";
  if (s === "unsupported") return "Unsupported Request";
  return "Connection Error";
}

export default function AiSettingsClient() {
  const [data, setData] = useState<AiSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; type: "success" | "error" }>({ open: false, message: "", type: "success" });

  async function loadSettings() {
    const res = await fetch("/api/ai/settings", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Gagal memuat pengaturan AI");
    setData(j);
    setModels(Array.isArray(j.models) ? j.models : []);
    setSelected(String(j.activeModel || j.defaultModel || ""));
    return j;
  }

  async function loadModels(refresh = false) {
    const res = await fetch("/api/ai/models", { method: refresh ? "POST" : "GET", cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (j.models && Array.isArray(j.models)) {
      setModels(j.models);
      if (j.lastUpdated || j.connectionStatus) {
        setData(d => ({ ...(d || {}), lastUpdated: j.lastUpdated ?? d?.lastUpdated ?? null, connectionStatus: j.ok === false && j.error ? (d?.connectionStatus || "error") : (d?.connectionStatus || "connected"), models: j.models }));
      }
    }
    if (!res.ok || j.ok === false) {
      throw new Error(j.error || "Gagal memuat daftar model");
    }
    return j;
  }

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        await loadSettings();
        // try load models; if fails keep saved/active model
        try { await loadModels(false); } catch (e: any) { setError(e?.message || null); }
      } catch (e: any) {
        setError(e?.message || "Gagal memuat pengaturan AI");
      } finally { setLoading(false); }
    })();
  }, []);

  const status = data?.connectionStatus || "unknown";
  const statusOk = status === "connected";

  async function onRefresh() {
    setRefreshing(true); setError(null);
    try {
      const j = await loadModels(true);
      await loadSettings();
      setToast({ open: true, message: j.fromCache ? "Daftar model dimuat dari cache terakhir." : "Daftar model berhasil diperbarui.", type: "success" });
    } catch (e: any) {
      setError(e?.message || "Gagal memuat daftar model");
      // keep previously saved model/selection
      await loadSettings().catch(() => {});
      setToast({ open: true, message: e?.message || "Gagal memuat daftar model", type: "error" });
    } finally { setRefreshing(false); }
  }

  async function onSave() {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/ai/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selected }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || "Gagal menyimpan model");
      await loadSettings();
      setToast({ open: true, message: "Model AI berhasil disimpan.", type: "success" });
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan model");
      setToast({ open: true, message: e?.message || "Gagal menyimpan model", type: "error" });
    } finally { setSaving(false); }
  }

  async function onTest() {
    setTesting(true); setError(null);
    try {
      const res = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selected || data?.activeModel || "" }) });
      const j = await res.json().catch(() => ({}));
      await loadSettings();
      if (!res.ok || j.ok === false) throw new Error(j.error || statusLabel(j.status) || "Koneksi gagal");
      setToast({ open: true, message: "Koneksi AI berhasil.", type: "success" });
    } catch (e: any) {
      setError(e?.message || "Tes koneksi gagal");
      setToast({ open: true, message: e?.message || "Tes koneksi gagal", type: "error" });
    } finally { setTesting(false); }
  }

  const options = useMemo(() => {
    const list = [...models];
    if (selected && !list.includes(selected)) list.unshift(selected);
    return list;
  }, [models, selected]);

  if (loading) return <div className="text-zinc-400 py-4">Memuat konfigurasi AI...</div>;

  return (
    <Card className="p-5 sm:p-6 space-y-5">
      <div className="space-y-1">
        <div className="font-medium text-base">AI CONFIGURATION</div>
        <div className="text-sm text-zinc-400">Pilih model AI yang digunakan untuk seluruh fitur PX STUDIO CREATOR.</div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-1">
        <div className="text-sm text-zinc-400">AI Gateway</div>
        <div className="font-medium text-white">9Router</div>
        <div className="text-xs text-zinc-500">Terhubung melalui konfigurasi server.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">AI MODEL</label>
          <Select value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Pilih AI Model</option>
            {options.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <div className="text-xs text-zinc-500">Daftar model diambil secara dinamis dari 9Router melalui backend.</div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-sm text-zinc-400">Active Model</div>
            <div className="text-sm text-white font-medium truncate max-w-[60%] text-right">{data?.activeModel || selected || "Belum dipilih"}</div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-sm text-zinc-400">Connection</div>
            <Badge className={statusOk ? "border-emerald-500/30 text-emerald-200" : "border-amber-500/30 text-amber-200"}>{statusLabel(status)}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-sm text-zinc-400">Last Updated</div>
            <div className="text-sm text-zinc-300">{data?.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : "-"}</div>
          </div>
        </div>
      </div>

      {(error || data?.connectionError) && (
        <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 break-words">
          {error || data?.connectionError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="secondary" onClick={onRefresh} disabled={refreshing || saving || testing}>{refreshing ? "Memuat..." : "Refresh Models"}</Button>
        <Button variant="secondary" onClick={onTest} disabled={testing || saving || refreshing}>{testing ? "Testing..." : "Test AI Connection"}</Button>
        <Button onClick={onSave} disabled={saving || !selected || refreshing || testing}>{saving ? "Menyimpan..." : "Save Selected Model"}</Button>
      </div>

      <div className="text-xs text-zinc-500 leading-relaxed">
        Model aktif digunakan secara global untuk seluruh fitur AI. Jika model tidak mendukung kemampuan tertentu (mis. vision/audio/STT/TTS), fitur terkait dapat menampilkan keterbatasan atau gagal untuk permintaan yang tidak kompatibel. API key dan endpoint gateway tidak ditampilkan di dashboard.
      </div>

      <Toast open={toast.open} message={toast.message} type={toast.type} onClose={() => setToast(t => ({ ...t, open: false }))} />
    </Card>
  );
}
