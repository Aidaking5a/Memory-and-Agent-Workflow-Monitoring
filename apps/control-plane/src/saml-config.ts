import { XMLParser } from "fast-xml-parser";

export interface SamlResolvedConfig {
  enabled: boolean;
  provider: string;
  issuer: string;
  callbackUrl: string;
  audience: string;
  entryPoint?: string;
  cert?: string;
  reason?: string;
}

function normalizeCert(cert: string): string {
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function asRecordArray(input: unknown): Record<string, unknown>[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  if (typeof input === "object") {
    return [input as Record<string, unknown>];
  }
  return [];
}

function pickMetadataNode(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const root = parsed.EntityDescriptor ?? parsed.EntitiesDescriptor;
  if (!root || typeof root !== "object") {
    return null;
  }

  const rootRecord = root as Record<string, unknown>;
  if (rootRecord.IDPSSODescriptor) {
    return rootRecord;
  }

  const entities = asRecordArray(rootRecord.EntityDescriptor);
  for (const entity of entities) {
    if (entity && typeof entity === "object" && "IDPSSODescriptor" in entity) {
      return entity as Record<string, unknown>;
    }
  }

  return null;
}

async function resolveFromMetadata(metadataUrl: string): Promise<{ entryPoint: string; cert: string } | null> {
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch metadata: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const entity = pickMetadataNode(parsed);
  if (!entity) {
    return null;
  }

  const idp = entity.IDPSSODescriptor as Record<string, unknown>;
  if (!idp || typeof idp !== "object") {
    return null;
  }

  const ssoServices = asRecordArray(idp.SingleSignOnService);
  const redirectService = ssoServices.find((service) => service.Binding === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect");
  const selectedService = redirectService ?? ssoServices[0];
  const entryPoint = typeof selectedService?.Location === "string" ? selectedService.Location : undefined;

  const keyDescriptors = asRecordArray(idp.KeyDescriptor);
  const signingKey =
    keyDescriptors.find((descriptor) => descriptor.use === "signing") ??
    keyDescriptors.find((descriptor) => !descriptor.use) ??
    keyDescriptors[0];

  const certNode = (signingKey?.KeyInfo as Record<string, unknown> | undefined)?.X509Data as
    | Record<string, unknown>
    | undefined;
  const certValue = certNode?.X509Certificate;

  const cert = typeof certValue === "string" ? normalizeCert(certValue) : undefined;
  if (!entryPoint || !cert) {
    return null;
  }

  return { entryPoint, cert };
}

export async function resolveSamlConfig(): Promise<SamlResolvedConfig> {
  const provider = process.env.THEIA_SAML_PROVIDER ?? "samltest.id";
  const issuer = process.env.THEIA_SAML_ISSUER ?? "theia-control-plane";
  const callbackUrl = process.env.THEIA_SAML_CALLBACK_URL ?? "http://localhost:4620/auth/saml/callback";
  const audience = process.env.THEIA_SAML_AUDIENCE ?? issuer;

  const directEntryPoint = process.env.THEIA_SAML_ENTRY_POINT;
  const directCert = process.env.THEIA_SAML_CERT;

  if (directEntryPoint && directCert) {
    return {
      enabled: true,
      provider,
      issuer,
      callbackUrl,
      audience,
      entryPoint: directEntryPoint,
      cert: normalizeCert(directCert)
    };
  }

  const metadataUrl = process.env.THEIA_SAML_METADATA_URL;
  if (metadataUrl) {
    try {
      const resolved = await resolveFromMetadata(metadataUrl);
      if (resolved) {
        return {
          enabled: true,
          provider,
          issuer,
          callbackUrl,
          audience,
          entryPoint: resolved.entryPoint,
          cert: resolved.cert
        };
      }

      return {
        enabled: false,
        provider,
        issuer,
        callbackUrl,
        audience,
        reason: "Metadata parsed but missing SSO endpoint or signing certificate."
      };
    } catch (error) {
      return {
        enabled: false,
        provider,
        issuer,
        callbackUrl,
        audience,
        reason: `SAML metadata resolution failed: ${(error as Error).message}`
      };
    }
  }

  return {
    enabled: false,
    provider,
    issuer,
    callbackUrl,
    audience,
    reason:
      "SAML not configured. Set THEIA_SAML_METADATA_URL (recommended) or THEIA_SAML_ENTRY_POINT + THEIA_SAML_CERT."
  };
}
