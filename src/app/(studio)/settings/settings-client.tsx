"use client";
import { useEffect, useState } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import AiSettingsClient from "./ai-settings-client";

export default function SettingsClient() {
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);
  const [wmUploading, setWmUploading] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  useEffect(()=>{ fetch('/api/settings').then(r=>r.json()).then(d=>{ setData(d); }).catch(()=>{}); },[]);
  async function save() {
    setSaving(true); setMsg(null);
    const res = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data||{}) });
    const j = await res.json();
    setMsg(res.ok ? 'Pengaturan berhasil disimpan.' : (j.error||'Gagal menyimpan pengaturan'));
    setSaving(false);
  }
  const f = (k:string, v:any) => setData((d:any)=>({...d,[k]:v}));
  const fb = (k:string, v:any) => setData((d:any)=>({ ...d, brandKit: { ...(d?.brandKit||{}), [k]: v } }));

  async function uploadWatermark(file: File) {
    setWmUploading(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/settings/watermark', { method: 'POST', body: fd });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j.error || 'Gagal upload watermark');
      setData((d:any)=>({ ...d, brandKit: j.brandKit || { ...(d?.brandKit||{}), watermarkPath: j.path, watermarkEnabled: true } }));
      setMsg('Watermark berhasil diupload dan diaktifkan.');
    } catch (e:any) { setMsg(e?.message || 'Gagal upload watermark'); }
    finally { setWmUploading(false); }
  }

  function saveProfile() {
    const name = profileName.trim();
    if (!name) { setMsg('Nama profil wajib diisi.'); return; }
    const profiles = Array.isArray(data?.brandProfiles) ? [...data.brandProfiles] : [];
    const idx = profiles.findIndex((p:any)=>p?.name === name);
    const entry = { name, kit: data?.brandKit || {} };
    if (idx >= 0) profiles[idx] = entry; else profiles.push(entry);
    setData((d:any)=>({ ...d, brandProfiles: profiles }));
    setSelectedProfile(name);
    setMsg(`Profil "${name}" disimpan (klik Simpan Pengaturan untuk persist).`);
  }
  function applyProfile(name: string) {
    const profiles = Array.isArray(data?.brandProfiles) ? data.brandProfiles : [];
    const p = profiles.find((x:any)=>x?.name === name);
    if (!p) return;
    setData((d:any)=>({ ...d, brandKit: { ...(d?.brandKit||{}), ...(p.kit||{}) } }));
    setSelectedProfile(name);
    setMsg(`Profil "${name}" diterapkan (klik Simpan Pengaturan untuk persist).`);
  }
  function deleteProfile(name: string) {
    const profiles = (Array.isArray(data?.brandProfiles) ? data.brandProfiles : []).filter((p:any)=>p?.name !== name);
    setData((d:any)=>({ ...d, brandProfiles: profiles }));
    if (selectedProfile === name) setSelectedProfile('');
    setMsg(`Profil "${name}" dihapus (klik Simpan Pengaturan untuk persist).`);
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="space-y-4">
        <AiSettingsClient />
      </section>

      <Card className="p-5 sm:p-6 lg:p-7 space-y-5">
        <div className="space-y-1">
          <div className="font-medium text-base">Pemrosesan & Batas</div>
          <div className="text-sm text-zinc-400">Atur batas unggahan, durasi, dan preferensi pemrosesan project.</div>
        </div>
        {!data ? (
          <div className="text-zinc-400">Memuat pengaturan pemrosesan...</div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Max Upload (MB)</label><Input value={data.maxUploadMb||""} onChange={e=>f('maxUploadMb',e.target.value)} /></div>
              <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Max Concurrent Jobs</label><Input value={data.maxConcurrentJobs||""} onChange={e=>f('maxConcurrentJobs',e.target.value)} /></div>
              <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Max Video Duration (s)</label><Input value={data.maxVideoDurationSeconds||""} onChange={e=>f('maxVideoDurationSeconds',e.target.value)} /></div>
              <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">FFmpeg Path</label><Input value={data.ffmpegPath||""} onChange={e=>f('ffmpegPath',e.target.value)} placeholder="ffmpeg" /></div>
            </div>

            <div className="pt-2 border-t border-white/10 space-y-4">
              <div className="space-y-1">
                <div className="font-medium text-base">Brand Kit & Output Defaults</div>
                <div className="text-sm text-zinc-400">Preset watermark/logo, gaya subtitle, dan normalisasi loudness untuk render (auto-caption, clip, montage, beat, convert).</div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Loudness Normalize (EBU R128)</label>
                  <Select value={String(data.brandKit?.loudnessNormalize ?? true)} onChange={e=>fb('loudnessNormalize', e.target.value === 'true')}>
                    <option value="true">Aktif (disarankan)</option>
                    <option value="false">Nonaktif</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Watermark/Logo</label>
                  <Select value={String(data.brandKit?.watermarkEnabled ?? false)} onChange={e=>fb('watermarkEnabled', e.target.value === 'true')}>
                    <option value="false">Nonaktif</option>
                    <option value="true">Aktif</option>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium text-zinc-300">Watermark/Logo (upload atau path)</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input value={data.brandKit?.watermarkPath||""} onChange={e=>fb('watermarkPath', e.target.value || null)} placeholder="Path file di server/storage (atau upload di samping)" />
                    <label className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm cursor-pointer whitespace-nowrap">
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={e=>{ const file=e.target.files?.[0]; if(file) uploadWatermark(file); e.currentTarget.value=''; }} />
                      {wmUploading ? 'Mengupload...' : 'Upload Logo'}
                    </label>
                  </div>
                  <div className="text-xs text-zinc-500">Upload akan menyimpan ke storage server dan mengaktifkan watermark. Anda juga bisa isi path manual.</div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Posisi Watermark</label>
                  <Select value={data.brandKit?.watermarkPosition || 'bottom-right'} onChange={e=>fb('watermarkPosition', e.target.value)}>
                    <option value="top-left">Kiri Atas</option>
                    <option value="top-right">Kanan Atas</option>
                    <option value="bottom-left">Kiri Bawah</option>
                    <option value="bottom-right">Kanan Bawah</option>
                    <option value="center">Tengah</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Opacity Watermark (0-1)</label>
                  <Input value={String(data.brandKit?.watermarkOpacity ?? 0.8)} onChange={e=>fb('watermarkOpacity', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Skala Watermark (0.05-0.6)</label>
                  <Input value={String(data.brandKit?.watermarkScale ?? 0.18)} onChange={e=>fb('watermarkScale', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Margin Watermark (px)</label>
                  <Input value={String(data.brandKit?.watermarkMargin ?? 24)} onChange={e=>fb('watermarkMargin', e.target.value)} />
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="text-sm font-medium text-zinc-200">Profil Brand Kit (Preset Bernama)</div>
                <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
                  <Input value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Nama profil (mis. Kanal Utama)" />
                  <Button type="button" variant="secondary" onClick={saveProfile}>Simpan Profil</Button>
                  <Button type="button" variant="secondary" onClick={()=>{ if(selectedProfile) deleteProfile(selectedProfile); }}>Hapus</Button>
                </div>
                <div className="grid sm:grid-cols-[1fr_auto] gap-2">
                  <Select value={selectedProfile} onChange={e=>{ setSelectedProfile(e.target.value); if(e.target.value) applyProfile(e.target.value); }}>
                    <option value="">Pilih profil untuk diterapkan...</option>
                    {(Array.isArray(data.brandProfiles)?data.brandProfiles:[]).map((p:any)=>(<option key={p.name} value={p.name}>{p.name}</option>))}
                  </Select>
                  <Button type="button" variant="secondary" onClick={()=>{ if(selectedProfile) applyProfile(selectedProfile); }}>Terapkan</Button>
                </div>
                <div className="text-xs text-zinc-500">Simpan profil dari Brand Kit saat ini, lalu klik “Simpan Pengaturan” untuk menyimpan daftar profil ke server.</div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Ukuran Font Subtitle</label>
                  <Input value={String(data.brandKit?.subtitleFontSize ?? 22)} onChange={e=>fb('subtitleFontSize', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Nama Font (opsional)</label>
                  <Input value={data.brandKit?.subtitleFontName||""} onChange={e=>fb('subtitleFontName', e.target.value || null)} placeholder="Arial, Montserrat, dll" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Warna Teks Subtitle</label>
                  <Input value={data.brandKit?.subtitlePrimaryColor||"#FFFFFF"} onChange={e=>fb('subtitlePrimaryColor', e.target.value)} placeholder="#FFFFFF" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Warna Outline Subtitle</label>
                  <Input value={data.brandKit?.subtitleOutlineColor||"#000000"} onChange={e=>fb('subtitleOutlineColor', e.target.value)} placeholder="#000000" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Outline</label>
                  <Input value={String(data.brandKit?.subtitleOutline ?? 2)} onChange={e=>fb('subtitleOutline', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Shadow</label>
                  <Input value={String(data.brandKit?.subtitleShadow ?? 0)} onChange={e=>fb('subtitleShadow', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Margin Bawah (MarginV)</label>
                  <Input value={String(data.brandKit?.subtitleMarginV ?? 35)} onChange={e=>fb('subtitleMarginV', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Alignment (ASS 1-9, 2=bottom-center)</label>
                  <Input value={String(data.brandKit?.subtitleAlignment ?? 2)} onChange={e=>fb('subtitleAlignment', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button onClick={save} disabled={saving}>{saving? 'Menyimpan...' : 'Simpan Pengaturan'}</Button>
              {msg && <span className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">{msg}</span>}
            </div>
            <div className="text-xs text-zinc-500">Catatan: watermark membutuhkan path file gambar yang dapat dibaca server (PNG/SVG/WEBP/JPG). Jika watermark tidak valid, render tetap berjalan tanpa watermark.</div>
          </>
        )}
      </Card>
    </div>
  );
}