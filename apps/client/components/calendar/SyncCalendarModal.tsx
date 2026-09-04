import { colors, fonts, styles } from "@/constants/theme";
import { useServer } from "@/contexts/ServerContext";
import { useApi } from "@/services/api";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useEffect, useState } from "react";
import { Text, Pressable, ScrollView, View, TextInput, Alert, Linking } from "react-native";
import { ModalPortal as Modal } from "@/components/ui/ModalPortal";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "@/components/ui/Tap";
import { Btn } from "@/components/ui/Btn";
import { GoogleG } from "@/components/auth/SocialAuthButtons";
import * as haptics from "@/lib/haptics";
import { fetchWithTimeout, userFacingError } from "@/lib/network";
import { hasSeenGoogleDisclosure, markGoogleDisclosureSeen } from "@/lib/googleDisclosure";
import { parseInviteLink } from "@musubi/types";
import { router } from "expo-router";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import {
  disconnectFederatedServer,
  loadFederatedAccounts,
  refreshFederatedAccounts,
  type FederatedAccount,
} from "@/services/federation";

const ICLOUD_URL = "https://caldav.icloud.com";
const PRIVACY_URL = "https://musubi.pro/privacy/";

type Step = "providers" | "google" | "apple" | "caldav" | "musubi";

type Props = {
  visible: boolean;
  onClose: () => void;
  onConnected: (provider: "google" | "microsoft" | "caldav" | "musubi") => void;
  /** Where the OAuth round-trip lands — onboarding passes its own step so
   *  connecting doesn't dump the user into the app. */
  callbackURL?: string;
};

