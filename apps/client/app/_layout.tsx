import { ServerProvider, useServer } from '@/contexts/ServerContext';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Stack, SplashScreen, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import { InterTight_400Regular, InterTight_500Medium } from '@expo-google-fonts/inter-tight';
import { NotoSerif_400Regular } from '@expo-google-fonts/noto-serif';
import { ShipporiMinchoB1_400Regular } from '@expo-google-fonts/shippori-mincho-b1';
import { colors, styles } from '@/constants/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

SplashScreen.preventAutoHideAsync();

function AppContent() {
  const { isLoading, authClient } = useServer();
  const router = useRouter();

  const [loaded, error] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    NotoSerif_400Regular,
    ShipporiMinchoB1_400Regular,
  });

  const { data: session, isPending } = authClient.useSession();

  const ready = (loaded || !!error) && !isPending && !isLoading;

  const everReady = useRef(false);
  if (ready) everReady.current = true;

  const navigated = useRef(false);
  useEffect(() => {
    if (!ready || navigated.current) return;
    navigated.current = true;
    router.replace(session ? '/(tabs)' : '/(auth)/welcome');
  }, [ready]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!everReady.current) return null;

  return (
    <Stack screenOptions={{ statusBarStyle: 'auto', navigationBarHidden: true, headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}

function AppLoader() {
  const { apiUrl } = useServer();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppContent key={apiUrl ?? 'loading'} />
      </View>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  return (
    <ServerProvider>
      <AppLoader />
    </ServerProvider>
  );
}
