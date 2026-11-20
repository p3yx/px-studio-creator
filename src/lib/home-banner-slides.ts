/**
 * Config-driven source of truth for the home page banner carousel.
 *
 * Only slides that are `active`, have complete content, and point to a route
 * that actually exists in this app are rendered. See `isValidBannerHref`.
 */

export type BannerSlide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  artwork: string;
  gradient: string;
  badge?: string;
  cta: { label: string; href: string };
  active: boolean;
  order: number;
};

/** Every href below maps to a real page under src/app. Do not add unverified paths. */
export const VALID_BANNER_HREFS = [
  "/dashboard",
  "/projects",
  "/create",
  "/ai-studio/montage",
  "/ai-studio/prompt-editor",
  "/ai-studio/auto-caption",
  "/ai-studio/convert-resize",
  "/ai-studio/watermark-delogo",
  "/ai-studio/add-audio",
  "/ai-studio/audio-extractor",
  "/ai-studio/text-to-speech",
  "/ai-studio/audio-library",
  "/settings",
  "/support",
] as const;

export function isValidBannerHref(href: string): boolean {
  return (VALID_BANNER_HREFS as readonly string[]).includes(href);
}

export const HOME_BANNER_SLIDES: BannerSlide[] = [
  {
    id: "welcome",
    eyebrow: "PX STUDIO CREATOR",
    title: "Welcome to PX STUDIO CREATOR.",
    description:
      "Satu studio kreatif untuk mengubah clip mentah menjadi video siap unggah. Upload media, tulis instruksi, lalu biarkan alur kerja yang rapi membawa Anda dari ide sampai MP4 final.",
    artwork: "/banners/welcome.svg",
    gradient: "from-violet-700/25 via-transparent to-cyan-500/10",
    badge: "PROFESSIONAL AI CREATIVE STUDIO",
    cta: { label: "Open Dashboard", href: "/dashboard" },
    active: true,
    order: 1,
  },
  {
    id: "ai-editing",
    eyebrow: "AI Prompt Editing",
    title: "AI-Powered Video Editing.",
    description:
      "Tulis perintah editing dalam bahasa sendiri. AI Clip Studio menyusun rencana timeline, memilih momen terbaik, dan menyiapkan transisi sebelum Anda mengambil kendali penuh di editor.",
    artwork: "/banners/ai-edit.svg",
    gradient: "from-violet-600/25 via-transparent to-sky-500/10",
    badge: "PROMPT → PLAN → RENDER",
    cta: { label: "Open AI Clip Studio", href: "/create" },
    active: true,
    order: 2,
  },
  {
    id: "presets",
    eyebrow: "Montage Presets",
    title: "Creative Preset Collection.",
    description:
      "Preset montage sinematik, AMV, hype, emotional, dan clean—ditambah gaya anime serta filter warna. Pakai sebagai titik awal, lalu sesuaikan tiap clip, beat, dan transisi sesuai kebutuhan.",
    artwork: "/banners/montage.svg",
    gradient: "from-fuchsia-600/20 via-transparent to-cyan-500/12",
    badge: "CINEMATIC · AMV · HYPE · EMOTIONAL",
    cta: { label: "Open AI Montage Maker", href: "/ai-studio/montage" },
    active: true,
    order: 3,
  },
  {
    id: "local-fallback",
    eyebrow: "On-Machine Processing",
    title: "Local Render & Audio Fallback.",
    description:
      "Render FFmpeg dan sebagian pemrosesan audio berjalan di mesin Anda, dengan fallback teks-ke-suara lokal bila penyedia tidak tersedia. Permintaan AI tetap melalui penyedia yang Anda konfigurasi—tidak ada klaim model lokal.",
    artwork: "/banners/local-render.svg",
    gradient: "from-emerald-600/20 via-transparent to-cyan-500/12",
    badge: "FFMPEG · LOCAL TTS · PROVIDER-BASED AI",
    cta: { label: "Open Dashboard", href: "/dashboard" },
    active: true,
    order: 5,
  },
];
