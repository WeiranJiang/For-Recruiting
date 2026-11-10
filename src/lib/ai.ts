import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Profile, Contact, Email } from "./db/schema";
import { RulesSchema, type Rules, renderSubject } from "./rules";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
let _client: Anthropic | null = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  _client ??= new Anthropic();
  return _client;
}

type Effort = "low" | "medium" | "high";

/**
 * One structured-output call to Claude. Optionally lets Claude use web search.
 * Uses server-side refusal fallbacks so a declined request is retried on a fallback model.
 */
async function callJSON<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  webSearchUses?: number;
  effort?: Effort;
  maxTokens?: number;
  cacheSystem?: boolean;
}): Promise<z.infer<T>> {
  const fmt = zodOutputFormat(opts.schema);
  const tools: Anthropic.Beta.BetaToolUnion[] = opts.webSearchUses
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: opts.webSearchUses }]
    : [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.content }];

  let useFormat = true;
  for (let turn = 0; turn < 7; turn++) {
    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      stream: true,
      model: MODEL,
      max_tokens: opts.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.cacheSystem
        ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
        : opts.system,
      messages,
      ...(tools.length ? { tools } : {}),
      output_config: useFormat
        ? { effort: opts.effort ?? "medium", format: { type: "json_schema" as const, schema: fmt.schema } }
        : { effort: opts.effort ?? "medium" },
    };
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await client().beta.messages.stream(params).finalMessage();
    } catch (e) {
      // Fallback: if the API rejects structured output in this combination (e.g. with server tools),
      // retry once asking for raw JSON in the prompt instead.
      if (useFormat && e instanceof Anthropic.BadRequestError && tools.length) {
        useFormat = false;
        messages[0] = {
          role: "user",
          content: [
            ...(typeof opts.content === "string" ? [{ type: "text" as const, text: opts.content }] : opts.content),
            {
              type: "text" as const,
              text: `Respond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(fmt.schema)}`,
            },
          ],
        };
        continue;
      }
      throw e;
    }
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    if (msg.stop_reason === "refusal") throw new Error("The AI declined this request.");
    if (msg.stop_reason === "max_tokens") throw new Error("The AI response was cut off (too long). Try a smaller batch.");
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (useFormat) return fmt.parse(text) as z.infer<T>;
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return opts.schema.parse(JSON.parse(json)) as z.infer<T>;
  }
  throw new Error("The AI did not finish (too many search rounds).");
}

// ---------------------------------------------------------------- people research

const PersonSchema = z.object({
  name: z.string(),
  title: z.string().describe("e.g. Analyst, Associate, VP"),
  bank: z.string(),
  bankDomain: z.string().describe("Corporate email domain, e.g. gs.com"),
  group: z.string().describe("Coverage/product group, e.g. TMT, Healthcare, Restructuring"),
  location: z.string(),
  school: z.string(),
  linkedinUrl: z.string().describe("Empty string if unknown"),
  email: z.string().describe("Best-guess work email; empty string if no reasonable guess"),
  emailBasis: z
    .string()
    .describe("How the email was derived, e.g. 'published on X' or 'bank pattern first.last@ per sources'"),
  emailConfidence: z.number().int().describe("0-100 likelihood the email address is exactly right"),
  infoConfidence: z.number().int().describe("0-100 likelihood name+bank+title+group are current and right"),
  matchReasons: z.array(z.string()).describe("Why this person fits the targeting, each citing evidence"),
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
  notes: z.string().describe("Anything useful for personalising the email (shared clubs, hometown, deals)"),
});
export type ResearchedPerson = z.infer<typeof PersonSchema>;

const ResearchSchema = z.object({ people: z.array(PersonSchema) });

const RESEARCH_SYSTEM = `You research investment banking professionals for a student's networking outreach.
Use web search to find real, currently-employed bankers (analysts, associates, VPs, MDs) and verify facts.

Accuracy rules:
- Never invent people. Only return people you found evidence for, and cite the source URLs you used.
- Work email: if the address is published, use it (confidence 85-97). Otherwise determine the bank's email format
  (search e.g. "<bank> email format") and apply it; confidence reflects how well-established that pattern is
  (typically 40-75). Common names, nicknames and middle names lower confidence. If unknown, leave it empty and give 0.
- infoConfidence reflects how recent and consistent sources are (an old article or one source => lower).
- Be calibrated: these percentages are shown to the user as "how likely this is right".

Targeting rules:
- Prefer people who match the student's targeting description and explain each match in matchReasons with evidence.
- For demographic criteria (gender, race, ethnicity, religion, etc.) only count someone as matching when they have
  publicly self-identified, e.g. membership or leadership in an affinity network or diversity program
  (SEO, MLT, Girls Who Invest, a firm's women's or Black/Hispanic/Asian professionals network), or a public bio or
  article in which they describe it. NEVER infer these traits from a name, photo or appearance. If you cannot find
  such evidence, say so in matchReasons rather than guessing.`;

