import crypto from "crypto";

function getSecret() {
  const s = process.env.AUTH_SECRET || process.env.AI_ENCRYPTION_SECRET || "px-studio-dev-secret-change-me";
  return crypto.createHash("sha256").update(String(s)).digest();
}

export function encryptSecret(plain: string): string {
  const key = getSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${enc.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(payload?: string | null): string | null {
  if (!payload) return null;
  try {
    const [ivB64, dataB64, tagB64] = String(payload).split(":");
    if (!ivB64 || !dataB64 || !tagB64) return null;
    const key = getSecret();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(secret?: string | null) {
  if (!secret) return "";
  const s = String(secret);
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}
