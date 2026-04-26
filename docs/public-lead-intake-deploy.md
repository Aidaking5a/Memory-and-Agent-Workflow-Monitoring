# Public Lead Intake Deploy (HTTPS)

This repository now ships with `render.yaml` to deploy `@theia/control-plane` on Render with HTTPS.

## What is preconfigured

- Website lead form endpoint:
  - `website/site/contact.html`
  - `data-api-base-url="https://theia-control-plane.onrender.com"`
- Control-plane CORS allowlist:
  - `THEIA_LEADS_ALLOW_ORIGINS=https://aidaking5a.github.io`
- Production hardening defaults in Render:
  - `NODE_ENV=production`
  - `THEIA_COOKIE_SECURE=true`
  - `THEIA_ENABLE_DEV_LOGIN=false`
  - generated secrets for session + lead IP hash salt

## Deploy on Render

1. In Render, choose **New > Blueprint**.
2. Select this GitHub repository.
3. Confirm `render.yaml` is detected.
4. Deploy.
5. Verify:
   - `https://theia-control-plane.onrender.com/health`
   - `https://theia-control-plane.onrender.com/api/public/leads` (POST only)

## If Render assigns a different hostname

Update `website/site/contact.html`:

- `data-api-base-url="https://<your-render-hostname>"`

and redeploy GitHub Pages.
