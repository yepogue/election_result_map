import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wu strength and 2026 Senate challengers | Primary Atlas",
  description:
    "A source-linked Boston precinct analysis comparing three 2026 Democratic State Senate races with Michelle Wu's 2021 and 2025 mayoral results.",
};

export default function WuAnalysisLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
