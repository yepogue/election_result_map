import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Renters & voting | Primary Atlas",
  description: "Renter household share and Brownsberger support, before and after accounting for municipality, with precinct-level descriptive statistics.",
};

export default function RenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
