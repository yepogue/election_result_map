import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Primary Atlas overview",
  description: "An overview of the election results, Wu comparison, and precinct factor analysis available in Primary Atlas.",
};

export default function OverviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
