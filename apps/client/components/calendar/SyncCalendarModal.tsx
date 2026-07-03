import { colors, fonts, styles } from "@/constants/theme";
import { useServer } from "@/contexts/ServerContext";
import { useApi } from "@/services/api";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useState } from "react";
import { Text, Modal, Pressable, ScrollView, View, TextInput, Alert } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

const ICLOUD_URL = "https://caldav.icloud.com";

type Props = {
  visible: boolean;
  onClose: () => void;
  onConnected: () => void; // trigger a data refresh after a successful connect
};

export default function SyncCalendarModal({ visible, onClose, onConnected }: Props) {
  const { authClient } = useServer();
  const api = useApi();

  const [step, setStep] = useState<"providers" | "caldav">("providers");
  const [serverUrl, setServerUrl] = useState(ICLOUD_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const closeSequence = () => {
    onClose();
    setStep("providers");
    setServerUrl(ICLOUD_URL);
    setUsername("");
    setPassword("");
    setError("");
    setIsLoading(false);
  };

  const { slideStyle, fadeStyle, gesture, handleClose } = useModalAnimation(visible, closeSequence);

  const handleGoogle = async () => {
    setIsLoading(true);
    try {
      const { error } = await authClient.linkSocial({
        provider: "google",
        scopes: ["https://www.googleapis.com/auth/calendar"],
        callbackURL: "/(tabs)",
      });
      if (error) throw new Error(error.message ?? "Google connect failed");
      onConnected();
      handleClose();
    } catch (e: any) {
      Alert.alert("Google connect failed", e?.message ?? "An unexpected error occured.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCaldav = async () => {
    if (!serverUrl || !username || !password) {
      setError("All fields are required.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await api.connectCaldav(serverUrl, username, password);
      onConnected();
      handleClose();
    } catch (e: any) {
      setError("Could not connect — check the URL and credentials.");
    } finally {
      setIsLoading(false);
    }
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
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
        </Animated.View>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.modalSheet, fadeStyle, slideStyle]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>
                {step === "providers" ? "Sync a Calendar" : "Connect CalDAV / Apple"}
              </Text>
            </View>

            <ScrollView>
              {step === "providers" ? (
                <View style={styles.modalButtonsColumn}>
                  <Pressable style={styles.btnSecondary} disabled={isLoading} onPress={handleGoogle}>
                    <Text style={styles.btnSecondaryText}>Google Calendar</Text>
                  </Pressable>
                  <Pressable style={styles.btnSecondary} onPress={() => setStep("caldav")}>
                    <Text style={styles.btnSecondaryText}>Apple / iCloud (CalDAV)</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Server URL</Text>
                    <TextInput
                      value={serverUrl}
                      onChangeText={setServerUrl}
                      autoCapitalize="none"
                      placeholderTextColor={colors.fg4}
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                    />
                  </View>
                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Username / Apple ID</Text>
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder="you@icloud.com"
                      placeholderTextColor={colors.fg4}
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                    />
                  </View>
                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>App-specific password</Text>
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      autoCapitalize="none"
                      secureTextEntry
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      placeholderTextColor={colors.fg4}
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                    />
                    <Text style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.fg4, marginTop: 4 }}>
                      For iCloud, generate one at account.apple.com (not your Apple ID password).
                    </Text>
                  </View>
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  <View style={styles.modalButtonsColumn}>
                    <Pressable style={styles.btnPrimary} disabled={isLoading} onPress={handleCaldav}>
                      <Text style={styles.btnPrimaryText}>{isLoading ? "Connecting…" : "Connect"}</Text>
                    </Pressable>
                    <Pressable style={styles.btnSecondary} onPress={() => setStep("providers")}>
                      <Text style={styles.btnSecondaryText}>Back</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}
