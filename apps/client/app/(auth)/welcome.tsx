import { colors, fonts, styles } from "@/constants/theme";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View, Text, Linking, KeyboardAvoidingView } from "react-native";
import InputModal from "@/components/TextInputModal";
import { Btn } from "@/components/ui/Btn";
import { useServer } from "@/contexts/ServerContext";
import { normalizeServerUrl } from "@/lib/serverUrl";
import { fetchWithTimeout, userFacingError } from "@/lib/network";
import semver from "semver";

const requiredServerVersion = "0.1.3";

export default function Welcome() {
  const { apiUrl, setNewServerUrl } = useServer();

  const [inputModalVisible, setInputModalVisible] = useState(false);
  const router = useRouter();

  const testApiUrl = async (value: string) => {
    let result;

    try {
      result = await fetchWithTimeout(`${normalizeServerUrl(value)}/api/v1/server/ok`);
    } catch (err) {
      return { ok: false, error: userFacingError(err, "Could not reach this server. Check the URL and try again.") }
    }

    if (result.ok) {
      const data = await result.json();
      if (data.ok && semver.valid(data.version) && semver.gte(data.version, requiredServerVersion)) {
        return { ok: true, error: "" };
      }
      if (data.ok) {
        return {
          ok: false,
          error: `This server runs ${data.version ?? "an old build"}; Musubi ${requiredServerVersion} is required.`,
        };
      }
    }

    return { ok: false, error: "Invalid Api Server Url..." };
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <View style={{ alignItems: "center", justifyContent: "space-between", flex: 1, paddingTop: 60 }}>
        <View style={{ alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.fg, fontSize: 72, fontFamily: fonts.serif }}>
            結び
          </Text>
          <Text style={{ color: colors.fg3 }}>
            MUSUBI
          </Text>
        </View>
        <View style={{ alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Text style={{ color: colors.fg, fontSize: 28, fontFamily: fonts.serif, textAlign: "center", lineHeight: 32, paddingBottom: 8 }}>
            To tie a knot{"\n"}with your closest...
          </Text>
          <Text style={{ color: colors.fg3, fontSize: 16, fontFamily: fonts.serif, textAlign: "center" }}>
            A quiet, shared space for time — {"\n"}
            for two, or for a small circle of trust.
          </Text>
        </View>
        <View style={styles.modalButtonsColumn}>
          <Btn
            label="Create account"
            onPress={() => router.push("/(auth)/sign-up")}
          />
          <Btn
            label="Login"
            variant="secondary"
            onPress={() => router.push("/(auth)/sign-in")}
          />
          <Btn
            label={`Server: ${apiUrl}`}
            variant="secondary"
            onPress={() => setInputModalVisible(true)}
          />
          <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.fg4, textAlign: "center" }}>
            By continuing you accept the
            <Text
              style={{
                color: colors.fg3
              }}
              onPress={() => {
                Linking.openURL("https://musubi.pro/terms/");
              }}
            >
              {" terms of service "}
            </Text>
            and our
            <Text
              style={{
                color: colors.fg3
              }}
              onPress={() => {
                Linking.openURL("https://musubi.pro/privacy/");
              }}
            >
              {" privacy policy."}
            </Text>
          </Text>
        </View>
      </View >
      </KeyboardAvoidingView>
      <InputModal
        visible={inputModalVisible}
        title="Api Server URL..."
        placeholder="https://your.api.server"
        onClose={() => setInputModalVisible(false)}
        onTest={(value) => testApiUrl(value)}
        onConfirm={setNewServerUrl}
      />
    </View>
  );
}
