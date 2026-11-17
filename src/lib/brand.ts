import { prisma } from "./db";

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export type BrandKit = {
  watermarkEnabled: boolean;
  watermarkPath?: string | null; // absolute path on server/storage
  watermarkPosition: WatermarkPosition;
  watermarkOpacity: number; // 0..1
  watermarkScale: number; // relative to video width, 0.01..2.0
  watermarkMargin: number; // px
  subtitleFontSize: number;
  subtitleFontName?: string | null;
  subtitlePrimaryColor: string; // ASS &H00BBGGRR or hex like #FFFFFF
  subtitleOutlineColor: string;
  subtitleOutline: number;
  subtitleShadow: number;
  subtitleMarginV: number;
  subtitleAlignment: number; // ASS alignment 1-9, 2 bottom-center
  subtitleBold: boolean;
  subtitleItalic: boolean;
  subtitleBorderStyle: number; // 1=outline+shadow, 3=opaque box
  subtitleBackColor: string; // box/outline background color
  subtitleBackOpacity: number; // 0..1 for box alpha
  loudnessNormalize: boolean;
  loudnessTargetI: number; // LUFS integrated, e.g. -14
  loudnessTargetTP: number; // dBTP, e.g. -1.5
  loudnessTargetLRA: number;
};

export const defaultBrandKit: BrandKit = {
  watermarkEnabled: false,
  watermarkPath: null,
  watermarkPosition: "bottom-right",
  watermarkOpacity: 0.8,
  watermarkScale: 0.18,
  watermarkMargin: 24,
  subtitleFontSize: 22,
  subtitleFontName: null,
  subtitlePrimaryColor: "#FFFFFF",
  subtitleOutlineColor: "#000000",
  subtitleOutline: 2,
  subtitleShadow: 0,
  subtitleMarginV: 35,
  subtitleAlignment: 2,
  subtitleBold: false,
  subtitleItalic: false,
  subtitleBorderStyle: 1,
  subtitleBackColor: "#000000",
  subtitleBackOpacity: 0.5,
  loudnessNormalize: true,
  loudnessTargetI: -14,
  loudnessTargetTP: -1.5,
  loudnessTargetLRA: 11,
};

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

export function normalizeBrandKit(input: any): BrandKit {
  const b = input && typeof input === "object" ? input : {};
  const pos: WatermarkPosition[] = ["top-left","top-right","bottom-left","bottom-right","center"];
  return {
    watermarkEnabled: !!b.watermarkEnabled,
    watermarkPath: b.watermarkPath ? String(b.watermarkPath) : null,
    watermarkPosition: pos.includes(b.watermarkPosition) ? b.watermarkPosition : defaultBrandKit.watermarkPosition,
    watermarkOpacity: clamp(Number(b.watermarkOpacity ?? defaultBrandKit.watermarkOpacity) || 0, 0, 1),
    watermarkScale: clamp(Number(b.watermarkScale ?? defaultBrandKit.watermarkScale) || 0.18, 0.01, 2.0),
    watermarkMargin: clamp(Number(b.watermarkMargin ?? defaultBrandKit.watermarkMargin) || 24, 0, 400),
    subtitleFontSize: clamp(Number(b.subtitleFontSize ?? defaultBrandKit.subtitleFontSize) || 22, 10, 96),
    subtitleFontName: b.subtitleFontName ? String(b.subtitleFontName) : null,
    subtitlePrimaryColor: String(b.subtitlePrimaryColor || defaultBrandKit.subtitlePrimaryColor),
    subtitleOutlineColor: String(b.subtitleOutlineColor || defaultBrandKit.subtitleOutlineColor),
    subtitleOutline: clamp(Number(b.subtitleOutline ?? defaultBrandKit.subtitleOutline) || 0, 0, 12),
    subtitleShadow: clamp(Number(b.subtitleShadow ?? defaultBrandKit.subtitleShadow) || 0, 0, 12),
    subtitleMarginV: clamp(Number(b.subtitleMarginV ?? defaultBrandKit.subtitleMarginV) || 35, 0, 300),
    subtitleAlignment: clamp(Number(b.subtitleAlignment ?? defaultBrandKit.subtitleAlignment) || 2, 1, 9),
    subtitleBold: !!b.subtitleBold,
    subtitleItalic: !!b.subtitleItalic,
    subtitleBorderStyle: [1,3,4].includes(Number(b.subtitleBorderStyle)) ? Number(b.subtitleBorderStyle) : defaultBrandKit.subtitleBorderStyle,
    subtitleBackColor: String(b.subtitleBackColor || defaultBrandKit.subtitleBackColor),
    subtitleBackOpacity: clamp(Number(b.subtitleBackOpacity ?? defaultBrandKit.subtitleBackOpacity) || 0, 0, 1),
    loudnessNormalize: b.loudnessNormalize === false ? false : true,
    loudnessTargetI: Number.isFinite(Number(b.loudnessTargetI)) ? Number(b.loudnessTargetI) : defaultBrandKit.loudnessTargetI,
    loudnessTargetTP: Number.isFinite(Number(b.loudnessTargetTP)) ? Number(b.loudnessTargetTP) : defaultBrandKit.loudnessTargetTP,
    loudnessTargetLRA: Number.isFinite(Number(b.loudnessTargetLRA)) ? Number(b.loudnessTargetLRA) : defaultBrandKit.loudnessTargetLRA,
  };
}

