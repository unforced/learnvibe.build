import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { users, apiKeys, oauthTokens, oauthClients } from '../db/schema'
import { generateApiKey, hashApiKey, getKeyPrefix } from '../lib/api-auth'
import { createEmailChangeToken, consumeEmailChangeToken } from '../lib/email-change'
import { sendEmailChange, sendEmailChangedNotice, isEmailConfigured } from '../lib/email'
import type { AppContext } from '../types'

const settingsRoutes = new Hono<AppContext>()

// Profile settings — /settings/profile
settingsRoutes.get('/settings/profile', async (c) => {
  const user = c.get('user')

  if (!user) return c.redirect('/sign-in')

  const db = getDb(c.env.DB)
  const profile = await db.select().from(users).where(eq(users.id, user.id)).get()

  if (!profile) return c.redirect('/dashboard')

  const saved = c.req.query('saved')
  const error = c.req.query('error')
  // Email-change flow signals
  const emailChanged = c.req.query('email_changed')
  const emailPending = c.req.query('email_pending')
  const emailError = c.req.query('email_error')
  const emailErrorMessages: Record<string, string> = {
    missing: 'Please enter an email address.',
    invalid: "That email doesn't look right — give it another go.",
    same: "That's already your email.",
    taken: 'That email is already used by another account.',
    server: 'Something went wrong sending the confirmation. Please try again.',
  }

  return c.html(
    <Layout title="Edit Profile" user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto;">
        <a href="/community" class="back-link">← Community</a>

        <p class="section-label">Settings</p>
        <h2>Edit Your Profile</h2>

        {saved && (
          <div style="margin-top: 1rem; padding: 1rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; color: #166534;">
            Profile updated successfully!
          </div>
        )}

        {error === 'missing_fields' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Please fill in the required fields.
          </div>
        )}

        {error === 'server_error' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Something went wrong. Please try again.
          </div>
        )}

        {error === 'invalid_website' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Website must start with http:// or https://
          </div>
        )}

        {error === 'invalid_avatar' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Avatar URL must start with http:// or https://
          </div>
        )}

        {error === 'invalid_github' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            GitHub must be a valid username (letters, numbers, hyphens only).
          </div>
        )}

        {error === 'too_long' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            One or more fields exceeded the allowed length. Please shorten and try again.
          </div>
        )}

        <form method="post" action="/api/profile" style="margin-top: 2rem;">
          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label for="name" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={profile.name || ''}
              required
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label for="bio" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Bio</label>
            <textarea
              id="bio"
              name="bio"
              rows={3}
              placeholder="Tell the community a bit about yourself..."
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text); resize: vertical; font-family: var(--font-body);"
            >{profile.bio || ''}</textarea>
          </div>

          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label for="location" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Location</label>
            <input
              type="text"
              id="location"
              name="location"
              value={profile.location || ''}
              placeholder="Boulder, CO"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label for="website" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Website</label>
            <input
              type="url"
              id="website"
              name="website"
              value={profile.website || ''}
              placeholder="https://yoursite.com"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label for="github" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">GitHub Username</label>
            <input
              type="text"
              id="github"
              name="github"
              value={profile.github || ''}
              placeholder="your-username"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label for="avatar_url" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Avatar URL</label>
            <input
              type="url"
              id="avatar_url"
              name="avatar_url"
              value={profile.avatarUrl || ''}
              placeholder="https://example.com/your-photo.jpg"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
            <p style="margin-top: 0.25rem; font-size: 0.8rem; color: var(--text-tertiary);">
              Paste a URL to your profile photo. Tip: Use your GitHub avatar:
              {' '}
              <code
                id="gh-avatar-url"
                style="user-select: all; -webkit-user-select: all; cursor: text; padding: 0.15rem 0.4rem; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text);"
              >{profile.github ? `https://github.com/${profile.github}.png` : 'https://github.com/username.png'}</code>
              {profile.github && (
                <>
                  {' '}
                  <button
                    type="button"
                    id="gh-avatar-use"
                    style="margin-left: 0.25rem; padding: 0.15rem 0.5rem; font-size: 0.75rem; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; color: var(--accent);"
                  >Use this</button>
                  <span id="gh-avatar-status" style="margin-left: 0.4rem; font-size: 0.75rem; color: var(--text-tertiary);"></span>
                </>
              )}
            </p>
            <script dangerouslySetInnerHTML={{ __html: `
              (function(){
                var code = document.getElementById('gh-avatar-url');
                var btn = document.getElementById('gh-avatar-use');
                var input = document.getElementById('avatar_url');
                var status = document.getElementById('gh-avatar-status');
                if (code) {
                  code.addEventListener('click', function(){
                    var sel = window.getSelection();
                    if (!sel) return;
                    var range = document.createRange();
                    range.selectNodeContents(code);
                    sel.removeAllRanges();
                    sel.addRange(range);
                  });
                }
                if (btn && input && code) {
                  btn.addEventListener('click', function(){
                    input.value = code.textContent.trim();
                    input.focus();
                    if (status) {
                      status.textContent = 'Filled — click Save to apply';
                      setTimeout(function(){ status.textContent = ''; }, 3000);
                    }
                  });
                }
              })();
            `}} />
          </div>

          <div style="display: flex; gap: 1rem; align-items: center; margin-top: 2rem;">
            <button
              type="submit"
              style="background: var(--accent); color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer;"
            >
              Save Profile
            </button>
            <a href={`/members/${user.id}`} style="color: var(--text-secondary); font-size: 0.9rem;">
              View your profile →
            </a>
          </div>
        </form>

        {/* ===== ACCOUNT EMAIL ===== */}
        <div id="email" style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--border);">
          <h3 style="font-family: var(--font-display); margin-bottom: 0.5rem;">Account email</h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">
            This is the email you sign in with. Changing it sends a confirmation link to the new address — the change only takes effect once you click it while signed in here.
          </p>

          {emailChanged && (
            <div style="margin-bottom: 1rem; padding: 1rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; color: #166534;">
              Your sign-in email is now <strong>{profile.email}</strong>.
            </div>
          )}

          {emailPending && (
            <div style="margin-bottom: 1rem; padding: 1rem; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; color: #1e40af;">
              Almost there — we sent a confirmation link to <strong>{emailPending}</strong>. Open it while signed in here to finish. Until then, keep signing in with <strong>{profile.email}</strong>.
            </div>
          )}

          {emailError && (
            <div style="margin-bottom: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
              {emailErrorMessages[emailError] || 'Something went wrong. Please try again.'}
            </div>
          )}

          <form method="post" action="/settings/email" style="display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 240px;">
              <label for="new_email" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">
                Current: <code style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-secondary);">{profile.email}</code>
              </label>
              <input
                type="email"
                id="new_email"
                name="email"
                required
                placeholder="new@email.com"
                autocomplete="email"
                style="width: 100%; padding: 0.65rem; border: 1px solid var(--border); border-radius: 6px; font-size: 0.95rem; background: var(--surface); color: var(--text);"
              />
            </div>
            <button
              type="submit"
              style="background: var(--accent); color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 6px; font-size: 0.95rem; font-weight: 500; cursor: pointer; white-space: nowrap;"
            >
              Send confirmation link
            </button>
          </form>
        </div>

        <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <p style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-tertiary); margin: 0;">
            {user.role}
          </p>
          <a href="/settings/api-keys" style="font-size: 0.85rem; color: var(--accent); text-decoration: none;">
            API Keys →
          </a>
        </div>
      </div>
    </Layout>
  )
})

