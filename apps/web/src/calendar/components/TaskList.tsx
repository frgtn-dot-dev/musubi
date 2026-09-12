import { Plus, Repeat2, Trash2 } from "lucide-react";
import {
  describeAdvanced,
  isEditableRRule,
  parseAdvanced,
  splitRecurrence,
} from "@musubi/calendar/rrule-editor";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { providerFlavor } from "@musubi/types";
import type {
  Calendar,
  Settings,
  Task,
  TaskCreate,
  TaskUpdate,
} from "@musubi/types";
import { parseDateKey } from "../calendar-math";
import { toDateKey } from "../date-key";
import { Button } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { DatePicker } from "~/ui/DatePicker";
import { Dialog } from "~/ui/Dialog";
import { Disclosure } from "~/ui/Disclosure";
import { Empty } from "~/ui/Empty";
import { Field } from "~/ui/Field";
import { InlineError } from "~/ui/InlineError";
import { Select } from "~/ui/Select";
import { Row, RowAction } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { TimePicker } from "~/ui/TimePicker";
import { AccountMark } from "./ProviderIcon";
import styles from "./TaskList.module.css";

type TaskListProps = {
  calendars: Calendar[];
  createRequest: number;
  editableCalendarIds: ReadonlySet<string>;
  offline: boolean;
  onCreateRequestHandled: () => void;
  onCreate: (task: TaskCreate) => Promise<Task>;
  onRemove: (task: Task) => Promise<void>;
  onUpdate: (id: string, task: TaskUpdate) => Promise<Task>;
  settings: Pick<Settings, "timeFormat" | "weekStartsOn">;
  tasks: Task[];
  sourceTasks?: Task[];
  sourceCalendars?: Calendar[];
  calendarsResolved?: boolean;
  tasksResolved?: boolean;
};

type Draft = TaskUpdate & { id?: string };

function emptyDraft(calendarID: string): Draft {
  return {
    calendarID,
    completedAt: null,
    description: null,
    due: null,
    isAllDay: false,
    percentComplete: 0,
    priority: 0,
    recurrence: null,
    relatedTo: null,
    start: null,
    status: "needs-action",
    title: "",
    url: null,
  };
}

export function taskUpdate(task: Task): TaskUpdate {
  return {
    expectedProviderReadRetiredGeneration: task.providerReadRetiredGeneration ?? 0,
    calendarID: task.calendarID,
    completedAt: task.completedAt,
    description: task.description,
    due: task.due,
    isAllDay: task.isAllDay,
    percentComplete: task.percentComplete,
    priority: task.priority,
    recurrence: task.recurrence,
    relatedTo: task.relatedTo,
    start: task.start,
    status: task.status,
    title: task.title,
    url: task.url,
  };
}

export function taskDateKey(value: Date | null | undefined) {
  return value ? toDateKey(value) : "";
}

/** Keep an existing time-of-day while a date picker replaces only its date. */
export function replaceTaskDate(value: Date | null | undefined, date: string) {
  const next = parseDateKey(date);
  if (value) {
    next.setHours(
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
    );
  }
  return next;
}

