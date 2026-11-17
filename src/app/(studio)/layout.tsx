import { AppShell } from "@/components/app-shell";
import { PageTransition } from "@/components/page-transition";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <PageTransition>{children}</PageTransition>
    </AppShell>
  );
}