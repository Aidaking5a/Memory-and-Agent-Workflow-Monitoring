# Theia SEO Visibility Playbook

This playbook turns the website into a repeatable growth surface without hype or deceptive SEO tactics.

## 1) Search Console Setup

1. Add the site property in Google Search Console:
   - `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/`
   - if custom domain is active, also add `https://www.your-domain.com/`
2. Verify ownership:
   - use the meta tag in `website/site/index.html`
3. Submit sitemaps:
   - `/sitemap.xml`
   - `/feed.xml`
4. Request indexing for these pages first:
   - `/`
   - `/product.html`
   - `/agent-observability.html`
   - `/ai-memory-orchestration.html`
   - `/workflow-auditability.html`
   - `/changelog.html`
   - `/case-studies.html`

## 2) Custom Domain Rollout

1. Point DNS for `www` to GitHub Pages.
2. Run:
   - `scripts\set-site-origin.cmd -NewOrigin https://www.your-domain.com -CustomDomainHost www.your-domain.com`
3. Commit and publish.
4. Re-submit sitemap in Search Console.

## 3) Backlink Execution

Use high-signal sources only:

- repository README and docs index links
- launch announcements in technical communities aligned with agent tooling
- credible launch directories and product listing sites
- partner mentions from design partners and integration docs

Anchor themes to reuse:

- agent workflow observability
- AI memory orchestration
- workflow auditability

## 4) Freshness Cadence

Minimum cadence:

- changelog update every release
- one case study or technical note every month
- quarterly updates to core landing pages

Use:

- `website/site/changelog.html`
- `website/site/case-studies.html`
- `website/site/feed.xml`

## 5) Quality Guardrails

- avoid keyword stuffing
- avoid doorway pages
- keep claims evidence-based
- keep metadata and page body aligned
- keep canonical URLs consistent after domain changes
