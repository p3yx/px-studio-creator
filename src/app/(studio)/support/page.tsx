import { PageHeader } from "@/components/ui";
import SupportClient from "./support-client";

export const dynamic = "force-dynamic";

export default function SupportPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Buy Me a Coffee"
        description="Dukung PX STUDIO CREATOR via QRIS dinamis. Pilih nominal, scan, dan selesaikan pembayaran sebelum batas waktu berakhir."
      />
      <SupportClient />
    </div>
  );
}
