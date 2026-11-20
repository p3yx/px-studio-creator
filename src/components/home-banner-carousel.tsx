"use client";

/* Local SVG artwork is served from /public; plain <img> avoids the Next image
   optimizer's SVG restriction and keeps these tiny files lazy-loadable. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { isValidBannerHref, type BannerSlide } from "@/lib/home-banner-slides";

const AUTOPLAY_MS = 6500;
const SWIPE_THRESHOLD = 50;

const slideVariants: Variants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: "0%", opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0, pointerEvents: "none" }),
};

export function HomeBannerCarousel({ slides: configured }: { slides: BannerSlide[] }) {
  const slides = useMemo(
    () =>
      configured
        .filter(
          (s) =>
            s.active &&
            !!s.id &&
            !!s.title &&
            !!s.description &&
            !!s.artwork &&
            !!s.cta?.label &&
            isValidBannerHref(s.cta.href),
        )
        .sort((a, b) => a.order - b.order),
    [configured],
  );

  const count = slides.length;
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const pointerStart = useRef<number | null>(null);

  const paused = hovered || focused || hidden || !!reduceMotion || count <= 1;

  const go = useCallback(
    (dir: number) => {
      if (count <= 1) return;
      setDirection(dir);
      setIndex((i) => (i + dir + count) % count);
    },
    [count],
  );

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = window.setInterval(() => go(1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [paused, count, go, index]);

  if (count === 0) return null;

  const slide = slides[index];
  const slideTransition = reduceMotion
    ? { duration: 0 }
    : {
        x: { type: "tween" as const, duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
        opacity: { duration: 0.35 },
      };

  return (
    <motion.section
      aria-roledescription="carousel"
      aria-label="PX STUDIO CREATOR highlights"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onPointerDown={(e) => { pointerStart.current = e.clientX; }}
      onPointerUp={(e) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (start == null) return;
        const delta = e.clientX - start;
        if (Math.abs(delta) > SWIPE_THRESHOLD) go(delta < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { pointerStart.current = null; }}
      className="panel relative isolate mb-12 h-[470px] w-full overflow-hidden rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.35)] outline-none sm:mb-14 sm:h-[430px] lg:mb-16 lg:h-[380px]"
    >
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={slide.id}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={slideTransition}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} dari ${count}: ${slide.title}`}
          className="absolute inset-0 grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr]"
        >
          <div className={cn("absolute inset-0 bg-gradient-to-br", slide.gradient)} aria-hidden="true" />

          <div className="absolute inset-0 lg:hidden" aria-hidden="true">
            <img src={slide.artwork} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0B0D16] via-[#0B0D16]/85 to-[#0B0D16]/45" />
          </div>

          <div className="relative z-10 flex flex-col justify-center px-6 pb-20 pt-7 sm:px-9 sm:pb-16 lg:px-12 lg:pb-10 lg:pt-10">
            {slide.badge && (
              <span className="inline-flex w-fit items-center rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-[10px] font-medium tracking-[0.14em] text-violet-200 sm:text-xs">
                {slide.badge}
              </span>
            )}
            <h2 className="mt-5 max-w-xl text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">
              {slide.title}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-zinc-300 sm:text-base">{slide.description}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={slide.cta.href}
                className="btn-primary h-11 rounded-xl px-5 text-sm font-medium inline-flex items-center gap-2"
              >
                {slide.cta.label}
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <div className="relative hidden h-full overflow-hidden lg:block" aria-hidden="true">
            <img src={slide.artwork} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0F111A]/85 via-[#0F111A]/10 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0F111A]/60 via-transparent to-transparent" />
          </div>
        </motion.div>
      </AnimatePresence>

      {!reduceMotion && !paused && count > 1 && (
        <motion.div
          key={`progress-${index}`}
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: AUTOPLAY_MS / 1000, ease: "linear" }}
          className="absolute bottom-0 left-0 z-20 h-[2px] bg-gradient-to-r from-violet-400 to-cyan-300"
          aria-hidden="true"
        />
      )}

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3 px-4 pb-4 sm:pb-5">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Slide sebelumnya"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/35 text-zinc-200 backdrop-blur-md transition-colors hover:border-violet-400/40 hover:bg-black/55 hover:text-white"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2" aria-label="Navigasi slide">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { if (i !== index) { setDirection(i > index ? 1 : -1); setIndex(i); } }}
                aria-label={`Slide ${i + 1}: ${s.title}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  i === index
                    ? "w-7 bg-gradient-to-r from-violet-400 to-cyan-300"
                    : "w-2 bg-white/25 hover:w-3 hover:bg-white/50",
                )}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Slide berikutnya"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/35 text-zinc-200 backdrop-blur-md transition-colors hover:border-violet-400/40 hover:bg-black/55 hover:text-white"
          >
            <ArrowRight size={16} />
          </button>

          <span className="ml-1 text-xs tabular-nums text-zinc-400">
            {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
          </span>
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        Slide {index + 1} dari {count}: {slide.title}
      </span>
    </motion.section>
  );
}
