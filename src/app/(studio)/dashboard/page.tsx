import Link from "next/link";
import { Card, Button, Badge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "date-fns";
import { Sparkles, Wand2, Captions, Clapperboard, Clock, FolderKanban } from "lucide-react";
import { publicFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const projects = user ? await prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 6, include: { _count: { select: { clips: true } } } } as any) : [];
  return (
    <div className="space-y-8 lg:space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#121526] via-[#10131d] to-[#0b1020] p-6 sm:p-8 lg:p-10 mt-0">
        <div className="absolute right-[-10%] top-[-20%] h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute left-[30%] bottom-[-30%] h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative grid lg:grid-cols-[1.2fr_.8fr] gap-8 lg:gap-10 items-end">
          <div className="space-y-5">
            <div className="text-sm text-violet-200">PX STUDIO CREATOR Dashboard</div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold leading-tight max-w-3xl tracking-tight">Create, Edit, and Render with PX STUDIO CREATOR.</h1>
            <p className="text-base sm:text-lg text-zinc-300 max-w-2xl leading-relaxed">Gabungkan clip, kelola audio, dan susun video dengan bantuan AI dalam satu studio kreatif.</p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-1">
              <Link href="/create"><Button className="w-full sm:w-auto"><Sparkles size={16}/> Buat Project Baru</Button></Link>
              <Link href="/projects"><Button variant="secondary" className="w-full sm:w-auto"><FolderKanban size={16}/> Lihat Project Saya</Button></Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {[{n: projects.length, l:"Project terbaru"}, {n: projects.reduce((a,p)=>a+p._count.clips,0), l:"Clip dibuat"}, {n:"AI", l:"Asisten kreatif"}, {n:"MP4", l:"Ekspor video"}].map((s,i)=>(
              <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
                <div className="text-2xl sm:text-3xl font-semibold">{s.n}</div>
                <div className="text-sm text-zinc-400 mt-1.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4"><h2 className="text-xl sm:text-2xl font-semibold">Aksi Cepat</h2></div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5">
          {[
            {href:"/create?mode=Best%20Moments", icon:Wand2, title:"AI Clip Studio", desc:"Temukan momen terbaik dari video dan buat clip secara otomatis."},
            {href:"/ai-studio/montage", icon:Clapperboard, title:"AI Montage Maker", desc:"Gabungkan beberapa clip menjadi satu video montage yang dinamis."},
            {href:"/ai-studio/audio-extractor", icon:Captions, title:"Audio Extractor", desc:"Ambil audio dari video dan simpan ke library untuk digunakan kembali."},
            {href:"/settings", icon:Sparkles, title:"Pengaturan Studio", desc:"Kelola koneksi AI dan preferensi pemrosesan project."},
          ].map((a,i)=> (
            <Link key={i} href={a.href} className="block h-full"><Card className="p-5 sm:p-6 h-full interactive-card hover:bg-white/[0.03]">
              <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 grid place-items-center mb-4"><a.icon size={20}/></div>
              <div className="font-medium mb-2">{a.title}</div>
              <div className="text-sm text-zinc-400 leading-relaxed">{a.desc}</div>
            </Card></Link>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4"><h2 className="text-xl sm:text-2xl font-semibold">Project Terbaru</h2><Link href="/projects" className="text-sm text-violet-300 hover:text-violet-200 transition">Lihat semua</Link></div>
        {!user ? (
          <Card className="p-8 sm:p-10 text-center space-y-3"><div className="text-lg font-medium">Masuk untuk mengelola project</div><p className="text-zinc-400 max-w-xl mx-auto">Masuk atau buat akun untuk menyimpan project, clip, dan audio Anda.</p><div className="pt-2 flex flex-col sm:flex-row justify-center gap-3"><Link href="/login"><Button className="w-full sm:w-auto">Masuk</Button></Link><Link href="/register"><Button variant="secondary" className="w-full sm:w-auto">Daftar</Button></Link></div></Card>
        ) : projects.length === 0 ? (
          <Card className="p-8 sm:p-10 text-center space-y-3"><div className="text-lg font-medium">Belum ada project</div><p className="text-zinc-400 max-w-xl mx-auto">Mulai project pertama Anda dan buat clip atau montage secara otomatis.</p><div className="pt-2"><Link href="/create"><Button><Sparkles size={16}/> Buat Project Baru</Button></Link></div></Card>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
            {projects.map((p: any) => {
              const thumb = publicFileUrl(p.thumbnailPath);
              return (
              <Link key={p.id} href={`/projects/${p.id}`} className="block group"><Card className="overflow-hidden interactive-card hover:bg-white/[0.02] h-full">
                <div className="relative aspect-video bg-[#0b0d14] border-b border-white/10 overflow-hidden">
                  {thumb ? <img src={thumb} alt={p.name} className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" loading="lazy" /> : <div className="absolute inset-0 bg-gradient-to-br from-violet-900/30 via-[#10121b] to-cyan-900/20 flex items-center justify-center text-zinc-400 text-sm">Pratinjau Project</div>}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent pointer-events-none" />
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3"><div className="font-medium line-clamp-1">{p.name}</div><Badge className={p.status === 'COMPLETED' ? 'border-green-500/30 text-green-300' : p.status === 'FAILED' ? 'border-red-500/30 text-red-300' : 'border-violet-500/30 text-violet-200'}>{p.status.replaceAll('_',' ')}</Badge></div>
                  <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-400"><span className="inline-flex items-center gap-1.5"><Clapperboard size={14}/>{p._count.clips} clips</span><span className="inline-flex items-center gap-1.5"><Clock size={14}/>{formatDate(p.createdAt, 'dd MMM yyyy')}</span></div>
                </div>
              </Card></Link>
            );})}
          </div>
        )}
      </section>
    </div>
  );
}