export default function SyncCalendarModal({ visible, onClose, onConnected, callbackURL = "/(tabs)" }: Props) {
  const { authClient, apiUrl } = useServer();
  const api = useApi();

  // Which providers this server can actually sync (same pattern as the welcome
  // screen's social buttons). null = unknown (old server / fetch failed) →
  // show everything rather than an empty modal.
  const [available, setAvailable] = useState<string[] | null>(null);
  // Has the user already seen the Google data-use disclosure? Gates whether
  // tapping "Google Calendar" shows the disclosure step or goes straight to OAuth.
  const [googleAcked, setGoogleAcked] = useState(false);
  useEffect(() => {
    if (!visible || !apiUrl) return;
    fetchWithTimeout(`${apiUrl}/api/v1/server`)
      .then((res) => res.json())
      .then(({ syncProviders }) => setAvailable(Array.isArray(syncProviders) ? syncProviders : null))
      .catch(() => setAvailable(null));
    hasSeenGoogleDisclosure().then(setGoogleAcked);
  }, [visible, apiUrl]);
  const shows = (provider: string) => !available || available.includes(provider);

  const [step, setStep] = useState<Step>("providers");
  // Musubi servers this account is federated with. Loaded when that step opens,
  // from the home server (the source of truth) with the local registry as the
  // offline fallback.
  const [servers, setServers] = useState<FederatedAccount[]>([]);
  const calendars = useCalendarsStore((state) => state.calendars);
  // A member token can be revoked or expire, and it can only be replaced by
  // accepting a new invite — so that state is worth naming rather than leaving
  // the server looking merely quiet. The flag rides on its calendars, set by the
  // federated sync when the origin rejected us.
  const needsInvite = (account: FederatedAccount) =>
    calendars.some(
      (calendar) =>
        calendar.serverUrl === account.server &&
        calendar.syncStatus === "reconnect_required",
    );
  const [serversBusy, setServersBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // which OAuth button is mid-flight — only that one shows a spinner
  const [loadingProvider, setLoadingProvider] = useState<"google" | "microsoft" | null>(null);

  const closeSequence = () => {
    onClose();
    setStep("providers");
    setInviteLink("");
    setServerUrl("");
    setUsername("");
    setPassword("");
    setError("");
    setIsLoading(false);
    setLoadingProvider(null);
  };

  const { slideStyle, fadeStyle, gesture, handleClose, onSheetLayout } = useModalAnimation(visible, closeSequence);

  // Shared OAuth link flow — Google and Microsoft only differ in the
  // calendar scope their provider expects.
  const handleOAuth = async (provider: "google" | "microsoft", scopes: string[], label: string) => {
    if (loadingProvider) return; // one OAuth round-trip at a time
    setLoadingProvider(provider);
    try {
      const { error } = await authClient.linkSocial({
        provider,
        scopes,
        callbackURL,
      });
      if (error) throw new Error(error.message ?? `${label} connect failed`);
      if (provider === "google") {
        void markGoogleDisclosureSeen();
        setGoogleAcked(true);
      }
      haptics.success();
      onConnected(provider);
      handleClose();
    } catch (e: any) {
      haptics.warn();
      Alert.alert(`${label} connect failed`, userFacingError(e));
    } finally {
      setLoadingProvider(null);
    }
  };
  // Narrowest Google scopes for our two-way event, calendar, and task sync.
  const handleGoogle = () => handleOAuth("google", [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist",
    "https://www.googleapis.com/auth/calendar.calendars",
    "https://www.googleapis.com/auth/tasks",
  ], "Google");
  // Show the data-use disclosure before the first Google authorization; once
  // the user has connected a Google calendar, go straight to OAuth.
  const startGoogle = () => (googleAcked ? handleGoogle() : setStep("google"));
  const handleMicrosoft = () => handleOAuth("microsoft", ["Calendars.ReadWrite", "Tasks.ReadWrite"], "Outlook");

  const openMusubi = async () => {
    setStep("musubi");
    setError("");
    setServersBusy(true);
    try {
      setServers(await refreshFederatedAccounts());
    } catch {
      // Offline or the home server is down: the cached registry still names the
      // servers, which is enough to read and to disconnect from later.
      setServers(await loadFederatedAccounts());
    } finally {
      setServersBusy(false);
    }
  };

  const openInvite = () => {
    const parsed = parseInviteLink(inviteLink, apiUrl ?? "");
    if (!parsed) {
      setError("That is not an invite link. Paste the whole link, or just its code.");
      return;
    }
    // The invite screen already previews and accepts, for this server and for a
    // federated one — routing there beats a second copy of that flow.
    handleClose();
    router.push({
      pathname: "/invite/[token]",
      params: { token: parsed.token, ...(parsed.server ? { server: parsed.server } : {}) },
    });
  };

  const disconnectServer = (account: FederatedAccount) => {
    Alert.alert(
      `Disconnect ${account.label}?`,
      "Its calendars disappear from this account. Nothing is deleted on that server, and a new invite can bring them back.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Disconnect",
          onPress: () => {
            void (async () => {
              try {
                await disconnectFederatedServer(account.server);
                haptics.success();
                setServers((current) => current.filter((s) => s.id !== account.id));
                onConnected("musubi");
              } catch (e: any) {
                haptics.warn();
                Alert.alert("Could not disconnect", userFacingError(e));
              }
            })();
          },
        },
      ],
    );
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
      haptics.success();
      onConnected("caldav");
      handleClose();
    } catch (e: any) {
      haptics.warn();
      // The server distinguishes credential/discovery failures from a failed
      // initial event import. Surface that distinction instead of replacing
      // every failure with the same credentials hint.
      setError(userFacingError(e, "Could not connect — check your credentials."));
    } finally {
      setIsLoading(false);
    }
  };

  const title =
    step === "musubi" ? "Musubi servers"
      : step === "google" ? "Connect Google Calendar"
      : step === "apple" ? "Connect Apple / iCloud"
      : step === "caldav" ? "Connect CalDAV"
      : "Sync a Calendar";

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
          <Pressable style={{ flex: 1 }} onPress={handleClose} accessible={false} />
        </Animated.View>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.modalSheet, fadeStyle, slideStyle]} onLayout={e => onSheetLayout(e.nativeEvent.layout.height)}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>{title}</Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {step === "providers" && (
                <View style={styles.modalButtonsColumn}>
                  {shows("google") && (
                    <Btn
                      label="Google Calendar"
                      variant="secondary"
                      icon={<Ionicons name="logo-google" size={16} color={colors.fg2} />}
                      loading={loadingProvider === "google"}
                      onPress={startGoogle}
                    />
                  )}
                  {shows("microsoft") && (
                    <Btn
                      label="Outlook"
                      variant="secondary"
                      icon={<Ionicons name="logo-microsoft" size={16} color={colors.fg2} />}
                      loading={loadingProvider === "microsoft"}
                      onPress={handleMicrosoft}
                    />
                  )}
                  {shows("caldav") && (
                    <>
                      <Btn
                        label="Apple / iCloud"
                        variant="secondary"
                        icon={<Ionicons name="logo-apple" size={16} color={colors.fg2} />}
                        onPress={() => setStep("apple")}
                      />
                      <Btn
                        label="Other (CalDAV)"
                        variant="secondary"
                        icon={<Ionicons name="cloud" size={16} color={colors.fg2} />}
                        onPress={() => setStep("caldav")}
                      />
                    </>
                  )}
                  {/* Not a provider: another Musubi server is people you share
                      with, not a system to mirror. It sits here because this is
                      where someone looks for "add calendars from somewhere else". */}
                  <Btn
                    label="Musubi server"
                    variant="secondary"
                    icon={<Ionicons name="git-network" size={16} color={colors.fg2} />}
                    onPress={() => void openMusubi()}
                  />
                </View>
              )}

              {step === "musubi" && (
                <>
                  <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 12 }}>
                    <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.fg2, lineHeight: 21 }}>
                      Calendars shared from another Musubi server. Paste an invite
                      link to join one — your server does the handshake and keeps
                      the credentials, so nothing secret lands on this phone.
                    </Text>
                    <View style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Invite link</Text>
                    <TextInput
                      style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                      placeholder="https://server/invite/…"
                      placeholderTextColor={colors.fg4}
                      value={inviteLink}
                      onChangeText={(value) => { setInviteLink(value); setError(""); }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      onSubmitEditing={openInvite}
                      returnKeyType="go"
                    />
                    </View>
                    {error ? (
                      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.accent }}>{error}</Text>
                    ) : null}
                  </View>
                  <View style={styles.modalButtonsColumn}>
                    <Btn label="Open invite" variant="secondary" disabled={!inviteLink.trim()} onPress={openInvite} />
                  </View>

                  <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 10 }}>
                    <Text style={[styles.sectionLabel, { paddingHorizontal: 0 }]}>Connected</Text>
                    {serversBusy && servers.length === 0 ? (
                      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3 }}>Loading…</Text>
                    ) : servers.length === 0 ? (
                      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3 }}>
                        No other servers yet. An invite link is the only way in — there is no directory to search.
                      </Text>
                    ) : (
                      servers.map((account) => (
                        <View
                          key={account.id}
                          style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: colors.fg }}>
                              {account.label}
                            </Text>
                            <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.fg3 }}>
                              {needsInvite(account) ? "Needs a new invite" : "Connected"}
                            </Text>
                          </View>
                          <Btn
                            label="Disconnect"
                            variant="secondary"
                            onPress={() => disconnectServer(account)}
                          />
                        </View>
                      ))
                    )}
                  </View>
                  <View style={styles.modalButtonsColumn}>
                    <Btn label="Back" variant="secondary" onPress={() => setStep("providers")} />
                  </View>
                </>
              )}

              {step === "google" && (
                <>
                  <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 12 }}>
                    <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.fg2, lineHeight: 21 }}>
                      Musubi will access the calendars and events you select to display them in Musubi and synchronize changes both ways. You can create, edit, and delete events and calendars you own. Synced calendar data and OAuth credentials are stored by your Musubi server so synchronization can continue in the background.
                    </Text>
                    <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.fg2, lineHeight: 21 }}>
                      Google Calendar data is not used for advertising, profiling, or AI training. You can disconnect your account at any time to remove stored credentials and synchronized copies.
                    </Text>
                    <Tap onPress={() => Linking.openURL(PRIVACY_URL)}>
                      <Text style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: colors.accent }}>
                        Privacy Policy
                      </Text>
                    </Tap>
                  </View>
                  <View style={styles.modalButtonsColumn}>
                    <Btn
                      label="Continue to Google"
                      variant="secondary"
                      icon={<GoogleG size={18} />}
                      loading={loadingProvider === "google"}
                      onPress={handleGoogle}
                    />
                    <Btn label="Back" variant="secondary" onPress={() => setStep("providers")} />
                  </View>
                </>
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
                    <Tap onPress={() => Linking.openURL("https://account.apple.com")}>
                      <Text style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent }}>
                        Open account.apple.com →
                      </Text>
                    </Tap>
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
                    <Btn label="Connect" loading={isLoading} onPress={() => handleCaldav(ICLOUD_URL)} />
                    <Btn label="Back" variant="secondary" onPress={() => setStep("providers")} />
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
                    <Btn label="Connect" loading={isLoading} onPress={() => handleCaldav(serverUrl)} />
                    <Btn label="Back" variant="secondary" onPress={() => setStep("providers")} />
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
