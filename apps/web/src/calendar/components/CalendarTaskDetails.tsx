import { AccountMark } from "./ProviderIcon";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { createContext, useContext, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import { can, providerFlavor, type Calendar, type Settings, type Task, type TaskUpdate } from "@musubi/types";
import { CalendarDays, Clock3, FileText, Flag, X, Pencil, Trash2, Repeat2, Link, GitBranch } from "lucide-react";
import { Inspector, InspectorContent, InspectorTrigger } from "~/ui/Inspector";
import { Button, IconButton } from "~/ui/Button";
import { ConfirmationDialog } from "~/ui/ConfirmationDialog";
import { SectionLabel } from "~/ui/SectionLabel";
import { Row } from "~/ui/Row";
import { Select } from "~/ui/Select";
import { InlineError } from "~/ui/InlineError";
import { TaskList, taskUpdate, taskRecurrenceSummary, TASK_STATUSES, TASK_PRIORITIES } from "./TaskList";
import { formatTaskDate } from "../task-format";
import styles from "./styles/event-details.module.css";

export const CalendarTaskContext = createContext<{
  tasks: Task[]; calendars: Calendar[]; settings: Settings; offline: boolean;
  update?: (id: string, task: TaskUpdate) => Promise<Task>;
  remove?: (task: Task) => Promise<void>;
} | null>(null);

export function CalendarTaskDetails({ taskId, children }: { taskId: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  return <TaskDetails key={taskId} taskId={taskId} open={open} onOpenChange={setOpen}>{children}</TaskDetails>;
}

/** The same task inspector is used by calendar chips, search, list and kanban. */
export function TaskDetails({ taskId, open, onOpenChange, children, returnFocus: requestedReturnFocus }: {
  taskId: string; open: boolean; onOpenChange: (open: boolean) => void; children?: ReactElement; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const context = useContext(CalendarTaskContext);
  const [returnFocus] = useState(() => typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null);
  const [relatedId, setRelatedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const task = context?.tasks.find(task => task.id === (relatedId ?? taskId));
  const calendar = context?.calendars.find(calendar => calendar.id === task?.calendarID);
  const related = context?.tasks.find(item => item.id === task?.relatedTo);
  const editableCalendarIds = new Set(context?.calendars.filter(item => can(item.role, "editTasks") && item.supportsTasks !== false).map(item => item.id));
  const editable = !!context?.update && !context.offline && !!calendar && editableCalendarIds.has(calendar.id);
  const format = (date: Date, allDay = task?.isAllDay ?? false) => formatTaskDate(date, allDay, context!.settings);
  async function update(patch: Partial<Pick<TaskUpdate, "status" | "priority">>) {
    if (!task || !editable || busy) return;
    setBusy(true); setError("");
    try {
      await context!.update!(task.id, { ...taskUpdate(task), ...patch,
        ...(patch.status ? {
          percentComplete: patch.status === "completed" ? 100 : task.status === "completed" ? 0 : task.percentComplete,
          completedAt: patch.status === "completed" ? task.completedAt ?? new Date() : null,
        } : {}) });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update task."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!task || !editable || !context?.remove || busy) return;
    setBusy(true); setError("");
    try { await context.remove(task); setConfirmDelete(false); onOpenChange(false); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not delete task."); setConfirmDelete(false); }
    finally { setBusy(false); }
  }
  return <>
    {!editing ? <Inspector open={open} onOpenChange={onOpenChange} onRequestClose={after => { if (!busy && !editing && !confirmDelete) { onOpenChange(false); after(); } }}>
      {children ? <InspectorTrigger asChild>{children}</InspectorTrigger> : null}
      <InspectorContent accessibleTitle={task?.title ?? "Task"} className={styles.detailPopover} style={{ "--event-accent": calendar?.color } as CSSProperties}
        onCloseAutoFocus={event => { const target = requestedReturnFocus?.current ?? returnFocus; if (!children && target?.isConnected) { event.preventDefault(); target.focus(); } }}
        onFocusOutside={event => event.preventDefault()}>
        <header className={styles.detailsHeader}>
          <div className={styles.titleBlock}><h2>{task?.status === "completed" ? <s>{task.title}</s> : task?.title ?? "Task"}</h2>
            {calendar ? <ul aria-label="Calendars" className={styles.calendarPills}>
              <li className={styles.calendarPill} data-home="" aria-label={`${calendar.name} · Home calendar`}>
                <AccountMark flavor={providerFlavor(calendar)} size="compact" color={calendar.color} />
                {calendar.name}
              </li>
            </ul> : null}
          </div>
          <IconButton label="Close task" disabled={busy || editing || confirmDelete} onClick={() => onOpenChange(false)}><X size={18} /></IconButton>
        </header>
        <div className={styles.detailsBody}>
          {!task || !calendar ? <p>This task is no longer available.</p> : <>
            <div className={styles.infoList}>
              <Row icon={<TaskStatusIcon status={task.status} size={17} />} label="Status" trailing={
                <Select label="Task status" value={task.status} options={TASK_STATUSES} disabled={!editable || busy}
                  onChange={value => { void update({ status: value as Task["status"] }); }} />} />
              {task.start ? <Row icon={<Clock3 size={17} />} label="Starts" value={format(task.start)} /> : null}
              {task.due ? <Row icon={<CalendarDays size={17} />} label="Deadline" value={format(task.due)} /> : null}
              {task.completedAt ? <Row icon={<TaskStatusIcon status="completed" size={17} />} label="Completed" value={format(task.completedAt, false)} /> : null}
              <Row icon={<Flag size={17} />} label="Priority" trailing={
                <Select label="Task priority" value={String(task.priority)} options={TASK_PRIORITIES} disabled={!editable || busy}
                  onChange={value => { void update({ priority: Number(value) }); }} />} />
              {task.recurrence ? <Row icon={<Repeat2 size={17} />} label="Repeat" value={taskRecurrenceSummary(task.recurrence, task.start ?? task.due)} /> : null}
              {task.relatedTo ? <Row icon={<GitBranch size={17} />} label="Related task" trailing={related ? <Button variant="ghost" disabled={busy} onClick={() => setRelatedId(related.id)}>{related.title || "Untitled task"}</Button> : undefined} value={!related ? "Task unavailable" : undefined} /> : null}
              {task.url ? <Row icon={<Link size={17} />} label="Link" value={/^https?:\/\//i.test(task.url) ? <a href={task.url} target="_blank" rel="noreferrer">{task.url}</a> : task.url} /> : null}
            </div>
            {task.description ? <section className={styles.notes} aria-label="Notes">
              <SectionLabel className={styles.sectionHeading}><FileText size={17} />Notes</SectionLabel><p>{task.description}</p>
            </section> : null}
          </>}
          {error ? <InlineError>{error}</InlineError> : null}
        </div>
        {editable && task ? <footer aria-label="Task actions" className={styles.detailActions}>
          <Button disabled={busy} icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>
          {context?.remove ? <Button disabled={busy} variant="secondary" className={styles.deleteAction} icon={<Trash2 size={16} />} onClick={() => setConfirmDelete(true)}>Delete</Button> : null}
        </footer> : null}
      </InspectorContent>
    </Inspector> : null}
    {editing && task && context?.update ? <TaskList key={task.id} editorOnly initialEditTask={task} onEditorClose={() => setEditing(false)}
      calendars={context.calendars} sourceCalendars={context.calendars} tasks={context.tasks} sourceTasks={context.tasks} calendarsResolved tasksResolved
      settings={context.settings} editableCalendarIds={editableCalendarIds} offline={context.offline} createRequest={0} onCreateRequestHandled={() => {}}
      onCreate={async () => { throw new Error("Use the new task form to create tasks."); }} onUpdate={context.update}
      onRemove={async value => { if (!context.remove) throw new Error("Task cannot be deleted."); await context.remove(value); onOpenChange(false); }} /> : null}
    <ConfirmationDialog open={confirmDelete} onOpenChange={value => { if (!busy) setConfirmDelete(value); }} title="Delete task?" description="This task will be permanently deleted." closeLabel="Close delete task confirmation" confirmLabel="Delete task" loading={busy} onConfirm={() => void remove()}>{task?.title}</ConfirmationDialog>
  </>;
}
