"use client";
import { useRef, useState } from "react";
import { api, type Me, type Profile } from "./api";
import { Button, Card, Chat, Field, inputCls, toast } from "./ui";
import { resumeFilename, signatureBlock } from "@/lib/text-rules";

const TARGET_EXAMPLES = [
  "Penn / Wharton alumni",
  "People who interned where I did (see my experience)",
  "Analysts & associates in Technology M&A",
  "Members of SEO, MLT or similar programs",
  "Women in banking networks",
  "First-gen college graduates",
  "Elite boutiques: PJT, Centerview, Evercore, Moelis, Lazard",
  "New York office only",
];

export function Setup({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  const [p, setP] = useState<Profile>(me.profile);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });

  const saveProfile = async () => {
    setSaving(true);
    try {
      const r = await api<{ user: Me }>("/api/me", { method: "PATCH", json: { profile: p } });
      onChange(r.user);
      toast("Saved", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="bg-gradient-to-br from-surface to-sky/60 lg:col-span-2">
        <h2 className="font-display text-[32px] leading-tight">Who do you want to reach?</h2>
        <p className="mb-3 text-sm text-muted">
          Describe your targets in plain words: schools, past internships you share, groups, banks, seniority, locations, affinity networks. The
          people search uses this every time.
        </p>
        <textarea
          className={inputCls + " min-h-28"}
          value={p.targeting}
          onChange={set("targeting")}
          placeholder="e.g. Penn alumni who are analysts or associates in Technology M&A at elite boutiques in NYC; people who interned at the same firms I did; members of SEO or women-in-finance networks."
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TARGET_EXAMPLES.map((t) => (
            <button
              key={t}
              onClick={() => setP({ ...p, targeting: p.targeting ? `${p.targeting.replace(/\s+$/, "")}; ${t}` : t })}
              className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted transition hover:bg-lilac hover:text-fg"
            >
              + {t}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          For demographic filters (gender, race, ethnicity), people only count as a match when they&apos;ve publicly self-identified, e.g. through an
          affinity network, a diversity program, or their own bio. The AI never guesses from names or photos, and every match shows its evidence.
        </p>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={saveProfile} loading={saving}>
            Save targeting
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-[26px] leading-tight">About you</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input className={inputCls} value={p.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="School">
            <input className={inputCls} value={p.school} onChange={set("school")} placeholder="University of Pennsylvania" />
          </Field>
          <Field label="Class year">
            <input className={inputCls} value={p.gradYear} onChange={set("gradYear")} placeholder="2028" />
          </Field>
          <Field label="Major">
            <input className={inputCls} value={p.major} onChange={set("major")} />
          </Field>
          <Field label="Hometown">
            <input className={inputCls} value={p.hometown} onChange={set("hometown")} />
          </Field>
          <Field label="Phone (for your signature)">
            <input className={inputCls} value={p.phone ?? ""} onChange={set("phone")} placeholder="(215) 555-0100" />
          </Field>
        </div>
        <div className="mt-3">
          <Field
            label="Signature block"
            hint="Leave empty to use the default built from the fields above. Check that your phone number and links look right."
          >
            <textarea
              className={inputCls + " min-h-24 font-mono text-xs"}
              value={p.signature}
              onChange={set("signature")}
              placeholder={signatureBlock(p, me.email)}
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3">
          <Field label="Experience & affiliations you actually have" hint="Internships, clubs, programs. The AI will never claim an affiliation that isn't listed here.">
            <textarea className={inputCls + " min-h-20"} value={p.pastExperience} onChange={set("pastExperience")} />
          </Field>
          <Field label="Interests" hint="Groups, industries, or questions you genuinely care about">
            <textarea className={inputCls + " min-h-16"} value={p.interests} onChange={set("interests")} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={saveProfile} loading={saving}>
            Save
          </Button>
        </div>
      </Card>

      <Resume me={me} onChange={onChange} />
      <WritingStyle me={me} onChange={onChange} />
      <Rules me={me} onChange={onChange} />
      <Providers me={me} onChange={onChange} />
    </div>
  );
}

function Resume({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  const [text, setText] = useState(me.profile.resumeText);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file?: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      if (file) fd.set("file", file);
      if (!file || text !== me.profile.resumeText) fd.set("text", text);
      const r = await api<{ user: Me }>("/api/resume", { method: "POST", body: fd });
      onChange(r.user);
      setText(r.user.profile.resumeText);
      toast(file ? "Resume uploaded" : "Resume text saved", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h2 className="font-display text-[26px] leading-tight">Resume</h2>
      <p className="mb-3 text-sm text-muted">
        Attached to every email by default (you can remove it on any card while swiping). Upload the PDF you want bankers to see; paste the text
        too so drafts can reference your experience accurately.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
        {me.resume.hasPdf ? (
          <>
            <span>
              📎 {resumeFilename(me.profile.fullName || me.name, me.resume.filename ?? "Resume.pdf")}
              <span className="ml-1 text-xs text-muted">(sent with this clean name; uploaded as {me.resume.filename})</span>
            </span>
            <a className="text-accent underline" href="/api/resume" target="_blank">
              view
            </a>
            <Button
              variant="ghost"
              onClick={async () => {
                const r = await api<{ user: Me }>("/api/resume", { method: "DELETE" });
                onChange(r.user);
              }}
            >
              remove PDF
            </Button>
          </>
        ) : (
          <span className="text-muted">No PDF yet. If you only paste text, a simple PDF is generated from it.</span>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button onClick={() => fileRef.current?.click()} loading={busy}>
        Upload PDF
      </Button>
      <div className="mt-3">
        <Field label="Resume text" hint="Paste your resume here. Uploading a PDF fills this in automatically.">
          <textarea className={inputCls + " min-h-40 font-mono text-xs"} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="primary" onClick={() => upload()} loading={busy} disabled={text === me.profile.resumeText}>
          Save resume text
        </Button>
      </div>
    </Card>
  );
}

function WritingStyle({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  const [showGuide, setShowGuide] = useState(false);
  const [guide, setGuide] = useState(me.writingGuide);
  const [busy, setBusy] = useState(false);
  const save = async (json: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await api<{ user: Me; reply: string | null }>("/api/style", { method: "POST", json });
      onChange(r.user);
      setGuide(r.user.writingGuide);
      return r;
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="lg:col-span-2">
      <h2 className="font-display text-[26px] leading-tight">How your emails should sound</h2>
      <p className="mb-3 text-sm text-muted">
        Every draft follows the master writing prompt plus your personal guidelines below. Guidelines update automatically when you edit a draft
        before swiping right, and whenever you give feedback here.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[13px] font-medium text-muted">Your learned guidelines ({me.styleGuidelines.length})</div>
          {me.styleGuidelines.length === 0 ? (
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">None yet. Edit a draft or tell the chat what you like and dislike.</p>
          ) : (
            <ul className="space-y-1.5">
              {me.styleGuidelines.map((g, i) => (
                <li key={i} className="flex items-start gap-2 rounded-2xl bg-lilac px-3.5 py-2 text-sm">
                  <span className="flex-1">{g}</span>
                  <button
                    className="text-xs text-muted hover:text-bad"
                    title="Remove"
                    onClick={() => save({ guidelines: me.styleGuidelines.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium text-muted">Writing feedback</div>
          <Chat
            messages={me.styleChat}
            placeholder="e.g. Too formal. Never say 'circle back'. Keep it under 120 words."
            examples={["Sound a bit more casual with analysts", "Don't mention my GPA", "Sign off with just my first name"]}
            onSend={async (t) => {
              await save({ message: t });
            }}
          />
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <button className="text-sm font-medium text-accent" onClick={() => setShowGuide((s) => !s)}>
          {showGuide ? "Hide" : "View / edit"} master writing prompt {me.writingGuideIsDefault ? "(default)" : "(customised)"}
        </button>
        {showGuide && (
          <div className="mt-2">
            <p className="mb-2 text-xs text-muted">
              Update the “My background and context” section to match your situation (event, firm, interests). The resume setting in this app
              overrides the guide&apos;s note about attachments.
            </p>
            <textarea className={inputCls + " min-h-96 font-mono text-xs"} value={guide} onChange={(e) => setGuide(e.target.value)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => save({ writingGuide: null })} loading={busy}>
                Restore default
              </Button>
              <Button variant="primary" onClick={() => save({ writingGuide: guide })} loading={busy} disabled={guide === me.writingGuide}>
                Save prompt
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Rules({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  return (
    <Card>
      <h2 className="font-display text-[26px] leading-tight">Sending rules</h2>
      <p className="mb-3 text-sm text-muted">
        Tell it when to send and how to space out emails to the same bank. Swiping right schedules each email in the next slot that obeys these
        rules.
      </p>
      <ul className="mb-3 space-y-1.5 rounded-2xl bg-butter p-4 text-sm">
        {me.rulesSummary.map((s) => (
          <li key={s}>• {s}</li>
        ))}
      </ul>
      <Chat
        messages={me.rulesChat}
        placeholder="e.g. Only send Tue–Thu 7–8:30am ET, and space emails to the same bank 2 days apart"
        examples={[
          "Send Tue–Thu between 7:00 and 8:30am Eastern",
          "Same bank: at least 48 hours apart, max 2 per week",
          "BCC my tracker address on everything: me+track@gmail.com",
          "Follow up after 4 business days, max 1 follow-up",
        ]}
        onSend={async (t) => {
          try {
            const r = await api<{ user: Me }>("/api/rules", { method: "POST", json: { message: t } });
            onChange(r.user);
          } catch (e) {
            toast((e as Error).message, "bad");
          }
        }}
      />
      <div className="mt-2 text-right">
        <Button
          variant="ghost"
          onClick={async () => {
            const r = await api<{ user: Me }>("/api/rules", { method: "POST", json: { reset: true } });
            onChange(r.user);
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </Card>
  );
}

function Providers({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  const [hunter, setHunter] = useState("");
  const [apollo, setApollo] = useState("");
  const save = async (json: Record<string, string>) => {
    try {
      const r = await api<{ user: Me }>("/api/me", { method: "PATCH", json });
      onChange(r.user);
      setHunter("");
      setApollo("");
      toast("Saved", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  return (
    <Card>
      <h2 className="font-display text-[26px] leading-tight">Email lookup providers (optional)</h2>
      <p className="mb-3 text-sm text-muted">
        The AI finds emails from public sources and bank email formats. For verified addresses, add a Hunter.io or Apollo.io API key and choose it
        when searching. Keys are stored encrypted.
      </p>
      <div className="grid gap-3">
        <Field label={`Hunter.io API key ${me.providers.hunter ? "✓ connected" : ""}`}>
          <div className="flex gap-2">
            <input className={inputCls} type="password" value={hunter} onChange={(e) => setHunter(e.target.value)} placeholder={me.providers.hunter ? "••••••••" : "paste key"} />
            <Button onClick={() => save({ hunterKey: hunter })}>{hunter ? "Save" : me.providers.hunter ? "Remove" : "Save"}</Button>
          </div>
        </Field>
        <Field label={`Apollo.io API key ${me.providers.apollo ? "✓ connected" : ""}`}>
          <div className="flex gap-2">
            <input className={inputCls} type="password" value={apollo} onChange={(e) => setApollo(e.target.value)} placeholder={me.providers.apollo ? "••••••••" : "paste key"} />
            <Button onClick={() => save({ apolloKey: apollo })}>{apollo ? "Save" : me.providers.apollo ? "Remove" : "Save"}</Button>
          </div>
        </Field>
      </div>
    </Card>
  );
}
