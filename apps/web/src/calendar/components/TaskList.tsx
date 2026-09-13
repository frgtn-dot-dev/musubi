import { CalendarDays, GripVertical, Circle, CircleCheck, CircleDashed, CircleX, Flag, FlagOff, Plus, Repeat2, Trash2 } from "lucide-react";
import {
  describeAdvanced,
  isEditableRRule,
  parseAdvanced,
  splitRecurrence,
} from "@musubi/calendar/rrule-editor";
import { Fragment, useLayoutEffect, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { Button, IconButton } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { DatePicker } from "~/ui/DatePicker";
import { Dialog } from "~/ui/Dialog";
import { Disclosure } from "~/ui/Disclosure";
import { Empty } from "~/ui/Empty";
import { Field } from "~/ui/Field";
import { InlineError } from "~/ui/InlineError";
import { Select } from "~/ui/Select";
import { Row, RowAction } from "~/ui/Row";
import { useKanbanDrag } from "../use-kanban-drag";
import { TaskLayoutSwitch } from "./TaskLayoutSwitch";
import { SectionLabel } from "~/ui/SectionLabel";
import { TimePicker } from "~/ui/TimePicker";
import { AccountMark } from "./ProviderIcon";
import { RecurrenceEditor } from "./RecurrenceEditor";
import styles from "./TaskList.module.css";

type TaskListProps = {
  showLayoutControl?: boolean;
  layout?: "list" | "kanban";
  onLayoutChange?: (layout: "list" | "kanban") => void;
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

export const TASK_STATUSES = [
  { label: "Needs action", value: "needs-action", icon: <Circle size={16} /> },
  { label: "In progress", value: "in-process", icon: <CircleDashed size={16} /> },
  { label: "Completed", value: "completed", icon: <CircleCheck size={16} /> },
  { label: "Cancelled", value: "cancelled", icon: <CircleX size={16} /> },
];
const TASK_PRIORITIES = Array.from({ length: 10 }, (_, priority) => ({
  label: priority === 0 ? "No priority" : `${priority <= 4 ? "High" : priority === 5 ? "Medium" : "Low"} (${priority})`,
  value: String(priority),
  icon: priority === 0 ? <FlagOff size={16} /> : <Flag size={16} fill={priority <= 4 ? "currentColor" : "none"} />,
}));

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
  showLayoutControl = true,
  layout: controlledLayout,
  onLayoutChange,
  calendars,
  createRequest,
  editableCalendarIds,
  offline,
  onCreateRequestHandled,
  onCreate,
  onRemove,
  onUpdate,
  settings,
  tasks: serverTasks,
  sourceTasks = serverTasks,
  sourceCalendars = calendars,
  calendarsResolved = false,
  tasksResolved = false,
}: TaskListProps) {
  const [optimisticTask, setOptimisticTask] = useState<Task>();
  const tasks = useMemo(() => optimisticTask ? serverTasks.map(task => task.id === optimisticTask.id ? { ...task, status: optimisticTask.status, priority: optimisticTask.priority, completedAt: optimisticTask.completedAt, percentComplete: optimisticTask.percentComplete } : task) : serverTasks, [serverTasks, optimisticTask]);
  const [localLayout, setLocalLayout] = useState<"list" | "kanban">("list");
  const layout = controlledLayout ?? localLayout;
  const drag = useKanbanDrag(async (task, status) => {
    const current = tasks.find(item => item.id === task.id);
    return current ? updateInline(current, { status }) : false;
  });
  const boardRef = useRef<HTMLDivElement>(null);
  const previousPositions = useRef(new Map<string, { left: number; top: number }>());
  const cardOrder = tasks.map(task => `${task.id}:${task.status}`).join("|");
  useLayoutEffect(() => {
    const next = new Map<string, { left: number; top: number }>();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const boardRect = boardRef.current?.getBoundingClientRect();
    boardRef.current?.querySelectorAll<HTMLElement>("[data-task-id]").forEach(card => {
      const id = card.dataset.taskId!;
      card.getAnimations?.().forEach(animation => animation.cancel());
      const bounds = card.getBoundingClientRect();
      const rect = { left: bounds.left - (boardRect?.left ?? 0), top: bounds.top - (boardRect?.top ?? 0) };
      const previous = previousPositions.current.get(id);
      next.set(id, rect);
      if (previous && id !== drag.draggingId && !reduced && card.animate) {
        const x = previous.left - rect.left, y = previous.top - rect.top;
        if (x || y) card.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    previousPositions.current = next;
  }, [cardOrder, layout, drag.draggingId, drag.targetStatus]);
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
  const [inlineBusy, setInlineBusy] = useState(false);
  const inlineLock = useRef(false);
  const inlineControls = useRef(new Map<string, HTMLButtonElement>());
  const restoreInlineFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (inlineBusy || !restoreInlineFocus.current) return;
    const control = inlineControls.current.get(restoreInlineFocus.current);
    if (control && document.activeElement === document.body) control.focus();
    restoreInlineFocus.current = undefined;
  }, [inlineBusy, tasks]);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const calendarById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );


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

  function openCreate(status: Task["status"] = "needs-action") {
    if (!firstEditableCalendarID || offline || busy) return;
    setEditing(undefined);
    setOwnedFields([]);
    setRemovedTaskID(undefined);
    setDraft({ ...emptyDraft(firstEditableCalendarID), status, completedAt: status === "completed" ? new Date() : null, percentComplete: status === "completed" ? 100 : 0 });
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

  async function updateInline(task: Task, patch: Partial<Pick<TaskUpdate, "status" | "priority">>) {
    if (!editableCalendarIds.has(task.calendarID) || offline || inlineLock.current || busy) return false;
    restoreInlineFocus.current = `${task.id}:${patch.status ? "status" : "priority"}`;
    inlineLock.current = true;
    setInlineBusy(true);
    const input = {
        ...taskUpdate(task),
        ...patch,
        ...(patch.status ? {
          completedAt: patch.status === "completed" ? task.completedAt ?? new Date() : null,
          percentComplete: patch.status === "completed" ? 100 : task.status === "completed" ? 0 : task.percentComplete,
        } : {}),
      };
    setOptimisticTask({ ...task, ...input });
    try {
      await onUpdate(task.id, input);
      return true;
    } catch {
      openEdit(task);
      setError("This task could not be updated. It is still unchanged — try again.");
      return false;
    } finally {
      setOptimisticTask(undefined);
      inlineLock.current = false;
      setInlineBusy(false);
    }
  }

  return (
    <section aria-label="Tasks" className={styles.tasks} data-layout={layout} data-kanban-scroll>
      {showLayoutControl ? <div className={styles.viewControls}>
        <TaskLayoutSwitch value={layout} onChange={next => { setLocalLayout(next); onLayoutChange?.(next); }} />
      </div> : null}
      <div ref={boardRef} className={layout === "kanban" ? styles.board : undefined}>
      {tasks.length === 0 && layout === "list" ? (
        <Empty
          action={!offline && firstEditableCalendarID ? <Button icon={<Plus size={16} />} onClick={() => openCreate()}>Create task</Button> : undefined}
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
        TASK_STATUSES.map(({ value, label, icon }) => (
          <TaskGroup
            key={value}
            kanban={layout === "kanban"}
            placeholderBeforeId={tasks.find((task, index) => task.status === value && index > tasks.findIndex(item => item.id === drag.draggingId))?.id}
            statusValue={value}
            dropActive={drag.targetStatus === value && !tasks.some(task => task.id === drag.draggingId && task.status === value)}
            draggingId={drag.draggingId}
            onDragTask={drag.begin}
            onCreate={!offline && firstEditableCalendarID ? () => openCreate(value as Task["status"]) : undefined}
            calendarById={calendarById}
            editableCalendarIds={editableCalendarIds}
            label={label}
            icon={icon}
            onEdit={openEdit}
            onUpdateInline={updateInline}
            busy={inlineBusy || busy}
            saving={inlineBusy}
            controls={inlineControls}
            timeFormat={settings.timeFormat}
            tasks={tasks.filter(task => task.status === value)}
          />
        ))
      )}
      </div>
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
  kanban,
  dropActive,
  onDragTask,
  draggingId,
  statusValue,
  placeholderBeforeId,
  onCreate,
  icon,
  calendarById,
  editableCalendarIds,
  label,
  onEdit,
  onUpdateInline,
  busy,
  controls,
  saving,
  timeFormat,
  tasks,
}: {
  kanban: boolean;
  dropActive: boolean;
  onDragTask: (task: Task, event: React.PointerEvent<HTMLElement>) => void;
  draggingId?: string;
  statusValue: string;
  placeholderBeforeId?: string;
  onCreate?: () => void;
  icon: ReactNode;
  calendarById: Map<string, Calendar>;
  editableCalendarIds: ReadonlySet<string>;
  label: string;
  onEdit: (task: Task) => void;
  onUpdateInline: (task: Task, patch: Partial<Pick<TaskUpdate, "status" | "priority">>) => Promise<boolean>;
  busy: boolean;
  saving: boolean;
  controls: React.RefObject<Map<string, HTMLButtonElement>>;
  timeFormat: Settings["timeFormat"];
  tasks: Task[];
}) {
  if (!tasks.length && !kanban) return null;
  const placeholder = <li key="drop-placeholder" className={styles.dropPlaceholder} data-drop-placeholder aria-hidden="true">Move to {label.toLowerCase()}</li>;
  return (
    <section
      className={kanban ? styles.column : styles.group}
      aria-label={label}
      data-drop-active={dropActive || undefined}
      data-saving={saving || undefined}
      data-kanban-status={kanban ? statusValue : undefined}
    >
      <SectionLabel className={styles.groupHeading}>
        <span aria-hidden="true">{icon}</span>{label}{" "}<span>{tasks.length}</span>
      </SectionLabel>
      {kanban && !tasks.length && !dropActive ? <p className={styles.emptyColumn}>No tasks</p> : null}
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
          const providerMark = <AccountMark size="compact" flavor={calendar ? providerFlavor(calendar) : null} color={calendar?.color} />;
          const detailText = [
            calendar?.name ?? "Unknown calendar",
            status,
            due ? `Due ${due}` : undefined,
            !editable ? "Read only" : undefined,
          ].filter(Boolean).join(" · ");
          const detail = <span className={styles.listCalendarDetail}>{providerMark}<span>{detailText}</span></span>;
          const title = (
            <span className={complete ? styles.done : undefined}>{task.title}</span>
          );
          const controlsMarkup = (
              <div className={styles.taskControls}>
                <Select
                  ref={node => { if (node) controls.current.set(`${task.id}:status`, node); else controls.current.delete(`${task.id}:status`); }}
                  label={`Status of ${task.title}`}
                  options={TASK_STATUSES}
                  size="compact"
                  value={task.status}
                  disabled={!editable || busy}
                  onChange={status => void onUpdateInline(task, { status: status as Task["status"] })}
                />
                <Select
                  ref={node => { if (node) controls.current.set(`${task.id}:priority`, node); else controls.current.delete(`${task.id}:priority`); }}
                  label={`Priority of ${task.title}`}
                  options={TASK_PRIORITIES}
                  size="compact"
                  value={String(task.priority)}
                  disabled={!editable || busy}
                  onChange={priority => void onUpdateInline(task, { priority: Number(priority) })}
                />
              </div>
          );
          if (kanban) return (
            <Fragment key={task.id}>
            {dropActive && placeholderBeforeId === task.id ? placeholder : null}
            <li className={styles.kanbanCard} key={task.id} data-task-id={task.id} data-editable={editable || undefined} data-dragging={draggingId === task.id || undefined}
              data-draggable={editable && !busy || undefined}
              onPointerDown={event => {
                if (!editable || busy || event.pointerType === "touch" || !(event.target instanceof Element)) return;
                if (event.target.closest('button, a, input, textarea, select, [role="combobox"], [contenteditable="true"]')) return;
                onDragTask(task, event);
              }}>
              <div className={styles.cardHeader}>
                <span className={styles.cardCalendar}>{providerMark}<span>{calendar?.name ?? "Unknown calendar"}</span></span>
                {editable ? <IconButton className={styles.dragHandle} label={`Drag ${task.title} to another status; or use its status selector`} size="compact" disabled={busy}
                  onPointerDown={event => onDragTask(task, event)}
                  onClick={event => { if (event.detail === 0) controls.current.get(`${task.id}:status`)?.focus(); }}><GripVertical size={16} /></IconButton> : <span>Read only</span>}
              </div>
              {editable ? <Button variant="ghost" className={styles.cardTitle} disabled={busy} onClick={() => onEdit(task)}>{title}</Button> : <p className={styles.cardTitle}>{title}</p>}
              {task.description ? <p className={styles.cardDescription}>{task.description}</p> : null}
              <div className={styles.cardMeta}>
                {due ? <span><CalendarDays size={14} aria-hidden="true" />{due}</span> : <span>No due date</span>}
                {task.recurrence ? <span title={taskRecurrenceSummary(task.recurrence, task.start)}><Repeat2 size={14} aria-hidden="true" />Repeats</span> : null}
              </div>
              {controlsMarkup}
            </li>
            </Fragment>
          );
          return (
            <li className={styles.task} key={task.id}>
              {controlsMarkup}
              {editable ? (
                <RowAction
                  className={styles.taskMain}
                  detail={detail}
                  label={title}
                  showChevron={false}
                  disabled={busy}
                  onClick={() => onEdit(task)}
                />
              ) : (
                <Row className={styles.taskMain} detail={detail} label={title} />
              )}
            </li>
          );
        })}
        {kanban && dropActive && !placeholderBeforeId ? placeholder : null}
      </ul>
      {kanban && onCreate ? <Button variant="ghost" disabled={busy} icon={<Plus size={16} />} onClick={onCreate}>Add task</Button> : null}
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
              options={TASK_STATUSES}
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
              options={TASK_PRIORITIES}
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
          {!draft.start && !draft.due ? <p>Choose a start or due date to set repetition.</p> : null}
          <RecurrenceEditor
            followStartDate={false}
            date={taskDateKey(draft.start) || taskDateKey(draft.due) || toDateKey(new Date())}
            allDay={draft.isAllDay}
            weekStartsOn={settings.weekStartsOn}
            disabled={busy || unavailable || (!draft.start && !draft.due)}
            value={draft.recurrence ?? ""}
            onChange={(recurrence) => onChange({
              ...draft,
              recurrence: recurrence || null,
            })}
          />
          <Disclosure density="compact" label="Advanced rule">
          <Field label="Recurrence rule" help="Uses iCalendar recurrence syntax.">
            <textarea
              disabled={busy || unavailable}
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
        </Disclosure>
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Dialog>
  );
}
