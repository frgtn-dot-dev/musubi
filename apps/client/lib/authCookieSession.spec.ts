import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "android" }, AppState: { addEventListener: vi.fn(() => ({remove: vi.fn()})) } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "musubi" } } }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `musubi://${path}` }));
vi.mock("expo-network", () => ({ addNetworkStateListener: vi.fn(() => ({remove: vi.fn()})) }));
import { expoClient } from "@better-auth/expo/client";
import { authCookiePrefixes } from "./authCookiePrefixes";

describe("Expo QA session persistence", () => {
  it("persists a custom-prefix sign-in cookie and sends it on protected API requests", async () => {
    const values = new Map<string, string>();
    const plugin = expoClient({ scheme: "musubi", cookiePrefix: authCookiePrefixes(true, "musubi-ui-qa"), storagePrefix: "qa",
      storage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => {values.set(key, value);} } });
    const fetchPlugin = plugin.fetchPlugins![0];
    await fetchPlugin.hooks!.onSuccess!({ response: new Response("{}", {headers: {"set-cookie": "musubi-ui-qa.session_token=synthetic-test-token; Path=/; Max-Age=3600; HttpOnly"}}), request: {url: "http://localhost:7531/api/auth/sign-in/email"}, data: {} } as never);
    const request = await fetchPlugin.init!("http://localhost:7531/api/v1/events", {});
    expect(request!.options!.headers).toMatchObject({cookie: "musubi-ui-qa.session_token=synthetic-test-token"});
  });
});
