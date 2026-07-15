// Minimal placeholder root layout. The real layout, styling, and 3D UI are
// owned by Contributor A — this file exists only so the app builds.
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Counterfactual Lab",
  description:
    "AI-compiled physics micro-experiments: predict, test counterfactuals, explain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
