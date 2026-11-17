"use client";
import { useEffect, useState } from "react";
import { Card, Button, Badge, ConfirmDialog, PageHeader, Toast, Select } from "@/components/ui";
import { formatBytes, formatDuration } from "@/lib/utils";
import { RefreshCw, Download, Trash2, RotateCcw, Clapperboard, Copy, Check } from "lucide-react";
import Link from "next/link";

export default function ProjectDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [captionBusy, setCaptionBusy] = useState<string | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState<string>("auto");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{open:boolean;message:string;type:'success'|'error'}>({open:false,message:'',type:'success'});
  const [copied, setCopied] = useState<string|null>(null);
  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setToast({ open: true, message: 'Tersalin ke clipboard.', type: 'success' });
      setTimeout(()=>setCopied(c=>c===key?null:c), 1500);
    } catch { setToast({ open: true, message: 'Gagal menyalin.', type: 'error' }); }
  }
  async function load() {
    try {
      const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setData(j.project); setErr(null);
    } catch (e:any) { setErr(e.message); }
  }
  useEffect(()=>{ load(); const t = setInterval(load, 3000); return ()=>clearInterval(t); }, [id]);
  if (err) return <div className="space-y-8 lg:space-y-10"><Card className="p-6 sm:p-8 text-red-300 border-red-500/20">{err}</Card></div>;
  if (!data) return <div className="space-y-8 lg:space-y-10"><div className="text-zinc-400 py-2">Loading project...</div></div>;
  const p = data;
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title={p.name}
        description={
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-zinc-400">
              <Badge className={p.status === 'COMPLETED' ? 'border-green-500/30 text-green-300' : p.status === 'FAILED' ? 'border-red-500/30 text-red-300' : 'border-violet-500/30 text-violet-200'}>{p.status.replaceAll('_',' ')}</Badge>
              {p.type === 'montage' && <Badge className="border-cyan-500/30 text-cyan-200">MONTAGE</Badge>}
              {p.sourceDuration != null && <span>Duration: <span className="text-zinc-200">{formatDuration(p.sourceDuration)}</span></span>}
              {p.outputDuration != null && <span>Output: <span className="text-zinc-200">{formatDuration(p.outputDuration)}</span></span>}
              {p.sourceSize != null && <span>Size: <span className="text-zinc-200">{formatBytes(p.sourceSize)}</span></span>}
              {p.outputSize != null && <span>Output Size: <span className="text-zinc-200">{formatBytes(p.outputSize)}</span></span>}
            </div>
            {p.errorMessage && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-3 max-w-3xl">{p.errorMessage}</div>}
          </div>
        }
        actions={
          <>
            {p.type === 'montage' ? (
              <Link href="/ai-studio/montage"><Button variant="secondary"><Clapperboard size={16}/> Open Montage Maker</Button></Link>
            ) : (
              <Button variant="secondary" onClick={async ()=>{ setBusy(true); await fetch(`/api/projects/${id}/regenerate`,{method:'POST'}).catch(()=>{}); await load(); setBusy(false); }} disabled={busy}><RotateCcw size={16}/> {busy? 'Queueing...' : 'Regenerate'}</Button>
            )}
            <Button variant="secondary" onClick={load}><RefreshCw size={16}/> Refresh</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={deleting}><Trash2 size={16}/> Delete</Button>
          </>
        }
      />

      <Card className="p-5 sm:p-6 lg:p-7 space-y-4">
        <div className="flex items-center justify-between gap-3"><div className="font-medium text-base">Progres Pemrosesan</div><div className="text-xs text-zinc-500">Diperbarui otomatis</div></div>
        {p.jobs?.length ? <div className="space-y-4">{p.jobs.map((j:any)=>(
          <div key={j.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><div className="text-zinc-200">{j.stage || j.status} <span className="text-zinc-500">({j.type})</span></div><div className="text-zinc-300 font-medium">{j.progress || 0}%</div></div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500" style={{width:`${j.progress||0}%`}}/></div>
            {j.error && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{j.error}</div>}
          </div>
        ))}</div> : <div className="text-zinc-400 text-sm">Belum ada proses berjalan. Progres akan muncul di sini saat project diproses.</div>}
      </Card>

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="font-medium text-lg sm:text-xl">{p.type === 'montage' ? 'Montage Result' : 'Generated Clips'} <span className="text-zinc-500 font-normal">({p.clips?.length || 0})</span></div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400 whitespace-nowrap">Bahasa Caption</label>
            <Select value={captionLanguage} onChange={e=>setCaptionLanguage(e.target.value)} className="min-w-[170px]">
              <option value="auto">Auto-detect</option>
              <option value="id">Indonesia (id)</option>
              <option value="en">English (en)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="ko">Korean (ko)</option>
              <option value="zh">Chinese (zh)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="ar">Arabic (ar)</option>
              <option value="hi">Hindi (hi)</option>
              <option value="pt">Portuguese (pt)</option>
              <option value="ru">Russian (ru)</option>
            </Select>
          </div>
        </div>
        {p.clips?.length ? <div className={`grid ${p.type === 'montage' && p.clips.length === 1 ? 'md:grid-cols-1 max-w-4xl' : 'md:grid-cols-2 xl:grid-cols-3'} gap-4 lg:gap-5`}>{p.clips.map((c:any)=>{
          const src = c.downloadUrl || p.outputUrl || null;
          return <Card key={c.id} className="p-4 sm:p-5 space-y-4 interactive-card">
            <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center">
              {src ? <video src={src} controls className="w-full h-full object-contain" preload="metadata" /> : <div className="text-zinc-500 text-sm px-4 text-center">Status: {c.status || 'pending'}</div>}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-start gap-1.5">
                <div className="font-medium break-words whitespace-pre-wrap">{c.title}</div>
                <button type="button" title="Salin judul" onClick={()=>copyText(`t-${c.id}`, c.title || '')} className="shrink-0 mt-0.5 h-6 w-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200">
                  {copied === `t-${c.id}` ? <Check size={13} className="text-green-400"/> : <Copy size={13}/>}
                </button>
              </div>
              <div className="flex items-start gap-1.5">
                <div className="text-sm text-zinc-400 break-words leading-relaxed whitespace-pre-wrap">{c.description || c.reason}</div>
                <button type="button" title="Salin deskripsi" onClick={()=>copyText(`d-${c.id}`, (c.description || c.reason || ''))} className="shrink-0 mt-0.5 h-6 w-6 grid place-items-center rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200">
                  {copied === `d-${c.id}` ? <Check size={13} className="text-green-400"/> : <Copy size={13}/>}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <Badge>{c.category || (p.type === 'montage' ? 'Montage' : 'Clip')}</Badge><span>{formatDuration(c.duration)}</span>{c.resolution && <span>{c.resolution}</span>}{c.fileSize && <span>{formatBytes(c.fileSize)}</span>}{c.relevance!=null && p.type !== 'montage' && <span>Score {Math.round(c.relevance)}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {src && <a href={src} download className="inline-flex"><Button variant="secondary"><Download size={15}/> Download MP4</Button></a>}
              {c.subtitleUrl && <a href={c.subtitleUrl} download className="inline-flex"><Button variant="secondary">Download SRT</Button></a>}
              <Button
                variant="secondary"
                onClick={async ()=>{
                  setCaptionBusy(c.id);
                  try {
                    const res = await fetch(`/api/projects/${id}/clips/${c.id}/captions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: captionLanguage }) });
                    const j = await res.json().catch(()=>({}));
                    if (!res.ok) throw new Error(j.error || 'Gagal membuat caption');
                    await load();
                    const extra = j.note ? ` ${j.note}` : (j.fallback ? ' (fallback digunakan).' : '');
                    setToast({ open: true, message: `Caption berhasil diproses${captionLanguage && captionLanguage !== 'auto' ? ` (${captionLanguage})` : ''}.${extra}`, type: 'success' });
                  } catch (e:any) { setToast({ open: true, message: e.message || 'Gagal membuat caption', type: 'error' }); }
                  finally { setCaptionBusy(null); }
                }}
                disabled={captionBusy === c.id}
              >
                {captionBusy === c.id ? 'Generating...' : (c.subtitleUrl ? 'Regenerate Captions' : 'Generate Captions')}
              </Button>
              {p.type === 'montage' && <Link href="/ai-studio/montage" className="inline-flex"><Button variant="secondary"><Clapperboard size={15}/> Open Montage Maker</Button></Link>}
            </div>
            {p.type !== 'montage' && <div className="text-xs text-zinc-500">{formatDuration(c.startTime)} - {formatDuration(c.endTime)} · Status: {c.status}{c.subtitleUrl ? ' · Caption siap' : ''}</div>}
            {p.type === 'montage' && <div className="text-xs text-zinc-500">Status: {c.status}{c.subtitleUrl ? ' · Caption siap' : ''}</div>}
          </Card>;
        })}</div> : <Card className="p-8 sm:p-10 text-center text-zinc-400 space-y-2"><div className="text-zinc-200 font-medium">{p.type === 'montage' ? 'Belum ada hasil montage' : 'Belum ada clip'}</div><div>{p.type === 'montage' ? 'Susun clip di AI Montage Maker lalu mulai proses render untuk melihat hasilnya di sini.' : 'Proses pembuatan clip sedang dipersiapkan atau belum dimulai. Hasil akan muncul setelah rendering selesai.'}</div></Card>}
      </section>

      <Card className="p-4 sm:p-5 text-sm text-zinc-400 leading-relaxed">
        Video Anda akan diproses sesuai pengaturan project. Progres dan hasil akhir akan diperbarui secara otomatis di halaman ini.
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus project?"
        description="Project, job, dan semua file/clip hasil render akan dihapus permanen. Tindakan ini tidak dapat dibatalkan."
        confirmText="Hapus Project"
        cancelText="Batal"
        variant="danger"
        busy={deleting}
        onCancel={() => !deleting && setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await fetch(`/api/projects/${id}`, { method: 'DELETE' });
            window.location.href = '/projects';
          } finally {
            setDeleting(false);
            setConfirmDelete(false);
          }
        }}
      />
      <Toast open={toast.open} message={toast.message} type={toast.type} onClose={()=>setToast(t=>({...t,open:false}))} />
    </div>
  );
}
