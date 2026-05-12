export const DEFAULT_CORS_METHODS = "GET,POST,PUT,OPTIONS";

export const DEFAULT_CORS_HEADERS = [
  "Authorization",
  "Content-Type",
  "x-theia-operator-role",
  "x-theia-operator-id",
  "x-theia-pairing-id",
  "x-theia-pairing-token",
  "x-openclaw-pairing-token",
  "x-theia-agent-id",
  "x-theia-agent-token"
].join(", ");

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost"
];

export interface CorsPolicy {
  allowedOrigins: ReadonlySet<string>;
  methods: string;
  headers: string;
}

export interface CorsDecision {
  allowed: boolean;
  origin?: string;
  reason?: string;
}

export function createCorsPolicy(input?: {
  allowedOrigins?: string;
  extraOrigins?: string[];
  methods?: string;
  headers?: string;
}): CorsPolicy {
  const origins = new Set<string>();
  for (const origin of [...DEFAULT_ALLOWED_ORIGINS, ...(input?.extraOrigins ?? []), ...parseOriginList(input?.allowedOrigins)]) {
    const normalized = normalizeOrigin(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return {
    allowedOrigins: origins,
    methods: input?.methods ?? DEFAULT_CORS_METHODS,
    headers: input?.headers ?? DEFAULT_CORS_HEADERS
  };
}

export function evaluateCorsOrigin(originHeader: unknown, policy: CorsPolicy): CorsDecision {
  const origin = normalizeOrigin(readHeader(originHeader));
  if (!origin) {
    return { allowed: true };
  }
  if (policy.allowedOrigins.has(origin)) {
    return { allowed: true, origin };
  }
  return {
    allowed: false,
    reason: `Origin is not allowed by THEIA_ALLOWED_ORIGINS: ${origin}`
  };
}

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "*");
}

function normalizeOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "*") return undefined;
  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(trimmed)) {
      return trimmed.replace(/\/+$/, "");
    }
    return undefined;
  }
}

function readHeader(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === "string");
    return first;
  }
  return undefined;
}
