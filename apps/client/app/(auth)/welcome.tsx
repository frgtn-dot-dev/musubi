import { colors, fonts, styles } from "@/constants/theme";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View, Text, Pressable, Linking } from "react-native";
import InputModal from "@/components/TextInputModal";
import { useServer } from "@/contexts/ServerContext";
import { GoogleSignin, isSuccessResponse, GoogleSigninButton } from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";

GoogleSignin.configure({
  webClientId: Constants.expoConfig?.extra?.googleWebClientId,
});

export default function Welcome() {
  const { authClient } = useServer();
  const handleGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (isSuccessResponse(response) && response.data.idToken) {
        const { error } = await authClient.signIn.social({
          provider: "google",
          idToken: { token: response.data.idToken },
        });
        if (error) {
          alert("Google SignIn Failed...");
        } else {
          router.replace("/(tabs)");
        }
      }
    } catch (e) {
      alert("Google SignIn Failed...");
    }
  };

  const { apiUrl, setNewServerUrl } = useServer();
  const [inputModalVisible, setInputModalVisible] = useState(false);
  const router = useRouter();

  const testApiUrl = async (value: string) => {
    let result;

    try {
      result = await fetch(`${value.toLowerCase()}/api/server/ok`);
    } catch (err) {
      return { ok: false, error: "Invalid URL..." }
    }

    if (result.ok) {
      const data = await result.json();
      if (data.ok) {
        return { ok: true, error: "" };
      }
    }

    return { ok: false, error: "Invalid Api Server Url..." };
  }

  return (
    <View style={styles.screen}>
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
          <GoogleSigninButton onPress={handleGoogle} />
          <Pressable
            style={styles.btnPrimary}
            onPress={() => router.push("/(auth)/sign-up")}
          >
            <Text style={styles.btnPrimaryText}>
              Create account
            </Text>
          </Pressable>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => router.push("/(auth)/sign-in")}
          >
            <Text style={styles.btnSecondaryText}>
              Login
            </Text>
          </Pressable>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => setInputModalVisible(true)}
          >
            <Text style={styles.btnSecondaryText}>
              Server: {apiUrl}
            </Text>
          </Pressable>
          <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.fg4, textAlign: "center" }}>
            By continuing you accept the
            <Text
              style={{
                color: colors.fg3
              }}
              onPress={() => {
                Linking.openURL("https://musubi.frgtn.dev/terms/");
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
                Linking.openURL("https://musubi.frgtn.dev/privacy/");
              }}
            >
              {" privacy policy."}
            </Text>
          </Text>
        </View>
      </View >
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
