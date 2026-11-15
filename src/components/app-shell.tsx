"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Sparkles, FolderKanban, Settings, User, Menu, X, Clapperboard, Wand2, AudioLines, Library, Volume2, Music, Captions, Scaling, Coffee } from "lucide-react";
import { BrandLockup, PxLogoMark } from "@/components/brand";
import { useState } from "react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/create", label: "AI Clip Studio", icon: Sparkles },
  { href: "/ai-studio/montage", label: "AI Montage", icon: Clapperboard },
  { href: "/ai-studio/prompt-editor", label: "Prompt Editor", icon: Wand2 },
  { href: "/ai-studio/auto-caption", label: "Auto Caption", icon: Captions },
  { href: "/ai-studio/convert-resize", label: "Convert & Resize", icon: Scaling },
  { href: "/ai-studio/add-audio", label: "Tambah Suara ke Video", icon: Music },
  { href: "/ai-studio/audio-extractor", label: "Audio Extractor", icon: AudioLines },
  { href: "/ai-studio/text-to-speech", label: "Text to Speech", icon: Volume2 },
  { href: "/ai-studio/audio-library", label: "Audio Library", icon: Library },
  { href: "/support", label: "Buy Me a Coffee", icon: Coffee },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/profile", label: "Profile", icon: User },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen flex relative">
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-72 border-r border-white/10 bg-[#10121B]/95 backdrop-blur-xl p-5 flex flex-col transition-transform duration-300 ease-out lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between mb-6 px-1 shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <PxLogoMark className="h-9 w-9" />
            <div className="leading-tight">
              <div className="font-semibold tracking-wide text-white text-sm">PX STUDIO <span className="text-violet-300">CREATOR</span></div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">AI Creative Studio</div>
            </div>
          </Link>
          <button className="lg:hidden text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18}/></button>
        </div>
        <nav className="flex flex-col gap-1.5 flex-1 overflow-y-auto min-h-0 pr-1 pb-2">
          {nav.map(item => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 px-3.5 h-11 shrink-0 rounded-xl text-sm font-medium transition-all duration-200", active ? "bg-white/[0.08] text-white ring-1 ring-violet-500/30 shadow-sm" : "text-zinc-400 hover:text-white hover:bg-white/[0.05]")}>
                <Icon size={18} className={cn("shrink-0 transition-colors", active ? "text-violet-300" : "text-zinc-500")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="pt-3 px-1 shrink-0 border-t border-white/5 mt-2 space-y-2.5">
          <div className="brand-showcase p-3.5 min-h-[74px]">
            <div className="brand-fx" aria-hidden="true">
              <div className="brand-orbit" />
              <div className="brand-glow" />
              <div className="brand-spark" />
            </div>
            <div className="brand-content text-xs leading-relaxed text-zinc-300">
              <span className="font-semibold text-white">PX STUDIO CREATOR</span>
              <span className="text-zinc-400"> - Professional AI Video Editing &amp; Creative Studio.</span>
            </div>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex-1 lg:ml-72 flex flex-col min-w-0">
        <button
          className="lg:hidden fixed top-4 left-4 z-20 h-10 w-10 inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#10121B]/95 backdrop-blur text-zinc-200 hover:bg-white/5 transition shadow-lg"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={18}/>
        </button>
        <main className="flex-1 px-4 pt-16 pb-8 sm:px-6 sm:pt-10 sm:pb-10 lg:px-10 lg:pt-10 lg:pb-12">
          <div className="page-container">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
