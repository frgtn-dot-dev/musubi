import { providerFlavor, type Calendar, type Event, type Task } from "@musubi/types";
import { ArrowRight, CalendarDays, CheckSquare, Search, Users } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Dialog, DialogInfo } from "~/ui/Dialog";
import { Button } from "~/ui/Button";
import { RowAction } from "~/ui/Row";
import { Segmented } from "~/ui/Segmented";
import { SectionLabel } from "~/ui/SectionLabel";
import { InlineError } from "~/ui/InlineError";
import { SHORTCUT_GROUPS } from "../shortcuts";
import shortcutStyles from "./styles/shortcuts.module.css";
import { AccountMark } from "./ProviderIcon";
import { offeredViews, type CalendarViewId } from "../view-registry";
import styles from "./styles/search-dialog.module.css";

export type SearchAccountData = { events: Event[]; tasks: Task[]; calendars: Calendar[] };
export type SearchAccountSource = {
  data?: SearchAccountData;
  loading: boolean;
  error: boolean;
  retry: () => void;
};
const dateLabel = (date: Date | null | undefined) => date ? date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }) : "No date";
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const filters = [{ label: "All", value: "all" }, { label: "Events", value: "events" }, { label: "Tasks", value: "tasks" }] as const;

type SearchDialogProps = {
  activeView: CalendarViewId;
  canCreateEvents: boolean;
  canCreateTasks?: boolean;
  canCreateMeetings?: boolean;
  onCreateMeeting?: () => void;
  events: Event[];
  tasks?: Task[];
  calendars?: Calendar[];
  visibleCalendarIds?: string[];
  visibleEventIds?: string[];
  accountSource?: SearchAccountSource;
  inputRef: RefObject<HTMLInputElement | null>;
  onCreateEvent: () => void;
  onCreateTask?: () => void;
  onEventSelect: (event: Event) => void;
  onTaskSelect?: (task: Task) => void;
  onOpenChange: (open: boolean) => void;
  onToday: () => void;
  onViewChange: (view: CalendarViewId) => void;
  open: boolean;
  query: string;
  returnFocus: RefObject<HTMLElement | null>;
  setQuery: (query: string) => void;
};

