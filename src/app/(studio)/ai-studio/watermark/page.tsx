import { PageHeader } from "@/components/ui";
import WatermarkClient from "./watermark-client";

export const dynamic = "force-dynamic";

export default function WatermarkPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Watermark"
        description="Satu menu untuk hapus watermark (soft blur), buat watermark, dan pasang watermark ke video."
      />
      <WatermarkClient />
    </div>
  );
}
