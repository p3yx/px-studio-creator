import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const appSans = Plus_Jakarta_Sans({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PX STUDIO CREATOR — AI Video Editing & Creative Studio",
  description: "PX STUDIO CREATOR helps you combine clips, analyze media, extract audio, apply AI-guided editing, and render professional videos.",
  applicationName: "PX STUDIO CREATOR",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${appSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col text-[var(--text)]">
        <div className="app-bg" aria-hidden="true">
          <div className="app-bg-grid" />
        </div>
        <div className="app-content">{children}</div>
      </body>
    </html>
  );
}
