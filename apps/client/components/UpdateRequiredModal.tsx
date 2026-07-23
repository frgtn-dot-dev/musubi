import { colors, fonts, styles } from "@/constants/theme";
import { View, Text, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn } from "@/components/ui/Btn";
import Constants from "expo-constants";

const iosAppStoreUrl = Constants.expoConfig?.extra?.iosAppStoreUrl as string | undefined;
const storeUrl = Platform.OS === "ios"
  ? iosAppStoreUrl ?? "https://musubi.pro"
  : "https://play.google.com/store/apps/details?id=dev.frgtn.musubi";
const storeLabel = Platform.OS === "ios"
  ? iosAppStoreUrl ? "Open App Store" : "Open download page"
  : "Open Play Store";

type Props = {
  currentVersion: string;
  requiredVersion: string;
};

export default function UpdateRequiredModal({ currentVersion, requiredVersion }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 32, paddingBottom: 32 + insets.bottom }]}>
      <View style={{
        width: "100%",
        backgroundColor: colors.bg2,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.line2,
        paddingHorizontal: 28,
        paddingTop: 28,
        paddingBottom: 20,
        gap: 16,
      }}>
        <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.fg }}>
          Update Required
        </Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.fg2, lineHeight: 22 }}>
          This version of Musubi is no longer supported. Please update the app to continue.
        </Text>
        <View style={{ gap: 6, marginTop: 4 }}>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3 }}>
            Your version{'   '}<Text style={{ color: colors.fg }}>{currentVersion}</Text>
          </Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3 }}>
            Required{'       '}<Text style={{ color: colors.fg }}>{requiredVersion}</Text>
          </Text>
        </View>
        <Btn
          label={storeLabel}
          style={{ flex: 0, marginTop: 8 }}
          onPress={() => Linking.openURL(storeUrl)}
        />
      </View>
    </View>
  );
}
