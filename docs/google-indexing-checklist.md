# Google Indexing Checklist for Theia Website

1. Set the production site origin:
- for GitHub Pages path: `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring`
- for custom domain: run `scripts\set-site-origin.cmd -NewOrigin https://www.YOUR_DOMAIN.com -CustomDomainHost www.YOUR_DOMAIN.com`

2. Set your Search Console verification meta tag in `website/site/index.html`:
- `<meta name="google-site-verification" content="..." />`

3. Enable GitHub Pages deployment via GitHub Actions.

4. Confirm these pages are publicly reachable:
- `/`
- `/robots.txt`
- `/sitemap.xml`
- `/feed.xml`

5. In Google Search Console, submit:
- `https://YOUR_DOMAIN/sitemap.xml`
- `https://YOUR_DOMAIN/feed.xml`

6. Request indexing for priority pages:
- `/`
- `/product.html`
- `/agent-observability.html`
- `/ai-memory-orchestration.html`
- `/workflow-auditability.html`
- `/changelog.html`
- `/case-studies.html`

7. Monitor indexing status and enhancement reports weekly.
