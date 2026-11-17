import { PageHeader } from "@/components/ui";
import WatermarkDelogoClient from "./watermark-delogo-client";

export const dynamic = "force-dynamic";

export default function WatermarkDelogoPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Hapus Watermark (Delogo)"
        description="Hapus watermark/logo/overlay milik Anda sendiri (atau yang Anda berwenang edit) menggunakan filter FFmpeg delogo — piksel area diisi dari tepi sekeliling, tanpa bayangan. Opsi kombinasi delogo + blur tipis tersedia. Ringan untuk PC tanpa GPU."
      />
      <WatermarkDelogoClient />
    </div>
  );
}
