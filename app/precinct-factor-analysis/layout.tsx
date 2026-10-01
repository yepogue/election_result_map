import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Precinct factors, vote share, and turnout | Primary Atlas",
  description:
    "A precinct-level statistical analysis of socioeconomic and demographic associations with Brownsberger vote share and primary turnout.",
};

export default function FactorAnalysisLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
