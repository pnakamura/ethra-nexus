// CSP-safe HTML validator for artifact output (Spec #4).
// Runs after Sonnet generates the HTML, before storage write.
// Belt + suspenders with the CSP headers on /artifacts/:id/view.

const MAX_HTML_BYTES = 50 * 1024
const ALLOWED_SCRIPT_HOSTS: ReadonlySet<string> = new Set(['cdn.jsdelivr.net'])

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateArtifactHtml(html: string): ValidationResult {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, reason: 'html exceeds 50KB' }
  }

  // Inline event handlers: onclick=, onerror=, onload=, etc.
  if (/<[^>]+\s+on[a-z]+\s*=/i.test(html)) {
    return { ok: false, reason: 'inline event handler detected (on*=)' }
  }

  // javascript: pseudo-URLs in href/src/action
  if (/javascript:/i.test(html)) {
    return { ok: false, reason: 'javascript: URL detected' }
  }

  // data: URLs are dangerous in iframe/object/embed (allowed in img/font for charts)
  if (/<(iframe|object|embed)[^>]+src\s*=\s*["']data:/i.test(html)) {
    return { ok: false, reason: 'data: URL in iframe/object/embed' }
  }

  // External scripts: only HTTPS + whitelisted host
  const scriptSrcs = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)]
  for (const m of scriptSrcs) {
    const url = m[1]!
    if (url.startsWith('//') || url.startsWith('http:')) {
      return { ok: false, reason: `non-https script src: ${url}` }
    }
    if (url.startsWith('http')) {
      try {
        const u = new URL(url)
        if (u.protocol !== 'https:') {
          return { ok: false, reason: `non-https script src: ${url}` }
        }
        if (!ALLOWED_SCRIPT_HOSTS.has(u.hostname)) {
          return { ok: false, reason: `script host not whitelisted: ${u.hostname}` }
        }
      } catch {
        return { ok: false, reason: `invalid script src URL: ${url}` }
      }
    }
    // Relative URLs (no protocol) are allowed — same-origin
  }

  return { ok: true }
}
