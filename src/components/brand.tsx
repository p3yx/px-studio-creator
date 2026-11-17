import { cn } from "@/lib/utils";

export function PxLogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("h-9 w-9", className)} aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#px-bg)" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" stroke="white" strokeOpacity="0.18" />
      <path d="M18 44V20h11.5c6.2 0 10.5 3.4 10.5 9.1 0 5.8-4.3 9.2-10.5 9.2H24V44h-6Zm6-10.7h5c2.9 0 4.8-1.5 4.8-4.2s-1.9-4.1-4.8-4.1h-5v8.3Z" fill="white"/>
      <path d="M34.5 44l6.4-8.8-6-8.2h6.9l2.8 4.3 2.9-4.3h6.7l-6 8.1 6.5 8.9h-7l-3.2-4.8-3.3 4.8h-6.7Z" fill="#67E8F9"/>
      <path d="M14 16l6-6" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round" opacity="0.9"/>
      <path d="M44 50l6-6" stroke="#22D3EE" strokeWidth="2.5" strokeLinecap="round" opacity="0.8"/>
      <defs>
        <linearGradient id="px-bg" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C3AED"/>
          <stop offset="1" stopColor="#0891B2"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BrandLockup({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <PxLogoMark className={compact ? "h-8 w-8" : "h-9 w-9"} />
      {!compact && (
        <div className="leading-tight">
          <div className="font-semibold tracking-wide text-white">PX STUDIO <span className="text-violet-300">CREATOR</span></div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Professional AI Creative Studio</div>
        </div>
      )}
    </div>
  );
}