export function SearchDialog({ activeView, canCreateEvents, canCreateTasks, canCreateMeetings, onCreateMeeting, events, tasks = [], calendars = [], visibleCalendarIds, visibleEventIds, accountSource, inputRef, onCreateEvent, onCreateTask, onEventSelect, onTaskSelect, onOpenChange, onToday, onViewChange, open, query, returnFocus, setQuery }: SearchDialogProps) {
  const account = accountSource?.data;
  const loading = accountSource?.loading ?? false;
  const error = accountSource?.error ?? false;
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState(0);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setActive(0);
  }
  const [limit, setLimit] = useState(40);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const normalized = normalize(query.trim());
  const calendarMap = new Map((account?.calendars ?? calendars).map(calendar => [calendar.id, calendar]));
  const visible = new Set(visibleCalendarIds ?? calendars.map(calendar => calendar.id));
  const records = useMemo(() => [
    ...(account?.events ?? events).map(event => ({ key: `event:${event.id}`, kind: "events", title: event.title, text: [event.title, event.description, event.location].filter(Boolean).join(" "), calendars: event.calendars, date: event.start, event, task: undefined as Task | undefined })),
    ...(account?.tasks ?? tasks).map(task => ({ key: `task:${task.id}`, kind: "tasks", title: task.title, text: [task.title, task.description].filter(Boolean).join(" "), calendars: [task.calendarID], date: task.due ?? task.start, event: undefined as Event | undefined, task })),
  ], [account, events, tasks]);
  const visibleEvents = new Set(visibleEventIds ?? events.map(event => event.recurrence ? event.id.replace(/_\d+$/, "") : event.id));
  function section(record: typeof records[number]) {
    if (visibleCalendarIds && !record.calendars.some(id => visible.has(id))) return 3;
    if (record.event && visibleEvents.has(record.event.id)) return 0;
    if (record.task && activeView === "tasks") return 1;
    return 2;
  }
  const matches = normalized ? records.filter(record => (filter === "all" || filter === record.kind) && normalized.split(/\s+/).every(word => normalize(`${record.text} ${record.calendars.map(id => calendarMap.get(id)?.name ?? "").join(" ")}`).includes(word))).sort((a, b) => {
    const visibleDifference = section(a) - section(b);
    return visibleDifference || Number(normalize(b.title).startsWith(normalized)) - Number(normalize(a.title).startsWith(normalized)) || (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || a.key.localeCompare(b.key);
  }) : [];
  const shown = matches.slice(0, limit);
  const actions: { label: string; onSelect: () => void; shortcut?: string }[] = [
    ...(canCreateEvents ? [{ label: "New event", shortcut: SHORTCUT_GROUPS.flatMap(group => group.items).find(item => item.action === "New event")?.keys, onSelect: onCreateEvent }] : []),
    ...(canCreateMeetings && onCreateMeeting ? [{ label: "New meeting", onSelect: onCreateMeeting }] : []),
    ...(canCreateTasks && onCreateTask ? [{ label: "New task", onSelect: onCreateTask }] : []),
    { label: "Go to today", onSelect: onToday },
    ...offeredViews().filter(view => view.id !== activeView).map(view => ({ label: `Switch to ${view.label}`, shortcut: SHORTCUT_GROUPS.find(group => group.title === "Switch view")?.items.find(item => item.action === view.label)?.keys, onSelect: () => onViewChange(view.id as CalendarViewId) })),
  ];
  const resultCount = shown.length + actions.length;
  const selected = Math.min(active, Math.max(0, resultCount - 1));
  function run(action: () => void) { onOpenChange(false); action(); }
  function openRecord(record: typeof shown[number]) { run(() => record.event ? onEventSelect(record.event) : record.task && onTaskSelect?.(record.task)); }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Enter" && event.currentTarget.tagName === "INPUT") {
      event.preventDefault();
      const record = shown[selected];
      if (record) openRecord(record); else if (actions[selected - shown.length]) run(actions[selected - shown.length]!.onSelect);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp"].includes(event.key) || !resultCount) return;
    event.preventDefault();
    const inResults = selected < shown.length;
    const start = inResults ? 0 : shown.length;
    const count = inResults ? shown.length : actions.length;
    const row = selected - start;
    let next = selected;
    if (event.key === "ArrowRight") {
      if (inResults && actions.length) next = shown.length + Math.min(row, actions.length - 1);
    } else if (event.key === "ArrowLeft") {
      if (!inResults && shown.length) next = Math.min(row, shown.length - 1);
    } else {
      const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "PageDown" ? 5 : -5;
      next = start + ((row + delta) % count + count) % count;
    }
    setActive(next);
    const target = listRef.current?.querySelectorAll<HTMLElement>("[data-search-result]")[next];
    target?.scrollIntoView?.({ block: "nearest" });
    if (event.currentTarget.tagName !== "INPUT") target?.focus();
  }
  function group(label: string, items: typeof shown) {
    if (!items.length) return null;
    return <section aria-label={label} className={styles.resultGroup}>
      <SectionLabel>{label} <span>{items.length}</span></SectionLabel>
      {items.map(record => {
        const index = shown.indexOf(record);
        const calendar = record.calendars.map(id => calendarMap.get(id)).find(calendar => calendar && visible.has(calendar.id)) ?? calendarMap.get(record.calendars[0] ?? "");
        return <RowAction key={record.key} id={`${id}-${index}`} data-search-result data-active={selected === index || undefined} className={styles.result}
          icon={<AccountMark size="compact" flavor={calendar ? providerFlavor(calendar) : null} color={calendar?.color} />}
          label={record.title} showChevron={false}
          detail={`${record.event ? "Event" : "Task"} · ${dateLabel(record.date)}${record.task ? ` · ${record.task.status.replace("in-process", "in progress").replace("needs-action", "needs action")}` : ""}`}
          trailing={<span className={styles.calendarName}>{calendar?.name ?? "Calendar"}</span>}
          onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => openRecord(record)} />;
      })}
    </section>;
  }
  return <Dialog className={styles.dialog} size="workspace" bodyClassName={styles.body} closeLabel="Close search" initialFocus={inputRef} onOpenChange={onOpenChange} open={open} returnFocus={returnFocus} title="Search Musubi"
    headerActions={<DialogInfo label="About search" title="Search your account">Find events and tasks stored on this server, across all your accessible calendars and dates. Items in the current view come first; other dates and hidden calendars are grouped separately. Recurring events appear as their series.</DialogInfo>}
    footer={<span className={styles.hint}>↑ ↓ Items · ← → Columns · Enter Open · Esc Close</span>}>
    <div className={styles.searchControls}>
      <label className={styles.searchBox}><Search aria-hidden="true" size={18} />
        <input aria-label="Search events and actions" placeholder="Search events, tasks, calendars…" ref={inputRef} type="search" value={query}
          aria-describedby={`${id}-status`} onChange={event => { setQuery(event.target.value); setActive(0); setLimit(40); }} onKeyDown={keyboard} />
      </label>
      <Segmented label="Search type" value={filter} options={filters} onChange={value => { setFilter(value); setActive(0); setLimit(40); }} />
    </div>
    <p className={styles.hint} role="status" id={`${id}-status`}>{loading ? "Searching your account…" : normalized ? `${matches.length} results${error || !accountSource ? " in available data" : " across your account"}` : "Search across your account, or choose an action."}</p>
    {error ? <InlineError>Account search could not load. Showing available data. <Button size="compact" variant="ghost" onClick={accountSource?.retry}>Retry</Button></InlineError> : null}
    <span className={styles.visuallyHidden} aria-live="polite">{shown[selected]?.title ?? actions[selected - shown.length]?.label}</span>
    <div className={styles.columns} ref={listRef} onKeyDown={keyboard}>
      <div className={styles.results}>
        {group("Visible events", shown.filter(record => section(record) === 0))}
        {group("Visible tasks", shown.filter(record => section(record) === 1))}
        {group("Outside current range", shown.filter(record => section(record) === 2))}
        {group("Elsewhere in your account", shown.filter(record => section(record) === 3))}
        {!normalized ? <div className={styles.empty}><Search size={28} aria-hidden="true" /><p>Find something in Musubi</p><span>Search a title, place, note or calendar name.</span></div> : !shown.length ? <p className={styles.empty}>{loading ? "Looking for matches…" : "No matching events or tasks."}</p> : null}
        {matches.length > limit ? <Button variant="ghost" onClick={() => setLimit(value => value + 40)}>Show more results ({matches.length - limit})</Button> : null}
      </div>
      <aside className={styles.actions} aria-label="Quick actions"><SectionLabel>Quick actions</SectionLabel>
        {actions.map((action, index) => <RowAction id={`${id}-${shown.length + index}`} key={action.label} data-search-result data-active={selected === shown.length + index || undefined} className={styles.result} label={action.label} showChevron={false}
          icon={action.label === "New meeting" ? <Users size={16} /> : action.label === "New task" ? <CheckSquare size={16} /> : action.label === "New event" ? <CalendarDays size={16} /> : <ArrowRight size={16} />}
          trailing={<span className={`${styles.actionHint} ${shortcutStyles.shortcutList}`}>{action.shortcut ? <kbd>{action.shortcut}</kbd> : null}</span>} onFocus={() => setActive(shown.length + index)} onMouseEnter={() => setActive(shown.length + index)} onClick={() => run(action.onSelect)} />)}
      </aside>
    </div>
  </Dialog>;
}
