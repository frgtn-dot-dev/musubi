import { Columns3, List } from "lucide-react";
import { Segmented } from "~/ui/Segmented";
import styles from "./TaskList.module.css";

export function TaskLayoutSwitch({ value, onChange }: {
  value: "list" | "kanban";
  onChange: (value: "list" | "kanban") => void;
}) {
  return <Segmented label="Task layout" value={value} onChange={onChange} options={[
    { label: <span className={styles.layoutLabel}><List size={16} aria-hidden="true" />List</span>, value: "list" },
    { label: <span className={styles.layoutLabel}><Columns3 size={16} aria-hidden="true" />Kanban</span>, value: "kanban" },
  ]} />;
}
