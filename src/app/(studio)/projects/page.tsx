import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, Badge, Button, PageHeader } from "@/components/ui";
import { formatDate } from "date-fns";
import { publicFileUrl } from "@/lib/storage";
import { Clapperboard, Play } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtDur(sec?: number | null) {
  if (sec == null || !isFinite(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) return <div className="space-y-8 lg:space-y-10"><Card className="p-8"><div className="font-medium">Masuk diperlukan</div><p className="text-zinc-400 mt-1">Silakan masuk untuk melihat dan mengelola project Anda.</p><div className="mt-4"><Link href="/login"><Button>Masuk</Button></Link></div></Card></div>;
  const projects = await prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { clips: true, jobs: true } } } as any });
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="My Projects"
        description="Kelola project, pantau progres, dan akses hasil video Anda."
        actions={<Link href="/create"><Button className="w-full sm:w-auto">Buat Project Baru</Button></Link>}
      />
      {projects.length === 0 ? <Card className="p-10 sm:p-12 text-center text-zinc-400 space-y-2"><div className="text-lg text-zinc-200 font-medium">Belum ada project</div><div>Mulai dengan membuat project baru dan unggah video sumber.</div></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5 lg:gap-6">
          {projects.map((p: any) => {
            const thumb = publicFileUrl(p.thumbnailPath);
            const dur = fmtDur(p.type === "montage" ? p.outputDuration : p.sourceDuration);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="block group">
                <Card className="overflow-hidden h-full interactive-card hover:bg-white/[0.02]">
                  <div className="relative aspect-video bg-[#0b0d14] border-b border-white/10 overflow-hidden">
                    {thumb ? (
                      <img src={thumb} alt={p.name} className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-violet-900/30 via-[#10121b] to-cyan-900/20 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2 text-zinc-400">
                          <div className="h-11 w-11 rounded-full bg-black/30 border border-white/10 grid place-items-center"><Clapperboard size={18} className="text-violet-300" /></div>
                          <span className="text-xs">{p.thumbnailStatus === "failed" ? "Pratinjau tidak tersedia" : "Menyiapkan pratinjau"}</span>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent pointer-events-none" />
                    <div className="absolute top-3 left-3 flex items-center gap-1.5">
                      <Badge className={p.status === 'COMPLETED' ? 'border-green-500/30 text-green-200 bg-black/35' : p.status === 'FAILED' ? 'border-red-500/30 text-red-200 bg-black/35' : 'border-violet-500/30 text-violet-100 bg-black/35'}>{p.status.replaceAll('_',' ')}</Badge>
                      {p.type === 'montage' && <Badge className="border-cyan-500/30 text-cyan-100 bg-black/35">MONTAGE</Badge>}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                      <div className="h-11 w-11 rounded-full bg-black/45 border border-white/20 backdrop-blur-sm grid place-items-center"><Play size={18} className="text-white ml-0.5" /></div>
                    </div>
                    {dur && <div className="absolute bottom-3 right-3 text-[11px] px-2 py-1 rounded-md bg-black/55 border border-white/10 text-zinc-100">{dur}</div>}
                  </div>
                  <div className="p-4 sm:p-5 space-y-2.5">
                    <div className="font-medium line-clamp-1 text-base text-white">{p.name}</div>
                    <div className="text-sm text-zinc-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{p.type === 'montage' ? 'Montage' : `${p._count.clips} clip`}</span>
                      <span>•</span>
                      <span>{p._count.jobs} proses</span>
                    </div>
                    <div className="text-xs text-zinc-500 flex items-center justify-between gap-2">
                      <span>Dibuat {formatDate(p.createdAt, "dd MMM yyyy")}</span>
                      <span>Diperbarui {formatDate(p.updatedAt, "dd MMM yyyy")}</span>
                    </div>
                    {p.errorMessage && <div className="text-xs text-red-300 line-clamp-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{p.errorMessage}</div>}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}