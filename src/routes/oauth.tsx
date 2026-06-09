// OAuth 2.1 Authorization Server endpoints + discovery metadata.
//
// Flow:
//   1. Claude hits /mcp → 401 with WWW-Authenticate pointing at
//      /.well-known/oauth-protected-resource (on the same origin).
//   2. Claude fetches /.well-known/oauth-protected-resource → finds this
//      authorization server in `authorization_servers`.
//   3. Claude fetches /.well-known/oauth-authorization-server → finds
//      registration, authorization, token endpoints.
//   4. Claude POSTs to /oauth/register with its metadata (DCR, RFC 7591).
//      We store the client with a generated client_id; no secret (public).
//   5. Claude opens /oauth/authorize in the user's browser. We rely on
//      Clerk to know who the user is — if not signed in, bounce to
//      /sign-in with redirect_url back to /oauth/authorize.
//   6. Signed-in user sees a consent page. On approve, we generate a
//      single-use code tied to the PKCE challenge, redirect to Claude.
//   7. Claude POSTs /oauth/token with code + PKCE verifier. We validate,
//      issue an opaque access token (hashed in DB).
//   8. Claude calls /mcp with Authorization: Bearer <token>.

import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { oauthClients, oauthCodes, oauthTokens, users } from '../db/schema'
import {
  generateOpaqueToken, sha256Hex, verifyPkceS256, isRegisteredRedirectUri,
} from '../lib/oauth'
import type { AppContext } from '../types'

const oauth = new Hono<AppContext>()

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
const CODE_TTL_SECONDS = 10 * 60 // 10 minutes

// ============================================================
// DISCOVERY METADATA
// ============================================================

// Describes the MCP endpoint as an OAuth-protected resource.
// Per the MCP auth spec, this sits alongside the resource.
oauth.get('/.well-known/oauth-protected-resource', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/api/v1/docs`,
  })
})

// Describes us as the authorization server. RFC 8414.
oauth.get('/.well-known/oauth-authorization-server', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp'],
    service_documentation: `${origin}/api/v1/docs`,
  })
})

// ============================================================
// DYNAMIC CLIENT REGISTRATION (RFC 7591)
// ============================================================

// Open registration — clients can self-register without auth. This is
// per MCP spec; the registered client has no privileges until a user
// explicitly grants access via the consent flow.
oauth.post('/oauth/register', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    client_name?: string
    redirect_uris?: string[]
    grant_types?: string[]
    token_endpoint_auth_method?: string
  } | null
  if (!body) return c.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400)

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(Boolean) : []
  if (redirectUris.length === 0) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required' }, 400)
  }
  for (const uri of redirectUris) {
    try {
      const u = new URL(uri)
      // Allow http only for localhost (dev/desktop clients). Everything else must be https.
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
        return c.json({ error: 'invalid_redirect_uri', error_description: `redirect_uri must be https (or http://localhost): ${uri}` }, 400)
      }
    } catch {
      return c.json({ error: 'invalid_redirect_uri', error_description: `Malformed redirect_uri: ${uri}` }, 400)
    }
  }

  const name = (body.client_name || 'Unnamed client').slice(0, 200)
  const clientId = generateOpaqueToken('lvb-client', 16)
  const db = getDb(c.env.DB)

  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash: null, // public client (PKCE-only)
    name,
    redirectUris: JSON.stringify(redirectUris),
    grantTypes: JSON.stringify(['authorization_code']),
    tokenEndpointAuthMethod: 'none',
  })

  return c.json({
    client_id: clientId,
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'none',
  }, 201)
})

// ============================================================
// AUTHORIZATION ENDPOINT (user consent)
// ============================================================

