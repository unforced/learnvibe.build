import type { FC, PropsWithChildren } from 'hono/jsx'
import { DESIGN_SYSTEM_CSS } from '../styles/design-system'
import type { AuthUser } from '../lib/auth'

type LayoutProps = PropsWithChildren<{
  title: string
  description?: string
  noindex?: boolean
  user?: AuthUser | null
  fullWidth?: boolean
}>

export const Layout: FC<LayoutProps> = ({ title, description, noindex, user, fullWidth, children }) => {
  const isEnrolled = user?.isEnrolled ?? false
  const isAdmin = user?.role === 'admin' || user?.role === 'facilitator'

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} — Learn Vibe Build</title>
        {description && <meta name="description" content={description} />}
        {noindex && <meta name="robots" content="noindex, nofollow" />}
        <meta property="og:image" content="https://learnvibe.build/og-image-v2.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://learnvibe.build/og-image-v2.png" />
        <meta name="theme-color" content="#e8612a" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v2.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        <style dangerouslySetInnerHTML={{ __html: DESIGN_SYSTEM_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: `
          document.addEventListener('click', function(e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-copy-code]') : null;
            if (!btn) return;
            var wrap = btn.parentElement;
            if (!wrap) return;
            var pre = wrap.querySelector('pre');
            if (!pre) return;
            var text = (pre.textContent || '').replace(/^\\s+|\\s+$/g, '');
            function done() {
              btn.textContent = 'Copied!';
              btn.classList.add('copied');
              setTimeout(function(){ btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
            }
            function fail() {
              btn.textContent = 'Copy failed';
              setTimeout(function(){ btn.textContent = 'Copy'; }, 2000);
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(fail);
            } else {
              try {
                var ta = document.createElement('textarea');
                ta.value = text; ta.setAttribute('readonly', '');
                ta.style.position = 'absolute'; ta.style.left = '-9999px';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
              } catch (err) { fail(); }
            }
          });
        ` }} />
      </head>
      <body>
        <nav class="nav">
          <a href="/" class="nav-brand">Learn Vibe Build</a>
          <ul class="nav-links">
            {user ? (
              isEnrolled ? (
                <>
                  {/* Enrolled (or admin/facilitator): Cohort | Community | Dashboard | [Admin] | Profile.
                      Link targets the user's most recent active cohort via primaryCohortSlug (set in
                      getUser); falls back to cohort-1 for legacy admin/facilitator records with no
                      explicit enrollment. */}
                  <li><a href={`/cohort/${user.primaryCohortSlug ?? 'cohort-1'}`}>Cohort</a></li>
                  <li><a href="/community">Community</a></li>
                  <li><a href="/dashboard">Dashboard</a></li>
                  {isAdmin && (
                    <li><a href="/admin">Admin</a></li>
                  )}
                  <li>
                    <a href={`/members/${user.id}`} class="nav-user">
                      {user.name || user.email.split('@')[0]}
                    </a>
                  </li>
                </>
              ) : (
                <>
                  {/* Logged in, not enrolled: Curriculum | Dashboard | Enroll | Profile */}
                  <li class="nav-hide-mobile"><a href="/curriculum">Curriculum</a></li>
                  <li><a href="/dashboard">Dashboard</a></li>
                  <li><a href="/enroll" class="nav-apply">Enroll</a></li>
                  <li>
                    <a href="/settings/profile" class="nav-user">
                      {user.name || user.email.split('@')[0]}
                    </a>
                  </li>
                </>
              )
            ) : (
              <>
                {/* Logged out: Curriculum | Sign In | Enroll */}
                <li class="nav-hide-mobile"><a href="/curriculum">Curriculum</a></li>
                <li class="nav-hide-mobile"><a href="/sign-in">Sign In</a></li>
                <li><a href="/enroll" class="nav-apply">Enroll</a></li>
              </>
            )}
          </ul>
        </nav>
        <main class={fullWidth ? 'main-full' : ''}>{children}</main>
        <footer>
          <p>Learn Vibe Build &middot; Boulder, Colorado &middot; 2026</p>
          <p>Part of the cooperative at <a href="https://regenhub.xyz" target="_blank">Regen Hub</a></p>
        </footer>
      </body>
    </html>
  )
}
