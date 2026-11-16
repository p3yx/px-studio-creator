import { PageHeader } from "@/components/ui";
import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="space-y-8 lg:space-y-10">
      <PageHeader
        title="Settings"
        description="Pilih model AI yang digunakan untuk seluruh fitur PX STUDIO CREATOR dan kelola pengaturan pemrosesan project."
      />
      <SettingsClient />
    </div>
  );
}