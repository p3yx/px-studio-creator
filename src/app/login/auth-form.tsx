"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Button, Input } from "@/components/ui";
import { PxLogoMark } from "@/components/brand";
import { signInWithGooglePopup } from "@/lib/firebase-client";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      router.push("/dashboard"); router.refresh();
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }

  async function loginWithGoogle() {
    setGoogleLoading(true); setError(null);
    try {
      const { idToken } = await signInWithGooglePopup();
      const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Google login failed");
      router.push("/dashboard"); router.refresh();
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") setError("Login Google dibatalkan.");
      else setError(err?.message || "Google login failed");
    } finally { setGoogleLoading(false); }
  }
  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6 lg:p-8 relative">
      <Card className="w-full max-w-md p-6 sm:p-8 relative z-10">
        <div className="mb-7 space-y-2">
          <div className="inline-flex items-center gap-2 text-sm text-violet-300">
            <PxLogoMark className="h-7 w-7" />
            PX STUDIO CREATOR
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight">{mode === "login" ? "Selamat datang kembali" : "Buat akun baru"}</h1>
          <p className="text-zinc-400 text-sm leading-relaxed">{mode === "login" ? "Masuk untuk melanjutkan project dan karya kreatif Anda." : "Daftar untuk mulai membuat dan mengelola project video Anda."}</p>
        </div>
        <div className="space-y-4">
          <Button type="button" variant="secondary" className="w-full" onClick={loginWithGoogle} disabled={googleLoading || loading}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-.9 2.3-2 3l3.2 2.5c1.9-1.8 3-4.4 3-7.5 0-.7-.1-1.4-.2-2H12z"/><path fill="#34A853" d="M12 22c2.7 0 5-0.9 6.7-2.4l-3.2-2.5c-.9.6-2 .9-3.5.9-2.7 0-5-1.8-5.8-4.3H2.9v2.6C4.6 19.6 8 22 12 22z"/><path fill="#4A90E2" d="M6.2 13.7c-.2-.6-.3-1.1-.3-1.7s.1-1.2.3-1.7V7.7H2.9C2.3 9 2 10.5 2 12s.3 3 .9 4.3l3.3-2.6z"/><path fill="#FBBC05" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3 14.7 2 12 2 8 2 4.6 4.4 2.9 7.7l3.3 2.6c.8-2.5 3.1-4.4 5.8-4.4z"/></svg>
            {googleLoading ? "Menghubungkan ke Google..." : "Continue with Google"}
          </Button>
          <div className="flex items-center gap-3 text-xs text-zinc-500"><div className="h-px flex-1 bg-white/10" /><span>atau</span><div className="h-px flex-1 bg-white/10" /></div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Name</label><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" /></div>}
            <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Email</label><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com" /></div>
            <div className="space-y-2"><label className="text-sm font-medium text-zinc-300">Password</label><Input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} placeholder="Min. 6 characters" /></div>
            {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-3">{error}</div>}
            <Button disabled={loading || googleLoading} className="w-full mt-1" type="submit">{loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}</Button>
          </form>
        </div>
        <div className="mt-5 text-sm text-zinc-400">
          {mode === "login" ? <>Belum punya akun? <Link href="/register" className="text-violet-300 hover:text-violet-200 transition">Register</Link></> : <>Sudah punya akun? <Link href="/login" className="text-violet-300 hover:text-violet-200 transition">Login</Link></>}
        </div>
      </Card>
    </div>
  );
}