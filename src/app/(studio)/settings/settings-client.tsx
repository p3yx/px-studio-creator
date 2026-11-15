"use client";
import { useEffect, useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import AiSettingsClient from "./ai-settings-client";

export default function SettingsClient() {
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);
  useEffect(()=>{ fetch('/api/settings').then(r=>r.json()).then(setData).catch(()=>{}); },[]);
  async function save() {
    setSaving(true); setMsg(null);
    const res = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data||{}) });
    const j = await res.json();
    setMsg(res.ok ? 'Pengaturan berhasil disimpan.' : (j.error||'Gagal menyimpan pengaturan'));
    setSaving(false);
  }
  const f = (k:string, v:string) => setData((d:any)=>({...d,[k]:v}));

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
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button onClick={save} disabled={saving}>{saving? 'Menyimpan...' : 'Simpan Pengaturan'}</Button>
              {msg && <span className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">{msg}</span>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}