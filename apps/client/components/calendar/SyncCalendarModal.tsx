import { colors, fonts, styles } from "@/constants/theme";
import { useServer } from "@/contexts/ServerContext";
import { useApi } from "@/services/api";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useState } from "react";
import { Text, Modal, Pressable, ScrollView, View, TextInput, Alert, Linking } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

const ICLOUD_URL = "https://caldav.icloud.com";

type Step = "providers" | "apple" | "caldav";

type Props = {
  visible: boolean;
  onClose: () => void;
  onConnected: () => void;
};

export default function SyncCalendarModal({ visible, onClose, onConnected }: Props) {
  const { authClient } = useServer();
  const api = useApi();

  const [step, setStep] = useState<Step>("providers");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const closeSequence = () => {
    onClose();
    setStep("providers");
    setServerUrl("");
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

  // Shared for Apple (fixed iCloud server) and generic CalDAV.
  const handleCaldav = async (url: string) => {
    if (!url || !username || !password) {
      setError("All fields are required.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await api.connectCaldav(url, username, password);
      onConnected();
      handleClose();
    } catch {
      setError("Could not connect — check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  const title =
    step === "apple" ? "Connect Apple / iCloud" : step === "caldav" ? "Connect CalDAV" : "Sync a Calendar";

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
              <Text style={styles.modalTitle}>{title}</Text>
            </View>

            <ScrollView>
              {step === "providers" && (
                <View style={styles.modalButtonsColumn}>
                  <Pressable style={styles.btnSecondary} disabled={isLoading} onPress={handleGoogle}>
                    <Text style={styles.btnSecondaryText}>Google Calendar</Text>
                  </Pressable>
                  <Pressable style={styles.btnSecondary} onPress={() => setStep("apple")}>
                    <Text style={styles.btnSecondaryText}>Apple / iCloud</Text>
                  </Pressable>
                  <Pressable style={styles.btnSecondary} onPress={() => setStep("caldav")}>
                    <Text style={styles.btnSecondaryText}>Other (CalDAV)</Text>
                  </Pressable>
                </View>
              )}

              {step === "apple" && (
                <>
                  <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 6 }}>
                    <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg2 }}>
                      iCloud needs an <Text style={{ fontFamily: fonts.sansMedium }}>app-specific password</Text> — not your Apple ID password.
                    </Text>
                    <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.fg3 }}>
                      1. Open account.apple.com → Sign-In & Security.{"\n"}
                      2. App-Specific Passwords → generate one (name it “Musubi”).{"\n"}
                      3. Paste it below with your Apple ID.
                    </Text>
                    <Pressable onPress={() => Linking.openURL("https://account.apple.com")}>
                      <Text style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent }}>
                        Open account.apple.com →
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Apple ID</Text>
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
                  </View>
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  <View style={styles.modalButtonsColumn}>
                    <Pressable style={styles.btnPrimary} disabled={isLoading} onPress={() => handleCaldav(ICLOUD_URL)}>
                      <Text style={styles.btnPrimaryText}>{isLoading ? "Connecting…" : "Connect"}</Text>
                    </Pressable>
                    <Pressable style={styles.btnSecondary} onPress={() => setStep("providers")}>
                      <Text style={styles.btnSecondaryText}>Back</Text>
                    </Pressable>
                  </View>
                </>
              )}

              {step === "caldav" && (
                <>
                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Server URL</Text>
                    <TextInput
                      value={serverUrl}
                      onChangeText={setServerUrl}
                      autoCapitalize="none"
                      placeholder="https://your.caldav.server"
                      placeholderTextColor={colors.fg4}
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                    />
                  </View>
                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Username</Text>
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      placeholderTextColor={colors.fg4}
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                    />
                  </View>
                  <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Password</Text>
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      autoCapitalize="none"
                      secureTextEntry
                      placeholderTextColor={colors.fg4}
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                    />
                  </View>
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  <View style={styles.modalButtonsColumn}>
                    <Pressable style={styles.btnPrimary} disabled={isLoading} onPress={() => handleCaldav(serverUrl)}>
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
