import Link from "next/link";
import { Sparkles, Wand2, Film, Subtitles, Scissors, Cpu } from "lucide-react";

import { BrandLockup, PxLogoMark } from "@/components/brand";

export default function Home() {
  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <header className="relative z-10 flex items-center justify-between px-6 lg:px-12 h-20 border-b border-white/10 bg-[#10121B]/70 backdrop-blur-md">
        <BrandLockup />
        <nav className="flex items-center gap-2 sm:gap-3 text-sm">
          <Link href="/dashboard" className="btn-primary h-10 px-4 rounded-xl font-medium inline-flex items-center justify-center">Open Dashboard</Link>
        </nav>
      </header>
      <main className="relative z-10 px-6 lg:px-12 py-16 sm:py-20 lg:py-24 max-w-7xl mx-auto page-enter">
        <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-12 lg:gap-16 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-violet-400/20 bg-violet-500/10 text-violet-200 text-xs sm:text-sm">
              <Cpu size={14}/> Professional AI Creative Studio
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-5xl font-semibold leading-tight tracking-tight max-w-3xl">
              Create Professional Videos with <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-cyan-300">PX STUDIO CREATOR.</span>
            </h1>
            <p className="text-lg text-zinc-300 max-w-2xl leading-8">
              Gabungkan beberapa clip, tulis instruksi editing dengan prompt, ekstrak & kelola audio, susun montage dengan transisi dan sinkronisasi, lalu render video MP4 berkualitas — semua dalam satu creative studio.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Link href="/ai-studio/montage" className="btn-primary px-6 py-3.5 rounded-xl font-medium inline-flex items-center justify-center gap-2 transition-all duration-200"><Sparkles size={18}/> Open AI Montage Maker</Link>
              <Link href="/dashboard" className="btn-secondary px-6 py-3.5 rounded-xl font-medium inline-flex items-center justify-center gap-2 transition-all duration-200">Open Dashboard</Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 pt-4 text-sm">
              {[{i:Wand2,t:"AI Prompt Editing"},{i:Scissors,t:"Montage & Transitions"},{i:Subtitles,t:"Audio Extraction"},{i:Film,t:"MP4 Rendering"}].map((x, idx) => (
                <div key={idx} className="panel rounded-xl p-3.5 sm:p-4 text-zinc-300 flex items-center gap-2.5 interactive-card"><x.i size={16} className="text-violet-300 shrink-0"/><span>{x.t}</span></div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-r from-violet-600/20 to-cyan-500/10 blur-3xl rounded-full" />
            <div className="relative panel rounded-3xl p-5 sm:p-6 ring-accent">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200"><PxLogoMark className="h-7 w-7" /> Creative Workflow</div>
                <div className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-2.5 py-1">PROMPT → PLAN → RENDER</div>
              </div>
              <div className="space-y-3">
                {[
                  ["1. Select & upload media", "Pilih beberapa clip, audio, atau hasil project sebelumnya"],
                  ["2. Prompt & AI analysis", "Tulis instruksi editing, AI menyusun plan timeline/audio/transisi"],
                  ["3. Edit & preview", "Atur urutan, trim, preset, musik, dan transisi"],
                  ["4. Render & export", "FFmpeg worker memproses dan menghasilkan video MP4 final"],
                ].map((s, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 transition-colors hover:bg-white/[0.045]">
                    <div className="font-medium">{s[0]}</div>
                    <div className="text-sm text-zinc-400 mt-1.5 leading-relaxed">{s[1]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