export function taskTime(value: Date | null | undefined) {
  if (!value) return "";
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Describe only rules the shared parser understands; keep imported syntax intact. */
export function taskRecurrenceSummary(
  recurrence: string | null | undefined,
  start?: Date | null,
) {
  if (!recurrence) return "Does not repeat";
  const { rrule, extras } = splitRecurrence(recurrence);
  if (extras.length || !isEditableRRule(rrule)) return "Custom recurrence";
  const config = parseAdvanced(rrule, start?.getDay());
  if (!start && !rrule.includes("BYDAY=")) config.days = new Set();
  return describeAdvanced(config);
}

/** Replace only the local clock part; dates are calendar values, never UTC slices. */
export function replaceTaskTime(value: Date | null | undefined, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  if (hours === undefined || minutes === undefined) return value ?? null;
  const next = value ? new Date(value) : new Date();
  next.setHours(hours, minutes, 0, 0);
  return next;
}

export function TaskList({
  calendars,
  createRequest,
  editableCalendarIds,
  offline,
  onCreateRequestHandled,
  onCreate,
  onRemove,
  onUpdate,
  settings,
  tasks,
  sourceTasks = tasks,
  sourceCalendars = calendars,
  calendarsResolved = false,
  tasksResolved = false,
}: TaskListProps) {
  const firstEditableCalendarID = calendars.find((calendar) =>
    editableCalendarIds.has(calendar.id),
  )?.id;
  const [handledCreateRequest, setHandledCreateRequest] =
    useState(createRequest);
  const [editing, setEditing] = useState<Task>();
  const [draft, setDraft] = useState<Draft | undefined>(() =>
    createRequest && firstEditableCalendarID && !offline
      ? emptyDraft(firstEditableCalendarID)
      : undefined,
  );
  const [removedTaskID, setRemovedTaskID] = useState<string>();
  const [ownedFields, setOwnedFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const calendarById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const active = tasks.filter((task) => task.status !== "completed");
  const completed = tasks.filter((task) => task.status === "completed");

  if (createRequest !== handledCreateRequest) {
    setHandledCreateRequest(createRequest);
    if (createRequest && firstEditableCalendarID && !offline) {
      openCreate();
    }
  }

  const liveTask = editing ? sourceTasks.find(task => task.id === editing.id) : undefined;
  const liveRetirement = liveTask?.providerReadRetiredGeneration ?? 0;
  const editingRetirement = editing?.providerReadRetiredGeneration ?? 0;
  const restoredContent = editing && liveTask && liveRetirement > 0 && liveRetirement === editingRetirement &&
    (["title", "description", "url", "relatedTo"] as const).some(field => (liveTask[field] ?? "") !== (editing[field] ?? ""));
  // Restoration retains the retirement counter. Refresh copied fields from the
  // newly authorized baseline even when retirement arrived in a separate read.
  if (editing && draft && liveTask && (liveRetirement > editingRetirement || restoredContent)) {
    const refreshed = { ...draft, expectedProviderReadRetiredGeneration: liveTask.providerReadRetiredGeneration ?? 0 };
    for (const field of ["title", "description", "url", "relatedTo"] as const) {
      if (!ownedFields.includes(field) && (draft[field] ?? "") === (editing[field] ?? "")) Object.assign(refreshed, { [field]: liveTask[field] });
    }
    setEditing(liveTask); setDraft(refreshed);
  }

  if (editing && draft && !offline && ((tasksResolved && !liveTask) || (calendarsResolved && !sourceCalendars.some(calendar => calendar.id === editing.calendarID))) && removedTaskID !== editing.id) {
    const retired = { ...draft };
    for (const field of ["title", "description", "url", "relatedTo"] as const) {
      if (!ownedFields.includes(field) && (draft[field] ?? "") === (editing[field] ?? "")) Object.assign(retired, { [field]: field === "title" ? "" : null });
    }
    setDraft(retired);
    setRemovedTaskID(editing.id);
    setError("This task is no longer available from its source. Your own changes are still here.");
  }

  function resetEditor() {
    setDraft(undefined);
    setEditing(undefined);
    setOwnedFields([]);
    setRemovedTaskID(undefined);
    setError("");
    onCreateRequestHandled();
  }

  function closeEditor() {
    if (!busy) resetEditor();
  }

  function openCreate() {
    if (!firstEditableCalendarID || offline || busy) return;
    setEditing(undefined);
    setOwnedFields([]);
    setRemovedTaskID(undefined);
    setDraft(emptyDraft(firstEditableCalendarID));
    setError("");
  }

  function openEdit(task: Task) {
    if (!editableCalendarIds.has(task.calendarID)) return;
    setEditing(task);
    setOwnedFields([]);
    setRemovedTaskID(undefined);
    setDraft({ ...taskUpdate(task), id: task.id });
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draft.title.trim() || busy || removedTaskID === editing?.id && !!editing) return;
    setBusy(true);
    setError("");
    try {
      const input = { ...draft, title: draft.title.trim() };
      if (editing) await onUpdate(editing.id, input);
      else await onCreate({ ...input, id: crypto.randomUUID() });
      resetEditor();
    } catch {
      setError(
        editing
          ? "This task could not be saved. Your changes are still here — try again."
          : "This task could not be created. Your details are still here — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      await onRemove(editing);
      resetEditor();
    } catch {
      setError("This task could not be deleted. It is still here — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleComplete(task: Task, checked: boolean) {
    if (!editableCalendarIds.has(task.calendarID)) return;
    try {
      await onUpdate(task.id, {
        ...taskUpdate(task),
        completedAt: checked ? new Date() : null,
        percentComplete: checked ? 100 : 0,
        status: checked ? "completed" : "needs-action",
      });
    } catch {
      // The checkbox has already returned to its server-derived value. Open the
      // task so the failure is visible and its unchanged draft can be retried.
      setEditing(task);
      setDraft({ ...taskUpdate(task), id: task.id });
      setError(
        "This task could not be updated. It is still unchanged — try again.",
      );
    }
  }

  return (
    <section aria-label="Tasks" className={styles.tasks}>
      {tasks.length === 0 ? (
        <Empty
          action={!offline && firstEditableCalendarID ? <Button icon={<Plus size={16} />} onClick={openCreate}>Create task</Button> : undefined}
          description={
            offline
              ? "Reconnect to refresh the tasks saved on this device."
              : firstEditableCalendarID
                ? "Add a task for one of the calendars on this Page."
                : "Tasks from the calendars on this Page will appear here."
          }
          headingLevel={2}
          title={offline ? "No saved tasks" : "No tasks yet"}
        />
      ) : (
        <>
          <TaskGroup
            calendarById={calendarById}
            editableCalendarIds={editableCalendarIds}
            label="Open"
            onEdit={openEdit}
            onToggle={toggleComplete}
            timeFormat={settings.timeFormat}
            tasks={active}
          />
          {completed.length ? (
            <TaskGroup
              calendarById={calendarById}
              editableCalendarIds={editableCalendarIds}
              label="Completed"
              onEdit={openEdit}
              onToggle={toggleComplete}
              timeFormat={settings.timeFormat}
              tasks={completed}
            />
          ) : null}
        </>
      )}
      {draft ? (
        <TaskEditor
          busy={busy}
          unavailable={Boolean(editing && removedTaskID === editing.id)}
          calendars={calendars}
          draft={draft}
          editableCalendarIds={editableCalendarIds}
          editing={editing}
          error={error}
          initialFocus={titleRef}
          settings={settings}
          onChange={next => {
            if (draft) setOwnedFields(previous => [...new Set([...previous, ...["title", "description", "url", "relatedTo"].filter(field => next[field as keyof Draft] !== draft[field as keyof Draft])])]);
            setDraft(next);
          }}
          onDelete={editing && removedTaskID !== editing.id ? remove : undefined}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
          onSubmit={submit}
        />
      ) : null}
    </section>
  );
}

function TaskGroup({
  calendarById,
  editableCalendarIds,
  label,
  onEdit,
  onToggle,
  timeFormat,
  tasks,
}: {
  calendarById: Map<string, Calendar>;
  editableCalendarIds: ReadonlySet<string>;
  label: string;
  onEdit: (task: Task) => void;
  onToggle: (task: Task, checked: boolean) => Promise<void>;
  timeFormat: Settings["timeFormat"];
  tasks: Task[];
}) {
  if (!tasks.length) return null;
  return (
    <section className={styles.group}>
      <SectionLabel className={styles.groupHeading}>
        {label}<span>{tasks.length}</span>
      </SectionLabel>
      <ul>
        {tasks.map((task) => {
          const calendar = calendarById.get(task.calendarID);
          const complete = task.status === "completed";
          const editable = editableCalendarIds.has(task.calendarID);
          const due = task.due?.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            ...(!task.isAllDay ? {
              hour: "numeric" as const,
              minute: "2-digit" as const,
              hour12: timeFormat === "12h",
            } : {}),
          });
          const status = task.status === "in-process"
            ? "In progress"
            : task.status === "cancelled" ? "Cancelled" : undefined;
          const detail = [
            calendar?.name ?? "Unknown calendar",
            status,
            due ? `Due ${due}` : undefined,
            !editable ? "Read only" : undefined,
          ].filter(Boolean).join(" · ");
          const title = (
            <span className={complete ? styles.done : undefined}>{task.title}</span>
          );
          return (
            <li className={styles.task} key={task.id}>
              <div className={styles.taskCheck}>
                <Checkbox
                  checked={complete}
                  disabled={!editable}
                  label={`Mark ${task.title} ${complete ? "open" : "completed"}`}
                  labelHidden
                  onChange={(event) => void onToggle(task, event.target.checked)}
                />
              </div>
              {editable ? (
                <RowAction
                  className={styles.taskMain}
                  detail={detail}
                  label={title}
                  showChevron={false}
                  onClick={() => onEdit(task)}
                />
              ) : (
                <Row className={styles.taskMain} detail={detail} label={title} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TaskEditor({
  busy,
  unavailable,
  calendars,
  draft,
  editableCalendarIds,
  editing,
  error,
  initialFocus,
  settings,
  onChange,
  onDelete,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  unavailable: boolean;
  calendars: Calendar[];
  draft: Draft;
  editableCalendarIds: ReadonlySet<string>;
  editing?: Task;
  error: string;
  initialFocus: React.RefObject<HTMLInputElement | null>;
  settings: Pick<Settings, "timeFormat" | "weekStartsOn">;
  onChange: (draft: Draft) => void;
  onDelete?: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  const calendarOptions = calendars
    .filter((calendar) => editableCalendarIds.has(calendar.id))
    .map((calendar) => ({ label: calendar.name, value: calendar.id, icon: <AccountMark size="compact" flavor={providerFlavor(calendar)} /> }));
  const updateDate = (key: "start" | "due", value: string) =>
    onChange({
      ...draft,
      [key]: value ? replaceTaskDate(draft[key], value) : null,
    });
  const updateTime = (key: "start" | "due", value: string) =>
    onChange({
      ...draft,
      [key]: value ? replaceTaskTime(draft[key], value) : null,
    });

  return (
    <Dialog
      closeLabel="Close task editor"
      footer={
        <>
          {onDelete ? (
            <Button
              className={styles.deleteTask}
              disabled={busy}
              icon={<Trash2 aria-hidden="true" size={16} />}
              variant="ghost"
              onClick={() => void onDelete()}
            >
              Delete
            </Button>
          ) : null}
          <Button
            disabled={busy || !draft.title.trim() || unavailable}
            form="task-editor"
            loading={busy}
            type="submit"
          >
            Save task
          </Button>
        </>
      }
      initialFocus={initialFocus}
      open
      size="wide"
      title={editing ? "Edit task" : "New task"}
      onOpenChange={onOpenChange}
    >
      <form
        className={styles.editor}
        id="task-editor"
        onSubmit={(event) => void onSubmit(event)}
      >
        <Field label="Title">
          <input
            ref={initialFocus}
            value={draft.title}
            onChange={(event) =>
              onChange({ ...draft, title: event.target.value })
            }
          />
        </Field>
        <Field label="Calendar">
            <Select
              disabled={Boolean(editing)}
              label="Calendar"
              options={calendarOptions}
              value={draft.calendarID}
              onChange={(calendarID) => onChange({ ...draft, calendarID })}
            />
        </Field>
        <div className={styles.fields}>
          <Field label="Status">
            <Select
              label="Status"
              options={[
                { label: "Needs action", value: "needs-action" },
                { label: "In progress", value: "in-process" },
                { label: "Completed", value: "completed" },
                { label: "Cancelled", value: "cancelled" },
              ]}
              value={draft.status}
              onChange={(status) =>
                onChange({
                  ...draft,
                  completedAt: status === "completed" ? new Date() : null,
                  percentComplete:
                    status === "completed" ? 100 : draft.percentComplete,
                  status: status as Draft["status"],
                })
              }
            />
          </Field>
          <Field label="Priority">
            <Select
              label="Priority"
              options={Array.from({ length: 10 }, (_, priority) => ({
                label: priority === 0 ? "None" : `${priority <= 4 ? "High" : priority === 5 ? "Medium" : "Low"} (${priority})`,
                value: String(priority),
              }))}
              value={String(draft.priority)}
              onChange={(value) =>
                onChange({ ...draft, priority: Number(value) })
              }
            />
          </Field>
        </div>
        <div className={styles.scheduleFields}>
          {(["start", "due"] as const).map(endpoint => {
            const label = endpoint === "start" ? "Start" : "Due";
            return <div className={styles.dateTimeRow} data-all-day={draft.isAllDay || undefined} key={endpoint}>
              <Field label={`${label} date`}>
                <DatePicker
                  label={`${label} date`}
                  value={taskDateKey(draft[endpoint])}
                  weekStartsOn={settings.weekStartsOn}
                  onChange={value => updateDate(endpoint, value)}
                  onClear={() => updateDate(endpoint, "")}
                />
              </Field>
              {!draft.isAllDay ? <Field label={`${label} time`}>
                <TimePicker
                  label={`${label} time`}
                  placeholder="Select time"
                  timeFormat={settings.timeFormat}
                  value={taskTime(draft[endpoint])}
                  onChange={value => updateTime(endpoint, value)}
                />
              </Field> : null}
            </div>;
          })}
        </div>
        <Checkbox
          checked={draft.isAllDay}
          label="All day"
          onChange={(event) =>
            onChange({ ...draft, isAllDay: event.target.checked })
          }
        />
        <Field label="Notes">
          <textarea
            rows={4}
            value={draft.description ?? ""}
            onChange={(event) =>
              onChange({ ...draft, description: event.target.value || null })
            }
          />
        </Field>
        <Disclosure
          density="compact"
          icon={<Repeat2 aria-hidden="true" size={16} />}
          label="Recurrence"
          detail={taskRecurrenceSummary(draft.recurrence, draft.start)}
        >
          <Field label="Recurrence rule" help="Uses iCalendar recurrence syntax.">
            <textarea
              placeholder="RRULE:FREQ=WEEKLY"
              rows={2}
              spellCheck={false}
              value={draft.recurrence ?? ""}
              onChange={(event) =>
                onChange({ ...draft, recurrence: event.target.value || null })
              }
            />
          </Field>
        </Disclosure>
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Dialog>
  );
}
