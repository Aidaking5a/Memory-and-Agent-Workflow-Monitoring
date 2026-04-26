# Theia Website

This folder now contains both messaging drafts and a production-ready static website.

## Production Website

- Path: `website/site`
- Style: red/black premium theme
- Pages: home, product, use-cases, security, pricing, resources, contact, 404
- SEO: canonical tags, Open Graph, Twitter card, robots.txt, sitemap.xml, JSON-LD

## Publish

The GitHub Pages deployment workflow is at `.github/workflows/pages.yml`.

After pushing to `main` in a public repo and enabling GitHub Pages Actions deployment:
- The site is published automatically from `website/site`
- Search engines can discover it via `robots.txt` and `sitemap.xml`

## Important Domain Placeholders

Replace these values before launch:
- `https://theiaops.ai` in HTML canonical/OG/sitemap/robots
- `YOUR_ORG/YOUR_REPO` in `website/site/resources.html`
- `REPLACE_WITH_GOOGLE_VERIFICATION_TOKEN` in `website/site/index.html`
- `REPLACE_ME` Formspree endpoint in `website/site/contact.html`

## Content Drafts

Markdown strategy pages are still available in this folder:
- `homepage.md`
- `product.md`
- `use-cases.md`
- `security-trust-center.md`
- `pricing.md`
- `docs-resources.md`
- `contact-demo.md`