export async function researchPeople(input: {
  profile: Profile;
  query: string;
  count: number;
  excludeNames: string[];
}): Promise<ResearchedPerson[]> {
  const p = input.profile;
  const res = await callJSON({
    schema: ResearchSchema,
    system: RESEARCH_SYSTEM,
    webSearchUses: Math.min(30, 4 + input.count * 2),
    effort: "medium",
    content: `Student: ${p.fullName || "(unnamed)"}, ${p.school} ${p.gradYear}, ${p.major}. Hometown: ${p.hometown}.
Past experience: ${p.pastExperience}
Interests: ${p.interests}

Standing targeting preferences (who the student wants to reach):
${p.targeting || "(none given)"}

This search: ${input.query || "(use the standing targeting preferences)"}

Find up to ${input.count} people. Skip these people already in the student's sheet: ${input.excludeNames.slice(0, 300).join("; ") || "none"}.`,
  });
  return res.people;
}

export async function lookupSpecificPeople(input: {
  profile: Profile;
  people: { name: string; bank?: string; hint?: string }[];
}): Promise<ResearchedPerson[]> {
  const res = await callJSON({
    schema: ResearchSchema,
    system: RESEARCH_SYSTEM,
    webSearchUses: Math.min(30, 2 + input.people.length * 2),
    content: `Look up each of these specific people (return one entry per person you can identify; keep their names as given):
${input.people.map((x, i) => `${i + 1}. ${x.name}${x.bank ? ` — ${x.bank}` : ""}${x.hint ? ` (${x.hint})` : ""}`).join("\n")}

Student targeting preferences, for matchReasons: ${input.profile.targeting || "(none)"}
Student background: ${input.profile.school} ${input.profile.gradYear}; ${input.profile.pastExperience}`,
  });
  return res.people;
}

// ---------------------------------------------------------------- import parsing

const ImportSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      bank: z.string(),
      title: z.string(),
      group: z.string(),
      location: z.string(),
      school: z.string(),
      linkedinUrl: z.string(),
      notes: z.string(),
      infoConfidence: z.number().int().describe("0-100: how clearly the pasted text states these fields"),
    }),
  ),
});

export async function parseImport(text: string) {
  const res = await callJSON({
    schema: ImportSchema,
    effort: "low",
    system:
      "Extract every person from pasted text (CSV, spreadsheet rows, LinkedIn copy-paste, notes). Use empty strings for unknown fields. Do not invent data.",
    content: text.slice(0, 100_000),
  });
  return res.people;
}

// ---------------------------------------------------------------- drafting

const DraftSchema = z.object({
  roleAndGroup: z.string().describe("Current role and group, only if verified; otherwise say 'unverified'"),
  verifiedFacts: z.array(z.string()).describe("Facts about the person from research sources (not from the student's notes)"),
  fromMyNotes: z.array(z.string()).describe("Details that come only from the student's own notes"),
  whyContact: z.string().describe("Why this person is worth contacting"),
  personalizationAngle: z.string().describe("The specific detail the email references and why"),
  followUpQuestions: z.array(z.string()).describe("3-5 questions for a 15-minute call"),
  missingInfo: z.array(z.string()).describe("Anything missing that the student should fill in instead of guessing; empty if none"),
  qualityCheck: z.string().describe("One or two sentences: how the draft passed the quality-control questions"),
  subject: z.string(),
  body: z.string().describe("Complete plain-text email ready to send, ending with the sign-off"),
});
export type DraftResult = z.infer<typeof DraftSchema>;

