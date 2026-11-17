import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) return NextResponse.json({ error: "Missing idToken" }, { status: 400 });

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Firebase is not configured" }, { status: 500 });

    // Verify token with Firebase Identity Toolkit
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      cache: "no-store",
    });
    const lookup = await lookupRes.json().catch(() => ({}));
    if (!lookupRes.ok) {
      return NextResponse.json({ error: lookup?.error?.message || "Invalid Google token" }, { status: 401 });
    }
    const fbUser = lookup?.users?.[0];
    const email = fbUser?.email;
    if (!email) return NextResponse.json({ error: "Google account email not available" }, { status: 400 });

    const name = fbUser?.displayName || email.split("@")[0] || "User";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const count = await prisma.user.count();
      user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash: null,
          role: count === 0 ? "ADMIN" : "USER",
        },
      });
    } else if (!user.name && name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { name } });
    }

    await createSession(user.id);
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Google login failed" }, { status: 500 });
  }
}
