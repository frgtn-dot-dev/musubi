import { colors, fonts, styles } from "@/constants/theme";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { Modal, Pressable, Text, View, ScrollView } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { Event, can } from "@musubi/types";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useState } from "react";

type Props = {
  event: Event | null,
  visible: boolean,
  onClose: () => void,
  onLink: (calendarID: string) => Promise<void>,
};

export default function LinkEventModal({ event, visible, onClose, onLink }: Props) {
  const { calendars } = useCalendarsStore();
  const insets = useSafeAreaInsets();
  const { slideStyle, fadeStyle, gesture, handleClose } = useModalAnimation(visible, onClose);
  const [pending, setPending] = useState<string | null>(null);

  // Calendars the user can edit and the event isn't already in.
  const options = calendars.filter(c => can(c.role, "editEvents") && !event?.calendars.includes(c.id));

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
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
        </Animated.View>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.modalSheet, fadeStyle, slideStyle]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Add to calendar</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 4 }}>
              {options.length === 0 ? (
                <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3 }}>
                  No calendars you can add this to.
                </Text>
              ) : options.map((c) => (
                <Pressable
                  key={c.id}
                  disabled={pending === c.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pending === c.id ? 0.4 : 1 }}
                  onPress={async () => {
                    setPending(c.id);
                    try { await onLink(c.id); handleClose(); }
                    finally { setPending(null); }
                  }}
                >
                  <View style={[styles.colorDot, { backgroundColor: c.color }]} />
                  <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.fg }}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}
