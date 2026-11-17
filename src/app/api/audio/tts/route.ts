import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { STORAGE_ROOT } from "@/lib/storage";
import { synthesizeSpeechWithTask } from "@/lib/ai-providers";
import { probeVideo, runProcess } from "@/lib/ffmpeg";

export const runtime = "nodejs";

function safeName(s: string) { return String(s || "tts-audio").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "tts-audio"; }

type LocalVoice = { name: string; culture: string; gender: string; language: string };

function parseVoicesOutput(out: string): LocalVoice[] {
  return String(out || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [name, culture, gender] = l.split("|");
      const c = (culture || "").trim();
      const lang = c.toLowerCase().startsWith("id") ? "id" : c.toLowerCase().startsWith("en") ? "en" : (c || "unknown");
      return { name: (name || "").trim(), culture: c, gender: (gender || "").trim(), language: lang };
    })
    .filter(v => v.name);
}

async function listLocalVoices(): Promise<LocalVoice[]> {
  if (process.platform !== "win32") return [];
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$s.GetInstalledVoices() | ForEach-Object { $v=$_.VoiceInfo; Write-Output ($v.Name + '|' + $v.Culture.Name + '|' + $v.Gender.ToString()) }"
  ].join(" ");
  const ps = await runProcess("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
  if (ps.code !== 0) return [];
  return parseVoicesOutput(ps.stdout || "");
}

function pickLocalVoice(voices: LocalVoice[], requested?: string | null): { voice: LocalVoice | null; reason?: string } {
  if (!voices.length) return { voice: null, reason: "Tidak ada voice TTS lokal yang terpasang." };
  const req = String(requested || "").trim();
  if (req && req !== "auto" && req !== "auto-id" && req !== "auto-en") {
    const exact = voices.find(v => v.name === req);
    if (exact) return { voice: exact };
  }
  const idVoice = voices.find(v => v.culture.toLowerCase().startsWith("id") || /indones/i.test(v.name));
  if (req === "auto-en") {
    const en = voices.find(v => v.culture.toLowerCase().startsWith("en")) || voices[0];
    return { voice: en };
  }
  if (idVoice) return { voice: idVoice };
  const en = voices.find(v => v.culture.toLowerCase().startsWith("en")) || voices[0];
  return { voice: en, reason: "Voice Bahasa Indonesia tidak terpasang di Windows ini, fallback lokal mungkin kurang lancar untuk teks Indonesia." };
}

