"use client";

import { useRouter } from "next/navigation";
import { getRandomPlace } from "@/lib/places";

export default function RandomButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(`/${getRandomPlace().slug}`)}
      className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-bone/70 transition-colors hover:bg-white/10 hover:text-bone"
    >
      Random
    </button>
  );
}
