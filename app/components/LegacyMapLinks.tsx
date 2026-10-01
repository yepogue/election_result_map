"use client";
import { useEffect } from "react";

// Preserve previously published map-section bookmarks after the home-page move.
export default function LegacyMapLinks() {
  useEffect(() => {
    const mapSections = ["#map", "#data", "#context", "#sources", "#changelog"];
    if (window.location.pathname === "/" && mapSections.includes(window.location.hash)) {
      window.location.replace(`/election-map${window.location.hash}`);
    }
  }, []);
  return null;
}
