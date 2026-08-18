import { colors, styles } from "@/constants/theme";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View, ScrollView } from "react-native"
import { ModalPortal as Modal } from "@/components/ui/ModalPortal";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import {
  Calendar,
  can,
  presetOptions,
  presetRule,
  presetValue,
  providerDisplayName,
} from "@musubi/types";
import { confirm } from "@/lib/confirm";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useEventsStore } from "@/store/useEventsStore";
import { useState } from "react";
import { useApi } from "@/services/api";
import { useServer } from "@/contexts/ServerContext";
import MemberRolesModal from "./MemberRolesModal";
import InvitesModal from "./InvitesModal";
import { Tap } from "@/components/ui/Tap";
import { Btn } from "@/components/ui/Btn";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { warn } from "@/lib/haptics";
import { showToast } from "@/components/ui/Toast";
import { userFacingError } from "@/lib/network";
import { disconnectFederatedServer } from "@/services/federation";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { SettingRowAction } from "@/components/SettingRow";
import { reminderRules, setCalendarReminderRule } from "@/services/notifications";

// A calendar rule is absent, not silent, when it follows the global default —
// so the control needs a value for "say nothing" that is not itself a rule.
const FOLLOW_DEFAULT = "default";


type Props = {
  calendar: Calendar | null,
  visible: boolean,
  onClose: () => void,
  onDelete: (calendar: Calendar) => void,
  onEdit: (calendar: Calendar) => void,
  onLeave: () => void,
}

