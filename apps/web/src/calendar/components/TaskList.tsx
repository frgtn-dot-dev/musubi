import { Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
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
import { Empty } from "~/ui/Empty";
import { Field } from "~/ui/Field";
import { InlineError } from "~/ui/InlineError";
import { Select } from "~/ui/Select";
import { TimePicker } from "~/ui/TimePicker";
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
};

type Draft = Omit<TaskCreate, "id"> & { id?: string };

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
      setEditing(undefined);
      setDraft(emptyDraft(firstEditableCalendarID));
      setError("");
    }
  }

  function resetEditor() {
    setDraft(undefined);
    setEditing(undefined);
    setError("");
    onCreateRequestHandled();
  }

  function closeEditor() {
    if (!busy) resetEditor();
  }

  function openEdit(task: Task) {
    if (!editableCalendarIds.has(task.calendarID)) return;
    setEditing(task);
    setDraft({ ...taskUpdate(task), id: task.id });
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draft.title.trim() || busy) return;
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
          description={
            offline
              ? "Reconnect to refresh the tasks saved on this device."
              : "Add a task for one of the calendars on this Page."
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
            tasks={active}
          />
          {completed.length ? (
            <TaskGroup
              calendarById={calendarById}
              editableCalendarIds={editableCalendarIds}
              label="Completed"
              onEdit={openEdit}
              onToggle={toggleComplete}
              tasks={completed}
            />
          ) : null}
        </>
      )}
      {draft ? (
        <TaskEditor
          busy={busy}
          calendars={calendars}
          draft={draft}
          editableCalendarIds={editableCalendarIds}
          editing={editing}
          error={error}
          initialFocus={titleRef}
          settings={settings}
          onChange={setDraft}
          onDelete={editing ? remove : undefined}
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
  tasks,
}: {
  calendarById: Map<string, Calendar>;
  editableCalendarIds: ReadonlySet<string>;
  label: string;
  onEdit: (task: Task) => void;
  onToggle: (task: Task, checked: boolean) => Promise<void>;
  tasks: Task[];
}) {
  if (!tasks.length) return null;
  return (
    <section className={styles.group}>
      <h2>{label}</h2>
      <ul>
        {tasks.map((task) => {
          const calendar = calendarById.get(task.calendarID);
          const complete = task.status === "completed";
          const editable = editableCalendarIds.has(task.calendarID);
          const detail = `${calendar?.name ?? "Unknown calendar"}${
            task.due ? ` · Due ${task.due.toLocaleDateString()}` : ""
          }`;
          return (
            <li className={styles.task} key={task.id}>
              <Checkbox
                checked={complete}
                disabled={!editable}
                label={`Mark ${task.title} ${complete ? "open" : "completed"}`}
                labelHidden
                onChange={(event) => void onToggle(task, event.target.checked)}
              />
              {editable ? (
                <button
                  className={styles.taskMain}
                  type="button"
                  onClick={() => onEdit(task)}
                >
                  <span className={complete ? styles.done : undefined}>
                    {task.title}
                  </span>
                  <small>{detail}</small>
                </button>
              ) : (
                <div className={styles.taskMain}>
                  <span className={complete ? styles.done : undefined}>
                    {task.title}
                  </span>
                  <small>{detail}</small>
                </div>
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
    .map((calendar) => ({ label: calendar.name, value: calendar.id }));
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
              disabled={busy}
              icon={<Trash2 aria-hidden="true" size={16} />}
              variant="destructive"
              onClick={() => void onDelete()}
            >
              Delete
            </Button>
          ) : null}
          <Button
            disabled={busy || !draft.title.trim()}
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
        <div className={styles.fields}>
          <Field label="Calendar">
            <Select
              disabled={Boolean(editing)}
              label="Calendar"
              options={calendarOptions}
              value={draft.calendarID}
              onChange={(calendarID) => onChange({ ...draft, calendarID })}
            />
          </Field>
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
                label: priority === 0 ? "None" : String(priority),
                value: String(priority),
              }))}
              value={String(draft.priority)}
              onChange={(value) =>
                onChange({ ...draft, priority: Number(value) })
              }
            />
          </Field>
        </div>
        <div className={styles.fields}>
          <Field label="Start date">
            <DatePicker
              label="Start date"
              value={taskDateKey(draft.start)}
              weekStartsOn={settings.weekStartsOn}
              onChange={(value) => updateDate("start", value)}
              onClear={() => updateDate("start", "")}
            />
          </Field>
          <Field label="Due date">
            <DatePicker
              label="Due date"
              value={taskDateKey(draft.due)}
              weekStartsOn={settings.weekStartsOn}
              onChange={(value) => updateDate("due", value)}
              onClear={() => updateDate("due", "")}
            />
          </Field>
          {draft.isAllDay ? null : (
            <Field label="Start time">
              <TimePicker
                label="Start time"
                placeholder="Select time"
                timeFormat={settings.timeFormat}
                value={taskTime(draft.start)}
                onChange={(value) => updateTime("start", value)}
              />
            </Field>
          )}
        </div>
        {!draft.isAllDay ? (
          <Field label="Due time">
            <TimePicker
              label="Due time"
              placeholder="Select time"
              timeFormat={settings.timeFormat}
              value={taskTime(draft.due)}
              onChange={(value) => updateTime("due", value)}
            />
          </Field>
        ) : null}
        <Checkbox
          checked={draft.isAllDay}
          label="All day"
          onChange={(event) =>
            onChange({ ...draft, isAllDay: event.target.checked })
          }
        />
        <Field label="Notes">
          <textarea
            value={draft.description ?? ""}
            onChange={(event) =>
              onChange({ ...draft, description: event.target.value || null })
            }
          />
        </Field>
        <Field label="Recurrence">
          <input
            placeholder="RRULE:FREQ=WEEKLY"
            value={draft.recurrence ?? ""}
            onChange={(event) =>
              onChange({ ...draft, recurrence: event.target.value || null })
            }
          />
        </Field>
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Dialog>
  );
}
