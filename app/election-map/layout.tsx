import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Election map | Primary Atlas",
  description: "Certified Brownsberger–Lander precinct results, turnout, Census context, and original sources.",
};

export default function ElectionMapLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
