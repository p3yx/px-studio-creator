import { PageHeader } from "@/components/ui";
import TextToSpeechClient from "./text-to-speech-client";

export const dynamic = "force-dynamic";

export default function TextToSpeechPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader title="Text to Speech" description="Ubah teks menjadi audio suara menggunakan provider AI (task routing Text-to-Speech). Hasil dapat diputar, diunduh, dan disimpan ke Audio Library." />
      <TextToSpeechClient />
    </div>
  );
}
