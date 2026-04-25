import express, { type Request, type Response } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as SamlStrategy } from "passport-saml";
import type { Profile, VerifiedCallback } from "passport-saml";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LoginMetricsStore } from "./metrics-store.js";
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
await metricsStore.init();

const samlConfig = await resolveSamlConfig();
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.THEIA_SESSION_SECRET ?? "theia-dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
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

app.get("/api/login-events", ensureAuthenticated, async (request, response) => {
  const limit = Number(request.query.limit ?? 25);
  response.json(await metricsStore.listRecent(limit));
});

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
      </section>
    </main>

    <script>
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
      }

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
