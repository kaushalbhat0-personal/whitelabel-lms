// Loading shell for /student/live-sessions/[sessionId] — eliminates white screen during route transition and Zoom prep.
export default function LiveSessionLoading() {
  return (
    <div>
      {/* PageHeader skeleton — matches PageHeader sticky h-12 border-b */}
      <div
        className="sticky top-0 z-10 border-b border-surface-border bg-white md:static md:border-0 md:bg-transparent"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="flex h-12 items-center gap-3 px-4 md:h-auto md:px-0 md:pb-6 md:pt-0">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-surface-muted motion-safe:animate-pulse md:hidden" aria-hidden="true" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-4 w-48 rounded bg-surface-muted motion-safe:animate-pulse" aria-hidden="true" />
            <div className="hidden h-3 w-32 rounded bg-surface-muted motion-safe:animate-pulse md:block" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="px-4 md:px-0">
        <div className="mx-auto max-w-4xl">
          {/* Session container skeleton — same footprint as Zoom 600px */}
          <div
            className="relative w-full overflow-hidden rounded-xl border border-surface-border bg-surface-card"
            style={{ height: '600px' }}
            role="status"
            aria-label="Loading live session"
            aria-busy="true"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900/5">
              <div className="h-8 w-8 rounded-full border-2 border-surface-border border-t-brand-400 motion-safe:animate-spin" aria-hidden="true" />
              <div className="h-3 w-32 rounded bg-surface-muted motion-safe:animate-pulse" aria-hidden="true" />
              <p className="text-sm font-medium text-text-muted">Loading live session…</p>
              <p className="text-xs text-text-muted/70">Preparing Zoom</p>
            </div>
          </div>

          {/* Subtle secondary skeleton to avoid excessive whitespace */}
          <div className="mt-4 hidden md:block">
            <div className="h-3 w-40 rounded bg-surface-muted motion-safe:animate-pulse" aria-hidden="true" />
          </div>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        Loading live session, please wait
      </span>
    </div>
  );
}
