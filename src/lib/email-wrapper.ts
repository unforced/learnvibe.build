// Brand chrome for all transactional emails. Wraps the body content with the
// LVB header, footer, and shared CSS. Not admin-editable on purpose — the
// chrome is the visual identity; templates are the editable content.

export function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #fafaf8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.7; }
    .email-container { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .email-header { margin-bottom: 28px; border-bottom: 2px solid #e8612a; padding-bottom: 14px; }
    .email-brand { font-size: 18px; font-weight: 700; color: #1a1a1a; text-decoration: none; letter-spacing: -0.02em; }
    .email-body { background: #ffffff; border: 1px solid #e5e2db; border-radius: 12px; padding: 32px; margin-bottom: 28px; box-shadow: 0 1px 3px rgba(26,26,26,0.04); }
    .email-body h2 { font-size: 22px; font-weight: 600; color: #1a1a1a; margin: 0 0 16px 0; letter-spacing: -0.02em; }
    .email-body p { font-size: 15px; color: #555; margin: 0 0 16px 0; line-height: 1.7; }
    .email-body p:last-child { margin-bottom: 0; }
    .email-cta { display: inline-block; background: #e8612a; color: #ffffff !important; font-size: 15px; font-weight: 600; padding: 14px 30px; border-radius: 10px; text-decoration: none; margin-top: 8px; box-shadow: 0 2px 8px rgba(232,97,42,0.25); }
    .email-divider { border: none; border-top: 1px solid #e5e2db; margin: 24px 0; }
    .email-muted { font-size: 13px; color: #999; }
    .email-footer { text-align: center; padding: 0 24px; }
    .email-footer p { font-size: 13px; color: #999; margin: 0; line-height: 1.6; }
    .email-footer a { color: #999; text-decoration: none; }
    .email-footer a:hover { color: #e8612a; }
    .email-highlight { background: #fef4f0; border-radius: 8px; padding: 16px 20px; margin: 16px 0; }
    .email-highlight p { color: #1a1a1a; margin: 0; font-size: 14px; }
    .email-highlight strong { color: #e8612a; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <a href="https://learnvibe.build" class="email-brand">Learn Vibe Build</a>
    </div>
    <div class="email-body">
      ${content}
    </div>
    <div class="email-footer">
      <p>Learn Vibe Build · Boulder, Colorado</p>
      <p><a href="https://learnvibe.build">learnvibe.build</a> · Part of <a href="https://regenhub.xyz">Regen Hub Cooperative</a></p>
    </div>
  </div>
</body>
</html>`
}
