import "server-only";

export type EmailLookup = { email: string; confidence: number; source: "hunter" | "apollo"; detail: string } | null;

function splitName(name: string) {
  const parts = name.replace(/[,()]/g, " ").trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1] : "" };
}

/** Hunter.io Email Finder: https://hunter.io/api-documentation/v2#email-finder */
export async function hunterFind(apiKey: string, name: string, bank: string, domain: string): Promise<EmailLookup> {
  const { first, last } = splitName(name);
  const q = new URLSearchParams({ first_name: first, last_name: last, api_key: apiKey });
  if (domain) q.set("domain", domain);
  else q.set("company", bank);
  const r = await fetch(`https://api.hunter.io/v2/email-finder?${q}`);
  if (!r.ok) throw new Error(`Hunter error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: { email?: string; score?: number; verification?: { status?: string } } };
  if (!j.data?.email) return null;
  const status = j.data.verification?.status ?? "unknown";
  let conf = j.data.score ?? 50;
  if (status === "valid") conf = Math.max(conf, 92);
  if (status === "invalid") conf = Math.min(conf, 10);
  return { email: j.data.email, confidence: Math.round(conf), source: "hunter", detail: `Hunter score ${j.data.score}, verification: ${status}` };
}

/** Apollo People Match: https://docs.apollo.io/reference/people-enrichment */
export async function apolloFind(apiKey: string, name: string, bank: string, domain: string): Promise<EmailLookup> {
  const { first, last } = splitName(name);
  const r = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, "Cache-Control": "no-cache" },
    body: JSON.stringify({
      first_name: first,
      last_name: last,
      organization_name: bank,
      ...(domain ? { domain } : {}),
      reveal_personal_emails: false,
    }),
  });
  if (!r.ok) throw new Error(`Apollo error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { person?: { email?: string; email_status?: string } };
  const email = j.person?.email;
  if (!email || email.startsWith("email_not_unlocked")) return null;
  const status = j.person?.email_status ?? "unknown";
  const conf = status === "verified" ? 92 : status === "guessed" ? 60 : status === "likely to engage" ? 70 : 45;
  return { email, confidence: conf, source: "apollo", detail: `Apollo email_status: ${status}` };
}