// API Key management — /settings/api-keys
settingsRoutes.get('/settings/api-keys', async (c) => {
  const user = c.get('user')

  if (!user) return c.redirect('/sign-in')

  const db = getDb(c.env.DB)
  const keys = await db.select().from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), eq(apiKeys.status, 'active')))
    .all()

  // OAuth tokens (active = not revoked + not expired). Joined against
  // client registry so we can show the name of whoever connected.
  const nowIso = new Date().toISOString()
  const connections = await db
    .select({ token: oauthTokens, client: oauthClients })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthTokens.clientId, oauthClients.clientId))
    .where(eq(oauthTokens.userId, user.id))
    .all()
  const activeConnections = connections.filter(
    c => !c.token.revokedAt && c.token.expiresAt > nowIso
  )

  const newKey = c.req.query('new_key')
  const created = c.req.query('created')
  const revoked = c.req.query('revoked')
  const disconnected = c.req.query('disconnected')
  const error = c.req.query('error')

  return c.html(
    <Layout title="API Keys" user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto;">
        <a href="/settings/profile" class="back-link">← Profile Settings</a>

        <p class="section-label">Settings</p>
        <h2>API Keys</h2>
        <p class="lead" style="margin-top: 0.5rem;">
          Use API keys to connect your AI assistant (MCP) to Learn Vibe Build.
        </p>

        {newKey && (
          <div style="margin-top: 1.5rem; padding: 1.25rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
            <p style="color: #166534; font-weight: 600; margin-bottom: 0.5rem;">New API Key Created</p>
            <p style="color: #15803d; font-size: 0.9rem; margin-bottom: 0.75rem;">
              Copy this key now — it won't be shown again.
            </p>
            <div style="font-family: var(--font-mono); font-size: 0.85rem; background: white; padding: 0.75rem; border-radius: 4px; word-break: break-all; border: 1px solid #bbf7d0;">
              {newKey}
            </div>
          </div>
        )}

        {created && !newKey && (
          <div style="margin-top: 1rem; padding: 1rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; color: #166534;">
            API key created successfully.
          </div>
        )}

        {revoked && (
          <div style="margin-top: 1rem; padding: 1rem; background: var(--surface); border-radius: 8px; color: var(--text-secondary);">
            API key revoked.
          </div>
        )}

        {disconnected && (
          <div style="margin-top: 1rem; padding: 1rem; background: var(--surface); border-radius: 8px; color: var(--text-secondary);">
            Connection revoked.
          </div>
        )}

        {error === 'missing_name' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Please provide a name for the key.
          </div>
        )}

        {/* ===== CONNECTED APPS (OAuth tokens) ===== */}
        <div style="margin-top: 2rem;">
          <h3 style="font-family: var(--font-display); margin-bottom: 0.5rem;">Connected apps</h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">
            Apps you've authorized via OAuth to access Learn Vibe Build on your behalf.
          </p>
          {activeConnections.length === 0 ? (
            <p style="color: var(--text-tertiary); font-size: 0.9rem;">No connected apps yet. When you add Learn Vibe Build to Claude (or another MCP client), it'll appear here after you approve access.</p>
          ) : (
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              {activeConnections.map(({ token, client }) => (
                <div style="padding: 0.85rem 1rem; background: var(--surface); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                  <div>
                    <div style="font-weight: 500;">{client.name}</div>
                    <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">
                      Scope: {token.scope} · Added {new Date(token.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {token.lastUsedAt && <> · Last used {new Date(token.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                    </div>
                  </div>
                  <form method="post" action={`/api/oauth/tokens/${token.id}/revoke`}
                    onsubmit={`return confirm('Revoke access for ${client.name}? They\\'ll need to re-authorize to reconnect.')`}>
                    <button type="submit"
                      style="background: none; border: 1px solid #fecaca; color: #991b1b; padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
                      Revoke
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>

        <hr style="margin: 2.5rem 0 1.5rem 0; border: none; border-top: 1px solid var(--border);" />
        <h3 style="font-family: var(--font-display); margin-bottom: 0.5rem;">API keys</h3>
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">
          Manual Bearer tokens for CLI or scripted access. For Claude, prefer the OAuth flow above.
        </p>

        <form method="post" action="/api/api-keys" style="margin-top: 1.5rem; display: flex; gap: 0.75rem; align-items: flex-end;">
          <div style="flex: 1;">
            <label for="name" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">New Key Name</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              placeholder="My MCP Server"
              style="width: 100%; padding: 0.65rem; border: 1px solid var(--border); border-radius: 6px; font-size: 0.95rem; background: var(--surface); color: var(--text);"
            />
          </div>
          <button
            type="submit"
            style="background: var(--accent); color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 6px; font-size: 0.95rem; font-weight: 500; cursor: pointer; white-space: nowrap;"
          >
            Create Key
          </button>
        </form>

        {keys.length > 0 ? (
          <div class="api-key-list" style="margin-top: 2rem;">
            <h3 style="font-family: var(--font-display); margin-bottom: 1rem;">Active Keys</h3>
            {keys.map((key) => (
              <div class="api-key-item">
                <div>
                  <div class="api-key-name">{key.name}</div>
                  <div class="api-key-value">{key.keyPrefix}</div>
                  <div class="api-key-meta">
                    Created {new Date(key.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {key.lastUsedAt && <> · Last used {new Date(key.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                  </div>
                </div>
                <form method="post" action={`/api/api-keys/${key.id}/revoke`}>
                  <button
                    type="submit"
                    style="background: none; border: 1px solid #fecaca; color: #991b1b; padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer;"
                  >
                    Revoke
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <div class="empty-state" style="margin-top: 3rem;">
            <p>No API keys yet. Create one to connect your AI assistant.</p>
          </div>
        )}

        <div style="margin-top: 3rem; padding: 1.5rem; background: var(--surface); border-radius: 8px;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; margin-bottom: 0.75rem;">Connect to Claude as an MCP server</h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.7;">
            Add Learn Vibe Build as an MCP server in Claude so your AI can pull your lessons, track your progress, share projects, and (if you're an admin) author lesson content directly.
          </p>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.75rem;"><strong>Server URL:</strong></p>
          <pre style="background: var(--dark); color: #e0e0e0; padding: 0.75rem; border-radius: 6px; margin-top: 0.25rem; font-size: 0.85rem; overflow-x: auto;">
{`https://learnvibe.build/mcp`}
          </pre>
          <p style="font-size: 0.85rem; color: var(--text-tertiary); line-height: 1.7; margin-top: 0.75rem;">
            <strong>OAuth (recommended)</strong> — in Claude.ai: Settings → Connectors → Add custom connector, paste the URL. Claude discovers our OAuth endpoints automatically, you'll land on a consent page here, click Approve. No keys to manage.
          </p>
          <p style="font-size: 0.85rem; color: var(--text-tertiary); line-height: 1.7; margin-top: 0.5rem;">
            <strong>API key (for CLI / scripted use)</strong> — create a key below and pass it as <code>Authorization: Bearer lvb_your_key</code> to <code>{`https://learnvibe.build/mcp`}</code>.
          </p>
        </div>

        <div style="margin-top: 1.5rem; padding: 1.5rem; background: var(--surface); border-radius: 8px;">
          <h3 style="font-family: var(--font-display); font-size: 1rem; margin-bottom: 0.75rem;">Or use the REST API directly</h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.7;">
            Same key works for the JSON API — pass as a Bearer token:
          </p>
          <pre style="background: var(--dark); color: #e0e0e0; padding: 1rem; border-radius: 6px; margin-top: 0.75rem; font-size: 0.85rem; overflow-x: auto;">
{`curl https://learnvibe.build/api/v1/me \\
  -H "Authorization: Bearer lvb_your_key_here"`}
          </pre>
          <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.7; margin-top: 0.75rem;">
            Full API docs: <a href="/api/v1/docs" style="color: var(--accent);">learnvibe.build/api/v1/docs</a>
          </p>
        </div>
      </div>
    </Layout>
  )
})

// ===== CHANGE ACCOUNT EMAIL =====
// Request: signed-in user submits a new email → we email a confirmation link
// to the NEW address (proves they control it). The change is NOT applied yet.
settingsRoutes.post('/settings/email', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const body = await c.req.parseBody()
  const newEmail = String(body.email || '').trim().toLowerCase()
  const back = (q: string) => c.redirect(`/settings/profile?${q}#email`)

  if (!newEmail) return back('email_error=missing')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 320) return back('email_error=invalid')
  if (newEmail === user.email.toLowerCase()) return back('email_error=same')

  // A confirmation email must actually be sendable, or the user would be stuck.
  if (!isEmailConfigured(c.env.EMAIL)) {
    console.error('email change request: EMAIL binding not configured')
    return back('email_error=server')
  }

  const db = getDb(c.env.DB)

  // Reject up front if another account already owns this email (re-checked at
  // confirm time too, since someone could claim it in the interim).
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).get()
  if (taken && taken.id !== user.id) return back('email_error=taken')

  try {
    const token = await createEmailChangeToken(db, { userId: user.id, newEmail })
    const origin = new URL(c.req.url).origin
    const link = `${origin}/settings/email/verify?token=${encodeURIComponent(token)}`
    const result = await sendEmailChange(c.env, newEmail, link)
    if (!result.success) {
      console.error('email change send failed:', result.error)
      return back('email_error=server')
    }
  } catch (e) {
    console.error('email change request failed:', e)
    return back('email_error=server')
  }

  return back(`email_pending=${encodeURIComponent(newEmail)}`)
})

// Confirm: clicked from the new inbox. Requires an active session for the SAME
// account (so a mistyped/hostile address can't be used to take over an
// account — the attacker can't be signed in as the victim). Sign-in still uses
// the CURRENT email until the change lands.
settingsRoutes.get('/settings/email/verify', async (c) => {
  const token = c.req.query('token') || ''
  const user = c.get('user')

  const expiredPage = (
    <Layout title="Link expired" user={user}>
      <div class="page-section" style="max-width: 480px; margin: 0 auto; text-align: center; padding: 5rem 0;">
        <h2>This confirmation link is no longer valid</h2>
        <p style="margin-top: 1rem; color: var(--text-secondary);">
          Email-change links work once and expire after an hour. Request a fresh one from your profile settings.
        </p>
        <a href="/settings/profile#email" style="margin-top: 1.5rem; display: inline-block; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500;">
          Back to settings &rarr;
        </a>
      </div>
    </Layout>
  )

  // Must be signed in to confirm. Bounce through sign-in (using the current
  // email) and return to this exact link — WITHOUT consuming the token yet.
  if (!user) {
    return c.redirect(`/sign-in?redirect_url=${encodeURIComponent(`/settings/email/verify?token=${token}`)}`)
  }

  const db = getDb(c.env.DB)
  const data = await consumeEmailChangeToken(db, token)
  if (!data) return c.html(expiredPage, 410)

  // The signed-in account must match the one the token was minted for.
  if (data.userId !== user.id) {
    return c.html(
      <Layout title="Wrong account" user={user}>
        <div class="page-section" style="max-width: 480px; margin: 0 auto; text-align: center; padding: 5rem 0;">
          <h2>This link is for a different account</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            Sign in as the account you requested the change for, then open the link again.
          </p>
          <a href="/settings/profile" style="margin-top: 1.5rem; display: inline-block; color: var(--accent);">← Back to settings</a>
        </div>
      </Layout>,
      403,
    )
  }

  // Re-check uniqueness at confirm time — someone may have taken the address
  // since the request was made.
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.email, data.newEmail)).get()
  if (taken && taken.id !== user.id) {
    return c.redirect('/settings/profile?email_error=taken#email')
  }

  const oldEmail = user.email
  await db.update(users)
    .set({ email: data.newEmail, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id))

  // The session cookie keys on user.id, not email, so the user stays signed
  // in. Notify the old address as a security heads-up (best-effort).
  if (oldEmail && oldEmail.toLowerCase() !== data.newEmail) {
    c.executionCtx.waitUntil(sendEmailChangedNotice(c.env, oldEmail, data.newEmail))
  }

  return c.redirect('/settings/profile?email_changed=1#email')
})

export default settingsRoutes
