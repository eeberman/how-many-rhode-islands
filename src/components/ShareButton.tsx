"use client";

import { useState } from "react";

export default function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const url = window.location.href;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ url, title });
        return;
      } catch {
        // User cancelled — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. http:// on desktop) — do nothing
    }
  }

  return (
    <button
      onClick={onClick}
      className="mt-6 px-5 py-2 rounded-full bg-ocean/15 hover:bg-ocean/25 text-bone text-sm transition-colors border border-white/10"
    >
      {copied ? "Copied!" : "Send to a friend"}
    </button>
  );
}