export default function CalendarSettingsModal({ calendar, visible, onClose, onDelete, onEdit, onLeave }: Props) {
  const api = useApi();
  const { authClient } = useServer();
  const [isLeaving, setIsLeaving] = useState(false);
  const [rolesVisible, setRolesVisible] = useState(false);
  const [invitesVisible, setInvitesVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reminderPicker, setReminderPicker] = useState(false);
  const events = useEventsStore((state) => state.events);

  /**
   * This calendar's reminder, per member. It sits here rather than in Settings
   * because it is a fact about the calendar, and because a list of every
   * calendar was a screen nobody scrolled to the bottom of.
   */
  const rule = calendar ? reminderRules()?.calendars[calendar.id] : undefined;
  const reminderChoices = [
    { label: "Default", value: FOLLOW_DEFAULT },
    ...presetOptions(rule),
  ];
  const reminderValue = rule ? presetValue(rule) : FOLLOW_DEFAULT;

  const saveReminder = (next: string) => {
    if (!calendar) return;
    // Every event in the calendar may change, so the whole set is rescheduled.
    setCalendarReminderRule(
      calendar.id,
      next === FOLLOW_DEFAULT ? null : (presetRule(next) ?? rule ?? null),
      events,
    ).catch((e) => {
      warn();
      console.error("Calendar reminder save failed:", e);
      showToast({ message: userFacingError(e, "That reminder could not be saved.") });
    });
  };

  // One-shot .ics snapshot: fetch → temp file → OS share sheet.
  const exportCalendar = async () => {
    if (!calendar) return;
    setExporting(true);
    try {
      const ics = await api.exportCalendar(calendar.id);
      const file = new File(Paths.cache, `${calendar.name.replace(/[^\w.-]+/g, "_") || "calendar"}.ics`);
      if (file.exists) file.delete(); // stale export from a previous share
      file.write(ics);
      await Sharing.shareAsync(file.uri, { mimeType: "text/calendar" });
    } catch (e) {
      warn();
      console.error("Calendar export failed:", e);
      showToast({ message: userFacingError(e, "Could not export this calendar.") });
    } finally {
      setExporting(false);
    }
  };

  const insets = useSafeAreaInsets();
  const { slideStyle, fadeStyle, gesture, handleClose } = useModalAnimation(visible, onClose);
  const { loadCalendars } = useCalendarsStore();
  const { localRemoveCalendarEvents } = useEventsStore();
  const { data: session } = authClient.useSession();
  const userID = session?.user.id;

  // A federated calendar is a NATIVE calendar on another Musubi server, not a
  // provider mirror: management is allowed by role and routed to that server.
  // Its creatorID is a shadow-user id there, so the local owner check never
  // matches and must not gate anything.
  const isFederated = calendar?.provider === "musubi";
  const isProviderMirror = !!calendar?.provider && !isFederated; // google/caldav — edits push to the provider
  const isOwner = userID === calendar?.creatorID;
  // Provider mirrors: only the connection owner may edit/delete (the server
  // enforces this too); provider-side read-only mirrors have role "viewer",
  // so can() already blocks them.
  const showEdit = can(calendar?.role, "editCalendar") && (!isProviderMirror || isOwner);
  const showDelete = can(calendar?.role, "deleteCalendar") && !calendar?.isDefault && (!isProviderMirror || isOwner);
  const showInvite = can(calendar?.role, "invite");
  const showLeave = !isOwner;                    // non-owners can leave
  // Any provider mirror can be disconnected (sync stops, mirror dropped, the
  // provider calendar is untouched). This is the ONLY way to remove a read-only
  // mirror — holidays or a calendar you were invited to as viewer — which can't
  // be deleted and isn't yours to delete on the provider. For a federated
  // calendar this disconnects the whole origin server instead.
  const showDisconnect = isProviderMirror || isFederated;

  // External delete = two-step confirm: first that it's a provider-synced
  // calendar (and where it lives), then the actual deletion.
  const handleDelete = () => {
    if (!calendar) return;
    // Only provider mirrors need the "this also changes it at the provider"
    // step. A federated calendar is deleted on its own Musubi server, which is
    // the same operation as here — just say where it happens.
    if (!isProviderMirror) {
      confirm({
        title: `Delete "${calendar.name}"?`,
        message: isFederated
          ? `The calendar and all its events will be permanently deleted on ${providerDisplayName(calendar)}, for everyone it's shared with. This can't be undone.`
          : "The calendar and all its events will be permanently deleted. This can't be undone.",
        confirmLabel: "Delete",
      }, () => {
        onDelete(calendar);
        handleClose();
      });
      return;
    }
    const providerName = providerDisplayName(calendar);
    confirm({
      title: "External calendar",
      message: `"${calendar.name}" is synced from ${calendar.accountLabel ?? "a connected account"}. Deleting it here also deletes it in ${providerName}.`,
      confirmLabel: "Continue",
    }, () => confirm({
      title: "Delete calendar?",
      message: "The calendar and all its events will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete",
    }, () => {
      onDelete(calendar);
      handleClose();
    }));
  };

  const handleLeave = () => {
    if (!calendar) return;
    confirm({
      title: `Leave "${calendar.name}"?`,
      message: "You'll lose access until you're invited again. The calendar and its events stay for everyone else.",
      confirmLabel: "Leave",
    }, async () => {
      setIsLeaving(true);
      await api.leaveCalendar(calendar.id);
      // Purge the departed calendar's events locally — the leave itself sends
      // this device no SSE, so ghosts would linger.
      localRemoveCalendarEvents(calendar.id);
      loadCalendars(await api.getCalendars());
      handleClose();
      onLeave();
    });
  };

  const handleDisconnect = () => {
    if (!calendar) return;
    const providerName = providerDisplayName(calendar);
    // Federation has no per-calendar mirror to drop: the connection is to the
    // whole server, so say so instead of implying only this calendar goes away.
    confirm(isFederated
      ? {
        title: `Disconnect ${providerName}?`,
        message: `Every calendar shared from ${providerName} will be removed from Musubi, and you'll need a new invite to get them back. Nothing is deleted on that server.`,
        confirmLabel: "Disconnect",
      }
      : {
        title: `Disconnect "${calendar.name}"?`,
        message: `It will stop syncing and its events will be removed from Musubi. The calendar stays untouched in ${providerName}, and you can add it back later from ${providerName}.`,
        confirmLabel: "Disconnect",
      }, async () => {
      setIsLeaving(true);
      if (isFederated && calendar.serverUrl) {
        await disconnectFederatedServer(calendar.serverUrl);
      } else {
        await api.disconnectExternalCalendar(calendar.id);
      }
      localRemoveCalendarEvents(calendar.id);
      loadCalendars(await api.getCalendars());
      handleClose();
      onLeave();
    });
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={handleClose}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[styles.modalOverlay, fadeStyle]}>
          <Pressable style={{ flex: 1 }} onPress={handleClose} accessible={false} />
        </Animated.View>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.modalSheet, fadeStyle, slideStyle]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>{calendar?.name}</Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.container}>
                <SettingRowAction
                  label="Remind Me"
                  value={
                    reminderChoices.find((choice) => choice.value === reminderValue)?.label
                  }
                  onPress={() => setReminderPicker(true)}
                />

                <View style={{ gap: 8 }}>
                  {showInvite && (
                  <Btn
                    label="Invite Links"
                    icon={<Feather size={14} name="send" color={colors.bg3} />}
                    onPress={() => setInvitesVisible(true)}
                  />
                  )}
                  <Btn
                    label="Members"
                    variant="secondary"
                    icon={<Feather size={14} name="users" color={colors.fg2} />}
                    onPress={() => setRolesVisible(true)}
                  />
                  <Btn
                    label="Export (.ics)"
                    variant="secondary"
                    icon={<Feather size={14} name="download" color={colors.fg2} />}
                    loading={exporting}
                    onPress={exportCalendar}
                  />
                </View>
              </View>
            </ScrollView>
            {(showEdit || showDelete || showLeave || showDisconnect) && (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  borderTopWidth: 1,
                  borderColor: colors.line,
                  paddingBottom: insets.bottom,
                }}
              >
                {showEdit && (
                  <Tap
                    style={styles.modalActionBtn}
                    disabled={calendar ? false : true}
                    onPress={() => {
                      onEdit(calendar!);
                      handleClose();
                    }}
                  >
                    <Feather size={20} name="edit" color={colors.fg2} />
                    <Text style={{ color: colors.fg2, fontSize: 10 }}>Edit</Text>
                  </Tap>
                )}

                {showEdit && (showDelete || showLeave) && <View style={styles.modalActionDivider} />}

                {showDelete && (
                  <Tap
                    style={styles.modalActionBtn}
                    haptic="warn"
                    disabled={calendar ? false : true}
                    onPress={handleDelete}
                  >
                    <Feather size={20} name="trash" color={colors.accent} />
                    <Text style={{ color: colors.accent, fontSize: 10 }}>Delete</Text>
                  </Tap>
                )}

                {showLeave && (
                  <Tap
                    style={styles.modalActionBtn}
                    haptic="warn"
                    disabled={isLeaving || !calendar}
                    onPress={handleLeave}
                  >
                    <Feather size={20} name="arrow-left-circle" color={isLeaving ? colors.fg4 : colors.accent} />
                    <Text style={{ color: isLeaving ? colors.fg4 : colors.accent, fontSize: 10 }}>Leave</Text>
                  </Tap>
                )}

                {showDisconnect && (showEdit || showDelete || showLeave) && <View style={styles.modalActionDivider} />}

                {showDisconnect && (
                  <Tap
                    style={styles.modalActionBtn}
                    haptic="warn"
                    disabled={isLeaving || !calendar}
                    onPress={handleDisconnect}
                  >
                    <Feather size={20} name="cloud-off" color={isLeaving ? colors.fg4 : colors.accent} />
                    <Text style={{ color: isLeaving ? colors.fg4 : colors.accent, fontSize: 10 }}>Disconnect</Text>
                  </Tap>
                )}
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
      <MemberRolesModal
        calendar={calendar}
        visible={rolesVisible}
        onClose={() => setRolesVisible(false)}
      />
      <OptionPicker
        visible={reminderPicker}
        title="Remind Me"
        options={reminderChoices}
        value={reminderValue}
        onSelect={saveReminder}
        onClose={() => setReminderPicker(false)}
      />
      <InvitesModal
        calendar={calendar}
        visible={invitesVisible}
        onClose={() => setInvitesVisible(false)}
      />
    </Modal >
  );
}
