import { getCurrentUser } from "@/lib/auth";
import { Card, Button, PageHeader } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="Profile" description="Akun dan sesi aktif Anda." />
      <Card className="p-6 sm:p-7 max-w-2xl">
        {user ? <div className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Name</div><div className="font-medium">{user.name || '-'}</div></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Email</div><div className="font-medium break-all">{user.email}</div></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Role</div><div className="font-medium">{user.role}</div></div>
          </div>
          <form action="/api/auth/logout" method="post" className="pt-1"><Button variant="secondary" type="submit">Logout</Button></form>
        </div>
        : <div className="space-y-4"><p className="text-zinc-400">Anda belum masuk ke akun.</p><div className="flex flex-col sm:flex-row gap-3"><Link href="/login"><Button className="w-full sm:w-auto">Masuk</Button></Link><Link href="/register"><Button variant="secondary" className="w-full sm:w-auto">Daftar</Button></Link></div></div>}
      </Card>
    </div>
  );
}