/** System prompt for drafting: the user's writing guide plus everything learned from them. Stable → cached. */
export function writingSystem(guide: string, guidelines: string[]) {
  return `${guide}

${guidelines.length ? `PERSONAL STYLE GUIDELINES LEARNED FROM THIS USER'S EDITS AND FEEDBACK (these override the guide above when they conflict):
${guidelines.map((g) => `- ${g}`).join("\n")}
` : ""}
APP CONTEXT
You are drafting inside an outreach app. Output plain text only (no markdown). Write as the student, in first person.
Some contacts were found through web research rather than met in person: if the student's notes don't say you met,
do NOT claim you met; write a short, honest cold email that leads with the most genuine shared connection instead,
and list the missing context in missingInfo.
Placeholders like [detail] are not allowed in the body; if something essential is missing, write around it and flag it in missingInfo.`;
}

export async function draftEmail(input: {
  profile: Profile;
  rules: Rules;
  contact: Contact;
  kind: "initial" | "follow_up";
  previous?: Pick<Email, "subject" | "body" | "sentAt"> | null;
  attachResume: boolean;
  writingGuide: string;
  guidelines: string[];
}): Promise<DraftResult> {
  const { profile: p, rules: r, contact: c } = input;
  const firstName = c.name.split(/\s+/)[0] ?? "";
  const suggestedSubject = renderSubject(r.subjectTemplate, {
    school: p.school,
    bank: c.bank,
    group: c.group,
    firstName,
    myName: p.fullName,
    year: p.gradYear,
  });
  const resumeLine = input.attachResume
    ? "My resume will be attached (my app setting). At most mention it in one short, low-key clause — or not at all if it would feel pushy."
    : "No attachment. Do not mention a resume.";
  const student = `ME (the student)
Name: ${p.fullName}; School: ${p.school} ${p.gradYear}; Major: ${p.major}; Hometown: ${p.hometown}
Experience / affiliations I actually have: ${p.pastExperience || "(not given)"}
Interests: ${p.interests || "(not given)"}
Resume text (for facts about me only):
${p.resumeText.slice(0, 6000) || "(none)"}
Sign-off name/signature: ${p.signature || p.fullName}`;

  const person = `THE PERSON
Name: ${c.name}
Title: ${c.title || "(unknown)"}; Group: ${c.group || "(unknown)"}; Firm: ${c.bank}; Location: ${c.location || "(unknown)"}; School: ${c.school || "(unknown)"}
Research facts (verified-ish, info confidence ${c.infoConfidence}%): ${c.notes || "(none)"}
Why they matched my targeting: ${c.matchReasons.join(" | ") || "n/a"}
Sources: ${c.sources.map((s) => s.url).slice(0, 6).join(" ") || "none"}
MY NOTES from talking with them (treat as my notes, not verified fact): ${c.myNotes || "(none — we may not have met)"}`;

  const content =
    input.kind === "initial"
      ? `Write my first networking email to this person.

${student}

${person}

App settings: ${resumeLine} Aim for at most ~${r.maxWords} words.
Extra format notes from my settings: ${r.emailFormat}
Subject template from my settings (use it only if it fits the guide; otherwise write a better simple subject): "${suggestedSubject}"`
      : `Write a short, polite follow-up that will be sent as a reply in the same thread (the subject will be "Re: <original>").
Keep it to 2-4 sentences, ~40-80 words. Briefly restate the ask; never guilt-trip; don't repeat the original email.
${resumeLine}

${student}

${person}

My original email (sent ${input.previous?.sentAt?.toDateString() ?? "earlier"}):
Subject: ${input.previous?.subject}
${input.previous?.body}`;

  return callJSON({
    schema: DraftSchema,
    system: writingSystem(input.writingGuide, input.guidelines),
    content,
    effort: "medium",
    maxTokens: 12000,
    cacheSystem: true,
  });
}

// ---------------------------------------------------------------- learning the user's style

const LearnSchema = z.object({
  guidelines: z.array(z.string()).describe("The full updated list of personal style guidelines"),
  reply: z.string().describe("One or two sentences telling the user what you learned / changed"),
});

const LEARN_SYSTEM = `You maintain a short list of personal writing guidelines for one student's networking emails.
These sit on top of a long master writing guide. Each guideline is one concrete, reusable sentence
(e.g. "Sign off with 'Best,' then just 'Wei' — no full signature block" or "Never mention GPA").
Rules: keep at most 25 guidelines; merge duplicates; when a new preference contradicts an old one, replace the old one;
don't add guidelines that only apply to one specific recipient; don't restate what the master guide already says
unless the user is emphasising or overriding it. If nothing generalisable can be learned, return the list unchanged.`;

