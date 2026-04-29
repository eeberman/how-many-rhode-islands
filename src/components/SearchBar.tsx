"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { searchPlaces, queryToSlug, type Place } from "@/lib/places";

const TYPE_LABEL: Record<Place["type"], string> = {
  country: "Country",
  us_state: "US State",
  national_park: "National Park",
  city: "City",
};

export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Update matches as user types
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    setMatches(searchPlaces(query, 8));
    setHighlighted(0);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // The "Search [X] anyway" option always sits at the end if there's a query
  const showAnyway = query.trim().length > 0;
  const totalOptions = matches.length + (showAnyway ? 1 : 0);

  function go(slug: string) {
    setOpen(false);
    router.push(`/${slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % totalOptions);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + totalOptions) % totalOptions);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted < matches.length) {
        go(matches[highlighted].slug);
      } else if (showAnyway) {
        go(queryToSlug(query));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-md mx-auto">
      <input
        type="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        placeholder="Try Russia, Texas, or Yellowstone…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="
          w-full rounded-2xl bg-white/5 backdrop-blur
          border border-white/10
          px-5 py-4 text-lg text-bone
          placeholder:text-bone/40
          focus:outline-none focus:border-ocean-bright
          transition-colors
        "
      />

      {open && totalOptions > 0 && (
        <ul
          className="
            absolute z-10 mt-2 w-full rounded-2xl
            bg-navy-deep border border-white/10
            overflow-hidden shadow-2xl
          "
        >
          {matches.map((p, i) => (
            <li key={p.slug}>
              <button
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => go(p.slug)}
                className={`
                  w-full text-left px-5 py-3
                  flex justify-between items-baseline gap-3
                  transition-colors
                  ${highlighted === i ? "bg-ocean/20" : "bg-transparent"}
                `}
              >
                <span className="font-display text-lg text-bone">{p.name}</span>
                <span className="text-xs uppercase tracking-wider text-bone/50">
                  {TYPE_LABEL[p.type]}
                </span>
              </button>
            </li>
          ))}
          {showAnyway && (
            <li className="border-t border-white/10">
              <button
                onMouseEnter={() => setHighlighted(matches.length)}
                onClick={() => go(queryToSlug(query))}
                className={`
                  w-full text-left px-5 py-3
                  text-sm text-bone/70
                  transition-colors
                  ${highlighted === matches.length ? "bg-ocean/20" : "bg-transparent"}
                `}
              >
                Search <span className="text-ocean-bright italic">{query}</span> anyway →
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
