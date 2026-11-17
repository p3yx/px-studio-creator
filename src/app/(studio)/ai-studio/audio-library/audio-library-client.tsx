"use client";
import { useEffect, useState } from "react";
import { Card, Button, Input, PageHeader, ConfirmDialog } from "@/components/ui";
import { Download, Trash2, Music, Pencil } from "lucide-react";

export default function AudioLibraryClient() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string|null>(null);
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/audio/library", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setItems(data.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function rename(id: string) {
    await fetch(`/api/audio/library/${id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name }) });
    setEditing(null); setName(""); load();
  }
  async function remove(id: string) {
    setDeleting(true);
    try {
      await fetch(`/api/audio/library/${id}`, { method: "DELETE" });
      await load();
    } finally { setDeleting(false); setDeleteTarget(null); }
  }

  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="Audio Library" description="Kelola audio hasil ekstraksi untuk digunakan kembali di project Anda." />
      {loading ? <div className="text-zinc-400">Memuat audio...</div> : items.length === 0 ? (
        <Card className="p-10 text-center text-zinc-400 space-y-2"><div className="text-zinc-200 font-medium">Audio Library masih kosong</div><div>Ekstrak audio dari video untuk mulai membangun koleksi Anda.</div></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {items.map(it => (
            <Card key={it.id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 grid place-items-center"><Music size={18}/></div>
                  <div className="min-w-0">
                    {editing === it.id ? (
                      <div className="flex items-center gap-2"><Input value={name} onChange={e=>setName(e.target.value)} className="h-9" /><Button onClick={()=>rename(it.id)} className="h-9 px-3">Save</Button></div>
                    ) : (
                      <div className="font-medium truncate">{it.name}</div>
                    )}
                    <div className="text-xs text-zinc-500 uppercase">{it.format} · {it.duration ? `${Number(it.duration).toFixed(1)}s` : '-'} · {it.fileSize ? `${(it.fileSize/1024/1024).toFixed(2)} MB` : ''}</div>
                  </div>
                </div>
              </div>
              {it.fileUrl && <audio controls src={it.fileUrl} className="w-full" preload="none" />}
              {it.sourceName && <div className="text-xs text-zinc-500 truncate">Source: {it.sourceName}</div>}
              <div className="flex flex-wrap gap-2">
                {it.fileUrl && <a href={it.fileUrl} download className="inline-flex"><Button variant="secondary"><Download size={15}/> Download</Button></a>}
                <Button variant="secondary" onClick={()=>{ setEditing(it.id); setName(it.name); }}><Pencil size={15}/> Rename</Button>
                <Button variant="danger" onClick={()=>setDeleteTarget(it)}><Trash2 size={15}/> Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus audio?"
        description={deleteTarget ? `Audio "${deleteTarget.name}" akan dihapus permanen.` : undefined}
        confirmText="Hapus"
        cancelText="Batal"
        variant="danger"
        busy={deleting}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) remove(deleteTarget.id); }}
      />
    </div>
  );
}
