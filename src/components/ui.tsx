"use client";
import { useEffect, useState, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "secondary",
  className,
  loading,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "good"; loading?: boolean }) {
  const styles = {
    primary: "bg-fg text-bg hover:opacity-85 border-transparent shadow-soft",
    good: "bg-accent text-white hover:opacity-90 border-transparent shadow-soft",
    secondary: "bg-surface text-fg border-line hover:bg-surface-2",
    danger: "bg-surface text-bad border-line hover:bg-peach",
    ghost: "bg-transparent text-muted border-transparent hover:text-fg hover:bg-surface-2",
  }[variant];
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-3xl border border-line/70 bg-surface p-5 shadow-soft sm:p-6", className)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-bg/60 px-3.5 py-2.5 text-sm text-fg placeholder:text-muted/70 transition focus:border-fg/30 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-fg/5";

export function Pct({ value, label }: { value: number; label?: string }) {
  const tone = value >= 75 ? "bg-sage text-good" : value >= 50 ? "bg-butter text-warn" : "bg-peach text-bad";
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", tone)} title={label}>
      {label && <span className="font-normal opacity-80">{label}</span>}
      {value}%
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent" }) {
  const t = {
    neutral: "bg-surface-2 text-muted",
    good: "bg-sage text-good",
    warn: "bg-butter text-warn",
    bad: "bg-peach text-bad",
    accent: "bg-lilac text-fg",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "Replied"
      ? "good"
      : status === "Bounced" || status === "Not sent"
        ? "bad"
        : status === "Scheduled"
          ? "accent"
          : status === "Sent"
            ? "neutral"
            : "warn";
  return <Badge tone={tone as "good"}>{status}</Badge>;
}

type ToastMsg = { id: number; text: string; tone: "good" | "bad" | "neutral" };
let pushToast: (t: Omit<ToastMsg, "id">) => void = () => {};
export function toast(text: string, tone: ToastMsg["tone"] = "neutral") {
  pushToast({ text, tone });
}
export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setList((l) => [...l, { ...t, id }]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 5000);
    };
  }, []);
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            "animate-rise rounded-2xl border px-4 py-3 text-sm shadow-lift",
            t.tone === "good" && "border-transparent bg-fg text-bg",
            t.tone === "bad" && "border-bad/30 bg-peach text-bad",
            t.tone === "neutral" && "border-line bg-surface text-fg",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Chat({
  messages,
  placeholder,
  onSend,
  examples,
}: {
  messages: { role: "user" | "assistant"; text: string }[];
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  examples?: string[];
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      await onSend(t);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {messages.length > 0 && (
        <div className="mb-3 max-h-64 space-y-2 overflow-y-auto rounded-2xl bg-surface-2 p-3">
          {messages.map((m, i) => (
            <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cx(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
                  m.role === "user" ? "rounded-br-md bg-fg text-bg" : "rounded-bl-md border border-line bg-surface",
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>
      )}
      {examples && messages.length === 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {examples.map((e) => (
            <button key={e} onClick={() => setText(e)} className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted transition hover:bg-lilac hover:text-fg">
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
        <Button variant="primary" loading={busy} type="submit">
          Send
        </Button>
      </form>
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-[26px] leading-tight">{children}</h2>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}
