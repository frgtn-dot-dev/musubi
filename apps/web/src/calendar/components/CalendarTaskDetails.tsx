import { AccountMark } from "./ProviderIcon";
import { CalendarDot } from "./CalendarDot";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { createContext, useContext, useState, type CSSProperties, type ReactElement } from "react";
import { can, providerFlavor, type Calendar, type Settings, type Task, type TaskUpdate } from "@musubi/types";
import { CalendarDays, Clock3, FileText, Flag, X } from "lucide-react";
import { Inspector, InspectorContent, InspectorTrigger } from "~/ui/Inspector";
import { IconButton } from "~/ui/Button";
import { Row } from "~/ui/Row";
import { Select } from "~/ui/Select";
import { InlineError } from "~/ui/InlineError";
import { taskUpdate, TASK_STATUSES } from "./TaskList";
import styles from "./styles/event-details.module.css";

export const CalendarTaskContext = createContext<{
  tasks: Task[]; calendars: Calendar[]; settings: Settings; offline: boolean;
  update?: (id: string, task: TaskUpdate) => Promise<Task>;
} | null>(null);

export function CalendarTaskDetails({ taskId, children }: { taskId: string; children: ReactElement }) {
  const context = useContext(CalendarTaskContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = context?.tasks.find(task => task.id === taskId);
  const calendar = context?.calendars.find(calendar => calendar.id === task?.calendarID);
  const editable = !!context?.update && !context.offline && can(calendar?.role, "editTasks") && calendar?.supportsTasks !== false;
  const format = (date: Date) => new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
    ...(task?.isAllDay ? { timeZone: "UTC" } : { hour: "numeric", minute: "2-digit", hour12: context?.settings.timeFormat === "12h" }),
  }).format(date);
  async function update(status: Task["status"]) {
    if (!task || !editable || busy) return;
    setBusy(true); setError("");
    try {
      await context!.update!(task.id, { ...taskUpdate(task), status, percentComplete: status === "completed" ? 100 : 0, completedAt: status === "completed" ? new Date() : null });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update task."); }
    finally { setBusy(false); }
  }
  return <Inspector open={open} onOpenChange={setOpen} onRequestClose={after => { if (!busy) { setOpen(false); after(); } }}>
    <InspectorTrigger asChild>{children}</InspectorTrigger>
    <InspectorContent accessibleTitle={task?.title ?? "Task"} className={styles.detailPopover} style={{ "--event-accent": calendar?.color } as CSSProperties}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <header className={styles.detailsHeader}>
        <div className={styles.titleBlock}><h2>{task?.status === "completed" ? <s>{task.title}</s> : task?.title ?? "Task"}</h2>
          {calendar ? <ul aria-label="Calendars" className={styles.calendarPills}>
            <li className={styles.calendarPill} data-home="" aria-label={`${calendar.name} · Home calendar`}>
              {calendar.provider ? <AccountMark flavor={providerFlavor(calendar)} size="compact" color={calendar.color} /> : <CalendarDot color={calendar.color} />}
              {calendar.name}
            </li>
          </ul> : null}
        </div>
        <IconButton label="Close task" disabled={busy} onClick={() => setOpen(false)}><X size={18} /></IconButton>
      </header>
      <div className={styles.detailsBody}>
      {!task || !calendar ? <p>This task is no longer available.</p> : <div className={styles.infoList}>
        <Row icon={<TaskStatusIcon status={task.status} size={17} />} label="Status" trailing={
          <Select label="Task status" value={task.status} options={TASK_STATUSES} disabled={!editable || busy}
            onChange={value => { void update(value as Task["status"]); }} />} />
        {task.start ? <Row icon={<Clock3 size={17} />} label="Starts" value={format(task.start)} /> : null}
        {task.due ? <Row icon={<CalendarDays size={17} />} label="Deadline" value={format(task.due)} /> : null}
        <Row icon={<Flag size={17} />} label="Priority" value={task.priority === 0 ? "No priority" : `${task.priority <= 4 ? "High" : task.priority === 5 ? "Medium" : "Low"} (${task.priority})`} />
        {task.description ? <Row icon={<FileText size={17} />} label="Notes" detail={task.description} /> : null}
      </div>}
      {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </InspectorContent>
  </Inspector>;
}
