import express, { type Request, type Response } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as SamlStrategy } from "passport-saml";
import type { Profile, VerifiedCallback } from "passport-saml";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LoginMetricsStore } from "./metrics-store.js";
import { LeadsStore, type LeadStatus } from "./leads-store.js";
import { LeadNotifier } from "./lead-notifier.js";
import { PublicAuthStore, type PublicAuthUserView } from "./public-auth.js";
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
const leadNotifier = new LeadNotifier(path.resolve(__dirname, "../data/lead-deliveries.json"));
const publicAuthStore = new PublicAuthStore(path.resolve(__dirname, "../data/public-auth.json"), {
  sessionTtlHours: Number(process.env.THEIA_PUBLIC_AUTH_TTL_HOURS ?? 96)
});
await metricsStore.init();
await leadsStore.init();
await leadNotifier.init();
await publicAuthStore.init();

const samlConfig = await resolveSamlConfig();
const app = express();
const isProduction = process.env.NODE_ENV === "production";
const devLoginEnabled = (() => {
  const raw = process.env.THEIA_ENABLE_DEV_LOGIN?.toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return !isProduction;
})();

const leadAllowedOrigins = new Set(
  (process.env.THEIA_LEADS_ALLOW_ORIGINS ??
    "https://aidaking5a.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);
const leadIpHashSalt = process.env.THEIA_LEADS_IP_HASH_SALT?.trim();
const marketingAllowedOrigins = new Set(
  (process.env.THEIA_MARKETING_ALLOW_ORIGINS ??
    "https://aidaking5a.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);
const marketingMetricsFilePath = process.env.THEIA_MARKETING_METRICS_FILE?.trim()
  ? path.resolve(process.cwd(), process.env.THEIA_MARKETING_METRICS_FILE.trim())
  : path.resolve(__dirname, "../data/marketing-charts.json");
const leadBodyLimit = process.env.THEIA_LEADS_BODY_LIMIT?.trim() || "40kb";
const leadDedupeWindowSeconds = Math.max(
  15,
  Math.min(900, Number(process.env.THEIA_LEADS_DEDUPE_WINDOW_SECONDS ?? 120) || 120)
);
const leadRateLimitWindowSeconds = Math.max(
  10,
  Math.min(1800, Number(process.env.THEIA_LEADS_RATE_LIMIT_WINDOW_SECONDS ?? 120) || 120)
);
const leadRateLimitMaxSubmissions = Math.max(
  1,
  Math.min(20, Number(process.env.THEIA_LEADS_RATE_LIMIT_MAX_SUBMISSIONS ?? 5) || 5)
);
const leadRateLimitCache = new Map<string, number[]>();
const idempotencyCache = new Map<string, { leadId: string; status: LeadStatus; expiresAtMs: number }>();
const authRateLimitCache = new Map<string, number[]>();
const publicAuthRateLimitWindowSeconds = Math.max(
  30,
  Math.min(3600, Number(process.env.THEIA_PUBLIC_AUTH_RATE_LIMIT_WINDOW_SECONDS ?? 300) || 300)
);
const publicAuthRateLimitMaxAttempts = Math.max(
  3,
  Math.min(20, Number(process.env.THEIA_PUBLIC_AUTH_RATE_LIMIT_MAX_ATTEMPTS ?? 8) || 8)
);

interface MarketingChartsPayload {
  sourceLabel?: string;
  dataQuality?: "live" | "sample";
  generatedAt?: string;
  charts: Record<string, unknown>;
}

interface LeadSubmissionValidation {
  valid: boolean;
  errors: string[];
  data: {
    name: string;
    email: string;
    role: string;
    environment: string;
    company: string;
    sourcePage: string;
    honeypot: string;
  };
}

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
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Theia-Idempotency-Key");
  response.setHeader("Access-Control-Max-Age", "600");
}

function applyMarketingCors(request: Request, response: Response): void {
  const origin = resolveLeadOrigin(request);
  if (origin && marketingAllowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function loadMarketingChartsPayload(): Promise<MarketingChartsPayload | null> {
  try {
    const raw = await readFile(marketingMetricsFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!("charts" in parsed)) {
      return null;
    }
    return parsed as MarketingChartsPayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
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

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

async function authenticateLeadUser(request: Request): Promise<PublicAuthUserView | null> {
  const token = readBearerToken(request);
  if (!token) return null;
  return publicAuthStore.authenticateToken(token);
}

function readTextField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeLine(value: string, max = 200): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeParagraph(value: string, max = 2000): string {
  return value.replace(/\r/g, "").trim().slice(0, max);
}

function isEmailFormat(value: string): boolean {
  if (value.length < 6 || value.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSourcePage(input: string): string {
  const trimmed = sanitizeLine(input, 220);
  if (!trimmed) return "/contact.html";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      return `${parsed.pathname}${parsed.search}`.slice(0, 220);
    } catch {
      return "/contact.html";
    }
  }
  if (!trimmed.startsWith("/")) {
    return `/${trimmed}`.slice(0, 220);
  }
  return trimmed;
}

function normalizeForSignature(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function createSubmissionSignature(input: {
  name: string;
  email: string;
  role: string;
  environment: string;
  company: string;
  sourcePage: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        normalizeForSignature(input.name),
        normalizeForSignature(input.email),
        normalizeForSignature(input.role),
        normalizeForSignature(input.environment),
        normalizeForSignature(input.company),
        normalizeForSignature(input.sourcePage)
      ].join("|")
    )
    .digest("hex");
}

function validateLeadSubmission(body: LeadRequestBody): LeadSubmissionValidation {
  const errors: string[] = [];
  const honeypot = readTextField(body.website);
  const name = sanitizeLine(readTextField(body.name), 80);
  const email = sanitizeLine(readTextField(body.email).toLowerCase(), 200);
  const role = sanitizeLine(readTextField(body.role), 80);
  const environment = sanitizeParagraph(readTextField(body.environment), 2000);
  const company = sanitizeLine(readTextField(body.company), 120);
  const sourcePage = normalizeSourcePage(readTextField(body.sourcePage));

  if (name.length < 2) errors.push("Name must be at least 2 characters.");
  if (!isEmailFormat(email)) errors.push("A valid work email is required.");
  if (role.length < 2) errors.push("Role is required.");
  if (environment.length < 20) errors.push("Environment details must be at least 20 characters.");
  if (environment.length > 2000) errors.push("Environment details exceed the 2000 character limit.");

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name,
      email,
      role,
      environment,
      company,
      sourcePage,
      honeypot
    }
  };
}

function consumeRateLimitToken(key: string): boolean {
  const now = Date.now();
  const windowMs = leadRateLimitWindowSeconds * 1000;
  const existing = leadRateLimitCache.get(key) ?? [];
  const recent = existing.filter((value) => now - value <= windowMs);
  if (recent.length >= leadRateLimitMaxSubmissions) {
    leadRateLimitCache.set(key, recent);
    return false;
  }
  recent.push(now);
  leadRateLimitCache.set(key, recent);
  return true;
}

function consumePublicAuthRateLimit(key: string): boolean {
  const now = Date.now();
  const windowMs = publicAuthRateLimitWindowSeconds * 1000;
  const existing = authRateLimitCache.get(key) ?? [];
  const recent = existing.filter((value) => now - value <= windowMs);
  if (recent.length >= publicAuthRateLimitMaxAttempts) {
    authRateLimitCache.set(key, recent);
    return false;
  }
  recent.push(now);
  authRateLimitCache.set(key, recent);
  return true;
}

function readIdempotencyKey(request: Request): string | undefined {
  const header = request.headers["x-theia-idempotency-key"];
  const raw = Array.isArray(header) ? header[0] : header;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key || key.length > 120) return undefined;
  if (!/^[a-zA-Z0-9:_-]+$/.test(key)) return undefined;
  return key;
}

function pruneCaches(): void {
  const now = Date.now();
  for (const [key, timestamps] of leadRateLimitCache.entries()) {
    const recent = timestamps.filter((value) => now - value <= leadRateLimitWindowSeconds * 1000);
    if (recent.length === 0) {
      leadRateLimitCache.delete(key);
    } else {
      leadRateLimitCache.set(key, recent);
    }
  }
  for (const [key, value] of idempotencyCache.entries()) {
    if (value.expiresAtMs <= now) {
      idempotencyCache.delete(key);
    }
  }
  for (const [key, timestamps] of authRateLimitCache.entries()) {
    const recent = timestamps.filter((value) => now - value <= publicAuthRateLimitWindowSeconds * 1000);
    if (recent.length === 0) {
      authRateLimitCache.delete(key);
    } else {
      authRateLimitCache.set(key, recent);
    }
  }
}

function toCsvValue(input: string | undefined): string {
  const value = input ?? "";
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function escapeHtml(input: string | undefined): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.use(express.urlencoded({ extended: true, limit: leadBodyLimit }));
app.use(express.json({ limit: leadBodyLimit }));
if (isProduction || process.env.THEIA_TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}
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
  const smtpConfigured = Boolean(process.env.THEIA_LEADS_NOTIFY_SMTP_HOST?.trim());
  response.json({
    status: "ok",
    service: "theia-control-plane",
    samlEnabled: samlConfig.enabled,
    samlProvider: samlConfig.provider,
    devLoginEnabled,
    publicAuthEnabled: true,
    leadDeliveryTarget: process.env.THEIA_LEADS_NOTIFY_TO?.trim() ?? "windsurf345@outlook.com",
    leadDeliverySmtpConfigured: smtpConfigured
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
  if (!devLoginEnabled) {
    response.status(403).json({ message: "Dev login is disabled on this deployment." });
    return;
  }

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

app.options("/api/public/auth/:action", (request, response) => {
  applyLeadCors(request, response);
  response.sendStatus(204);
});

app.post("/api/public/auth/signup", async (request, response) => {
  applyLeadCors(request, response);
  const origin = resolveLeadOrigin(request);
  if (origin && !leadAllowedOrigins.has(origin)) {
    response.status(403).json({ message: "Origin not allowed." });
    return;
  }
  const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const authRateKey = `${getClientIp(request) ?? "unknown"}:${email.toLowerCase()}`;
  if (!consumePublicAuthRateLimit(authRateKey)) {
    response.setHeader("Retry-After", String(publicAuthRateLimitWindowSeconds));
    response.status(429).json({ message: "Too many auth attempts. Please retry shortly." });
    return;
  }
  if (!email || !password) {
    response.status(400).json({ message: "email and password are required." });
    return;
  }
  try {
    const session = await publicAuthStore.signup(email, password);
    response.status(201).json(session);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Unable to sign up." });
  }
});

app.post("/api/public/auth/signin", async (request, response) => {
  applyLeadCors(request, response);
  const origin = resolveLeadOrigin(request);
  if (origin && !leadAllowedOrigins.has(origin)) {
    response.status(403).json({ message: "Origin not allowed." });
    return;
  }
  const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const authRateKey = `${getClientIp(request) ?? "unknown"}:${email.toLowerCase()}`;
  if (!consumePublicAuthRateLimit(authRateKey)) {
    response.setHeader("Retry-After", String(publicAuthRateLimitWindowSeconds));
    response.status(429).json({ message: "Too many auth attempts. Please retry shortly." });
    return;
  }
  if (!email || !password) {
    response.status(400).json({ message: "email and password are required." });
    return;
  }
  try {
    const session = await publicAuthStore.signin(email, password);
    response.status(200).json(session);
  } catch (error) {
    response.status(401).json({ message: error instanceof Error ? error.message : "Unable to sign in." });
  }
});

app.get("/api/public/auth/me", async (request, response) => {
  applyLeadCors(request, response);
  const origin = resolveLeadOrigin(request);
  if (origin && !leadAllowedOrigins.has(origin)) {
    response.status(403).json({ message: "Origin not allowed." });
    return;
  }
  const user = await authenticateLeadUser(request);
  if (!user) {
    response.status(401).json({ authenticated: false });
    return;
  }
  response.json({ authenticated: true, user });
});

app.post("/api/public/auth/logout", async (request, response) => {
  applyLeadCors(request, response);
  const origin = resolveLeadOrigin(request);
  if (origin && !leadAllowedOrigins.has(origin)) {
    response.status(403).json({ message: "Origin not allowed." });
    return;
  }
  const token = readBearerToken(request);
  if (!token) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }
  await publicAuthStore.logout(token);
  response.json({ loggedOut: true });
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

app.options("/api/public/marketing/charts", (request, response) => {
  applyMarketingCors(request, response);
  response.sendStatus(204);
});

app.get("/api/public/marketing/charts", async (request, response) => {
  applyMarketingCors(request, response);

  const origin = resolveLeadOrigin(request);
  if (origin && !marketingAllowedOrigins.has(origin)) {
    response.status(403).json({ message: "Origin not allowed for marketing chart requests." });
    return;
  }

  const payload = await loadMarketingChartsPayload();
  if (!payload) {
    response.status(404).json({ message: "Marketing chart payload not configured yet." });
    return;
  }

  response.setHeader("Cache-Control", "public, max-age=120");
  response.json(payload);
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
  const leadUser = await authenticateLeadUser(request);
  if (!leadUser) {
    response.status(401).json({ message: "Sign in is required before submitting applications." });
    return;
  }

  pruneCaches();
  const idempotencyKey = readIdempotencyKey(request);
  if (idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      response.status(202).json({
        accepted: true,
        deduplicated: true,
        leadId: cached.leadId,
        status: cached.status,
        delivery: {
          status: "skipped_duplicate_request",
          reason: "Duplicate request detected via idempotency key."
        }
      });
      return;
    }
  }

  const body = (request.body ?? {}) as LeadRequestBody;
  const validation = validateLeadSubmission(body);
  if (!validation.valid) {
    response.status(400).json({
      message: "Validation failed.",
      errors: validation.errors
    });
    return;
  }

  const ipHash = hashIp(getClientIp(request)) ?? "anonymous";
  const rateLimitKey = `${ipHash}:${validation.data.email}`;
  if (!consumeRateLimitToken(rateLimitKey)) {
    response.setHeader("Retry-After", String(leadRateLimitWindowSeconds));
    response.status(429).json({
      message: "Too many submissions in a short window. Please retry shortly.",
      retryAfterSeconds: leadRateLimitWindowSeconds
    });
    return;
  }

  const markAsSpam =
    validation.data.honeypot.length > 0 ||
    validation.data.environment.length < 20 ||
    validation.data.name.length < 2;
  const submissionSignature = createSubmissionSignature({
    name: validation.data.name,
    email: validation.data.email,
    role: validation.data.role,
    environment: validation.data.environment,
    company: validation.data.company,
    sourcePage: validation.data.sourcePage
  });

  const upserted = await leadsStore.upsertLead({
    name: validation.data.name,
    email: validation.data.email,
    role: validation.data.role,
    environment: validation.data.environment,
    company: validation.data.company,
    sourcePage: validation.data.sourcePage,
    origin,
    referrer: typeof request.headers.referer === "string" ? request.headers.referer : undefined,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined,
    ipHash,
    submissionSignature,
    dedupeWindowSeconds: leadDedupeWindowSeconds,
    markAsSpam,
    submittedByUserId: leadUser.userId,
    submittedByEmail: leadUser.email
  });

  let deliveryStatus: { status: string; reason: string } = {
    status: "skipped",
    reason: "Submission deduplicated from a recent equivalent payload."
  };
  if (!upserted.wasDuplicate && upserted.lead.status !== "spam") {
    const delivery = await leadNotifier.notifyLead(upserted.lead);
    await leadNotifier.notifySubmitter(upserted.lead, leadUser.email);
    deliveryStatus = {
      status: delivery.status,
      reason: delivery.reason
    };
  } else if (upserted.lead.status === "spam") {
    deliveryStatus = {
      status: "suppressed_spam",
      reason: "Submission flagged by anti-spam controls."
    };
  }

  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, {
      leadId: upserted.lead.leadId,
      status: upserted.lead.status,
      expiresAtMs: Date.now() + leadDedupeWindowSeconds * 1000
    });
  }

  response.status(202).json({
    accepted: true,
    deduplicated: upserted.wasDuplicate,
    leadId: upserted.lead.leadId,
    status: upserted.lead.status,
    delivery: deliveryStatus
  });
});

app.get("/api/leads/report", ensureApiAuthenticated, async (_request, response) => {
  response.json(await leadsStore.report());
});

app.get("/api/leads/delivery/report", ensureApiAuthenticated, async (_request, response) => {
  response.json(await leadNotifier.report());
});

app.get("/api/leads/delivery", ensureApiAuthenticated, async (request, response) => {
  const limit = Number(request.query.limit ?? 120);
  response.json(await leadNotifier.listRecent(limit));
});

app.get("/api/leads/delivery/config", ensureApiAuthenticated, async (_request, response) => {
  response.json(leadNotifier.getConfigView());
});

app.post("/api/leads/delivery/verify", ensureApiAuthenticated, async (_request, response) => {
  const verification = await leadNotifier.verifyTransport();
  response.json(verification);
});

app.post("/api/leads/delivery/test", ensureApiAuthenticated, async (request, response) => {
  const actor = request.user?.email ?? request.user?.id ?? "unknown-operator";
  const delivery = await leadNotifier.sendTestDelivery(actor);
  response.status(202).json({
    accepted: true,
    delivery
  });
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
    "referrer",
    "submittedByUserId",
    "submittedByEmail"
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
      lead.referrer,
      lead.submittedByUserId,
      lead.submittedByEmail
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
    : devLoginEnabled
      ? `<a class=\"btn secondary\" href=\"/auth/dev/login\">Use local dev login</a>`
      : "";

  const signedInLabel = user ? escapeHtml(user.displayName ?? user.id) : "";
  const signedInEmail = user ? escapeHtml(user.email ?? "no-email") : "";
  const authStatus = user
    ? `<div class="auth-card"><p class="auth-title">Signed in</p><p class="auth-main">${signedInLabel}</p><p class="auth-sub">${signedInEmail}</p><div class="action-row"><a class="btn ghost" href="/auth/logout">Sign out</a></div></div>`
    : `<div class="auth-card"><p class="auth-title">Authentication required</p><p class="auth-sub">${escapeHtml(
        samlConfig.enabled
          ? "SAML is enabled for this control plane."
          : devLoginEnabled
            ? samlConfig.reason ?? "SAML config missing."
            : "SAML is required on this deployment. Configure SAML to access the operator dashboard."
      )}</p><div class="action-row">${authButton}</div></div>`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Theia Control Plane</title>
    <style>
      :root {
        --bg: #070707;
        --bg-soft: #100909;
        --panel: #111111;
        --panel-soft: #151515;
        --line: #351b1b;
        --line-soft: #2a1a1a;
        --text: #f2ebeb;
        --muted: #c9aeae;
        --accent: #ff2e2e;
        --accent-soft: #ff6a6a;
        --ok: #3fd39b;
        --warn: #ffb84d;
        --danger: #ff6b75;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Roboto, sans-serif;
        background:
          radial-gradient(circle at 10% 0%, rgba(255, 46, 46, 0.18), transparent 40%),
          radial-gradient(circle at 90% 10%, rgba(255, 46, 46, 0.08), transparent 34%),
          linear-gradient(180deg, #090707 0%, #070707 60%, #0a0909 100%);
        color: var(--text);
      }
      .wrap {
        max-width: 1100px;
        margin: 2rem auto;
        padding: 0 1rem 2.4rem;
      }
      h1, h2, h3 {
        margin: 0;
      }
      h1 {
        font-size: clamp(1.75rem, 3vw, 2.25rem);
      }
      .sub {
        color: var(--muted);
        margin: 0.45rem 0 0;
      }
      .hero {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 1.1rem;
        background: linear-gradient(160deg, rgba(255, 46, 46, 0.16), rgba(15, 8, 8, 0.92) 38%, rgba(11, 11, 11, 0.98));
        display: grid;
        gap: 0.9rem;
      }
      .hero-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.6rem;
      }
      .hero-chip {
        border: 1px solid var(--line-soft);
        border-radius: 999px;
        padding: 0.32rem 0.6rem;
        color: #ffd2d2;
        font-size: 0.78rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 0.9rem;
        margin-top: 0.9rem;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 0.95rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      }
      .auth-card {
        display: grid;
        gap: 0.25rem;
      }
      .auth-title {
        font-size: 0.78rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin: 0;
      }
      .auth-main {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
      }
      .auth-sub {
        margin: 0;
        color: #e2c8c8;
        font-size: 0.85rem;
      }
      .action-row {
        margin-top: 0.3rem;
        display: flex;
        gap: 0.45rem;
        flex-wrap: wrap;
      }
      .btn {
        display: inline-block;
        background: linear-gradient(145deg, var(--accent-soft), var(--accent));
        color: #230909;
        text-decoration: none;
        border-radius: 999px;
        padding: 0.45rem 0.92rem;
        font-weight: 600;
        border: 1px solid transparent;
      }
      .btn.secondary {
        background: #1e1a1a;
        color: #f5e9e9;
        border-color: var(--line);
      }
      .btn.ghost {
        background: transparent;
        color: #f5e9e9;
        border-color: var(--line);
      }
      .link {
        color: #ffd2d2;
        text-decoration: none;
      }
      #chart {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(20px, 1fr));
        gap: 0.22rem;
        align-items: end;
        min-height: 180px;
        margin-top: 0.8rem;
        border: 1px solid var(--line-soft);
        border-radius: 10px;
        padding: 0.45rem;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(0, 0, 0, 0.12));
      }
      .bar {
        background: linear-gradient(180deg, #ff7777, #ff2e2e);
        border-radius: 6px 6px 0 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.55rem;
      }
      th, td {
        border-bottom: 1px solid var(--line-soft);
        text-align: left;
        padding: 0.46rem;
        font-size: 0.88rem;
      }
      th {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        font-size: 0.72rem;
        background: var(--panel-soft);
      }
      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 0.5rem;
        margin-top: 0.55rem;
      }
      .stat {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 0.58rem;
        background: var(--panel-soft);
      }
      .label {
        font-size: 0.77rem;
        color: var(--muted);
      }
      .value {
        font-size: 1.2rem;
        font-weight: 700;
        margin-top: 0.2rem;
      }
      .pill {
        display: inline-block;
        border-radius: 999px;
        padding: 0.16rem 0.52rem;
        font-size: 0.78rem;
        background: rgba(255, 46, 46, 0.16);
        color: #ffc0c0;
        border: 1px solid rgba(255, 108, 108, 0.35);
      }
      .controls {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-top: 0.7rem;
      }
      .controls input,
      .controls select,
      .controls button {
        font: inherit;
        border-radius: 8px;
        border: 1px solid var(--line);
        padding: 0.38rem 0.5rem;
        color: var(--text);
        background: #0f0f0f;
      }
      .controls button {
        background: #191010;
        color: #ffe9e9;
        border-color: var(--line);
        cursor: pointer;
      }
      .controls .btn {
        padding: 0.38rem 0.68rem;
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
        padding: 0.24rem 0.35rem;
        color: var(--text);
        background: #0f0f0f;
      }
      .inline-status button {
        background: #1a1010;
        color: #ffe1e1;
        border-color: var(--line);
      }
      .small-note {
        color: var(--muted);
        font-size: 0.84rem;
      }
      .status-line {
        margin-top: 0.5rem;
        color: #ffd2d2;
        font-size: 0.84rem;
      }
      .success-line {
        color: var(--ok);
      }
      .warn-line {
        color: var(--warn);
      }
      .danger-line {
        color: var(--danger);
      }
      .wide-card {
        grid-column: 1 / -1;
      }
      @media (max-width: 700px) {
        .wrap {
          margin-top: 1rem;
        }
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class=\"wrap\">
      <section class=\"hero\">
        <div>
          <h1>Theia Control Plane</h1>
          <p class=\"sub\">Permission-based operator surface for login telemetry, lead intake, and delivery reliability.</p>
        </div>
        <div class=\"hero-meta\">
          <span class=\"hero-chip\">SAML: ${escapeHtml(samlConfig.enabled ? "enabled" : "disabled")}</span>
          <span class=\"hero-chip\">Dev Login: ${escapeHtml(devLoginEnabled ? "enabled" : "disabled")}</span>
          <span class=\"hero-chip\">Delivery Target: ${escapeHtml(process.env.THEIA_LEADS_NOTIFY_TO?.trim() || "windsurf345@outlook.com")}</span>
        </div>
      </section>

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
          <p class=\"small-note\">Website applications are validated, deduplicated, and routed through secure delivery controls.</p>
          <div class=\"stat-grid\">
            <div class=\"stat\"><div class=\"label\">Total Leads</div><div id=\"leadTotal\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">New</div><div id=\"leadNew\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Qualified</div><div id=\"leadQualified\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Updated 24h</div><div id=\"leadUpdated\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Delivered</div><div id=\"leadDelivered\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Queued Local</div><div id=\"leadQueued\" class=\"value\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Delivery Failed</div><div id=\"leadFailed\" class=\"value\">-</div></div>
          </div>
          <p id=\"deliveryStatusLine\" class=\"status-line\">Delivery status pending...</p>
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

        <article class=\"card wide-card\">
          <h2>Recent Leads</h2>
          <table>
            <thead><tr><th>When</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
            <tbody id=\"leadRows\"></tbody>
          </table>
        </article>

        <article class=\"card wide-card\">
          <h2>Lead Delivery History</h2>
          <p class=\"small-note\">Every delivery attempt is logged. If SMTP is unavailable, applications remain in local queue for operator follow-up.</p>
          <table>
            <thead><tr><th>When</th><th>Lead</th><th>Target</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody id=\"deliveryRows\"></tbody>
          </table>
        </article>

        <article class=\"card wide-card\">
          <h2>Lead Delivery Configuration</h2>
          <p class=\"small-note\">Set SMTP credentials via environment variables. Use verify + test to confirm live delivery to your target inbox.</p>
          <div class=\"stat-grid\">
            <div class=\"stat\"><div class=\"label\">Target Inbox</div><div id=\"deliveryTarget\" class=\"value\" style=\"font-size:0.95rem\">-</div></div>
            <div class=\"stat\"><div class=\"label\">SMTP Mode</div><div id=\"deliveryMode\" class=\"value\" style=\"font-size:0.95rem\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Host</div><div id=\"deliveryHost\" class=\"value\" style=\"font-size:0.95rem\">-</div></div>
            <div class=\"stat\"><div class=\"label\">Port</div><div id=\"deliveryPort\" class=\"value\" style=\"font-size:0.95rem\">-</div></div>
          </div>
          <p id=\"deliveryConfigStatus\" class=\"status-line\">Delivery configuration pending...</p>
          <div class=\"controls\">
            <button id=\"leadVerifyTransport\" type=\"button\">Verify SMTP</button>
            <button id=\"leadSendTest\" type=\"button\">Send Test Email</button>
          </div>
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

      function setLineState(node, text, tone) {
        if (!node) return;
        node.textContent = text;
        node.className = 'status-line';
        if (tone === 'success') node.classList.add('success-line');
        if (tone === 'warn') node.classList.add('warn-line');
        if (tone === 'danger') node.classList.add('danger-line');
      }

      function setDeliveryActionState(isBusy) {
        const verifyButton = document.getElementById('leadVerifyTransport');
        const testButton = document.getElementById('leadSendTest');
        if (verifyButton) verifyButton.disabled = Boolean(isBusy);
        if (testButton) testButton.disabled = Boolean(isBusy);
      }

      async function loadLeads(authenticated) {
        const tbody = document.getElementById('leadRows');
        const totalNode = document.getElementById('leadTotal');
        const newNode = document.getElementById('leadNew');
        const qualifiedNode = document.getElementById('leadQualified');
        const updatedNode = document.getElementById('leadUpdated');
        const deliveredNode = document.getElementById('leadDelivered');
        const queuedNode = document.getElementById('leadQueued');
        const failedNode = document.getElementById('leadFailed');
        const deliveryStatusLine = document.getElementById('deliveryStatusLine');
        const deliveryRows = document.getElementById('deliveryRows');
        const statusFilter = document.getElementById('leadStatusFilter');
        const searchInput = document.getElementById('leadSearch');
        const deliveryTargetNode = document.getElementById('deliveryTarget');
        const deliveryModeNode = document.getElementById('deliveryMode');
        const deliveryHostNode = document.getElementById('deliveryHost');
        const deliveryPortNode = document.getElementById('deliveryPort');
        const deliveryConfigStatusNode = document.getElementById('deliveryConfigStatus');

        if (!authenticated) {
          totalNode.textContent = '-';
          newNode.textContent = '-';
          qualifiedNode.textContent = '-';
          updatedNode.textContent = '-';
          deliveredNode.textContent = '-';
          queuedNode.textContent = '-';
          failedNode.textContent = '-';
          tbody.innerHTML = '<tr><td colspan="6">Sign in to access leads.</td></tr>';
          if (deliveryRows) {
            deliveryRows.innerHTML = '<tr><td colspan="5">Sign in to view delivery history.</td></tr>';
          }
          if (deliveryStatusLine) {
            setLineState(deliveryStatusLine, 'Sign in to inspect delivery reliability.');
          }
          if (deliveryTargetNode) deliveryTargetNode.textContent = '-';
          if (deliveryModeNode) deliveryModeNode.textContent = '-';
          if (deliveryHostNode) deliveryHostNode.textContent = '-';
          if (deliveryPortNode) deliveryPortNode.textContent = '-';
          if (deliveryConfigStatusNode) {
            setLineState(deliveryConfigStatusNode, 'Sign in to inspect delivery configuration.');
          }
          setDeliveryActionState(false);
          const verifyButton = document.getElementById('leadVerifyTransport');
          const testButton = document.getElementById('leadSendTest');
          if (verifyButton) verifyButton.disabled = true;
          if (testButton) testButton.disabled = true;
          return;
        }

        const verifyButton = document.getElementById('leadVerifyTransport');
        const testButton = document.getElementById('leadSendTest');
        if (verifyButton) verifyButton.disabled = false;
        if (testButton) testButton.disabled = false;

        const params = new URLSearchParams({ limit: '100' });
        if (statusFilter && statusFilter.value && statusFilter.value !== 'all') {
          params.set('status', statusFilter.value);
        }
        if (searchInput && searchInput.value.trim().length > 0) {
          params.set('q', searchInput.value.trim());
        }

        const [report, leads, deliveryReport, deliveries, deliveryConfig] = await Promise.all([
          fetch('/api/leads/report').then((r) => r.json()),
          fetch('/api/leads?' + params.toString()).then((r) => r.json()),
          fetch('/api/leads/delivery/report').then((r) => r.json()),
          fetch('/api/leads/delivery?limit=25').then((r) => r.json()),
          fetch('/api/leads/delivery/config').then((r) => r.json())
        ]);

        totalNode.textContent = String(report.total ?? 0);
        newNode.textContent = String(report.byStatus?.new ?? 0);
        qualifiedNode.textContent = String(report.byStatus?.qualified ?? 0);
        updatedNode.textContent = String(report.updatedLast24Hours ?? 0);
        deliveredNode.textContent = String(deliveryReport.sent ?? 0);
        queuedNode.textContent = String(deliveryReport.queuedLocal ?? 0);
        failedNode.textContent = String(deliveryReport.failed ?? 0);

        if (deliveryStatusLine) {
          const latest = deliveryReport.latest;
          if (!latest) {
            setLineState(deliveryStatusLine, 'No delivery attempts logged yet.');
          } else if (latest.status === 'sent') {
            setLineState(deliveryStatusLine, 'Latest delivery succeeded at ' + formatDate(latest.createdAt) + '.', 'success');
          } else if (latest.status === 'queued_local') {
            setLineState(deliveryStatusLine, 'SMTP not configured. Leads are safely queued locally for follow-up.', 'warn');
          } else {
            setLineState(
              deliveryStatusLine,
              'Latest delivery failed: ' + String(latest.lastError || latest.reason || 'Unknown error'),
              'danger'
            );
          }
        }

        if (deliveryTargetNode) {
          deliveryTargetNode.textContent = deliveryConfig?.targetEmail || '-';
        }
        if (deliveryModeNode) {
          if (!deliveryConfig?.enabled) {
            deliveryModeNode.textContent = 'disabled';
          } else if (deliveryConfig?.smtpConfigured) {
            deliveryModeNode.textContent = deliveryConfig?.smtpSecure ? 'smtp (tls)' : 'smtp';
          } else {
            deliveryModeNode.textContent = 'local_queue';
          }
        }
        if (deliveryHostNode) {
          deliveryHostNode.textContent = deliveryConfig?.smtpHost || 'not configured';
        }
        if (deliveryPortNode) {
          deliveryPortNode.textContent = String(deliveryConfig?.smtpPort ?? '-');
        }
        if (deliveryConfigStatusNode) {
          if (!deliveryConfig?.enabled) {
            setLineState(
              deliveryConfigStatusNode,
              'Lead notifications are disabled. Set THEIA_LEADS_NOTIFY_ENABLED=true to re-enable.',
              'warn'
            );
          } else if (!deliveryConfig?.smtpConfigured) {
            setLineState(
              deliveryConfigStatusNode,
              'SMTP host is not configured. Leads are protected in local queue mode until SMTP is enabled.',
              'warn'
            );
          } else if (deliveryConfig?.smtpUser && !deliveryConfig?.smtpPasswordConfigured) {
            setLineState(
              deliveryConfigStatusNode,
              'SMTP username is set but password is missing. Delivery verification is expected to fail.',
              'danger'
            );
          } else {
            setLineState(
              deliveryConfigStatusNode,
              'SMTP configuration detected. Run "Verify SMTP" to confirm remote connectivity.',
              'success'
            );
          }
        }

        tbody.innerHTML = '';
        if (!Array.isArray(leads) || leads.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6">No leads found for this filter.</td></tr>';
        } else {
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

        if (deliveryRows) {
          deliveryRows.innerHTML = '';
          if (!Array.isArray(deliveries) || deliveries.length === 0) {
            deliveryRows.innerHTML = '<tr><td colspan="5">No delivery records yet.</td></tr>';
          } else {
            for (const row of deliveries) {
              const tr = document.createElement('tr');
              tr.innerHTML =
                '<td>' + formatDate(row.createdAt) + '</td>' +
                '<td>' + escapeHtml(row.leadEmail || row.leadId) + '</td>' +
                '<td>' + escapeHtml(row.targetEmail || '-') + '</td>' +
                '<td><span class="pill">' + escapeHtml(row.status) + '</span></td>' +
                '<td>' + escapeHtml(row.reason || row.lastError || '-') + '</td>';
              deliveryRows.appendChild(tr);
            }
          }
        }
      }

      async function verifyLeadDeliveryTransport() {
        const line = document.getElementById('deliveryConfigStatus');
        try {
          setDeliveryActionState(true);
          setLineState(line, 'Verifying SMTP transport...', 'warn');
          const response = await fetch('/api/leads/delivery/verify', { method: 'POST' });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.message || 'Verification request failed.');
          }

          if (payload.ok) {
            setLineState(line, payload.message || 'SMTP verification succeeded.', 'success');
          } else if (payload.mode === 'queue_only' || payload.mode === 'disabled') {
            setLineState(line, payload.message || 'SMTP is not active; local queue fallback is enabled.', 'warn');
          } else {
            setLineState(line, payload.message || 'SMTP verification failed.', 'danger');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to verify delivery transport.';
          setLineState(line, message, 'danger');
        } finally {
          setDeliveryActionState(false);
          await loadMetrics();
        }
      }

      async function sendLeadTestEmail() {
        const line = document.getElementById('deliveryConfigStatus');
        try {
          setDeliveryActionState(true);
          setLineState(line, 'Sending test delivery...', 'warn');
          const response = await fetch('/api/leads/delivery/test', { method: 'POST' });
          const payload = await response.json();
          if (!response.ok || !payload?.accepted) {
            throw new Error(payload?.message || 'Test delivery request failed.');
          }

          const delivery = payload.delivery;
          if (delivery?.status === 'sent') {
            setLineState(line, 'Test email delivered successfully to ' + (delivery.targetEmail || 'configured target') + '.', 'success');
          } else if (delivery?.status === 'queued_local') {
            setLineState(
              line,
              'Test delivery queued locally: ' + String(delivery.reason || 'SMTP not configured.'),
              'warn'
            );
          } else {
            setLineState(
              line,
              'Test delivery failed: ' + String(delivery?.lastError || delivery?.reason || 'Unknown error'),
              'danger'
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to send test delivery.';
          setLineState(line, message, 'danger');
        } finally {
          setDeliveryActionState(false);
          await loadMetrics();
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
        try {
          const volume = await fetch('/api/login-volume?days=30').then((r) => r.json());
          const status = await fetch('/api/auth/status').then((r) => r.json());

          document.getElementById('totalLogins').textContent = String(volume.totalLogins);
          document.getElementById('uniqueUsers').textContent = String(volume.uniqueUsers);
          document.getElementById('lastLogin').textContent = volume.lastLoginAt ? new Date(volume.lastLoginAt).toLocaleString() : 'none';

          const chart = document.getElementById('chart');
          chart.innerHTML = '';
          const points = Array.isArray(volume.points) ? volume.points : [];
          const max = Math.max(1, ...points.map((p) => p.count || 0));
          for (const point of points) {
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.height = String(Math.max(4, Math.round(((point.count || 0) / max) * 170))) + 'px';
            bar.title = point.date + ': ' + point.count;
            chart.appendChild(bar);
          }

          if (status.authenticated) {
            const rows = await fetch('/api/login-events?limit=20').then((r) => r.json());
            const tbody = document.getElementById('events');
            tbody.innerHTML = '';
            for (const row of rows) {
              const tr = document.createElement('tr');
              tr.innerHTML = '<td>' + new Date(row.timestamp).toLocaleString() + '</td><td>' + escapeHtml(row.displayName || row.userId) + '</td><td>' + escapeHtml(row.provider) + '</td><td>' + escapeHtml(row.email || '') + '</td>';
              tbody.appendChild(tr);
            }
          } else {
            const tbody = document.getElementById('events');
            tbody.innerHTML = '<tr><td colspan="4">Sign in to view detailed login events.</td></tr>';
          }

          await loadLeads(Boolean(status.authenticated));
        } catch (error) {
          const tbody = document.getElementById('events');
          tbody.innerHTML = '<tr><td colspan="4">Unable to load dashboard data. Refresh to retry.</td></tr>';
        }
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

      document.getElementById('leadVerifyTransport')?.addEventListener('click', async () => {
        await verifyLeadDeliveryTransport();
      });

      document.getElementById('leadSendTest')?.addEventListener('click', async () => {
        await sendLeadTestEmail();
      });

      loadMetrics();
    </script>
  </body>
</html>`;

  response.type("html").send(html);
});

app.use((error: unknown, _request: Request, response: Response, _next: () => void) => {
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ message: "Invalid JSON payload." });
    return;
  }
  console.error("Unhandled control-plane error:", error);
  response.status(500).json({ message: "Unexpected server error." });
});

const port = Number(process.env.PORT ?? process.env.THEIA_CONTROL_PLANE_PORT ?? 4620);
app.listen(port, () => {
  console.log(`Theia control plane listening on port ${port}`);
  if (!samlConfig.enabled) {
    console.log(`SAML disabled: ${samlConfig.reason ?? "Unknown reason"}`);
  } else {
    console.log(`SAML enabled with provider hint: ${samlConfig.provider}`);
  }
  if (!devLoginEnabled) {
    console.log("Dev login is disabled for this deployment.");
  }
  console.log(`Lead delivery target: ${process.env.THEIA_LEADS_NOTIFY_TO?.trim() ?? "windsurf345@outlook.com"}`);
  console.log(
    `Lead SMTP configured: ${process.env.THEIA_LEADS_NOTIFY_SMTP_HOST?.trim() ? "yes" : "no (local queue fallback active)"}`
  );
});
