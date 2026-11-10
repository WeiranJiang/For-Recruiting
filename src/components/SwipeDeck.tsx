"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EmailCard, type Me } from "./api";
import { useBusy } from "./EmailParts";
import { ComposeWindow } from "./ComposeWindow";
import { Button, Card, cx } from "./ui";

const THRESHOLD = 110;

export function SwipeDeck({ me, onChange, goFind, goSetup }: { me: Me; onChange: () => void; goFind: () => void; goSetup?: () => void }) {
  const [cards, setCards] = useState<EmailCard[] | null>(null);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | null>(null);
  const { busy, wrap } = useBusy();

  useEffect(() => {
    void api<{ emails: EmailCard[] }>("/api/emails?status=pending").then((r) => setCards(r.emails));
  }, []);

  const top = cards?.[0];

  const finish = useCallback(
    (dir: "left" | "right") => {
      setLeaving(dir);
      setTimeout(() => {
        setCards((c) => (c ? c.slice(1) : c));
        setLeaving(null);
        setDx(0);
        onChange();
      }, 220);
    },
    [onChange],
  );

  const later = useCallback(async () => {
    if (!top || busy) return;
    await wrap("left", async () => {
      await api(`/api/emails/${top.id}`, { method: "PATCH", json: { status: "review" } });
      finish("left");
    });
  }, [top, busy, wrap, finish]);

  // Right swipe = press the window's Send button (it saves edits, checks duplicates, schedules).
  const sendTop = useCallback(() => {
    document.querySelector<HTMLButtonElement>("[data-deck-top] .gm-send")?.click();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if (e.key === "ArrowRight") sendTop();
      if (e.key === "ArrowLeft") void later();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [later, sendTop]);

  if (cards === null) return <p className="text-center text-muted">Loading…</p>;
  if (!top)
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="font-display text-3xl">All caught up</p>
        <Button variant="primary" className="mt-4" onClick={goFind}>
          Find people
        </Button>
      </Card>
    );

  const offset = leaving === "right" ? 700 : leaving === "left" ? -700 : dx;
  const hint = dx > 40 ? "send" : dx < -40 ? "later" : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>{cards.length} to go</span>
        <span className="hidden sm:inline">Drag the top bar · ← later · → send</span>
      </div>
      <div className="relative">
        {cards[1] && <div className="absolute inset-x-4 -bottom-2 top-3 rotate-[1.5deg] rounded-xl border border-line bg-surface-2" />}
        <div
          data-deck-top
          className="relative"
          style={{
            transform: `translateX(${offset}px) rotate(${offset / 30}deg)`,
            transition: dragging ? "none" : "transform 0.22s ease-out",
            opacity: leaving ? 0 : 1,
          }}
        >
          {hint && (
            <div
              className={cx(
                "absolute -top-3 z-10 rounded-full px-3 py-1 text-sm font-semibold shadow-soft",
                hint === "send" ? "right-4 bg-accent text-white" : "left-4 bg-surface-2 text-fg",
              )}
            >
              {hint === "send" ? "Send" : "Later"}
            </div>
          )}
          <ComposeWindow
            key={top.id}
            e={top}
            me={me}
            goSetup={goSetup}
            onSent={() => finish("right")}
            onDeleted={() => finish("left")}
            onLater={later}
            laterLabel="Edit later"
            dragHandle={{
              onPointerDown: (ev) => {
                if ((ev.target as HTMLElement).closest("button")) return;
                start.current = ev.clientX;
                setDragging(true);
                (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
              },
              onPointerMove: (ev) => start.current !== null && setDx(ev.clientX - start.current),
              onPointerUp: () => {
                if (start.current === null) return;
                start.current = null;
                setDragging(false);
                if (dx > THRESHOLD) {
                  setDx(0);
                  sendTop();
                } else if (dx < -THRESHOLD) void later();
                else setDx(0);
              },
            }}
          />
        </div>
      </div>
      <div className="mt-5 flex justify-center">
        <Button variant="ghost" onClick={later} loading={busy === "left"}>
          ← Edit later
        </Button>
      </div>
    </div>
  );
}
