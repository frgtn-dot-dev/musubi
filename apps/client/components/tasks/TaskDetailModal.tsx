import { useApi } from "@/services/api";
import { confirm } from "@/lib/confirm";
import { TaskEditorModal } from "./TaskEditorModal";
import { userFacingError } from "@/lib/network";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated from "react-native-reanimated";
import { can, providerFlavor, type Calendar, type Task, type TaskStatus } from "@musubi/types";
import { ProviderIcon } from "@/components/calendar/ProviderIcon";
import { colors, fonts, styles } from "@/constants/theme";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { Tap } from "@/components/ui/Tap";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useSettingsStore } from "@/store/useSettingsStore";
import { taskPriorityLabel, formatTaskDate } from "@/lib/taskPresentation";
import { showToast } from "@/components/ui/Toast";

const statuses = [
  { value: "needs-action", label: "Needs action" },
  { value: "in-process", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
function DetailRow({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; value: string }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
    <Feather name={icon} size={17} color={colors.fg3} style={{ marginTop: 2 }} />
    <View style={{ flex: 1, gap: 5 }}><Text style={styles.sectionLabel}>{label}</Text><Text selectable style={copy}>{value}</Text></View>
  </View>;
}
const copy = { fontFamily: fonts.sans, fontSize: 14, color: colors.fg2 };

export function TaskDetailModal({ task, calendar, editable, busy: externalBusy, onClose, onStatus, onPriority, onSaved }: {
  task: Task; calendar?: Calendar; editable: boolean; busy: boolean;
  onSaved: (task: Task | null) => void; onClose: () => void; onStatus: (status: TaskStatus) => void; onPriority: (priority: number) => void;
}) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const busy = externalBusy || actionBusy;
  const [picker, setPicker] = useState<"status" | "priority">();
  const { fadeStyle, slideStyle, gesture, handleClose } = useModalAnimation(true, onClose);
  const insets = useSafeAreaInsets();
  const dateFormat = useSettingsStore(s => s.dateFormat);
  const timeFormat = useSettingsStore(s => s.timeFormat);
  const date = (value: Date, timed = !task.isAllDay) => formatTaskDate(value, !timed, dateFormat, timeFormat);
  const close = () => { if (!busy) handleClose(); };
  const priorities = [...new Set([0, 1, 5, 9, task.priority])].sort((a, b) => a - b).map(value => ({ value: String(value), label: taskPriorityLabel(value) }));
  const status = statuses.find(item => item.value === task.status)?.label ?? task.status;
  return <ModalPortal visible onRequestClose={close}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={[styles.modalOverlay, fadeStyle]}><Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close task detail" /></Animated.View>

      <Animated.View style={[styles.modalSheet, { paddingHorizontal: 22, paddingBottom: editable ? 0 : Math.max(20, insets.bottom), maxHeight: "88%" }, fadeStyle, slideStyle]}>
        <GestureDetector gesture={gesture.enabled(!busy)}>
          <View collapsable={false}>
        <View style={styles.modalHandle} />
        <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start", paddingTop: 6, paddingBottom: 0 }}>
          <View style={{ flex: 1, flexDirection: "row", gap: 14, alignItems: "stretch" }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: calendar?.color ?? colors.fg3, marginVertical: 4 }} />
          <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.serif, fontSize: 26, lineHeight: 32, color: colors.fg, textDecorationLine: task.status === "completed" ? "line-through" : "none" }}>{task.title}</Text>
          </View>
          <Tap onPress={close} accessibilityLabel="Close task" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={20} color={colors.fg3} /></Tap>
        </View>
          </View>
        </GestureDetector>
        <ScrollView contentContainerStyle={{ gap: 20, paddingTop: 4, paddingBottom: 12 }}>
          {calendar ? (
            <View style={[styles.horizontalPillView, { flexWrap: "wrap" }]}>
              <View accessible accessibilityLabel={`${calendar.name} calendar${!can(calendar.role, "editTasks") ? ", read-only" : ""}`}
                style={[styles.pill, styles.pillEmphasized, { borderColor: colors.line3 }]}>
                {calendar.provider ? (
                  <ProviderIcon provider={providerFlavor(calendar)} color={calendar.color} />
                ) : !can(calendar.role, "editTasks") ? (
                  <Feather name="lock" size={11} color={calendar.color} />
                ) : <View style={[styles.colorDot, { backgroundColor: calendar.color }]} />}
                {calendar.provider && !can(calendar.role, "editTasks") ? <Feather name="lock" size={11} color={colors.fg3} /> : null}
                <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.fg2 }}>{calendar.name}</Text>
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Tap disabled={!editable || busy} onPress={() => setPicker("status")} accessibilityLabel={`Task status: ${status}`} style={{ flex: 1, minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: colors.bg3 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><TaskStatusIcon status={task.status} color={colors.fg3} /><Text style={[copy, { flexShrink: 1 }]}>{status}</Text></View></Tap>
            <Tap disabled={!editable || busy} onPress={() => setPicker("priority")} accessibilityLabel={`Task priority: ${taskPriorityLabel(task.priority)}`} style={{ flex: 1, minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: colors.bg3, flexDirection: "row", alignItems: "center", gap: 8 }}><Feather name="flag" size={15} color={colors.fg3} /><Text style={[copy, { flexShrink: 1 }]}>{taskPriorityLabel(task.priority)}</Text></Tap>
          </View>
          {busy ? <ActivityIndicator color={colors.fg3} /> : null}
          {task.description ? <DetailRow icon="file-text" label="Notes" value={task.description} /> : null}
          <View style={{ gap: 12 }}>
            <DetailRow icon="calendar" label="Starts" value={task.start ? date(task.start) : "Not set"} />
            <DetailRow icon="clock" label="Due" value={`${task.due ? date(task.due) : "Not set"}${task.isAllDay ? " · All day" : ""}`} />
            {task.completedAt ? <DetailRow icon="check-circle" label="Completed" value={date(task.completedAt, true)} /> : null}
            {task.recurrence ? <DetailRow icon="repeat" label="Repeat" value={task.recurrence} /> : null}
            {task.relatedTo ? <DetailRow icon="git-branch" label="Related task" value={task.relatedTo} /> : null}
            {task.url ? <Tap onPress={() => {
              if (!/^https?:\/\//i.test(task.url!)) { showToast({ message: "This link type cannot be opened." }); return; }
              void Linking.openURL(task.url!).catch(() => showToast({ message: "Could not open task link." }));
            }} accessibilityLabel="Open task link"><DetailRow icon="link" label="Link" value={task.url} /></Tap> : null}
          </View>
        </ScrollView>
        {editable ? <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: -22, paddingBottom: insets.bottom, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Tap style={styles.modalActionBtn} accessibilityLabel="Edit task" disabled={busy} onPress={() => setEditing(true)}><Feather name="edit-2" size={20} color={colors.fg} /><Text style={{ color: colors.fg, fontSize: 10 }}>Edit</Text></Tap>
          <View style={styles.modalActionDivider} />
          <Tap style={styles.modalActionBtn} accessibilityLabel="Delete task" haptic="warn" disabled={busy} onPress={() => confirm({ title: "Delete task?", message: task.title, confirmLabel: "Delete" }, () => {
            if (busy) return;
            setActionBusy(true);
            void api.removeTask(task).then(() => { onSaved(null); onClose(); }).catch(error => showToast({ message: userFacingError(error, "Could not delete task.") })).finally(() => setActionBusy(false));
          })}><Feather name="trash" size={20} color={colors.accent} /><Text style={{ color: colors.accent, fontSize: 10 }}>Delete</Text></Tap>
        </View> : null}
      </Animated.View>

    </GestureHandlerRootView>
    {editing && editable && calendar ? <TaskEditorModal key={task.id + ":" + (task.providerReadRetiredGeneration ?? 0)} task={task} calendarID={calendar.id} calendars={[calendar]} onClose={() => setEditing(false)} onSave={async draft => {
      const saved = await api.updateTask(task, draft); onSaved(saved);
    }} /> : null}
    <OptionPicker visible={!!picker} title={picker === "priority" ? "Task priority" : "Task status"} options={picker === "priority" ? priorities : statuses}
      value={picker === "priority" ? String(task.priority) : task.status} onSelect={value => { if (picker === "priority") onPriority(Number(value)); else onStatus(value as TaskStatus); }} onClose={() => setPicker(undefined)} />
  </ModalPortal>;
}
