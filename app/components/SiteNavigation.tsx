"use client";

/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect } from "react";
const pages = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "map", href: "/election-map", label: "Election map" },
  { id: "wu", href: "/wu-precinct-analysis", label: "Wu comparisons" },
  { id: "factors", href: "/precinct-factor-analysis", label: "Community factors" },
];

export function SiteHeader({ active }: { active: string }) {
  return <header className="atlas-header">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <a className="brand" href="/" aria-label="Primary Atlas overview"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>PRIMARY ATLAS</span></a>
    <nav aria-label="Main navigation">{pages.map(page => <a key={page.id} href={page.href} aria-current={active === page.id ? "page" : undefined}>{page.label}</a>)}</nav>
  </header>;
}

export function PageSections({ links }: { links: [string, string][] }) {
  // Data-driven pages initially show a loading state; restore direct section
  // links once their targets exist, rather than leaving visitors at the top.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
  }, []);
  return <nav className="page-sections" aria-label="On this page"><span>On this page</span>{links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>;
}

export function SiteFooter() {
  return <footer className="atlas-footer"><a href="/">← All analyses</a><span>Primary Atlas · Source-linked precinct analysis</span><a href="#top">Back to top ↑</a></footer>;
}
