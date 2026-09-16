import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState, type CSSProperties } from "react";
import { MapPin, Repeat2, Clock3, CircleCheck } from "lucide-react";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { AccountMark } from "./ProviderIcon";
import styles from "./AgendaProposal.module.css";

// Visual proposal only: no account data or writes, and no production route changes.
const days = [
  { date: "2026-09-15", day: "15", weekday: "Tuesday", label: "Today", items: [
    { title: "Ověřit nápovědu a nastavení", start: "All day", end: "", calendar: "UI kontrola", color: "#ca533a", provider: null, kind: "done", location: "" },
    { title: "Týdenní plánování", start: "09:00", end: "10:00", calendar: "Práce", color: "#849cbe", provider: "google", kind: "repeat", location: "Testovací prostředí" },
    { title: "UI kontrola — kompletně vyplněný úkol", start: "10:00", end: "", calendar: "UI kontrola", color: "#ca533a", provider: null, kind: "task", location: "" },
  ] },
  { date: "2026-09-16", day: "16", weekday: "Wednesday", label: "Tomorrow", items: [
    { title: "Volný den", start: "All day", end: "", calendar: "Osobní", color: "#a5b49e", provider: null, kind: "event", location: "" },
    { title: "Společná kontrola nové verze Musubi", start: "12:00", end: "12:30", calendar: "Domácí", color: "#68b5cf", provider: "apple", kind: "event", location: "Online" },
    { title: "Dokončit detaily kalendáře a připravit podklady k vydání", start: "14:30", end: "", calendar: "UI kontrola", color: "#ca533a", provider: null, kind: "task", location: "" },
    { title: "Plánování dalšího týdne", start: "15:00", end: "15:30", calendar: "Práce", color: "#849cbe", provider: "microsoft", kind: "event", location: "Kancelář" },
  ] },
  { date: "2026-09-17", day: "17", weekday: "Thursday", label: "", items: [
    { title: "Dokončení detailů kalendáře", start: "14:00", end: "16:00", calendar: "UI kontrola", color: "#ca533a", provider: null, kind: "event", location: "Testovací prostředí" },
  ] },
];
type Item = typeof days[number]["items"][number];
function AgendaProposal() {
  const [selected, setSelected] = useState<Item>();
  return <main className={styles.proposal}>
    <header className={styles.header}><h1>Agenda</h1><span>September 2026</span></header>
    <ol className={styles.days}>{days.map(day => <li key={day.date} className={styles.day}>
      <time dateTime={day.date} className={styles.date} data-today={day.label === "Today" || undefined}>
        <strong>{day.day}</strong><span>{day.weekday}</span><small>{day.label || "September"}</small>
      </time>
      <ul className={styles.events}>{day.items.map(item => <li key={item.title}>
        <Button variant="ghost" className={styles.event} onClick={() => setSelected(item)}>
          <span className={styles.eventLayout}>
            <span className={styles.time}><strong>{item.start}</strong>{item.end ? <span>{item.end}</span> : null}</span>
            <span className={styles.copy} style={{ "--agenda-color": item.color } as CSSProperties}>
              <span className={styles.title}>{item.kind === "done" ? <s>{item.title}</s> : item.title}</span>
              <span className={styles.meta}>
                <span><AccountMark flavor={item.provider} color={item.color} size="compact" />{item.calendar}</span>
                {item.location ? <><span aria-hidden="true">·</span><span><MapPin size={13} />{item.location}</span></> : null}
                {item.kind !== "event" ? <><span aria-hidden="true">·</span><span>{item.kind === "repeat" ? <Repeat2 size={13} /> : item.kind === "done" ? <CircleCheck size={13} /> : <Clock3 size={13} />}{item.kind === "repeat" ? "Weekly" : item.kind === "done" ? "Completed" : "Task"}</span></> : null}
              </span>
            </span>
          </span>
        </Button>
      </li>)}</ul>
    </li>)}</ol>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(undefined); }} title={selected?.title ?? "Detail"} closeLabel="Close preview detail">
      <p>{selected?.calendar} · {selected?.start}{selected?.end ? ` – ${selected.end}` : ""}</p>
      <p>This design preview opens a sample detail. The application will use the existing event and task panels.</p>
    </Dialog>
  </main>;
}
const meta = { title: "Calendar/Agenda proposal", component: AgendaProposal, parameters: { layout: "fullscreen" } } satisfies Meta<typeof AgendaProposal>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
export const Interaction: StoryObj<typeof meta> = { play: async () => {
  await userEvent.click(screen.getByRole("button", { name: /09:00.*Týdenní plánování/ }));
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Týdenní plánování" })).toBeVisible());
  await userEvent.click(screen.getByRole("button", { name: "Close preview detail" }));
} };
export const Narrow: StoryObj<typeof meta> = { globals: { viewport: { value: "mobile1", isRotated: false } } };