function psQuoteLiteral(s: string) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function synthesizeLocalTTS(text: string, format: "mp3" | "wav", requestedVoice?: string | null): Promise<{ buffer: Buffer; contentType: string; note: string; voiceUsed?: string | null; provider: "local" }> {
  if (process.platform !== "win32") {
    throw new Error("Local TTS fallback hanya tersedia di Windows pada instalasi ini.");
  }
  const voices = await listLocalVoices();
  const picked = pickLocalVoice(voices, requestedVoice);
  const voiceName = picked.voice?.name || null;

  const tmpBase = path.join(os.tmpdir(), `px-tts-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  const txtPath = `${tmpBase}.txt`;
  const wavPath = `${tmpBase}.wav`;
  const outPath = format === "mp3" ? `${tmpBase}.mp3` : wavPath;
  try {
    await fs.writeFile(txtPath, text, "utf8");
    const psLines = [
      "$ErrorActionPreference='Stop';",
      "Add-Type -AssemblyName System.Speech;",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    ];
    if (voiceName) psLines.push(`try { $s.SelectVoice(${psQuoteLiteral(voiceName)}); } catch {}`);
    psLines.push(
      `$t = Get-Content -LiteralPath ${psQuoteLiteral(txtPath)} -Raw -Encoding UTF8;`,
      `$s.SetOutputToWaveFile(${psQuoteLiteral(wavPath)});`,
      "$s.Rate = 0;",
      "$s.Speak($t);",
      "$s.Dispose();"
    );
    const ps = await runProcess("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psLines.join(" ")]);
    if (ps.code !== 0) throw new Error((ps.stderr || ps.stdout || "Local TTS failed").slice(-400));
    let finalPath = wavPath;
    if (format === "mp3") {
      const ff = process.env.FFMPEG_PATH || "ffmpeg";
      const conv = await runProcess(ff, ["-y", "-i", wavPath, "-c:a", "libmp3lame", "-b:a", "192k", outPath]);
      if (conv.code === 0) finalPath = outPath;
      else finalPath = wavPath;
    }
    const buffer = await fs.readFile(finalPath);
    const actualFormat = finalPath.endsWith(".mp3") ? "mp3" : "wav";
    const notes = ["Menggunakan fallback TTS lokal (Windows)."];
    if (voiceName) notes.push(`Suara: ${voiceName}${picked.voice?.culture ? ` (${picked.voice.culture})` : ""}.`);
    if (picked.reason) notes.push(picked.reason);
    return { buffer, contentType: actualFormat === "mp3" ? "audio/mpeg" : "audio/wav", note: notes.join(" "), voiceUsed: voiceName, provider: "local" };
  } finally {
    await Promise.allSettled([txtPath, wavPath, `${tmpBase}.mp3`].map(p => fs.unlink(p).catch(() => {})));
  }
}

function splitTtsText(text: string, maxLen = 180) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  let remaining = cleaned;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < 60) cut = remaining.lastIndexOf(".", maxLen);
    if (cut < 60) cut = remaining.lastIndexOf(",", maxLen);
    if (cut < 60) cut = maxLen;
    const seg = remaining.slice(0, cut).trim();
    if (seg) parts.push(seg);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function detectTtsLang(text: string, requested?: string) {
  const req = String(requested || "auto").toLowerCase();
  if (req && req !== "auto") return req;
  const t = String(text || "").toLowerCase();
  // simple heuristic for Indonesian
  if (/\b(yang|dan|dengan|untuk|tidak|dari|ini|itu|pada|adalah|saya|kamu|anda|akan|sudah|belum|karena|juga|ke|di)\b/.test(t)) return "id";
  return "en";
}

async function synthesizeGoogleTTS(text: string, format: "mp3" | "wav", requestedLang?: string): Promise<{ buffer: Buffer; contentType: string; note: string; provider: "google"; lang: string }> {
  const lang = detectTtsLang(text, requestedLang);
  const chunks = splitTtsText(text, 180);
  if (!chunks.length) throw new Error("Teks kosong.");
  const tmpBase = path.join(os.tmpdir(), `px-gtts-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  await fs.mkdir(tmpBase, { recursive: true });
  const segPaths: string[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const q = encodeURIComponent(chunks[i]);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${q}`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } as any });
      if (!res.ok) throw new Error(`Google TTS gagal (${res.status})`);
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      if (!buf.length) throw new Error("Google TTS mengembalikan audio kosong");
      const segPath = path.join(tmpBase, `seg-${String(i).padStart(3, "0")}.mp3`);
      await fs.writeFile(segPath, buf);
      segPaths.push(segPath);
    }
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    let mergedMp3 = path.join(tmpBase, "merged.mp3");
    if (segPaths.length === 1) {
      mergedMp3 = segPaths[0];
    } else {
      // concat via filter to be robust
      const args = ["-y"];
      for (const p of segPaths) args.push("-i", p);
      args.push("-filter_complex", `concat=n=${segPaths.length}:v=0:a=1[a]`, "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "192k", mergedMp3);
      const r = await runProcess(ff, args);
      if (r.code !== 0) throw new Error((r.stderr || "Gagal menggabungkan audio Google TTS").slice(-400));
    }
    let finalPath = mergedMp3;
    let contentType = "audio/mpeg";
    if (format === "wav") {
      const wavPath = path.join(tmpBase, "out.wav");
      const r = await runProcess(ff, ["-y", "-i", mergedMp3, "-c:a", "pcm_s16le", wavPath]);
      if (r.code === 0) { finalPath = wavPath; contentType = "audio/wav"; }
    }
    const buffer = await fs.readFile(finalPath);
    return { buffer, contentType, note: `Menggunakan fallback Google TTS (bahasa: ${lang}).`, provider: "google", lang };
  } finally {
    await Promise.allSettled([fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})]);
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const voices = await listLocalVoices();
    const hasIndonesian = voices.some(v => v.culture.toLowerCase().startsWith("id") || /indones/i.test(v.name));
    return NextResponse.json({ ok: true, localVoices: voices, hasIndonesianVoice: hasIndonesian, localFallbackAvailable: process.platform === "win32", googleFallbackAvailable: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, localVoices: [], error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    const voice = String(body.voice || "alloy");
    const localVoice = body.localVoice ? String(body.localVoice) : (body.voice || null);
    const fallbackLang = String(body.fallbackLang || body.lang || "auto");
    const format = (String(body.format || "mp3").toLowerCase() === "wav" ? "wav" : "mp3") as "mp3" | "wav";
    const model = body.model ? String(body.model) : undefined;
    const name = String(body.name || "Text to Speech");
    const saveToLibrary = body.saveToLibrary !== false;
    if (!text) return NextResponse.json({ error: "Text is required" }, { status: 400 });

    let buffer: Buffer;
    let usedFallback = false;
    let note: string | null = null;
    let voiceUsed: string | null = null;
    let providerUsed = "ai";

    try {
      const ai = await synthesizeSpeechWithTask("text_to_speech", text, { voice, format, model });
      buffer = Buffer.from(ai.buffer);
    } catch (aiErr: any) {
      // Fallback 1: Google TTS (better Indonesian support)
      try {
        const g = await synthesizeGoogleTTS(text, format, fallbackLang);
        buffer = g.buffer;
        usedFallback = true;
        providerUsed = "google";
        note = g.note;
      } catch (gErr: any) {
        // Fallback 2: Local Windows TTS
        try {
          const local = await synthesizeLocalTTS(text, format, localVoice);
          buffer = local.buffer;
          usedFallback = true;
          providerUsed = "local";
          note = local.note;
          voiceUsed = local.voiceUsed || null;
        } catch (localErr: any) {
          const aiMsg = aiErr?.message || "AI TTS failed";
          const gMsg = gErr?.message || "Google TTS fallback failed";
          const localMsg = localErr?.message || "Local TTS fallback failed";
          throw new Error(`${aiMsg} (fallback Google gagal: ${gMsg}; fallback lokal gagal: ${localMsg})`);
        }
      }
    }

    const outDir = path.join(STORAGE_ROOT, "audio", user.id);
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${Date.now()}-${safeName(name)}.${format}`);
    let finalFormat = format;
    // If Google/local returned wav but requested mp3 in some edge case, detect
    if (format === "mp3" && buffer.slice(0,4).toString("ascii") === "RIFF") finalFormat = "wav";
    const finalOutPath = finalFormat === format ? outPath : outPath.replace(/\.mp3$/i, ".wav");
    await fs.writeFile(finalOutPath, buffer);

    let duration: number | null = null;
    try { duration = (await probeVideo(finalOutPath)).duration || null; } catch {}
    const st = await fs.stat(finalOutPath).catch(() => null);

    let asset: any = null;
    const sourceName = providerUsed === "google" ? "Text-to-Speech (Google Fallback)" : providerUsed === "local" ? "Text-to-Speech (Local Fallback)" : "Text-to-Speech";
    if (saveToLibrary) {
      asset = await prisma.audioAsset.create({ data: { userId: user.id, name, format: finalFormat, filePath: finalOutPath, duration, fileSize: st?.size || null, sourceName } });
    }

    const rel = path.relative(STORAGE_ROOT, finalOutPath).replace(/\\/g, "/");
    return NextResponse.json({ ok: true, asset, fileUrl: `/api/files?path=${encodeURIComponent(rel)}`, duration, fileSize: st?.size || null, format: finalFormat, fallback: usedFallback, note, voiceUsed, provider: providerUsed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Text-to-speech failed" }, { status: 500 });
  }
}
