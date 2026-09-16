import { colors, fonts } from "@/constants/theme";
import { Pressable, Switch, View, Text } from "react-native";
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
  disabled?: boolean;
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
  expanded?: boolean;
  subdued?: boolean;
  onInfoPress?: () => void;
  disabled?: boolean;
  label: string;
  detail?: string;
  value?: string;
  external?: boolean;
  onPress?: () => void;
  /**
   * Tappable without looking or announcing it.
   *
   * For the version row, where ten taps open diagnostics. A chevron and a
   * button role would advertise a door meant to be found only by someone who
   * was told about it, and would put a control in the accessibility tree that
   * does nothing on nine activations out of ten. The row keeps the plain
   * appearance it has always had; its text is still read normally.
   */
  secret?: boolean;
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

export function SettingRowToggle({ label, toggle, onToggle, disabled }: ToggleProps) {
  return (
    <Tap
      onPress={onToggle}
      disabled={disabled}
      scaleTo={1}
      style={[rowStyle, { borderColor: colors.line }]}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: toggle, disabled: !!disabled }}
    >
      <Text
        style={{
          flex: 1,
          marginRight: spacing[2],
          fontFamily: fonts.sans,
          fontSize: typeSizes[15],
          color: colors.fg2,
        }}
      >
        {label}
      </Text>
      <Switch
        disabled={disabled}
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

export function SettingRowAction({ label, detail, value, external, onPress, secret, disabled, expanded, onInfoPress, subdued = false }: ActionProps) {
  if (onInfoPress && onPress) {
    return (
      <View style={[rowStyle, { borderColor: colors.line, paddingVertical: 0 }]}>
        <Tap onPress={onPress} disabled={disabled} scaleTo={1}
          accessibilityLabel={label} accessibilityState={{ expanded }}
          style={{ flexShrink: 1, minHeight: 44, justifyContent: "center" }}>
          <Text style={{ fontFamily: fonts.sans, fontSize: subdued ? typeSizes[13] : typeSizes[15], color: subdued ? colors.fg3 : colors.fg2 }}>{label}</Text>
        </Tap>
        <Tap onPress={onInfoPress} accessibilityLabel={`About ${label.toLowerCase()}`}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Feather name="info" size={16} color={colors.fg3} accessible={false} />
        </Tap>
        <Tap onPress={onPress} disabled={disabled} scaleTo={1}
          accessibilityLabel={label} accessibilityState={{ expanded }}
          style={{ flex: 1, minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }}>
          <Feather name={expanded ? "chevron-down" : "chevron-right"} size={15} color={colors.fg4} accessible={false} />
        </Tap>
      </View>
    );
  }
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: subdued ? typeSizes[13] : typeSizes[15],
            color: subdued ? colors.fg3 : colors.fg2,
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
      {onPress && !secret ? (
        <Feather name={external ? "external-link" : expanded ? "chevron-down" : "chevron-right"} size={15} color={colors.fg4} />
      ) : null}
    </>
  );

  const plain = (
    <View style={[rowStyle, { borderColor: colors.line, gap: spacing[3] }]}>
      {content}
    </View>
  );

  if (!onPress) return plain;

  // A secret row is the plain row that happens to answer a press: no chevron,
  // no dim, no scale, no button role. `Tap` cannot express that — it gives
  // every pressable the app's press feel and infers the role from `onPress` —
  // and all three of those would advertise the door.
  if (secret) return <Pressable onPress={onPress}>{plain}</Pressable>;

  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      scaleTo={1}
      style={[rowStyle, { borderColor: colors.line, gap: spacing[3] }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, ...(expanded === undefined ? {} : { expanded }) }}
      accessibilityLabel={label}
    >
      {content}
    </Tap>
  );
}
