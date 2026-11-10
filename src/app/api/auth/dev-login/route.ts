import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createSession } from "@/lib/session";
import { appUrl } from "@/lib/google";

/**
 * Local development only: signs in as a demo user (no Google) and optionally seeds sample data.
 * Disabled unless DEV_LOGIN=1 and NODE_ENV !== "production".
 */
export async function GET(req: Request) {
  // Triple-guarded: explicit flag, not a production build, not running on Vercel (preview or prod).
  if (process.env.DEV_LOGIN !== "1" || process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return new Response("Not found", { status: 404 });
  }
  const as = new URL(req.url).searchParams.get("as");
  const db = await getDb();
  const email = as && /^[a-z0-9]{1,20}$/.test(as) ? `${as}@example.com` : "demo@example.com";
  let [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) {
    [u] = await db
      .insert(schema.users)
      .values({
        email,
        name: "Demo Student",
        profile: {
          fullName: "Demo Student",
          school: "University of Pennsylvania",
          gradYear: "2028",
          major: "Economics",
          hometown: "Chicago",
          pastExperience: "Summer analyst at a middle-market bank; Penn finance club",
          interests: "Technology M&A",
          signature: "Best,\nDemo",
          targeting: "Penn alumni in Technology M&A at elite boutiques",
          resumeText: "",
        },
      })
      .returning();
  }
  if (new URL(req.url).searchParams.get("seed") === "1") {
    const people = [
      { name: "Jordan Lee", bank: "PJT Partners", title: "Analyst", group: "Strategic Advisory", email: "jordan.lee@pjtpartners.com", ec: 72, ic: 85 },
      { name: "Priya Shah", bank: "Evercore", title: "Associate", group: "TMT", email: "priya.shah@evercore.com", ec: 64, ic: 78 },
      { name: "Sam Ortiz", bank: "PJT Partners", title: "Vice President", group: "Restructuring", email: "sam.ortiz@pjtpartners.com", ec: 45, ic: 60 },
    ];
    for (const p of people) {
      const [c] = await db
        .insert(schema.contacts)
        .values({
          userId: u.id,
          name: p.name,
          email: p.email,
          bank: p.bank,
          title: p.title,
          group: p.group,
          school: "University of Pennsylvania",
          emailConfidence: p.ec,
          infoConfidence: p.ic,
          matchReasons: ["Penn alum (per firm bio)"],
          sources: [{ url: "https://example.com/bio", title: "Firm bio" }],
        })
        .returning();
      const first = p.name.split(" ")[0];
      await db.insert(schema.emails).values({
        userId: u.id,
        contactId: c.id,
        to: [p.email],
        bcc: ["demo+tracker@example.com"],
        subject: `Penn Student – ${p.bank}`,
        body: `Hi ${first},\n\nI'm a sophomore at Penn studying economcis and I'm really interested in learning more about ${p.group} at ${p.bank}. I noticed you also went to Penn, which is why I wanted to reach out to you in order to be able to hear about your experience.\n\nWould you be open to a brief 15-minute conversation sometime in the next couple of weeks? I'm free Thursday, November 20th from 10:30-10:50 am ET.\n\nBest,\nDemo`,
        aiSubject: `Penn Student – ${p.bank}`,
        rationale: {
          roleAndGroup: `${p.title}, ${p.group}`,
          verifiedFacts: [`${p.title} at ${p.bank}`],
          fromMyNotes: [],
          whyContact: "Shared Penn background and relevant group",
          personalizationAngle: "Penn connection",
          followUpQuestions: ["What does a typical week look like?", "How did you choose your group?"],
          missingInfo: ["Where you met them (add notes for a warmer email)"],
          qualityCheck: "Short and specific.",
        },
        status: "pending",
        grammar: {
          smoothness: 68,
          summary: "Clear ask, but one typo and a wordy sentence.",
          issues: [
            { field: "body", type: "spelling", original: "economcis", suggestion: "economics", reason: "Misspelled word" },
            {
              field: "body",
              type: "clarity",
              original: "which is why I wanted to reach out to you in order to be able to hear about your experience",
              suggestion: "so I'd love to hear about your experience",
              reason: "Wordy; say it more directly",
            },
          ],
          correctedSubject: `Penn Student – ${p.bank}`,
          correctedBody: "",
          checkedAt: new Date().toISOString(),
        },
      });
    }
  }
  await createSession(u.id, u.sessionVersion);
  return Response.redirect(`${appUrl()}/`);
}
