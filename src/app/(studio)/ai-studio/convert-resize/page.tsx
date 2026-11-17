import { PageHeader } from "@/components/ui";
import ConvertResizeClient from "./convert-resize-client";

export const dynamic = "force-dynamic";

export default function ConvertResizePage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Convert & Resize"
        description="Ubah rasio aspek dan ukuran video (16:9, 9:16, 1:1) dengan mode crop/pad, kualitas, dan loudness normalization. Render berjalan di background (worker)."
      />
      <ConvertResizeClient />
    </div>
  );
}
