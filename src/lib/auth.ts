import { cookies } from "next/headers";
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const SESSION_COOKIE = "pxstudio_session";
const SESSION_DAYS = 30;

let _localUserPromise: Promise<any> | null = null;

async function getOrCreateLocalUser() {
  if (_localUserPromise) return _localUserPromise;
  _localUserPromise = (async () => {
    const email = "local@pxstudio.local";
    let user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
    if (!user) {
      // Try to reuse first existing user, else create local user
      user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }).catch(() => null);
      if (!user) {
        user = await prisma.user.create({
          data: { email, name: "Local User", passwordHash: null, role: "ADMIN" },
        });
      }
    }
    return user;
  })().catch((e) => { _localUserPromise = null; throw e; });
  return _localUserPromise;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, token: tokenHash, expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token: hashToken(token) } }).catch(() => {});
  }
  cookieStore.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
}

export async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) {
      const session = await prisma.session.findUnique({
        where: { token: hashToken(token) },
        include: { user: true },
      });
      if (session && session.expiresAt >= new Date()) return session.user;
      if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
  } catch {}
  // No login required: use local/default user
  try { return await getOrCreateLocalUser(); } catch { return null; }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  return user; // local mode: allow access
}