/** Learns from the diff between what the AI drafted and what the user actually approved. */
export async function learnFromEdit(input: {
  guidelines: string[];
  aiSubject: string;
  aiBody: string;
  finalSubject: string;
  finalBody: string;
}) {
  return callJSON({
    schema: LearnSchema,
    effort: "low",
    maxTokens: 6000,
    system: LEARN_SYSTEM,
    content: `Current guidelines:
${input.guidelines.map((g) => `- ${g}`).join("\n") || "(none)"}

The AI drafted:
Subject: ${input.aiSubject}
${input.aiBody}

The user edited it to (and approved this version):
Subject: ${input.finalSubject}
${input.finalBody}

What general, reusable preferences do these edits reveal? Update the guidelines.`,
  });
}

/** Writing-feedback chat: the user tells us in words how they want emails to sound. */
export async function updateStyleFromChat(input: {
  guidelines: string[];
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
}) {
  return callJSON({
    schema: LearnSchema,
    effort: "low",
    maxTokens: 6000,
    system: LEARN_SYSTEM,
    content: `Current guidelines:
${input.guidelines.map((g) => `- ${g}`).join("\n") || "(none)"}

Recent conversation:
${input.history.slice(-8).map((m) => `${m.role}: ${m.text}`).join("\n")}

The user's latest feedback: ${input.message}`,
  });
}

// ---------------------------------------------------------------- grammar / smoothness

const GrammarSchema = z.object({
  smoothness: z.number().int().describe("0-100: how naturally and easily the email reads for a busy banker"),
  summary: z.string().describe("One short sentence on how it reads"),
  issues: z.array(
    z.object({
      field: z.enum(["subject", "body"]),
      type: z
        .enum(["spelling", "grammar", "clarity"])
        .describe("spelling = misspelled word; grammar = grammar/punctuation error; clarity = clunky, wordy, awkward or AI-sounding phrasing"),
      original: z.string().describe("The EXACT text copied character-for-character from the email (a word or short phrase, not a whole paragraph)"),
      suggestion: z.string().describe("Replacement text for exactly that span (empty string = delete it)"),
      reason: z.string().describe("Very short explanation, under 12 words"),
    }),
  ),
  correctedSubject: z.string(),
  correctedBody: z.string().describe("The full email with all suggestions applied"),
})

export async function grammarCheck(subject: string, body: string, guide: string, guidelines: string[]) {
  return callJSON({
    schema: GrammarSchema,
    effort: "low",
    maxTokens: 8000,
    cacheSystem: true,
    system: `${writingSystem(guide, guidelines)}

YOUR TASK NOW: act as a meticulous copy editor for the email the user gives you. Find grammar, spelling, punctuation,
awkward phrasing, filler, AI-sounding phrases and tone problems according to the guide above. Score "smoothness"
honestly (how naturally and easily it reads for a busy banker on a phone, and how human it sounds).
Fix only what needs fixing; keep the author's voice; do not add new facts.
Keep each issue's "original" as short as possible (the misspelled word, or the clunky phrase/sentence) and copy it exactly,
so the app can underline it. Don't report the same span twice. If the email is clean, return no issues.`,
    content: `Subject: ${subject}\n\n${body}`,
  });
}

// ---------------------------------------------------------------- rules chat

const RulesReplySchema = z.object({
  rules: RulesSchema,
  reply: z.string().describe("Short confirmation of what changed, or a clarifying question"),
});

export async function updateRulesFromChat(input: {
  current: Rules;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
}) {
  return callJSON({
    schema: RulesReplySchema,
    effort: "low",
    maxTokens: 8000,
    system: `You maintain a JSON settings object that controls when and how a student's cold emails are sent.
Apply the user's latest instruction to the current settings and return the full updated settings.
Change only what the user asked for. Interpret times in the settings' timezone unless the user names another.
Weekdays: 1=Mon ... 7=Sun. If an instruction is ambiguous, keep settings unchanged and ask in "reply".`,
    content: `Current settings:\n${JSON.stringify(input.current, null, 2)}\n\nRecent conversation:\n${input.history
      .slice(-8)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n")}\n\nLatest instruction: ${input.message}`,
  });
}

// ---------------------------------------------------------------- resume

export async function extractResumeText(pdfB64: string) {
  const res = await callJSON({
    schema: z.object({ text: z.string() }),
    effort: "low",
    maxTokens: 16000,
    system: "Transcribe the resume into clean plain text, preserving sections and bullet points. Do not summarise.",
    content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
      { type: "text", text: "Transcribe this resume." },
    ],
  });
  return res.text;
}
