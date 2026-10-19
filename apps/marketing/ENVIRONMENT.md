# Marketing Deployment Environment (MKT-01H)

MicroNest sales website (`apps/marketing`, static export). Independently
deployed from the LMS. No secrets live here — only public navigation targets.

## Vercel project settings

| Setting            | Value                                              |
| ------------------ | -------------------------------------------------- |
| Root Directory     | `apps/marketing`                                   |
| Framework          | Next.js (static export)                            |
| Production domain  | `https://<MARKETING_DOMAIN>` (apex or `www.`, TBD) |

## Environment variables (Production)

| Variable               | Example value                        | Purpose                                        |
| ---------------------- | ------------------------------------ | ---------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | `https://<MARKETING_DOMAIN>`         | canonical URLs, `metadataBase`, sitemap, OG    |
| `NEXT_PUBLIC_DEMO_URL` | `https://demo.<MARKETING_DOMAIN>`    | “Launch Live Demo” CTA → `${…}/login`          |

Both are **baked at build time**: changing either requires a redeploy.
Both are public by design (`NEXT_PUBLIC_*`). Never put secrets here:

- no LMS API keys, no Supabase keys, no Render credentials,
  no demo usernames/passwords, no cookies, no auth state.

## Demo topology (approved Option C)

    <MARKETING_DOMAIN>        →  marketing project (this app)
    demo.<MARKETING_DOMAIN>   →  demo LMS project (apps/web) + demo API (Render)

Marketing links to the demo with a plain HTTPS hyperlink only. Marketing
never calls the LMS API and never shares authentication, cookies, or a
database with the LMS or any client deployment.

## Development behavior

Without env vars, local builds use safe fallbacks:

- site URL → `http://localhost:3002`
- demo URL → the current demo deployment (testing only — explicitly NOT
  the permanent production architecture; do not copy it elsewhere).

The `prebuild` script (`scripts/check-marketing-env.mjs`) prints loud
warnings for missing/malformed production values without failing the build.
