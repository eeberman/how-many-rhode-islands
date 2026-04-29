import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-5xl text-bone">Not on the map.</h1>
      <p className="mt-4 text-bone/60 max-w-sm">
        We couldn&apos;t find that place. Try a different spelling or pick something
        from the autocomplete.
      </p>
      <Link
        href="/"
        className="mt-8 px-6 py-3 rounded-2xl bg-ocean text-bone hover:bg-ocean-bright transition-colors"
      >
        ← Back to search
      </Link>
    </main>
  );
}
