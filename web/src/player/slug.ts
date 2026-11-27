/** Same rule as the server's glossary slugs (api/app/seo.py term_slug). */
export const term_slug = (term: string) => term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "term";
