import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { serverStoragePrefix } from "@/lib/serverUrl";
import { authCookiePrefixes } from "@/lib/authCookiePrefixes";
import { diagnosticFetchFor } from "@/lib/serverDiagnostics";

export function createClient(url: string) {
  return createAuthClient({
    baseURL: url,
		fetchOptions: { customFetchImpl: diagnosticFetchFor(url) },
    plugins: [
      expoClient({
        scheme: "musubi",
        cookiePrefix: authCookiePrefixes(__DEV__, process.env.EXPO_PUBLIC_DEV_AUTH_COOKIE_PREFIX),
        storagePrefix: serverStoragePrefix(url),
        storage: SecureStore,
      })
    ]
  });
}
