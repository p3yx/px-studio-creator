import { PageHeader } from "@/components/ui";
import AddAudioClient from "./add-audio-client";

export const dynamic = "force-dynamic";

export default function AddAudioPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="Tambah Suara ke Video" description="Gabungkan atau ganti audio pada video menggunakan file audio/musik (upload atau dari Audio Library). Proses rendering dilakukan dengan FFmpeg." />
      <AddAudioClient />
    </div>
  );
}
