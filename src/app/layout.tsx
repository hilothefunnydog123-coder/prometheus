import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Counterfactual Lab",
  description:
    "AI-compiled physics micro-experiments: predict, test counterfactuals, explain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <span className="brand">
              Counterfactual<span className="spark"> Lab</span>
            </span>
            <span className="tagline">
              predict it · break it · explain it
            </span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
