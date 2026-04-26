import express, { type Request, type Response } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as SamlStrategy } from "passport-saml";
import type { Profile, VerifiedCallback } from "passport-saml";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { LoginMetricsStore } from "./metrics-store.js";
import { LeadsStore, type LeadStatus } from "./leads-store.js";
import { resolveSamlConfig } from "./saml-config.js";

interface AppUser {
  id: string;
  email?: string;
  displayName?: string;
  provider: "saml" | "dev";
}

declare global {
  namespace Express {
    interface User extends AppUser {}
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const metricsStore = new LoginMetricsStore(path.resolve(__dirname, "../data/login-events.json"));
const leadsStore = new LeadsStore(path.resolve(__dirname, "../data/lead-submissions.json"));
await metricsStore.init();
await leadsStore.init();

const samlConfig = await resolveSamlConfig();
const app = express();

const leadAllowedOrigins = new Set(
  (process.env.THEIA_LEADS_ALLOW_ORIGINS ??
    "https://aidaking5a.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);
const leadIpHashSalt = process.env.THEIA_LEADS_IP_HASH_SALT?.trim();

function resolveSessionSecret(): string {
  const configuredSecret = process.env.THEIA_SESSION_SECRET?.trim();
  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("THEIA_SESSION_SECRET must be set to at least 32 characters in production.");
  }

  const ephemeralSecret = crypto.randomBytes(48).toString("base64");
  console.warn("THEIA_SESSION_SECRET missing or too short. Using ephemeral dev session secret for this run.");
  return ephemeralSecret;
}

function resolveSecureCookie(): boolean {
  const raw = process.env.THEIA_COOKIE_SECURE?.toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

function ensureApiAuthenticated(request: Request, response: Response, next: () => void) {
  if (request.isAuthenticated()) {
    next();
    return;
  }
  response.status(401).json({ message: "Authentication required." });
}

function isLeadStatus(input: string): input is LeadStatus {
  return ["new", "contacted", "qualified", "closed_won", "closed_lost", "spam"].includes(input);
}

function resolveLeadOrigin(request: Request): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin.length > 0 ? origin : undefined;
}

function applyLeadCors(request: Request, response: Response): void {
  const origin = resolveLeadOrigin(request);
  if (origin && leadAllowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getClientIp(request: Request): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.trim();
  }
  return request.socket.remoteAddress ?? undefined;
}

function hashIp(ip: string | undefined): string | undefined {
  if (!ip || !leadIpHashSalt) {
    return undefined;
  }
  return crypto.createHash("sha256").update(`${leadIpHashSalt}:${ip}`).digest("hex");
}

interface LeadRequestBody {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  environment?: unknown;
  company?: unknown;
  sourcePage?: unknown;
  website?: unknown;
}

function readTextField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toCsvValue(input: string | undefined): string {
  const value = input ?? "";
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: resolveSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: resolveSecureCookie()
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user: Express.User, done: (err: Error | null, user?: Express.User) => void) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done: (err: Error | null, user?: Express.User) => void) => {
  done(null, user);
});

if (samlConfig.enabled && samlConfig.entryPoint && samlConfig.cert) {
  passport.use(
    "saml",
    new SamlStrategy(
      {
        issuer: samlConfig.issuer,
        callbackUrl: samlConfig.callbackUrl,
        audience: samlConfig.audience,
        entryPoint: samlConfig.entryPoint,
        idpCert: samlConfig.cert,
        acceptedClockSkewMs: 60_000,
        disableRequestedAuthnContext: true,
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
      },
      (profile: Profile | null, done: VerifiedCallback) => {
        if (!profile) {
          done(new Error("Missing SAML profile"));
          return;
        }

        const user: AppUser = {
          id: profile.nameID ?? profile.nameIDFormat ?? "unknown-user",
          email: (profile.email as string | undefined) ?? (profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string | undefined),
          displayName: (profile.displayName as string | undefined) ?? (profile.cn as string | undefined),
          provider: "saml"
        };
        done(null, user as unknown as Record<string, unknown>);
      },
      (_profile: Profile | null, done: VerifiedCallback) => {
        done(null, {
          id: "logout-profile",
          provider: "saml"
        });
      }
    )
  );
}

function ensureAuthenticated(request: Request, response: Response, next: () => void) {
  if (request.isAuthenticated()) {
    next();
    return;
  }
  response.redirect("/dashboard");
}

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "theia-control-plane",
    samlEnabled: samlConfig.enabled,
    samlProvider: samlConfig.provider
  });
});

