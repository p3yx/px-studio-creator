"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Button, Input, Select, Badge, ConfirmDialog, Toast } from "@/components/ui";

const OFFICIAL_PROVIDERS = [
  { value: "google_gemini", label: "Google Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
];
const ALL_TYPES = [...OFFICIAL_PROVIDERS, { value: "custom_gateway", label: "Custom Provider (Gateway)" }];

function statusLabel(s?: string | null, hasKey?: boolean) {
  if (!hasKey) return "Not Configured";
  if (!s) return "Not Tested";
  if (s === "connected") return "Connected";
  if (s === "auth_failed") return "Invalid API Key";
  if (s === "model_not_found") return "Model Unavailable";
  if (s === "unsupported") return "Unsupported Capability";
  return "Connection Failed";
}

export default function AiProvidersClient() {
  const [providers, setProviders] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; type: "success" | "error" }>({ open: false, message: "", type: "success" });
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [configTarget, setConfigTarget] = useState<any | null>(null);
  const [mounted, setMounted] = useState(false);

  const [form, setForm] = useState<any>({ type: "google_gemini", name: "Google Gemini", apiKey: "", baseUrl: "", modelId: "", compatibility: "openai_compatible" });
  const [cfgForm, setCfgForm] = useState<any>({ apiKey: "", baseUrl: "", modelId: "", compatibility: "openai_compatible", name: "" });

  useEffect(() => { setMounted(true); }, []);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [p, u] = await Promise.all([
        fetch("/api/ai/providers", { cache: "no-store" }).then(x => x.json()),
        fetch("/api/ai/usage", { cache: "no-store" }).then(x => x.json()).catch(() => ({ logs: [] })),
      ]);
      if (p.error) throw new Error(p.error);
      setProviders(p.providers || []);
      setUsage(u.logs || []);
    } catch (e: any) { setErr(e.message || "Gagal memuat data provider"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const activeProvider = useMemo(() => providers.find(p => p.isDefault) || providers.find(p => p.enabled) || null, [providers]);

  function onTypeChange(type: string) {
    const isCustom = type === "custom_gateway";
    const label = ALL_TYPES.find(t => t.value === type)?.label || "Provider";
    setForm((f: any) => ({ ...f, type, name: isCustom ? (f.name && f.name !== "Google Gemini" && f.name !== "OpenAI" && f.name !== "Anthropic Claude" && f.name !== "Groq" && f.name !== "OpenRouter" ? f.name : "Custom Provider") : label, baseUrl: isCustom ? f.baseUrl : "", modelId: isCustom ? f.modelId : "", apiKey: "", compatibility: "openai_compatible" }));
  }

  async function saveProvider(e: React.FormEvent) {
    e.preventDefault(); setBusy("save"); setErr(null);
    try {
      const isCustom = form.type === "custom_gateway";
      const payload: any = {
        name: form.name || (ALL_TYPES.find(t => t.value === form.type)?.label || "Provider"),
        type: form.type === "custom_gateway" ? "custom_gateway" : form.type,
        apiKey: form.apiKey,
        isDefault: providers.length === 0, // first provider becomes active by default
      };
      if (isCustom) {
        payload.baseUrl = form.baseUrl;
        payload.modelId = form.modelId;
        payload.compatibility = form.compatibility || "openai_compatible";
      }
      const res = await fetch("/api/ai/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Gagal menyimpan provider");
      setToast({ open: true, message: "Provider berhasil disimpan.", type: "success" });
      setShowAdd(false);
      setForm({ type: "google_gemini", name: "Google Gemini", apiKey: "", baseUrl: "", modelId: "", compatibility: "openai_compatible" });
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function testProvider(id: string) {
    setBusy(`test-${id}`); setErr(null);
    try {
      const res = await fetch(`/api/ai/providers/${id}/test`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) setToast({ open: true, message: j.error || j.status || "Test koneksi gagal", type: "error" });
      else setToast({ open: true, message: "Koneksi provider berhasil.", type: "success" });
      await load();
    } catch (e: any) { setErr(e.message || "Test gagal"); } finally { setBusy(null); }
  }

  async function activateProvider(id: string) {
    setBusy(`active-${id}`); setErr(null);
    try {
      const res = await fetch(`/api/ai/providers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isDefault: true, enabled: true }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal mengaktifkan provider");
      setToast({ open: true, message: "Provider aktif berhasil diubah. Seluruh fitur AI akan menggunakan provider ini.", type: "success" });
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function removeProvider(id: string) {
    setBusy(`del-${id}`);
    try {
      const res = await fetch(`/api/ai/providers/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal menghapus provider");
      setToast({ open: true, message: "Provider berhasil dihapus.", type: "success" });
      await load();
    } catch (e: any) { setToast({ open: true, message: e.message || "Gagal menghapus provider", type: "error" }); }
    finally { setBusy(null); setDeleteTarget(null); }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!configTarget) return;
    setBusy(`cfg-${configTarget.id}`); setErr(null);
    try {
      const isCustom = configTarget.type === "custom_gateway" || configTarget.type === "custom" || configTarget.type === "openai_compatible";
      const payload: any = { id: configTarget.id, name: cfgForm.name || configTarget.name };
      if (cfgForm.apiKey && !String(cfgForm.apiKey).includes("•")) payload.apiKey = cfgForm.apiKey;
      if (isCustom) { payload.baseUrl = cfgForm.baseUrl; payload.modelId = cfgForm.modelId; payload.compatibility = cfgForm.compatibility; }
      const res = await fetch(`/api/ai/providers/${configTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal menyimpan konfigurasi");
      setToast({ open: true, message: "Konfigurasi provider berhasil diperbarui.", type: "success" });
      setConfigTarget(null);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  if (loading) return <div className="text-zinc-400 py-8">Memuat pengaturan AI provider...</div>;

  const hasProviders = providers.length > 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      {err && <Card className="p-4 border-red-500/20 bg-red-500/10 text-red-300 text-sm">{err}</Card>}

      {!hasProviders ? (
        <Card className="p-6 sm:p-8 space-y-4">
          <div className="space-y-2">
            <div className="font-medium text-base">Belum ada konfigurasi AI provider</div>
            <div className="text-sm text-zinc-400">Tambahkan provider untuk mulai menggunakan fitur AI. Provider resmi cukup API Key, Custom Gateway dapat dikonfigurasi sesuai endpoint dan model Anda.</div>
          </div>
          <div>
            <Button onClick={() => setShowAdd(true)}>Add Provider</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium text-base">Active AI Provider</div>
                <div className="text-sm text-zinc-400 mt-1">Satu provider aktif digunakan secara global untuk seluruh fitur AI.</div>
              </div>
              <Badge className={activeProvider ? "border-emerald-500/30 text-emerald-200" : "border-amber-500/30 text-amber-200"}>{activeProvider ? "Aktif" : "Belum dipilih"}</Badge>
            </div>
            {activeProvider ? (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="font-medium text-white">{activeProvider.name} <span className="text-zinc-400 font-normal">({activeProvider.type === 'custom_gateway' ? 'Custom Provider (Gateway)' : activeProvider.type})</span></div>
                  <div className="text-sm text-zinc-400 mt-1">Status: <span className={activeProvider.lastTestStatus === 'connected' ? 'text-emerald-300' : 'text-zinc-300'}>{statusLabel(activeProvider.lastTestStatus, activeProvider.hasApiKey)}</span> · API Key: {activeProvider.hasApiKey ? (activeProvider.apiKeyMasked || 'Tersimpan') : 'Belum ada'}</div>
                </div>
                <div className="text-sm text-zinc-300">Seluruh fitur AI menggunakan provider ini.</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-500 rounded-xl border border-white/10 bg-white/[0.02] p-4">Belum ada provider aktif. Uji koneksi lalu aktifkan salah satu provider.</div>
            )}
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium text-base">Configured Providers</div>
                <div className="text-sm text-zinc-400 mt-1">Simpan beberapa provider, pilih satu sebagai provider aktif.</div>
              </div>
              <Button onClick={() => setShowAdd(true)}>Add Provider</Button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {providers.map(p => (
                <div key={p.id} className={`rounded-xl border p-4 space-y-3 ${p.isDefault ? 'border-violet-500/30 bg-violet-500/[0.04]' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2 flex-wrap">{p.name} {p.isDefault && <Badge className="border-violet-500/30 text-violet-200">Active</Badge>}</div>
                      <div className="text-xs text-zinc-500 mt-1">{p.type === 'custom_gateway' ? 'Custom Provider (Gateway)' : 'Official Provider'}</div>
                    </div>
                  </div>
                  <div className="text-sm space-y-1">
                    <div className="text-zinc-400">Status: <span className={p.lastTestStatus === 'connected' ? 'text-emerald-300' : p.lastTestStatus ? 'text-amber-300' : 'text-zinc-300'}>{statusLabel(p.lastTestStatus, p.hasApiKey)}</span></div>
                    <div className="text-zinc-400">API Key: <span className="text-zinc-200">{p.hasApiKey ? (p.apiKeyMasked || 'Tersimpan (masked)') : 'Belum dikonfigurasi'}</span></div>
                    {p.type === 'custom_gateway' && p.baseUrl && <div className="text-xs text-zinc-500 break-all">Base URL: {p.baseUrl}</div>}
                    {p.type === 'custom_gateway' && p.models?.[0]?.modelId && <div className="text-xs text-zinc-500 break-all">Model: {p.models[0].modelId}</div>}
                    {p.lastTestedAt && <div className="text-xs text-zinc-500">Last test: {new Date(p.lastTestedAt).toLocaleString()}</div>}
                    {p.lastTestError && p.lastTestStatus !== 'connected' && <div className="text-xs text-red-300/90 break-words">{p.lastTestError}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="secondary" onClick={() => testProvider(p.id)} disabled={busy === `test-${p.id}`}>{busy === `test-${p.id}` ? 'Testing...' : 'Test Connection'}</Button>
                    <Button variant="secondary" onClick={() => { setConfigTarget(p); setCfgForm({ name: p.name || '', apiKey: '', baseUrl: p.baseUrl || '', modelId: (p.models && p.models[0]?.modelId) || '', compatibility: (p.config && p.config.compatibility) || 'openai_compatible' }); }} disabled={!!busy}>Configure</Button>
                    <Button onClick={() => activateProvider(p.id)} disabled={!!busy || p.isDefault}>{p.isDefault ? 'Active' : 'Activate'}</Button>
                    <Button variant="danger" onClick={() => setDeleteTarget(p)} disabled={!!busy}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="font-medium text-base">Usage / Status</div>
            <div className="text-sm text-zinc-400">Semua fitur AI menggunakan provider aktif. Log penggunaan terakhir ditampilkan untuk referensi.</div>
            {usage.length === 0 ? <div className="text-sm text-zinc-500">Belum ada log penggunaan.</div> : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-zinc-400 border-b border-white/10"><th className="py-2 pr-3">Waktu</th><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">Fungsi</th><th className="py-2 pr-3">Status</th></tr></thead>
                  <tbody>
                    {usage.slice(0, 30).map((l: any) => (
                      <tr key={l.id} className="border-b border-white/5"><td className="py-2 pr-3 text-zinc-400">{new Date(l.createdAt).toLocaleString()}</td><td className="py-2 pr-3">{l.provider || '-'}</td><td className="py-2 pr-3">{l.task || '-'}</td><td className={`py-2 pr-3 ${l.success ? 'text-emerald-300' : 'text-red-300'}`}>{l.status || (l.success ? 'success' : 'error')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {mounted && showAdd && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !busy && setShowAdd(false)} />
          <div className="relative w-full max-w-lg panel rounded-2xl p-5 sm:p-6 shadow-2xl ring-1 ring-white/10 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between gap-3"><div className="font-medium text-lg">Add Provider</div><button className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5" onClick={() => !busy && setShowAdd(false)}>✕</button></div>
            <form onSubmit={saveProvider} className="space-y-4">
              <div className="space-y-2"><label className="text-sm text-zinc-300">Provider</label>
                <Select value={form.type} onChange={e => onTypeChange(e.target.value)}>
                  <optgroup label="Official Providers">{OFFICIAL_PROVIDERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</optgroup>
                  <optgroup label="Custom"><option value="custom_gateway">Custom Provider (Gateway)</option></optgroup>
                </Select>
              </div>
              <div className="space-y-2"><label className="text-sm text-zinc-300">Provider Name</label><Input value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="Nama provider" /></div>
              {form.type === "custom_gateway" ? (
                <>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">Base URL</label><Input value={form.baseUrl} onChange={e => setForm((f: any) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://gateway.example.com/v1" /></div>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">API Key</label><Input value={form.apiKey} onChange={e => setForm((f: any) => ({ ...f, apiKey: e.target.value }))} placeholder="Masukkan API Key gateway" /></div>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">Model ID</label><Input value={form.modelId} onChange={e => setForm((f: any) => ({ ...f, modelId: e.target.value }))} placeholder="Model yang tersedia di gateway" /></div>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">API Compatibility</label>
                    <Select value={form.compatibility} onChange={e => setForm((f: any) => ({ ...f, compatibility: e.target.value }))}>
                      <option value="openai_compatible">OpenAI Compatible</option>
                      <option value="custom">Custom Adapter (jika didukung)</option>
                    </Select>
                  </div>
                  <div className="text-xs text-zinc-500">Custom Provider (Gateway) dikonfigurasi terpisah dari provider resmi. Gunakan endpoint dan model milik Anda sendiri.</div>
                </>
              ) : (
                <>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">API Key</label><Input value={form.apiKey} onChange={e => setForm((f: any) => ({ ...f, apiKey: e.target.value }))} placeholder="Masukkan API Key" /></div>
                  <div className="text-xs text-zinc-500">Provider resmi cukup menggunakan API Key. Endpoint dan konfigurasi teknis dikelola otomatis oleh sistem.</div>
                </>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} disabled={busy === 'save'}>Cancel</Button>
                <Button type="submit" disabled={busy === 'save'}>{busy === 'save' ? 'Menyimpan...' : 'Save Provider'}</Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {mounted && configTarget && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !busy && setConfigTarget(null)} />
          <div className="relative w-full max-w-lg panel rounded-2xl p-5 sm:p-6 shadow-2xl ring-1 ring-white/10 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between gap-3"><div className="font-medium text-lg">Configure Provider</div><button className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5" onClick={() => !busy && setConfigTarget(null)}>✕</button></div>
            <form onSubmit={saveConfig} className="space-y-4">
              <div className="space-y-2"><label className="text-sm text-zinc-300">Provider Name</label><Input value={cfgForm.name} onChange={e => setCfgForm((f: any) => ({ ...f, name: e.target.value }))} /></div>
              {(configTarget.type === 'custom_gateway' || configTarget.type === 'custom' || configTarget.type === 'openai_compatible') && (
                <>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">Base URL</label><Input value={cfgForm.baseUrl} onChange={e => setCfgForm((f: any) => ({ ...f, baseUrl: e.target.value }))} /></div>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">Model ID</label><Input value={cfgForm.modelId} onChange={e => setCfgForm((f: any) => ({ ...f, modelId: e.target.value }))} /></div>
                  <div className="space-y-2"><label className="text-sm text-zinc-300">API Compatibility</label>
                    <Select value={cfgForm.compatibility} onChange={e => setCfgForm((f: any) => ({ ...f, compatibility: e.target.value }))}>
                      <option value="openai_compatible">OpenAI Compatible</option>
                      <option value="custom">Custom Adapter (jika didukung)</option>
                    </Select>
                  </div>
                </>
              )}
              <div className="space-y-2"><label className="text-sm text-zinc-300">API Key (kosongkan jika tidak diubah)</label><Input value={cfgForm.apiKey} onChange={e => setCfgForm((f: any) => ({ ...f, apiKey: e.target.value }))} placeholder="Masukkan API Key baru" /></div>
              <div className="text-xs text-zinc-500">API key disimpan terenkripsi di server dan ditampilkan dalam bentuk masked.</div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setConfigTarget(null)} disabled={!!busy}>Cancel</Button>
                <Button type="submit" disabled={!!busy}>{busy === `cfg-${configTarget.id}` ? 'Menyimpan...' : 'Save'}</Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus provider?"
        description={deleteTarget ? `Provider "${deleteTarget.name}" akan dihapus. Jika provider ini aktif, Anda perlu mengaktifkan provider lain.` : undefined}
        confirmText="Hapus Provider"
        cancelText="Batal"
        variant="danger"
        busy={!!busy && busy.startsWith('del-')}
        onCancel={() => { if (!busy || !busy.startsWith('del-')) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) removeProvider(deleteTarget.id); }}
      />
      <Toast open={toast.open} message={toast.message} type={toast.type} onClose={() => setToast(t => ({ ...t, open: false }))} />
    </div>
  );
}
