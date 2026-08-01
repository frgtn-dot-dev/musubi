import {
  controlHeights,
  radii,
  spacing,
  themeTokens,
  typeSizes,
  type ThemeTokens,
} from "@musubi/design-system";
import { StyleSheet } from "react-native";
import { SCREEN_HEADER_HEIGHT } from "@/constants/layout";


export const fonts = {
  sans: 'InterTight_400Regular',
  sansMedium: 'InterTight_500Medium',
  serif: 'NotoSerif_400Regular',
  kanji: 'ShipporiMinchoB1_400Regular',
};

// Transitional aliases keep existing native components stable while their
// values come from the same semantic roles as the web renderer.
function makeNativePalette(tokens: ThemeTokens) {
  return {
    bg: tokens.surfaceCanvas,
    bg1: tokens.surfacePanel,
    bg2: tokens.surfaceRaised,
    bg3: tokens.surfaceSunken,
    line: tokens.borderSubtle,
    line2: tokens.borderMedium,
    line3: tokens.borderStrong,
    fg: tokens.textPrimary,
    fg2: tokens.textSecondary,
    fg3: tokens.textMuted,
    fg4: tokens.textFaint,
    accent: tokens.accentPrimary,
    fill: tokens.controlFill,
    onFill: tokens.controlOnFill,
  };
}

const dark = makeNativePalette(themeTokens.dark);
const light = makeNativePalette(themeTokens.light);

export type ThemeScheme = keyof typeof themeTokens;

// `colors`, `styles` and `calendarTheme` are MUTABLE singletons: every
// component reads them at render time, so applyTheme() swaps their contents
// in place and the root remount (key={scheme}) repaints the whole app.
// No context/provider plumbing through 30 files.
export const colors = { ...dark };

export let activeScheme: ThemeScheme = 'dark';

export function applyTheme(scheme: ThemeScheme) {
  // No same-scheme early return: cheap to reapply, and a guard can wedge
  // after a hot reload leaves activeScheme out of sync with the palette.
  activeScheme = scheme;
  Object.assign(colors, scheme === 'dark' ? dark : light);
  Object.assign(styles, makeStyles());
  Object.assign(calendarTheme, makeCalendarTheme());
}

const makeStyles = () => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    height: SCREEN_HEADER_HEIGHT,
    paddingHorizontal: spacing[4],
    paddingVertical: 6,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.bg1,
  },
  screenTitle: {
    fontFamily: fonts.serif,
    fontSize: typeSizes[20],
    color: colors.fg,
  },
  pillActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line3,
    borderRadius: radii.pill,
    borderCurve: 'continuous',
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    backgroundColor: colors.bg2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderCurve: 'continuous',
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  horizontalPillView: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2
  },
  fab: {
    position: 'absolute',
    right: spacing[4],
    bottom: spacing[4],
    height: controlHeights.touch.compact,
    minWidth: controlHeights.touch.compact,
    paddingHorizontal: spacing[4],
    borderRadius: 26,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabRemove: {
    position: 'absolute',
    left: spacing[4],
    bottom: spacing[4],
    width: controlHeights.touch.compact,
    height: controlHeights.touch.compact,
    borderRadius: 26,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg1,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderCurve: 'continuous',
    // FIXED dp, not a percentage: with statusBarTranslucent the Modal window's
    // height settles a beat after open — a %-minHeight recomputed against the
    // taller window made short sheets visibly hop upward.
    minHeight: 290,
    maxHeight: '88%',
  },
  modalHandle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.line3,
    alignSelf: 'center',
    marginVertical: 10,
  },
  modalTitleRow: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  modalDetailRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  container: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  fieldContainer: {
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  fieldLabel: {
    fontFamily: fonts.sans,
    fontSize: typeSizes[10],
    color: colors.fg4,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: typeSizes[10],
    letterSpacing: 1.5,
    color: colors.fg4,
    textTransform: 'uppercase',
  },
  fieldValueText: {
    color: colors.fg,
    fontSize: typeSizes[14],
  },
  fieldValueBig: {
    color: colors.fg,
    fontSize: typeSizes[20],
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing[4],
  },
  modalButtonsColumn: {
    flexDirection: 'column',
    alignSelf: "stretch",
    alignItems: "stretch",
    justifyContent: "flex-end",
    flex: 1,
    gap: 10,
    padding: spacing[4],
  },
  btnPrimary: {
    flex: 1,
    maxHeight: controlHeights.touch.control,
    minHeight: controlHeights.touch.control,
    gap: 6,
    backgroundColor: colors.fill,
    borderRadius: radii.control,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnSecondary: {
    flex: 1,
    maxHeight: controlHeights.touch.control,
    minHeight: controlHeights.touch.control,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.control,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: 'center',
  },
  btnRemove: {
    flex: 1,
    maxHeight: controlHeights.touch.control,
    minHeight: controlHeights.touch.control,
    gap: 6,
    backgroundColor: "#C8553D",
    borderRadius: radii.control,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnDisabled: {
    flex: 1,
    maxHeight: controlHeights.touch.control,
    minHeight: controlHeights.touch.control,
    gap: 6,
    backgroundColor: colors.fg3,
    borderRadius: radii.control,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnPrimaryText: {
    color: colors.onFill,
    fontFamily: fonts.sansMedium,
    fontSize: typeSizes[13],
  },
  btnSecondaryText: {
    color: colors.fg2,
    fontFamily: fonts.sansMedium,
    fontSize: typeSizes[13],
  },
  modalTitle: {
    fontFamily: fonts.serif,
    fontSize: typeSizes[22],
    color: colors.fg,
  },
  errorText: {
    color: colors.accent,
    fontFamily: fonts.sans,
    fontSize: typeSizes[12],
  },
  textInput: {
    fontFamily: fonts.sans,
    fontSize: typeSizes[20],
    color: colors.fg2,
  },
  colorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  calendarCircle: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line3,
    position: 'relative',
    marginVertical: 16,
  },
  calendarCircleInner: {
    position: 'absolute',
    inset: 4,
    borderRadius: radii.lg,
    opacity: 0.9,
  },
  modalActionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 15,
    paddingBottom: 15,
  },
  modalActionDivider: {
    backgroundColor: colors.line,
    width: 1,
    alignSelf: 'stretch',
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  section: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[7],
    gap: spacing[3],
  },
  screenActions: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  timelineRow: {
    flexDirection: 'row',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  timelineDay: {
    fontFamily: fonts.serif,
    fontSize: typeSizes[24],
    color: colors.fg,
  },
  timelineMonth: {
    fontFamily: fonts.sans,
    fontSize: typeSizes[12],
    color: colors.fg3,
  },
  timelineTitle: {
    fontFamily: fonts.sans,
    fontSize: typeSizes[14],
    color: colors.fg,
  },
  timelineMeta: {
    fontFamily: fonts.sans,
    fontSize: typeSizes[10],
    color: colors.fg3,
  },
});

export const styles = makeStyles();

const makeCalendarTheme = () => ({
  palette: {
    primary: {
      main: colors.accent,
      contrastText: colors.bg,
    },
    gray: {
      '100': colors.bg1,
      '200': colors.line,
      '300': colors.line2,
      '500': colors.fg3,
      '800': colors.fg2,
    },
    nowIndicator: colors.accent,
  },
  typography: {
    fontFamily: fonts.sans,
    xs: { fontSize: typeSizes[10] },
    sm: { fontSize: typeSizes[12] },
  },
  eventCellOverlappingStyle: {
    borderRadius: 4,
  },
});

export const calendarTheme = makeCalendarTheme();
