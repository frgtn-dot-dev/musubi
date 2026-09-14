import { Feather } from "@expo/vector-icons";
import type { TaskStatus } from "@musubi/types";

export function TaskStatusIcon({ status, size = 16, color }: { status: TaskStatus; size?: number; color?: string }) {
  const name = status === "completed" ? "check-circle" : status === "in-process" ? "clock" : status === "cancelled" ? "x-circle" : "circle";
  return <Feather name={name} size={size} color={color} />;
}
