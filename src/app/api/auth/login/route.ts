import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Failed" }, { status: 500 }); }
}