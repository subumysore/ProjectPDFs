// OIDC Authorization-Code + PKCE identity broker for ProjectPDFs signing.
//
// ADAPTED from the Hospital Nexus (SDD) `oidc.service.ts` — same hardened flow
// (PKCE S256, SSRF-guarded discovery, JWKS RS256 ID-token verification), but:
//   - returns ONLY an identity assertion (subject/email/name), never content;
//   - no server sessions (local-first) — the app binds this identity to an
//     on-device Ed25519 signature (non-delegable, REQ-09/ADR-0004);
//   - `fetch` + node:crypto instead of axios, and a local OidcError.
import crypto from "node:crypto";

/** Typed OIDC error with a stable code. */
export class OidcError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string;
  usePKCE?: boolean;
}
export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}
/** The identity assertion — the ONLY thing that crosses. No document content. */
export interface SsoProfile {
  subject: string;
  email?: string;
  name?: string;
  attributes: Record<string, unknown>;
}

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a PKCE verifier + S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Validate an admin-supplied issuer URL. Discovery is fetched server-side, so a
 * bad issuer is an SSRF vector — enforce https (except localhost dev) and block
 * private / loopback / link-local hosts. Pure + exported for unit tests.
 */
export function assertSafeIssuerUrl(issuer: string, isProd = process.env.NODE_ENV === "production"): URL {
  if (typeof issuer !== "string" || issuer.trim() === "") {
    throw new OidcError("OIDC_ISSUER_REQUIRED", "OIDC issuer is required (e.g. https://accounts.google.com).");
  }
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new OidcError("OIDC_ISSUER_INVALID", `OIDC issuer must be an absolute URL (got "${issuer}").`);
  }
  const host = url.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.protocol !== "https:" && !(isLocalhost && !isProd)) {
    throw new OidcError("OIDC_ISSUER_INSECURE", "OIDC issuer must use https.");
  }
  const blockedPrivate =
    /^169\.254\./.test(host) || // link-local (cloud metadata)
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "0.0.0.0" ||
    host.endsWith(".internal") ||
    host.endsWith(".local");
  if (blockedPrivate || (isProd && isLocalhost)) {
    throw new OidcError("OIDC_ISSUER_BLOCKED", "OIDC issuer host is not allowed (private/loopback/link-local).");
  }
  return url;
}

async function getJson(url: string, manualRedirect = false): Promise<any> {
  const res = await fetch(url, {
    redirect: manualRedirect ? "manual" : "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new OidcError("HTTP_ERROR", `GET ${url} -> ${res.status}`);
  return res.json();
}

export class OidcService {
  async discover(issuer: string): Promise<OidcDiscovery> {
    assertSafeIssuerUrl(issuer);
    const base = issuer.replace(/\/$/, "");
    const url = `${base}/.well-known/openid-configuration`;
    let data: any;
    try {
      data = await getJson(url, true); // manual redirect: a benign issuer can't 302 onto an internal host
    } catch (e) {
      throw new OidcError("SSO_DISCOVERY_FAILED", `OIDC discovery failed for ${url}: ${(e as Error).message}`);
    }
    if (!data?.authorization_endpoint || !data?.token_endpoint || !data?.jwks_uri) {
      throw new OidcError("SSO_DISCOVERY_INVALID", `OIDC discovery at ${url} is missing required endpoints.`);
    }
    return data as OidcDiscovery;
  }

  /** Build the authorization redirect URL (PKCE S256 unless disabled). */
  async buildAuthorizeUrl(
    config: OidcConfig,
    p: { redirectUri: string; state: string; nonce: string; codeChallenge?: string },
  ): Promise<string> {
    const disc = await this.discover(config.issuer);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: p.redirectUri,
      scope: config.scopes || "openid profile email",
      state: p.state,
      nonce: p.nonce,
    });
    if (config.usePKCE !== false && p.codeChallenge) {
      params.set("code_challenge", p.codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${disc.authorization_endpoint}?${params.toString()}`;
  }

  async exchangeCode(
    config: OidcConfig,
    p: { code: string; redirectUri: string; codeVerifier?: string },
  ): Promise<{ id_token: string; access_token?: string }> {
    const disc = await this.discover(config.issuer);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: config.clientId,
    });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    if (p.codeVerifier) body.set("code_verifier", p.codeVerifier);
    const res = await fetch(disc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data: any = await res.json();
    if (!data?.id_token) throw new OidcError("NO_ID_TOKEN", "Token endpoint did not return an id_token");
    return data;
  }

  /** Verify the ID token against JWKS and validate iss/aud/exp/nonce → identity assertion. */
  async verifyIdToken(idToken: string, config: OidcConfig, expectedNonce?: string): Promise<SsoProfile> {
    const disc = await this.discover(config.issuer);
    const [headerB64, payloadB64, sigB64] = idToken.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) throw new OidcError("BAD_TOKEN", "Malformed ID token");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (header.alg !== "RS256") throw new OidcError("BAD_ALG", `Unsupported ID-token alg: ${header.alg}`);

    const jwks: any = await getJson(disc.jwks_uri);
    const jwk = (jwks?.keys || []).find((k: any) => k.kid === header.kid) || (jwks?.keys || [])[0];
    if (!jwk) throw new OidcError("NO_JWK", "No matching JWKS key for the ID token");

    const pubKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(sigB64, "base64url");
    if (!crypto.verify("RSA-SHA256", signingInput, pubKey, signature)) {
      throw new OidcError("BAD_SIGNATURE", "ID-token signature verification failed");
    }
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) throw new OidcError("EXPIRED", "ID token has expired");
    if (claims.iss && disc.issuer && claims.iss !== disc.issuer) throw new OidcError("ISS_MISMATCH", "issuer mismatch");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(config.clientId)) throw new OidcError("AUD_MISMATCH", "audience mismatch");
    if (expectedNonce && claims.nonce && claims.nonce !== expectedNonce) {
      throw new OidcError("NONCE_MISMATCH", "nonce mismatch");
    }
    return {
      subject: String(claims.sub),
      email: claims.email,
      name: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || undefined,
      attributes: claims,
    };
  }

  /** Full callback: exchange code → verify ID token → identity assertion. */
  async handleCallback(
    config: OidcConfig,
    p: { code: string; redirectUri: string; codeVerifier?: string; nonce?: string },
  ): Promise<SsoProfile> {
    const tokens = await this.exchangeCode(config, p);
    return this.verifyIdToken(tokens.id_token, config, p.nonce);
  }
}

export const oidcService = new OidcService();
