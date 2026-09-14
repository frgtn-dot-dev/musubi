import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { styles } from "@/constants/theme";
import type { useModalAnimation } from "@/hooks/useModalAnimation";

/** Common floating sheet frame. Day-view docked composers deliberately do not use it. */
export function BottomSheetFrame({ motion, onClose, dismissible = true, header, children }: {
  motion: ReturnType<typeof useModalAnimation>; onClose: () => void; dismissible?: boolean; header: ReactNode; children: ReactNode;
}) {
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <Animated.View style={[styles.modalOverlay, motion.fadeStyle]}>
      <Pressable disabled={!dismissible} style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close panel" />
    </Animated.View>
      <Animated.View onLayout={e => motion.onSheetLayout(e.nativeEvent.layout.height)} style={[styles.modalSheet, motion.fadeStyle, motion.slideStyle]}>
        <GestureDetector gesture={motion.gesture.enabled(dismissible)}>
          <View collapsable={false}>
            <View style={styles.modalHandle} />
            {header}
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
  </GestureHandlerRootView>;
}
