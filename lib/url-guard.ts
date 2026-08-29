// lib/url-guard.ts — SSRF protection for the `fetch_url` tool.
//
// Without this, a model can be talked into fetching http://169.254.169.254/
// (cloud instance metadata) or an internal service on the app's private network
// and reading the response straight back to the user. The guard runs twice per
// fetch: once on the requested URL, and again on the final URL after redirects,
// because a public host can 302 into a private one.

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,          // link-local, incl. cloud metadata endpoints
  /^\[?::1\]?$/,
  /^\[?fc00:/i,           // unique local addresses
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,           // link-local v6
  /\.local$/i,
  /\.internal$/i,
  /^metadata\./i,
];

export function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(hostname));
}

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/** Parse and validate a URL the model asked to fetch. */
export function checkFetchUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'The `url` argument is required.' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: `"${trimmed}" is not a valid URL. Include the https:// scheme.` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Refused: only http and https URLs are allowed (got ${parsed.protocol}).` };
  }

  if (isBlockedHost(parsed.hostname)) {
    return {
      ok: false,
      reason:
        `Refused: "${parsed.hostname}" is a private or internal address. ` +
        'Only public internet hosts can be fetched.',
    };
  }

  return { ok: true, url: parsed };
}
