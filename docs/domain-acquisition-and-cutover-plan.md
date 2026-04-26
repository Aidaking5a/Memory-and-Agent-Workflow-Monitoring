# Domain Acquisition And Cutover Plan

This plan is optimized for Theia's current public stack:

- Website: GitHub Pages
- Control-plane API: Render
- Search: Google Search Console

## Recommended Purchase Order

1. Buy `theia-vision.ai` (primary brand candidate).
2. Buy `theia-vision.com` (defensive + redirect domain).
3. Keep `theia` root-name variants as long-term acquisition targets.

`theia.com` and `theia.ai` are already in use, so treat those as broker-only options for later.

## Registrar Setup (Immediately After Purchase)

1. Turn on:
   - domain lock
   - auto-renew
   - WHOIS privacy (when available)
   - DNSSEC
2. Create DNS:
   - `www.theia-vision.ai` CNAME -> `aidaking5a.github.io`
   - apex redirect (`theia-vision.ai`) -> `https://www.theia-vision.ai`
   - `api.theia-vision.ai` CNAME -> `theia-control-plane.onrender.com`
3. For `.com` defensive redirect:
   - `www.theia-vision.com` -> redirect to `https://www.theia-vision.ai`
   - apex redirect (`theia-vision.com`) -> `https://www.theia-vision.ai`

## Repo Cutover Command

From project root:

```powershell
.\scripts\prepare-custom-domain.ps1 `
  -PrimaryDomain "www.theia-vision.ai" `
  -SecondaryDomain "www.theia-vision.com" `
  -ApiBaseUrl "https://api.theia-vision.ai" `
  -MailDomain "theia-vision.ai" `
  -Apply
```

This updates:

- canonical and OG URLs in `website/site/*.html`
- sitemap/feed/robots domain URLs
- contact emails (`@theiaops.ai` -> `@theia-vision.ai`)
- lead form API base URL in `contact.html`
- GitHub Pages `CNAME`

## GitHub Pages

1. Merge to `main`.
2. Wait for Pages deploy success in Actions.
3. In GitHub repo settings:
   - Pages -> Custom domain: `www.theia-vision.ai`
   - Enable "Enforce HTTPS".

## Search Console Cutover

1. Add and verify `https://www.theia-vision.ai/` property.
2. Submit:
   - `https://www.theia-vision.ai/sitemap.xml`
   - `https://www.theia-vision.ai/feed.xml`
3. Request indexing for:
   - `/`
   - `/product.html`
   - `/agent-observability.html`
   - `/ai-memory-orchestration.html`
   - `/workflow-auditability.html`

## Zero-Downtime Notes

- Keep the existing GitHub Pages URL alive with redirects/canonical pointing to the new primary domain.
- Do not remove old property in Search Console until new domain is fully indexed.
