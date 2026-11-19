"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Button, Select, Badge, Toast } from "@/components/ui";
import { ChevronDown, Check } from "lucide-react";

type AiSettings = {
  gateway?: string;
  providerId?: string;
  providerType?: string;
  providers?: Provider[];
  activeModel?: string | null;
  defaultModel?: string | null;
  connectionStatus?: string;
  connectionError?: string | null;
  lastUpdated?: string | null;
  models?: string[];
};

type Provider = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  createdAt?: string;
};

type Preset = { type: string; name: string; baseUrl: string; models: string[] };

function statusLabel(s?: string | null) {
  if (!s || s === "unknown") return "Unknown";
  if (s === "no_provider") return "Belum ada provider";
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
  const [providers, setProviders] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [providerBusy, setProviderBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "google_gemini", baseUrl: "", apiKey: "" });
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function loadSettings() {
    const res = await fetch("/api/ai/settings", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Gagal memuat pengaturan AI");
    setData(j);
    setProviders(Array.isArray(j.providers) ? j.providers : []);
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

  async function loadProviders() {
    const res = await fetch("/api/ai/providers", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error(j.error || "Gagal memuat provider");
    setProviders(Array.isArray(j.providers) ? j.providers : []);
    setPresets(Array.isArray(j.presets) ? j.presets : []);
  }

  useEffect(() => { loadProviders().catch(() => {}); }, []);

  async function onAuto() {
    setAutoRunning(true); setError(null);
    try {
      const res = await fetch("/api/ai/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: true }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || "Auto detect gagal");
      await loadSettings();
      setSelected(String(j.model || ""));
      setToast({ open: true, message: `Model aktif otomatis: ${j.model} (${j.provider || "provider"})`, type: "success" });
    } catch (e: any) {
      setError(e?.message || "Auto detect gagal");
      setToast({ open: true, message: e?.message || "Auto detect gagal", type: "error" });
    } finally { setAutoRunning(false); }
  }

  async function onSaveProvider() {
    setProviderBusy("new"); setError(null);
    try {
      const res = await fetch("/api/ai/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, activate: true }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || "Gagal menyimpan provider");
      await Promise.all([loadProviders(), loadSettings(), loadModels(true)]);
      setShowAdd(false);
      setForm({ name: "", type: "google_gemini", baseUrl: "", apiKey: "" });
      setToast({ open: true, message: "Provider ditambahkan dan diaktifkan.", type: "success" });
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan provider");
      setToast({ open: true, message: e?.message || "Gagal menyimpan provider", type: "error" });
    } finally { setProviderBusy(null); }
  }

  async function onProviderAction(id: string, action: "activate" | "test" | "delete" | "models") {
    setProviderBusy(id); setError(null);
    try {
      const url = action === "models" ? `/api/ai/providers/${encodeURIComponent(id)}/models` : `/api/ai/providers/${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        method: action === "delete" ? "DELETE" : action === "activate" ? "PATCH" : action === "models" ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "activate" ? JSON.stringify({ activate: true }) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || "Aksi provider gagal");
      if (action === "models") {
        if (Array.isArray(j.models)) setModels(j.models);
        if (j.error) throw new Error(String(j.error));
      }
      if (action === "activate") {
        await loadModels(true).catch(() => {});
        const s = await loadSettings();
        setSelected(String(s.activeModel || ""));
      } else {
        await Promise.all([loadProviders(), loadSettings()]);
      }
      setToast({ open: true, message: action === "test" ? "Koneksi provider berhasil." : `Provider ${action} berhasil.`, type: "success" });
    } catch (e: any) {
      setError(e?.message || "Aksi provider gagal");
      setToast({ open: true, message: e?.message || "Aksi provider gagal", type: "error" });
    } finally { setProviderBusy(null); }
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
        <div className="text-xs text-violet-200 mt-1">Provider aktif global: <b>{data?.gateway || "-"}</b> · model &amp; koneksi mengikuti provider ini.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">AI MODEL</label>
          <Select value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Pilih AI Model</option>
            {options.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <div className="text-xs text-zinc-500">Daftar model diambil dari provider aktif. Klik <b>Auto Detect</b> untuk mencari model yang benar-benar merespons.</div>
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
        <Button variant="secondary" onClick={onRefresh} disabled={refreshing || saving || testing || autoRunning}>{refreshing ? "Memuat..." : "Refresh Models"}</Button>
        <Button variant="secondary" onClick={onAuto} disabled={autoRunning || refreshing || saving || testing}>{autoRunning ? "Mencari model..." : "Auto Detect Model"}</Button>
        <Button variant="secondary" onClick={onTest} disabled={testing || saving || refreshing || autoRunning}>{testing ? "Testing..." : "Test AI Connection"}</Button>
        <Button onClick={onSave} disabled={saving || !selected || refreshing || testing}>{saving ? "Menyimpan..." : "Save Selected Model"}</Button>
      </div>

      <div className="pt-2 border-t border-white/10 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium text-zinc-200">Provider AI</div>
            <div className="text-xs text-zinc-500 mt-0.5">Tambahkan provider resmi (Gemini, OpenAI, Claude, Groq, OpenRouter) atau custom gateway OpenAI-compatible. Klik Aktifkan untuk memakainya.</div>
          </div>
          <Button type="button" variant="secondary" onClick={()=>setShowAdd(s=>!s)}>{showAdd ? "Tutup" : "+ Tambah Provider"}</Button>
        </div>

        {showAdd && typeof document !== "undefined" && createPortal((
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={e=>{ if(e.target===e.currentTarget) setShowAdd(false); }}>
            <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#14141a] p-5 space-y-4 shadow-2xl shadow-black/70">
              <div className="flex items-center justify-between">
                <div className="font-medium text-zinc-100">Tambah Provider AI</div>
                <button type="button" onClick={()=>setShowAdd(false)} className="text-xs text-zinc-400 hover:text-zinc-100">Tutup</button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Jenis Provider</label>
                <div className="relative" ref={typeRef}>
                  <button type="button" onClick={()=>setTypeOpen(o=>!o)} className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm flex items-center justify-between hover:bg-white/[0.06]">
                    <span className="truncate text-left">{presets.find(p=>p.type===form.type)?.name || "Custom Gateway (OpenAI-compatible)"}</span>
                    <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition ${typeOpen ? "rotate-180" : ""}`} />
                  </button>
                  {typeOpen && (
                    <div className="absolute z-30 mt-1 left-0 right-0 max-h-64 overflow-auto rounded-lg border border-white/15 bg-[#16161d] p-1 shadow-2xl shadow-black/60">
                      <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">Official Providers</div>
                      {presets.filter(p=>p.type!=="custom_gateway").map(p=>(
                        <button key={p.type} type="button" onClick={()=>{
                          setForm(f=>({ ...f, type: p.type, name: p.name, baseUrl: p.baseUrl }));
                          setTypeOpen(false);
                        }} className={`w-full flex items-center justify-between gap-2 text-left px-2 h-8 rounded-md text-sm hover:bg-white/[0.08] ${form.type===p.type ? "text-violet-200 bg-violet-500/10" : "text-zinc-200"}`}>
                          <span>{p.name}</span>{form.type===p.type && <Check size={13} />}
                        </button>
                      ))}
                      <div className="px-2 pt-2 pb-1 mt-1 border-t border-white/10 text-[10px] uppercase tracking-wide text-zinc-500">Custom</div>
                      <button type="button" onClick={()=>{
                        setForm(f=>({ ...f, type: "custom_gateway", name: f.name && presets.some(p=>p.name===f.name) ? "" : f.name, baseUrl: "" }));
                        setTypeOpen(false);
                      }} className={`w-full flex items-center justify-between gap-2 text-left px-2 h-8 rounded-md text-sm hover:bg-white/[0.08] ${form.type==="custom_gateway" ? "text-violet-200 bg-violet-500/10" : "text-zinc-200"}`}>
                        <span>Custom Gateway (OpenAI-compatible)</span>{form.type==="custom_gateway" && <Check size={13} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1"><label className="text-xs text-zinc-400">Nama</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm" /></div>
              <div className="space-y-1 sm:col-span-2"><label className="text-xs text-zinc-400">Base URL (boleh dikosongkan untuk preset resmi)</label><input value={form.baseUrl} onChange={e=>setForm(f=>({...f,baseUrl:e.target.value}))} placeholder="https://..." className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm" /></div>
              <div className="space-y-1 sm:col-span-2"><label className="text-xs text-zinc-400">API Key</label><input type="password" value={form.apiKey} onChange={e=>setForm(f=>({...f,apiKey:e.target.value}))} placeholder="sk-... / AIza..." className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm" /><div className="text-[10px] text-zinc-500">Gemini: kunci dari Google AI Studio diawali <code>AIza</code> (±39 karakter). Awalan seperti <code>API key:</code> otomatis dibuang. Jangan isi hanya teks "API".</div></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={()=>setShowAdd(false)}>Batal</Button>
              <Button onClick={onSaveProvider} disabled={providerBusy==="new"}>{providerBusy==="new" ? "Menyimpan..." : "Simpan & Aktifkan"}</Button>
            </div>
            </div>
          </div>
        ), document.body)}

        <div className="space-y-2">
          {providers.length === 0 && (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              Belum ada provider. Klik <b>+ Tambah Provider</b> untuk menambahkan API resmi (Gemini, OpenAI, Claude, Groq, OpenRouter) atau Custom Gateway. Provider pertama yang ditambahkan otomatis dipakai secara global.
            </div>
          )}
          {providers.map(p=>{
            const active = p.id === data?.providerId;
            const busy = providerBusy === p.id;
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-200 truncate">{p.name} {active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 ml-1">AKTIF</span>}</div>
                  <div className="text-[11px] text-zinc-500 truncate">{p.type} · {p.baseUrl || "(default)"}</div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <button type="button" onClick={()=>onProviderAction(p.id,"models")} disabled={busy} className="text-[11px] px-2 h-7 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-40">Model</button>
                  <button type="button" onClick={()=>onProviderAction(p.id,"test")} disabled={busy} className="text-[11px] px-2 h-7 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-40">Test</button>
                  {!active && <button type="button" onClick={()=>onProviderAction(p.id,"activate")} disabled={busy} className="text-[11px] px-2 h-7 rounded-md border border-violet-400/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 disabled:opacity-40">Aktifkan</button>}
                  <button type="button" onClick={()=>onProviderAction(p.id,"delete")} disabled={busy} className="text-[11px] px-2 h-7 rounded-md border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40">Hapus</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-zinc-500 leading-relaxed">
        Model aktif digunakan secara global untuk seluruh fitur AI. Jika model tidak mendukung kemampuan tertentu (mis. vision/audio/STT/TTS), fitur terkait dapat menampilkan keterbatasan atau gagal untuk permintaan yang tidak kompatibel. API key dan endpoint gateway tidak ditampilkan di dashboard.
      </div>

      <Toast open={toast.open} message={toast.message} type={toast.type} onClose={() => setToast(t => ({ ...t, open: false }))} />
    </Card>
  );
}
