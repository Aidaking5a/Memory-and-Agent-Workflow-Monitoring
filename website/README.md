# Theia Website

This folder now contains both messaging drafts and a production-ready static website.

## Production Website

- Path: `website/site`
- Style: red/black premium theme
- Pages: home, product, use-cases, security, pricing, resources, contact, keyword guides, changelog, case studies, 404
- SEO: canonical tags, Open Graph, Twitter card, robots.txt, sitemap.xml, RSS feed, JSON-LD

## Local One-Liner

From the repository root on Windows:

```powershell
pnpm.cmd run dev:marketing
```

Equivalent direct script:

```powershell
.\scripts\start-theia-marketing-site.cmd
```

This starts the static website server, writes logs to `.theia/dev-logs/marketing-site.log`, checks readiness, and opens:

- `http://localhost:4173/`
- `http://localhost:4173/contact.html`

Smoke test:

```powershell
pnpm.cmd run test:marketing
```

## Publish

The GitHub Pages deployment workflow is at `.github/workflows/pages.yml`.

After pushing to `main` in a public repo and enabling GitHub Pages Actions deployment:
- The site is published automatically from `website/site`
- Search engines can discover it via `robots.txt` and `sitemap.xml`

## Important Domain Placeholders

Replace these values before launch:
- `https://theiaops.ai` in HTML canonical/OG/sitemap/robots
- `REPLACE_WITH_GOOGLE_VERIFICATION_TOKEN` in `website/site/index.html`
- `data-api-base-url` in `website/site/contact.html` (currently set to `https://theia-control-plane.onrender.com`)

For lead intake to work cross-origin, configure the control-plane env var:

- `THEIA_LEADS_ALLOW_ORIGINS=https://aidaking5a.github.io`

## Domain Switch Utility

Use the script below to switch canonical and sitemap origin values:

```powershell
scripts\set-site-origin.cmd -NewOrigin https://www.your-domain.com -CustomDomainHost www.your-domain.com
```

## Content Drafts

Markdown strategy pages are still available in this folder:
- `homepage.md`
- `product.md`
- `use-cases.md`
- `security-trust-center.md`
- `pricing.md`
- `docs-resources.md`
- `contact-demo.md`
