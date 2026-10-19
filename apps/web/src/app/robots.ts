import type { MetadataRoute } from 'next';

// The LMS is an authenticated application (login + role-gated routes). It must
// never be crawled or indexed — this holds for the sales-demo deployment and
// for every client deployment alike, so no per-environment branching is used.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
