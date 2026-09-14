import { useState } from "react";
import { colors, fonts, styles } from "@/constants/theme";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { Feather } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { ModalPortal as Modal } from "@/components/ui/ModalPortal";
import { Btn } from "@/components/ui/Btn";
import { Tap } from "@/components/ui/Tap";

export type PickerOption = { label: string; value: string };

type Props = {
  searchable?: boolean;
  visible: boolean;
  title: string;
  /** Reads under the title. For saying what the choice actually affects. */
  message?: string;
  options: PickerOption[];
  /** The one currently in force, shown with a tick. */
  value?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
};

/**
 * Pick one of several, in Musubi's own dressing.
 *
 * `chooseOption` in lib/confirm.ts hands this question to the platform — an
 * iOS action sheet or an Android alert. That is right where the platform's
 * voice is the point: a destructive confirmation should look like the system
 * asking, not like an app asking. A settings choice is not that. It sits in a
 * screen the app has styled from top to bottom, and a grey system sheet in the
 * middle of it reads as a different product.
 *
 * Built from the pieces every other modal here uses — `ModalPortal`,
 * `useModalAnimation`, the `bg3` card, `Btn` — so it inherits the spring, the
 * back-button handling and the overlay without inventing any of them.
 */
export function OptionPicker({
  visible,
  searchable = false,
  title,
  message,
  options,
  value,
  onSelect,
  onClose,
}: Props) {
  const { fadeStyle, handleClose } = useModalAnimation(visible, onClose);

  const [query, setQuery] = useState("");
  const List = searchable ? ScrollView : View;
  const filtered = options.filter(option => !searchable || (option.label + " " + option.value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (option: PickerOption) => {
    onSelect(option.value);
    handleClose();
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={handleClose}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
    >
      <Animated.View style={[styles.modalOverlay, fadeStyle]}>
        <Pressable style={{ flex: 1 }} onPress={handleClose} accessibilityLabel="Close" />
      </Animated.View>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          justifyContent: "center",
        }}
      >
        <Animated.View
          style={[
            // Same frame as TextInputModal, so two dialogs opened from the same
            // screen are the same size and in the same place.
            { alignSelf: "center", justifyContent: "center", minHeight: "10%", width: "80%" },
            fadeStyle,
          ]}
        >
          <View
            style={{
              backgroundColor: colors.bg3,
              borderRadius: 15,
              gap: 16,
              padding: 16,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.fg, fontFamily: fonts.serif, fontSize: 18 }}>
                {title}
              </Text>
              {message ? (
                <Text style={{ color: colors.fg4, fontFamily: fonts.sans, fontSize: 13 }}>
                  {message}
                </Text>
              ) : null}
            </View>

            {searchable ? <TextInput accessibilityLabel={`Search ${title}`} placeholder="Search city or time zone" placeholderTextColor={colors.fg4} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} style={[styles.fieldValueText, { backgroundColor: colors.bg1, borderRadius: 8, padding: 12 }]} /> : null}
            <List {...(searchable ? { style: { maxHeight: 260 }, keyboardShouldPersistTaps: "handled" as const } : {})}>
              {filtered.map((option, index) => {
                const selected = option.value === value;
                return (
                  <Tap
                    key={option.value}
                    haptic="select"
                    scaleTo={1}
                    onPress={() => choose(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={option.label}
                    style={{
                      alignItems: "center",
                      borderColor: colors.line,
                      // Dividers between, not around: a line above the first row
                      // would fence the list off from its own title.
                      borderTopWidth: index === 0 ? 0 : 1,
                      flexDirection: "row",
                      gap: 12,
                      justifyContent: "space-between",
                      paddingVertical: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? colors.fg : colors.fg2,
                        flex: 1,
                        fontFamily: fonts.sans,
                        fontSize: 15,
                      }}
                    >
                      {option.label}
                    </Text>
                    {selected ? (
                      <Feather name="check" size={16} color={colors.accent} />
                    ) : null}
                  </Tap>
                );
              })}
              {searchable && !filtered.length ? <Text style={{ color: colors.fg3 }}>No time zones found</Text> : null}
            </List>

            {/* In a row, even alone. `btnSecondary` is `flex: 1` — built to
                share a row with a confirm button — and in a column that flex
                grows along the wrong axis and pushes the button out of the
                card. Same wrapper TextInputModal uses. */}
            <View style={{ flexDirection: "row", gap: 16 }}>
              <Btn label="Cancel" variant="secondary" onPress={handleClose} />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
