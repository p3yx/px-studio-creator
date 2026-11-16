import { PageHeader } from "@/components/ui";
import WatermarkRemoverClient from "./watermark-remover-client";

export const dynamic = "force-dynamic";

export default function WatermarkRemoverPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="AI Watermark Remover"
        description="Hapus watermark, logo, atau overlay milik Anda sendiri dari video yang Anda miliki hak editnya. Pilih area, pratinjau metode, lalu render hasil sebagai file terpisah."
      />
      <WatermarkRemoverClient />
    </div>
  );
}
