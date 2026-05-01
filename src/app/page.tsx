import Link from "next/link";
import RandomButton from "@/components/RandomButton";
import SearchBar from "@/components/SearchBar";

const SUGGESTIONS = [
  { name: "Russia", slug: "russia" },
  { name: "Texas", slug: "texas" },
  { name: "Yellowstone", slug: "yellowstone-national-park" },
  { name: "Moon", slug: "moon" },
  { name: "Vatican City", slug: "vatican-city" },
  { name: "Luxembourg", slug: "luxembourg" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl sm:text-6xl font-semibold tracking-tight text-bone leading-[0.95]">
            How Many
            <br />
            <span className="text-ocean-bright italic">Rhode Islands</span>
          </h1>
        </div>

        <SearchBar />
        <RandomButton />

        <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-md">
          {SUGGESTIONS.map((s) => (
            <Link
              key={s.slug}
              href={`/${s.slug}`}
              className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-bone/70 hover:text-bone text-xs transition-colors border border-white/10"
            >
              {s.name}
            </Link>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-bone/40 max-w-sm">
          The only unit of measure that matters: How many Rhode Islands is it?
        </p>
      </div>
    </main>
  );
}
