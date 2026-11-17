import CreateClient from "./create-client";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Create Clips with AI"
        description="Upload video atau gunakan link YouTube, pilih momen yang dicari, atur durasi & format, lalu biarkan AI menganalisis highlight dan FFmpeg merender clip MP4 secara otomatis."
      />
      <CreateClient />
    </div>
  );
}