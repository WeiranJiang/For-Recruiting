/**
 * Who may sign in. ALLOWED_EMAILS="a@x.com,b@y.com,@upenn.edu" (an entry starting with @ allows a domain).
 *
 * Secure default: in production, if no allowlist is configured, NOBODY can sign in unless
 * OPEN_SIGNUPS=1 is set explicitly. Every signed-in user can spend the server's Anthropic credits,
 * so an accidentally open deployment is a cost-abuse risk.
 */
export function isAllowedEmail(
  email: string,
  allowlist = process.env.ALLOWED_EMAILS,
  opts: { production?: boolean; openSignups?: boolean } = {},
) {
  const production = opts.production ?? process.env.NODE_ENV === "production";
  const openSignups = opts.openSignups ?? process.env.OPEN_SIGNUPS === "1";
  const raw = allowlist?.trim();
  if (!raw) return !production || openSignups;
  const e = email.trim().toLowerCase();
  return raw
    .split(/[,\s]+/)
    .filter(Boolean)
    .some((x) => {
      const r = x.toLowerCase();
      return r.startsWith("@") ? e.endsWith(r) : e === r;
    });
}