export async function getBrandKit(): Promise<BrandKit> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "brandKit" } });
    if (!row?.value) return { ...defaultBrandKit };
    const parsed = JSON.parse(row.value);
    return normalizeBrandKit(parsed);
  } catch {
    return { ...defaultBrandKit };
  }
}

function hexToAss(hex: string, alphaHex = "00") {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  // ASS uses &HAABBGGRR
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

export function subtitleForceStyle(kit: BrandKit) {
  const primary = kit.subtitlePrimaryColor.startsWith("&H") ? kit.subtitlePrimaryColor : hexToAss(kit.subtitlePrimaryColor, "00");
  const outline = kit.subtitleOutlineColor.startsWith("&H") ? kit.subtitleOutlineColor : hexToAss(kit.subtitleOutlineColor, "00");
  const backAlpha = Math.round(clamp(1 - (kit.subtitleBackOpacity ?? 0.5), 0, 1) * 255).toString(16).padStart(2, "0").toUpperCase();
  const back = kit.subtitleBackColor.startsWith("&H") ? kit.subtitleBackColor : hexToAss(kit.subtitleBackColor, backAlpha);
  const parts = [
    `FontSize=${kit.subtitleFontSize}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `BackColour=${back}`,
    `BorderStyle=${kit.subtitleBorderStyle || 1}`,
    `Outline=${kit.subtitleOutline}`,
    `Shadow=${kit.subtitleShadow}`,
    `MarginV=${kit.subtitleMarginV}`,
    `Alignment=${kit.subtitleAlignment}`,
    `Bold=${kit.subtitleBold ? -1 : 0}`,
    `Italic=${kit.subtitleItalic ? -1 : 0}`,
  ];
  if (kit.subtitleFontName) parts.push(`FontName=${String(kit.subtitleFontName).replace(/,/g, " ")}`);
  return parts.join(",");
}

export function loudnormFilter(kit: BrandKit) {
  return `alimiter=limit=0.95,loudnorm=I=${kit.loudnessTargetI}:TP=${kit.loudnessTargetTP}:LRA=${kit.loudnessTargetLRA}`;
}

export function watermarkOverlayExpr(kit: BrandKit) {
  const m = kit.watermarkMargin;
  switch (kit.watermarkPosition) {
    case "top-left": return `x=${m}:y=${m}`;
    case "top-right": return `x=W-w-${m}:y=${m}`;
    case "bottom-left": return `x=${m}:y=H-h-${m}`;
    case "center": return `x=(W-w)/2:y=(H-h)/2`;
    case "bottom-right":
    default: return `x=W-w-${m}:y=H-h-${m}`;
  }
}
