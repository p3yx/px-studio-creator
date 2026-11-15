import { PageHeader } from "@/components/ui";
import AutoCaptionClient from "./auto-caption-client";

export const dynamic = "force-dynamic";

export default function AutoCaptionPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Auto Caption Video"
        description="Upload video dan buat caption/subtitle otomatis (SRT) sekaligus video dengan caption yang sudah dimasukkan (burn-in). Mendukung pilihan bahasa dan fallback jika transkripsi AI gagal."
      />
      <AutoCaptionClient />
    </div>
  );
}
