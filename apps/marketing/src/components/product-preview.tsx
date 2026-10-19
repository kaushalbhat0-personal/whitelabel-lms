/**
 * Real product preview inside a browser frame (MKT-01D-A).
 *
 * Uses an actual screenshot captured from the live white-label LMS demo
 * (MicroNest Services Academy, fictional demo data). The static file lives
 * under apps/marketing/public/product/ — the marketing site stays fully
 * static with no runtime LMS dependency.
 */
export function ProductPreview() {
  return (
    <figure
      role="img"
      aria-label="Real screenshot of the branded LMS student dashboard: courses, progress, and upcoming classes."
      className="overflow-hidden rounded-hero border border-line bg-paper shadow-card-hover"
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-sand/60 px-4 py-3" aria-hidden="true">
        <span className="h-3 w-3 rounded-full bg-line" />
        <span className="h-3 w-3 rounded-full bg-line" />
        <span className="h-3 w-3 rounded-full bg-line" />
        <span className="ml-3 hidden flex-1 truncate rounded-full bg-paper px-4 py-1 text-xs text-ink-soft sm:block">
          learn.youracademy.com
        </span>
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
    </figure>
  );
}
