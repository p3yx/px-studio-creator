import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();
    if (!email || !password || password.length < 6) return NextResponse.json({ error: "Email and password (min 6 chars) are required" }, { status: 400 });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    const count = await prisma.user.count();
    const user = await prisma.user.create({ data: { email, name: name || null, passwordHash: await hashPassword(password), role: count === 0 ? "ADMIN" : "USER" } });
    await createSession(user.id);
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Failed" }, { status: 500 }); }
}