app.get("/auth/saml/login", (request, response, next) => {
  if (!samlConfig.enabled) {
    response.status(503).json({
      message: "SAML is not configured yet.",
      reason: samlConfig.reason
    });
    return;
  }

  passport.authenticate("saml")(request, response, next);
});

app.post("/auth/saml/callback", (request, response, next) => {
  if (!samlConfig.enabled) {
    response.status(503).json({ message: "SAML is not configured." });
    return;
  }

  passport.authenticate("saml", async (error: unknown, user: Express.User | false | null) => {
    if (error || !user) {
      response.status(401).json({ message: "SAML login failed", error: (error as Error | undefined)?.message });
      return;
    }

    request.logIn(user, async (loginError) => {
      if (loginError) {
        response.status(500).json({ message: "Unable to finalize login", error: loginError.message });
        return;
      }

      await metricsStore.record({
        timestamp: new Date().toISOString(),
        provider: "saml",
        userId: user.id,
        email: user.email,
        displayName: user.displayName
      });

      response.redirect("/dashboard");
    });
  })(request, response, next);
});

app.get("/auth/dev/login", async (request, response) => {
  const user: AppUser = {
    id: "dev-user",
    email: "dev@theia.local",
    displayName: "Local Dev User",
    provider: "dev"
  };

  request.logIn(user, async (error) => {
    if (error) {
      response.status(500).json({ message: "Unable to start dev session", error: error.message });
      return;
    }

    await metricsStore.record({
      timestamp: new Date().toISOString(),
      provider: "dev",
      userId: user.id,
      email: user.email,
      displayName: user.displayName
    });

    response.redirect("/dashboard");
  });
});

app.get("/auth/logout", (request, response) => {
  request.logout(() => {
    request.session.destroy(() => {
      response.redirect("/dashboard");
    });
  });
});

app.get("/api/auth/status", (request, response) => {
  response.json({
    authenticated: request.isAuthenticated(),
    user: request.user ?? null,
    samlEnabled: samlConfig.enabled,
    samlProvider: samlConfig.provider,
    samlReason: samlConfig.reason
  });
});

app.get("/api/login-volume", async (request, response) => {
  const daysParam = Number(request.query.days ?? 30);
  const report = await metricsStore.report(daysParam);
  response.json(report);
});

app.get("/api/login-events", ensureApiAuthenticated, async (request, response) => {
  const limit = Number(request.query.limit ?? 25);
  response.json(await metricsStore.listRecent(limit));
});

app.options("/api/public/leads", (request, response) => {
  applyLeadCors(request, response);
  response.sendStatus(204);
});

app.post("/api/public/leads", async (request, response) => {
  applyLeadCors(request, response);

  const origin = resolveLeadOrigin(request);
  if (origin && !leadAllowedOrigins.has(origin)) {
    response.status(403).json({ message: "Origin not allowed for lead submissions." });
    return;
  }

  const body = (request.body ?? {}) as LeadRequestBody;
  const honeypot = readTextField(body.website);
  const name = readTextField(body.name);
  const email = readTextField(body.email).toLowerCase();
  const role = readTextField(body.role);
  const environment = readTextField(body.environment);
  const company = readTextField(body.company);
  const sourcePage = readTextField(body.sourcePage);

  if (!name || !email || !role || !environment) {
    response.status(400).json({ message: "Missing required fields." });
    return;
  }

  if (!email.includes("@") || email.length > 200) {
    response.status(400).json({ message: "Invalid email format." });
    return;
  }

  const markAsSpam = honeypot.length > 0 || environment.length < 20 || name.length < 2;
  const upserted = await leadsStore.upsertLead({
    name,
    email,
    role,
    environment,
    company,
    sourcePage,
    origin,
    referrer: typeof request.headers.referer === "string" ? request.headers.referer : undefined,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined,
    ipHash: hashIp(getClientIp(request)),
    markAsSpam
  });

  response.status(202).json({
    accepted: true,
    leadId: upserted.lead.leadId,
    status: upserted.lead.status
  });
});

app.get("/api/leads/report", ensureApiAuthenticated, async (_request, response) => {
  response.json(await leadsStore.report());
});

app.get("/api/leads", ensureApiAuthenticated, async (request, response) => {
  const limit = Number(request.query.limit ?? 100);
  const statusParam = typeof request.query.status === "string" ? request.query.status.trim() : "";
  const search = typeof request.query.q === "string" ? request.query.q : undefined;
  const status = isLeadStatus(statusParam) ? statusParam : undefined;
  response.json(await leadsStore.list({ limit, status, search }));
});

