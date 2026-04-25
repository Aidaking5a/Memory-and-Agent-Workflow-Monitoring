# Google Indexing Checklist for Theia Website

1. Set your final production domain and update all placeholders:
- `https://theiaops.ai` values in website files
- `YOUR_ORG/YOUR_REPO` links
- Google verification token meta tag

2. Enable GitHub Pages for the public repository using GitHub Actions.

3. Confirm these URLs are live:
- `/`
- `/robots.txt`
- `/sitemap.xml`

4. Add the domain to Google Search Console.

5. Verify ownership using the meta tag in `website/site/index.html`:
- `<meta name="google-site-verification" content="..." />`

6. Submit sitemap URL in Search Console:
- `https://YOUR_DOMAIN/sitemap.xml`

7. Request indexing for homepage and key pages.

8. Monitor Coverage and Core Web Vitals in Search Console.