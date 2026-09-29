"use client";

import { useState } from "react";
import type { Assessment } from "@/lib/types";
import { ResultsPanel } from "@/components/results-panel";

type Mode = "url" | "text";

export default function Home() {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Assessment | null>(null);

  async function runAssessment() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "url" ? { url } : { text, title: title || undefined },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assessment failed.");
      setResult(data as Assessment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading && (mode === "url" ? url.trim().length > 0 : text.trim().length > 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
      <header className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-300">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          Team 14 · PTS-100 pipeline
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Article Assessment
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
          Score an article against criteria <b>C1–C3</b> with evidence-backed
          reasoning. Paste a link or the raw text — non-assessable criteria are
          excluded and the result is rescaled to 100.
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl backdrop-blur sm:p-6">
        <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-black/30 p-1 text-sm">
          {(["url", "text"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-4 py-1.5 font-medium transition-colors ${
                mode === m
                  ? "bg-indigo-500 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "url" ? "From URL" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && runAssessment()}
            placeholder="https://example.com/news/article"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-400"
          />
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Headline (optional)"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-400"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the full article text here…"
              rows={8}
              className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm leading-6 outline-none placeholder:text-zinc-600 focus:border-indigo-400"
            />
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            {mode === "url"
              ? "Some sites block bots — switch to Paste text if extraction fails."
              : "At least 20 words required."}
          </p>
          <button
            onClick={runAssessment}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <Spinner /> Assessing…
              </>
            ) : (
              "Run assessment"
            )}
          </button>
        </div>
      </section>

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !result && (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]"
            />
          ))}
        </div>
      )}

      {result && <ResultsPanel assessment={result} />}

      {!result && !loading && !error && (
        <p className="mt-10 text-center text-xs text-zinc-600">
          No key configured? The app returns a labelled mock so you can explore
          the flow. Set <code className="text-zinc-400">ANTHROPIC_API_KEY</code>{" "}
          for real scoring.
        </p>
      )}
    </main>
  );
}

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}
