import { colors, fonts } from "@/constants/theme";
import { ScrollView, Switch, View, Text } from "react-native";
import { Mode } from "@musubi/calendar";
import { Tap } from "@/components/ui/Tap";
import { Feather } from "@expo/vector-icons";
import {
  componentDimensions,
  radii,
  spacing,
  typeSizes,
} from "@musubi/design-system";

type ToggleProps = {
  label: string;
  toggle: boolean;
  onToggle: () => void;
  danger?: boolean;
}

type OptionsProps = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: Mode) => void;
  /** Optional display label per option value (else the value, capitalized). */
  labels?: Record<string, string>;
}

type ActionProps = {
  label: string;
  detail?: string;
  value?: string;
  external?: boolean;
  onPress?: () => void;
}

// Border color applied inline at usage — the theme can swap at runtime.
const rowStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing[4],
  paddingVertical: spacing[2],
  borderBottomWidth: 1,
  minHeight: componentDimensions.rowMinHeight,
} as const;

export function SettingRowToggle({ label, toggle, onToggle }: ToggleProps) {
  return (
    <Tap
      onPress={onToggle}
      scaleTo={1}
      style={[rowStyle, { borderColor: colors.line }]}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: toggle }}
    >
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: typeSizes[15],
          color: colors.fg2,
        }}
      >
        {label}
      </Text>
      <Switch
        thumbColor={toggle ? colors.accent : colors.bg3}
        trackColor={{
          false: colors.line,
          true: colors.line3,
        }}
        ios_backgroundColor={colors.line}
        onValueChange={onToggle}
        value={toggle}
        accessible={false}
      />
    </Tap>
  );
}

// Few options → pick in one tap: inline segmented pills, same visual language
// as the member-role selector.
export function SettingRowOptions({
  label,
  value,
  options,
  onChange,
  labels,
}: OptionsProps) {
  return (
    <View style={[rowStyle, { borderColor: colors.line }]}>
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: typeSizes[15],
          color: colors.fg2,
        }}
      >
        {label}
      </Text>
      <View style={{
        flexDirection: "row",
        borderWidth: 1, borderColor: colors.line2, borderRadius: radii.pill, padding: 2, gap: 2,
      }}>
        {options.map((o) => {
          const active = o === value;
          const displayLabel = labels?.[o] ?? o[0].toUpperCase() + o.slice(1);
          return (
            <Tap
              key={o}
              haptic="select"
              onPress={() => onChange(o as Mode)}
              accessibilityRole="radio"
              accessibilityLabel={`${label}, ${displayLabel}`}
              accessibilityState={{ checked: active }}
              hitSlop={{ top: 8, bottom: 8 }}
              style={{
                paddingHorizontal: spacing[3],
                paddingVertical: 5,
                borderRadius: radii.pill,
                borderCurve: "continuous",
                overflow: "hidden",
              }}
            >
              {active ? (
                <View pointerEvents="none" style={{
                  position: "absolute", inset: 0, borderRadius: radii.pill,
                  backgroundColor: colors.fill,
                }} />
              ) : null}
              <Text style={{
                fontFamily: fonts.sans, fontSize: typeSizes[11],
                color: active ? colors.onFill : colors.fg2,
              }}>
                {displayLabel}
              </Text>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

type PillsProps = {
  label: string;
  detail?: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
};

/**
 * A label with its choices on the line below, scrolling sideways.
 *
 * `SettingRowOptions` puts the pills beside the label, which works for three
 * and squashes at five. Reminder rules need more than three — "Off, 10 min,
 * 30 min, 1 hour, 1 day" — and the set grows by one again whenever a rule from
 * another device has no button here.
 */
export function SettingRowPills({ label, detail, value, options, onChange }: PillsProps) {
  return (
    <View style={{
      borderColor: colors.line,
      borderBottomWidth: 1,
      gap: spacing[2],
      paddingVertical: spacing[3],
    }}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontFamily: fonts.sans, fontSize: typeSizes[15], color: colors.fg2 }}>
          {label}
        </Text>
        {detail ? (
          <Text style={{ fontFamily: fonts.sans, fontSize: typeSizes[13], color: colors.fg3 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{
          flexDirection: "row",
          borderWidth: 1, borderColor: colors.line2, borderRadius: radii.pill, padding: 2, gap: 2,
        }}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <Tap
                key={option.value}
                haptic="select"
                onPress={() => onChange(option.value)}
                accessibilityRole="radio"
                accessibilityLabel={`${label}, ${option.label}`}
                accessibilityState={{ checked: active }}
                hitSlop={{ top: 8, bottom: 8 }}
                style={{
                  paddingHorizontal: spacing[3],
                  paddingVertical: 5,
                  borderRadius: radii.pill,
                  borderCurve: "continuous",
                  overflow: "hidden",
                }}
              >
                {active ? (
                  <View pointerEvents="none" style={{
                    position: "absolute", inset: 0, borderRadius: radii.pill,
                    backgroundColor: colors.fill,
                  }} />
                ) : null}
                <Text style={{
                  fontFamily: fonts.sans, fontSize: typeSizes[11],
                  color: active ? colors.onFill : colors.fg2,
                }}>
                  {option.label}
                </Text>
              </Tap>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

export function SettingRowAction({ label, detail, value, external, onPress }: ActionProps) {
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: typeSizes[15],
            color: colors.fg2,
          }}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: typeSizes[11],
              color: colors.fg4,
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: typeSizes[12],
            color: colors.fg4,
          }}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Feather name={external ? "external-link" : "chevron-right"} size={15} color={colors.fg4} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={[rowStyle, { borderColor: colors.line, gap: spacing[3] }]}>
        {content}
      </View>
    );
  }

  return (
    <Tap
      onPress={onPress}
      scaleTo={1}
      style={[rowStyle, { borderColor: colors.line, gap: spacing[3] }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {content}
    </Tap>
  );
}
