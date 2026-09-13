# Windows handoff: Android review

Start from the latest `main`, using a fresh Windows clone. Web UI/Core polish (#287) and product/operational observability (#288) are merged. The next task is Android functionality and UI review, not another web redesign. Read `AGENTS.md` and the implementation plans in `docs/audits` before changing Core contracts.

## Workflow

Work iteratively, fix and test findings, and use PRs with squash merges to main. The owner authorized this loop. **Before merging each PR, obtain an independent review from an agent with clean context**, address findings, and wait for required checks on the final head. Do not deploy production automatically. Preserve provider capability restrictions and default-off rollout gates.

## Windows setup

- Use the repository's Node/pnpm versions (Node 22, pnpm 11.8.0), then `pnpm install --frozen-lockfile`.
- Install Android Studio/SDK and an emulator or connect a physical Android device. The Linux debug build succeeded with JDK 17, Android platform 36 and NDK 27.1.12297006. Use Windows installations, not copied Linux binaries, `node_modules`, Gradle caches or generated native folders.
- Verify virtualization/acceleration before assuming an emulator can run inside the Windows VM. A Linux-host emulator is not automatically available to Windows ADB or computer control.
- Run `adb devices -l`. Expo's `--device` argument uses the actual AVD name (the previous Linux AVD was `telefon`), not the `emulator-5554` serial.
- This app requires a development build; Expo Go does not include its native modules.

In a shared terminal, from `apps/client`:

```powershell
pnpm exec expo run:android --device <actual-AVD-name> --port 8081
```

After the development build is installed, subsequent sessions can use:

```powershell
pnpm exec expo start --dev-client --localhost --port 8081
adb reverse tcp:8081 tcp:8081
adb reverse tcp:7531 tcp:7531
```

Use the appropriate `adb -s <serial>` selector when multiple devices are attached. Keep Metro visible in the shared terminal. Native module changes require rebuilding the development client.

## Test API and authentication

The client defaults to `musubi.pro`. Explicitly choose the test server before using the test account. The previous test API was `http://localhost:7531`; the test account is `ui-test@musubi.test` and its password must be transferred privately.

Windows localhost is not Linux localhost. Run the API in Windows or establish a working tunnel to the existing Linux QA service. For example, with SSH already configured, `ssh -N -L 7531:127.0.0.1:7531 <user>@<linux-host>` forwards the Linux loopback API to Windows. ADB reverse then connects the Android device to that Windows port. Verify the API is running first; it was restarted on Linux for the handoff verification, but process availability is not guaranteed after moving machines.

The existing QA backend uses `DEV_AUTH_COOKIE_PREFIX=musubi-ui-qa`. When connecting to this backend, create the ignored `apps/client/.env.local`:

```dotenv
EXPO_PUBLIC_DEV_AUTH_COOKIE_PREFIX=musubi-ui-qa
```

Restart Metro after changing the environment and sign in again. Leave this unset for a backend using standard Better Auth cookies. The override only applies to development builds, also accepts the standard prefix, and does not change production authentication.

The last Android failure was login succeeding followed by protected requests returning 401: the Expo plugin ignored the QA-prefixed session cookie. A regression test now exercises the real Expo plugin's cookie persistence and subsequent request header. A temporary integration probe using the mobile auth client passed a real QA API login and protected settings request after restarting the service (native platform/storage seams mocked). Device login and persistence after an app restart still need verification. Login HTTP 200 alone is not acceptance: verify authenticated settings, events and tasks, and that the app stays signed in.

## QA state to preserve

The Linux QA directory is a sibling of the working repository: `../local-qa`. It contains private `api.env`, `account.json`, logs and local SDK/JDK setup. Transfer secrets privately; never put them in Git, screenshots or public handoff text. Do not copy the Linux SDK/JDK to Windows.

The previous database was the persistent `musubi-ui-qa-20260913` container on Linux port 55437. Preserve its volume and existing calendars/events/tasks; do not rerun seeds or reset it. The test page ID is `2f5faa73-480d-44af-a7a7-19d12c933f18`. Provider credentials/configuration are in the private environment, not in this document.

## First verification pass

```powershell
pnpm --filter @musubi/client exec tsc --noEmit
pnpm --filter @musubi/client test
```

Then check on Android:

1. Server selection, login, protected data loading, session persistence after restart, and logout.
2. Day/week/month navigation and dates/time zones; event creation, editing and deletion.
3. Tasks, status/priority updates and persistence; provider capability restrictions.
4. Settings, light/dark appearance, keyboard handling, scrolling, safe areas and font scaling.
5. Offline/reconnect behavior, errors, reminders and provider connection flows using configured test providers.

Record reproducible steps, screenshots and sanitized logs for failures. Do not assume web search/Kanban features already exist in the native UI. The Linux debug APK built successfully, but a full Android UI review has **not** been completed. Green repository CI does not replace device verification.
