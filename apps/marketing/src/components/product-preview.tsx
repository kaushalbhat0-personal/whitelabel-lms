/**
 * Real product preview inside a refined browser frame (MKT-01D-A, MKT-02B).
 *
 * Uses the student-dashboard screenshot — chosen over course-learning after
 * visual inspection: the personalized greeting, sidebar navigation, upcoming
 * class, and progress stats communicate a real learning product at a glance.
 * (MicroNest demo brand, fictional demo data.) The static file lives under
 * apps/marketing/public/product/ — the marketing site stays fully static
 * with no runtime LMS dependency.
 */
export function ProductPreview() {
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label="Real screenshot of the branded LMS student dashboard: courses, progress, and upcoming classes."
        className="overflow-hidden rounded-hero border border-ink/10 bg-paper shadow-[0_24px_48px_-16px_rgb(28_25_23/0.18),0_4px_12px_-4px_rgb(28_25_23/0.08)]"
      >
        <div className="flex items-center gap-3 border-b border-line/80 bg-paper px-4 py-2.5" aria-hidden="true">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
          </span>
          <span className="hidden flex-1 truncate text-center text-xs font-medium tracking-wide text-ink-soft sm:block">
            learn.youracademy.com
          </span>
          <span className="w-10" />
        </div>
        <div aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/product/student-dashboard.webp"
            alt=""
            width={1440}
            height={900}
            loading="eager"
            className="block h-auto w-full"
          />
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[13px] font-medium tracking-wide text-ink-soft">
        Real LMS interface · fictional demo data
      </figcaption>
    </figure>
  );
}
