import { Circle, Clock3, CircleCheck, CircleX } from "lucide-react";
import type { TaskStatus } from "@musubi/types";

export function TaskStatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  const Icon = status === "completed" ? CircleCheck : status === "in-process" ? Clock3 : status === "cancelled" ? CircleX : Circle;
  return <Icon size={size} aria-hidden="true" />;
}