oauth.get('/oauth/authorize', async (c) => {
  const user = c.get('user')
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = c.req.query()

  // If signed-out, bounce through Clerk. Preserve the full query string so
  // we land back on this same consent request after sign-in.
  if (!user) {
    const returnTo = `/oauth/authorize?${new URLSearchParams(c.req.query()).toString()}`
    return c.redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`)
  }

  if (response_type !== 'code') {
    return c.text('Only response_type=code is supported', 400)
  }
  if (!client_id || !redirect_uri || !code_challenge) {
    return c.text('Missing required parameter (client_id, redirect_uri, code_challenge)', 400)
  }
  if (code_challenge_method && code_challenge_method !== 'S256') {
    return c.text('Only code_challenge_method=S256 is supported', 400)
  }

  const db = getDb(c.env.DB)
  const client = await db.select().from(oauthClients).where(eq(oauthClients.clientId, client_id)).get()
  if (!client) return c.text('Unknown client_id', 400)

  const registered: string[] = JSON.parse(client.redirectUris)
  if (!isRegisteredRedirectUri(registered, redirect_uri)) {
    return c.text('redirect_uri not registered for this client', 400)
  }

  // Show consent page. We deliberately keep the scope simple — one 'mcp'
  // scope that grants the token holder the same permissions as the user.
  const requestedScope = scope || 'mcp'

  return c.html(
    <Layout title="Authorize Access" user={user} noindex>
      <div class="page-section" style="max-width: 520px; margin: 0 auto; padding: 4rem 1rem;">
        <p class="section-label">Authorize Access</p>
        <h2 style="margin-top: 0.5rem;">
          <strong>{client.name}</strong> wants to access your Learn Vibe Build account
        </h2>
        <p class="lead" style="margin-top: 1rem; color: var(--text-secondary);">
          Signed in as <strong>{user.email}</strong>.
        </p>

        <div style="margin-top: 1.5rem; padding: 1.25rem; background: var(--surface); border-radius: 10px;">
          <p style="font-weight: 600; margin-bottom: 0.5rem;">This will let {client.name}:</p>
          <ul style="margin: 0; padding-left: 1.25rem; color: var(--text-secondary); line-height: 1.8;">
            <li>See your profile and cohort enrollments</li>
            <li>Read lessons + track your progress</li>
            <li>Post projects, discussions, and comments on your behalf</li>
            {(user.role === 'admin' || user.role === 'facilitator') && (
              <li><strong>Admin:</strong> create and edit lesson content</li>
            )}
          </ul>
          <p style="margin: 1rem 0 0 0; font-size: 0.85rem; color: var(--text-tertiary);">
            You can revoke access any time in your settings.
          </p>
        </div>

        <form method="post" action="/oauth/authorize" style="margin-top: 2rem; display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <input type="hidden" name="client_id" value={client_id} />
          <input type="hidden" name="redirect_uri" value={redirect_uri} />
          <input type="hidden" name="scope" value={requestedScope} />
          <input type="hidden" name="state" value={state || ''} />
          <input type="hidden" name="code_challenge" value={code_challenge} />
          <input type="hidden" name="code_challenge_method" value={code_challenge_method || 'S256'} />
          <button type="submit" name="decision" value="approve"
            style="flex: 1; padding: 0.85rem; background: var(--accent); color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;">
            Approve
          </button>
          <button type="submit" name="decision" value="deny"
            style="flex: 1; padding: 0.85rem; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; font-weight: 500; cursor: pointer;">
            Cancel
          </button>
        </form>
      </div>
    </Layout>
  )
})

oauth.post('/oauth/authorize', async (c) => {
  const user = c.get('user')
  if (!user) return c.text('Unauthorized', 401)

  const body = await c.req.parseBody()
  const client_id = String(body.client_id || '')
  const redirect_uri = String(body.redirect_uri || '')
  const scope = String(body.scope || 'mcp')
  const state = String(body.state || '')
  const code_challenge = String(body.code_challenge || '')
  const code_challenge_method = String(body.code_challenge_method || 'S256')
  const decision = String(body.decision || '')

  const db = getDb(c.env.DB)
  const client = await db.select().from(oauthClients).where(eq(oauthClients.clientId, client_id)).get()
  if (!client) return c.text('Unknown client', 400)

  const registered: string[] = JSON.parse(client.redirectUris)
  if (!isRegisteredRedirectUri(registered, redirect_uri)) {
    return c.text('redirect_uri mismatch', 400)
  }

  if (decision !== 'approve') {
    const url = new URL(redirect_uri)
    url.searchParams.set('error', 'access_denied')
    if (state) url.searchParams.set('state', state)
    return c.redirect(url.toString())
  }

  if (!code_challenge) {
    return c.text('code_challenge required', 400)
  }

  // Issue a single-use authorization code.
  const code = generateOpaqueToken('lvb-code', 32)
  const codeHash = await sha256Hex(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString()

  await db.insert(oauthCodes).values({
    codeHash,
    clientId: client_id,
    userId: user.id,
    redirectUri: redirect_uri,
    scope,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    expiresAt,
  })

  const url = new URL(redirect_uri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return c.redirect(url.toString())
})

// ============================================================
// TOKEN ENDPOINT (code → access_token)
// ============================================================

oauth.post('/oauth/token', async (c) => {
  // Accept both form-encoded and JSON bodies (some clients do one or the other).
  const contentType = c.req.header('content-type') || ''
  const body: Record<string, any> = contentType.includes('application/json')
    ? await c.req.json().catch(() => ({}))
    : await c.req.parseBody()

  const grant_type = String(body.grant_type || '')
  if (grant_type !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400)
  }

  const code = String(body.code || '')
  const client_id = String(body.client_id || '')
  const redirect_uri = String(body.redirect_uri || '')
  const code_verifier = String(body.code_verifier || '')

  if (!code || !client_id || !redirect_uri || !code_verifier) {
    return c.json({ error: 'invalid_request', error_description: 'code, client_id, redirect_uri, code_verifier required' }, 400)
  }

  const db = getDb(c.env.DB)
  const codeHash = await sha256Hex(code)
  const row = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).get()

  if (!row) return c.json({ error: 'invalid_grant', error_description: 'Unknown authorization code' }, 400)
  if (row.used) return c.json({ error: 'invalid_grant', error_description: 'Authorization code already used' }, 400)
  if (new Date(row.expiresAt) < new Date()) return c.json({ error: 'invalid_grant', error_description: 'Authorization code expired' }, 400)
  if (row.clientId !== client_id) return c.json({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400)
  if (row.redirectUri !== redirect_uri) return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400)

  const challengeOk = await verifyPkceS256(code_verifier, row.codeChallenge)
  if (!challengeOk) return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)

  // Mark code used (single-use) and issue an access token.
  await db.update(oauthCodes).set({ used: 1 }).where(eq(oauthCodes.id, row.id))

  const token = generateOpaqueToken('lvb-mcp', 32)
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

  await db.insert(oauthTokens).values({
    tokenHash,
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    expiresAt,
  })

  return c.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    scope: row.scope,
  })
})

// ============================================================
// TOKEN REVOCATION (RFC 7009 — simple version)
// ============================================================

oauth.post('/oauth/revoke', async (c) => {
  const body = await c.req.parseBody()
  const token = String(body.token || '')
  if (!token) return c.json({ error: 'invalid_request' }, 400)
  const db = getDb(c.env.DB)
  const tokenHash = await sha256Hex(token)
  await db.update(oauthTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(oauthTokens.tokenHash, tokenHash))
  // Per spec, always 200 regardless of token validity.
  return c.json({}, 200)
})

export default oauth
