import SearchBar from "@/components/SearchBar";

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
          <p className="mt-4 text-bone/60 text-base">
            fit inside that?
          </p>
        </div>

        <SearchBar />

        <p className="mt-8 text-center text-sm text-bone/40 max-w-sm">
          Rhode Island is <span className="text-bone/70">1,214 sq mi</span> — the smallest US state.
          <br />
          How does that compare?
        </p>
      </div>

      <footer className="text-center pb-6 text-xs text-bone/30">
        Rebuilt with care.
      </footer>
    </main>
  );
}