app.get("/api/leads/export.csv", ensureApiAuthenticated, async (_request, response) => {
  const leads = await leadsStore.list({ limit: 500, search: undefined, status: undefined });
  const header = [
    "leadId",
    "createdAt",
    "updatedAt",
    "lastSubmittedAt",
    "submissionCount",
    "status",
    "name",
    "email",
    "company",
    "role",
    "environment",
    "sourcePage",
    "origin",
    "referrer"
  ];
  const rows = leads.map((lead) =>
    [
      lead.leadId,
      lead.createdAt,
      lead.updatedAt,
      lead.lastSubmittedAt,
      String(lead.submissionCount),
      lead.status,
      lead.name,
      lead.email,
      lead.company,
      lead.role,
      lead.environment,
      lead.sourcePage,
      lead.origin,
      lead.referrer
    ]
      .map((value) => toCsvValue(value))
      .join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="theia-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  response.send(csv);
});

app.post<{ leadId: string }, unknown, { status?: string; note?: string }>(
  "/api/leads/:leadId/status",
  ensureApiAuthenticated,
  async (request, response) => {
    const statusInput = request.body?.status?.trim() ?? "";
    if (!isLeadStatus(statusInput)) {
      response.status(400).json({ message: "Invalid status." });
      return;
    }

    const updated = await leadsStore.updateStatus(request.params.leadId, statusInput, request.body?.note);
    if (!updated) {
      response.status(404).json({ message: "Lead not found." });
      return;
    }
    response.json(updated);
  }
);

app.get(["/", "/dashboard"], (request, response) => {
  const user = request.user;
  const authButton = samlConfig.enabled
    ? "<a class=\"btn\" href=\"/auth/saml/login\">Sign in with SAML</a>"
    : `<a class=\"btn secondary\" href=\"/auth/dev/login\">Use local dev login</a>`;

  const authStatus = user
    ? `<div class=\"auth-card\"><p><strong>Signed in:</strong> ${user.displayName ?? user.id}</p><p>${user.email ?? "no-email"}</p><a class=\"link\" href=\"/auth/logout\">Sign out</a></div>`
    : `<div class=\"auth-card\"><p><strong>Not signed in.</strong></p><p>${samlConfig.enabled ? "SAML is enabled for this control plane." : samlConfig.reason ?? "SAML config missing."}</p>${authButton}</div>`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Theia Control Plane</title>
    <style>
      :root {
        --bg: #f1efe8;
        --panel: #fffdf7;
        --line: #d9d0bc;
        --text: #1d2d2d;
        --muted: #566;
        --accent: #0b6a63;
      }
      body {
        margin: 0;
        font-family: Segoe UI, Roboto, sans-serif;
        background: radial-gradient(circle at 20% 0%, #fffaf2, var(--bg));
        color: var(--text);
      }
      .wrap {
        max-width: 980px;
        margin: 2rem auto;
        padding: 0 1rem;
      }
      h1 {
        margin: 0 0 0.4rem;
      }
      .sub {
        color: var(--muted);
        margin-top: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.9rem;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 1rem;
      }
      .auth-card {
        display: grid;
        gap: 0.3rem;
      }
      .btn {
        display: inline-block;
        background: var(--accent);
        color: white;
        text-decoration: none;
        border-radius: 999px;
        padding: 0.45rem 0.85rem;
        font-weight: 600;
      }
      .btn.secondary {
        background: #344;
      }
      .link {
        color: var(--accent);
        text-decoration: none;
      }
      #chart {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(20px, 1fr));
        gap: 0.2rem;
        align-items: end;
        min-height: 180px;
      }
      .bar {
        background: linear-gradient(180deg, #0f8d7f, #0b6a63);
        border-radius: 6px 6px 0 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border-bottom: 1px solid var(--line);
        text-align: left;
        padding: 0.4rem;
      }
      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 0.5rem;
      }
      .stat {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 0.55rem;
        background: #fff;
      }
      .label {
        font-size: 0.8rem;
        color: var(--muted);
      }
      .value {
        font-size: 1.4rem;
        font-weight: 700;
      }
      .pill {
        display: inline-block;
        border-radius: 999px;
        padding: 0.18rem 0.55rem;
        font-size: 0.78rem;
        background: #e6f6f4;
        color: #0b6a63;
      }
      .controls {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-top: 0.5rem;
      }
      .controls input,
      .controls select,
      .controls button {
        font: inherit;
        border-radius: 8px;
        border: 1px solid var(--line);
        padding: 0.3rem 0.45rem;
        background: #fff;
      }
      .controls button {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
        cursor: pointer;
      }
      .controls .btn {
        padding: 0.3rem 0.6rem;
      }
      .inline-status {
        display: flex;
        gap: 0.3rem;
      }
      .inline-status select,
      .inline-status button {
        font: inherit;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 0.2rem 0.3rem;
      }
      .inline-status button {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
      }
      .small-note {
        color: var(--muted);
        font-size: 0.86rem;
      }
    </style>
  </head>
  <body>
    <main class=\"wrap\">
      <h1>Theia Optional Cloud Control Plane</h1>
      <p class=\"sub\">SAML-ready auth plus local login-volume observability dashboard.</p>

      <section class=\"grid\">
        <article class=\"card\">${authStatus}</article>

        <article class=\"card\">
          <h2>Login Volume (last 30 days)</h2>
          <div class=\"stat-grid\">
            <div class=\"stat\"><div class=\"label\">Total Logins</div><div id=\"totalLogins\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Unique Users</div><div id=\"uniqueUsers\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Last Login</div><div id=\"lastLogin\" class=\"value\" style=\"font-size:0.95rem\">-</div></div>
          </div>
          <div id=\"chart\" style=\"margin-top:0.8rem\"></div>
        </article>

        <article class=\"card\">
          <h2>Recent Login Events</h2>
          <table>
            <thead><tr><th>Timestamp</th><th>User</th><th>Provider</th><th>Email</th></tr></thead>
            <tbody id=\"events\"></tbody>
          </table>
        </article>

        <article class=\"card\">
          <h2>Lead Pipeline</h2>
          <p class=\"small-note\">Public website leads are captured into this inbox. Sign in to review and update lead status.</p>
          <div class=\"stat-grid\">
            <div class=\"stat\"><div class=\"label\">Total Leads</div><div id=\"leadTotal\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">New</div><div id=\"leadNew\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Qualified</div><div id=\"leadQualified\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Updated 24h</div><div id=\"leadUpdated\" class=\"value\">-</div></div>
          </div>
          <div class=\"controls\">
            <select id=\"leadStatusFilter\">
              <option value=\"all\">All statuses</option>
              <option value=\"new\">new</option>
              <option value=\"contacted\">contacted</option>
              <option value=\"qualified\">qualified</option>
              <option value=\"closed_won\">closed_won</option>
              <option value=\"closed_lost\">closed_lost</option>
              <option value=\"spam\">spam</option>
            </select>
            <input id=\"leadSearch\" type=\"text\" placeholder=\"Search name, email, role\" />
            <button id=\"leadRefresh\" type=\"button\">Refresh Leads</button>
            <a class=\"btn\" href=\"/api/leads/export.csv\">Export CSV</a>
          </div>
        </article>

        <article class=\"card\">
          <h2>Recent Leads</h2>
          <table>
            <thead><tr><th>When</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
            <tbody id=\"leadRows\"></tbody>
          </table>
        </article>
      </section>
    </main>

    <script>
      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatDate(value) {
        if (!value) return 'n/a';
        return new Date(value).toLocaleString();
      }

      async function loadLeads(authenticated) {
        const tbody = document.getElementById('leadRows');
        const totalNode = document.getElementById('leadTotal');
        const newNode = document.getElementById('leadNew');
        const qualifiedNode = document.getElementById('leadQualified');
        const updatedNode = document.getElementById('leadUpdated');
        const statusFilter = document.getElementById('leadStatusFilter');
        const searchInput = document.getElementById('leadSearch');

        if (!authenticated) {
          totalNode.textContent = '-';
          newNode.textContent = '-';
          qualifiedNode.textContent = '-';
          updatedNode.textContent = '-';
          tbody.innerHTML = '<tr><td colspan="6">Sign in to access leads.</td></tr>';
          return;
        }

        const params = new URLSearchParams({ limit: '100' });
        if (statusFilter && statusFilter.value && statusFilter.value !== 'all') {
          params.set('status', statusFilter.value);
        }
        if (searchInput && searchInput.value.trim().length > 0) {
          params.set('q', searchInput.value.trim());
        }

        const report = await fetch('/api/leads/report').then((r) => r.json());
        const leads = await fetch('/api/leads?' + params.toString()).then((r) => r.json());

        totalNode.textContent = String(report.total ?? 0);
        newNode.textContent = String(report.byStatus?.new ?? 0);
        qualifiedNode.textContent = String(report.byStatus?.qualified ?? 0);
        updatedNode.textContent = String(report.updatedLast24Hours ?? 0);

        tbody.innerHTML = '';
        if (!Array.isArray(leads) || leads.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6">No leads found for this filter.</td></tr>';
          return;
        }

        for (const lead of leads) {
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + formatDate(lead.lastSubmittedAt || lead.createdAt) + '</td>' +
            '<td>' + escapeHtml(lead.name) + '</td>' +
            '<td><a href="mailto:' + encodeURIComponent(lead.email) + '">' + escapeHtml(lead.email) + '</a></td>' +
            '<td>' + escapeHtml(lead.role) + '</td>' +
            '<td><span class="pill">' + escapeHtml(lead.status) + '</span> (' + String(lead.submissionCount || 1) + ')</td>' +
            '<td>' +
              '<div class="inline-status">' +
                '<select data-lead-status="' + escapeHtml(lead.leadId) + '">' +
                  '<option value="new"' + (lead.status === 'new' ? ' selected' : '') + '>new</option>' +
                  '<option value="contacted"' + (lead.status === 'contacted' ? ' selected' : '') + '>contacted</option>' +
                  '<option value="qualified"' + (lead.status === 'qualified' ? ' selected' : '') + '>qualified</option>' +
                  '<option value="closed_won"' + (lead.status === 'closed_won' ? ' selected' : '') + '>closed_won</option>' +
                  '<option value="closed_lost"' + (lead.status === 'closed_lost' ? ' selected' : '') + '>closed_lost</option>' +
                  '<option value="spam"' + (lead.status === 'spam' ? ' selected' : '') + '>spam</option>' +
                '</select>' +
                '<button type="button" data-lead-save="' + escapeHtml(lead.leadId) + '">Save</button>' +
              '</div>' +
            '</td>';
          tbody.appendChild(tr);
        }
      }

      async function updateLeadStatus(leadId) {
        const selector = document.querySelector('select[data-lead-status="' + leadId + '"]');
        if (!selector) return;
        await fetch('/api/leads/' + encodeURIComponent(leadId) + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: selector.value })
        });
      }

      async function loadMetrics() {
        const volume = await fetch('/api/login-volume?days=30').then((r) => r.json());
        const status = await fetch('/api/auth/status').then((r) => r.json());

        document.getElementById('totalLogins').textContent = String(volume.totalLogins);
        document.getElementById('uniqueUsers').textContent = String(volume.uniqueUsers);
        document.getElementById('lastLogin').textContent = volume.lastLoginAt ? new Date(volume.lastLoginAt).toLocaleString() : 'none';

        const chart = document.getElementById('chart');
        chart.innerHTML = '';
        const max = Math.max(1, ...volume.points.map((p) => p.count));
        for (const point of volume.points) {
          const bar = document.createElement('div');
          bar.className = 'bar';
          bar.style.height = String(Math.max(4, Math.round((point.count / max) * 170))) + 'px';
          bar.title = point.date + ': ' + point.count;
          chart.appendChild(bar);
        }

        if (status.authenticated) {
          const rows = await fetch('/api/login-events?limit=20').then((r) => r.json());
          const tbody = document.getElementById('events');
          tbody.innerHTML = '';
          for (const row of rows) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + new Date(row.timestamp).toLocaleString() + '</td><td>' + (row.displayName || row.userId) + '</td><td>' + row.provider + '</td><td>' + (row.email || '') + '</td>';
            tbody.appendChild(tr);
          }
        } else {
          const tbody = document.getElementById('events');
          tbody.innerHTML = '<tr><td colspan="4">Sign in to view detailed login events.</td></tr>';
        }

        await loadLeads(Boolean(status.authenticated));
      }

      document.getElementById('leadRefresh')?.addEventListener('click', () => {
        loadMetrics();
      });

      document.getElementById('leadStatusFilter')?.addEventListener('change', () => {
        loadMetrics();
      });

      document.getElementById('leadSearch')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          loadMetrics();
        }
      });

      document.getElementById('leadRows')?.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const leadId = target.getAttribute('data-lead-save');
        if (!leadId) return;
        target.disabled = true;
        await updateLeadStatus(leadId);
        await loadMetrics();
      });

      loadMetrics();
    </script>
  </body>
</html>`;

  response.type("html").send(html);
});

const port = Number(process.env.THEIA_CONTROL_PLANE_PORT ?? 4620);
app.listen(port, () => {
  console.log(`Theia control plane listening on http://localhost:${port}`);
  if (!samlConfig.enabled) {
    console.log(`SAML disabled: ${samlConfig.reason ?? "Unknown reason"}`);
  } else {
    console.log(`SAML enabled with provider hint: ${samlConfig.provider}`);
  }
});
