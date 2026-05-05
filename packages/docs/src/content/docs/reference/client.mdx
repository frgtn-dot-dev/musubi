---
title: Client
description: Reference for the Musubi React Native / Expo client app.
---

import { Aside } from '@astrojs/starlight/components';

The client is a React Native app built with [Expo](https://expo.dev) and [Expo Router](https://docs.expo.dev/router/introduction/).

## Tech stack

| Concern | Library |
|---|---|
| Framework | Expo / React Native |
| Routing | Expo Router (file-based) |
| State management | Zustand |
| Calendar UI | `react-native-big-calendar` |
| Auth | Better Auth client |
| Fonts | Inter Tight, Noto Serif, Shippori Mincho |

## File structure

```
apps/client/
├── app/
│   ├── _layout.tsx          # Root layout — auth guard + font loading
│   ├── (auth)/
│   │   ├── welcome.tsx      # Onboarding / landing screen
│   │   ├── sign-in.tsx      # Email + password sign-in
│   │   └── sign-up.tsx      # Registration
│   ├── (tabs)/
│   │   ├── index.tsx        # Calendar view (main screen)
│   │   ├── agenda.tsx       # Agenda / list view
│   │   ├── calendars.tsx    # Manage calendars
│   │   └── settings.tsx     # User settings
│   └── invite/
│       └── [token].tsx      # Deep-link invite acceptance
├── components/
│   └── calendar/            # Calendar-specific components
├── constants/
│   ├── colors.ts            # Named app colors (bone, shu, moss…)
│   ├── theme.ts             # StyleSheet + calendarTheme config
│   ├── const.ts             # Locale constants (Japanese month/day names)
│   └── types.ts             # Shared TypeScript types
├── hooks/                   # Custom React hooks
├── services/                # API service functions
└── store/                   # Zustand stores
```

## Screens

### Calendar (`app/(tabs)/index.tsx`)

The main screen. Shows a weekly or daily calendar view powered by `react-native-big-calendar`. Tap an event to see details; use the FAB to create a new event.

### Agenda (`app/(tabs)/agenda.tsx`)

A scrollable list of upcoming events across all joined calendars, grouped by date.

### Calendars (`app/(tabs)/calendars.tsx`)

Manage your calendars — create new ones, view members, send invites, or leave a calendar.

### Settings (`app/(tabs)/settings.tsx`)

Account settings, display name, sign out.

### Invite (`app/invite/[token].tsx`)

Handles deep links for calendar invitations. Accepts or rejects an invite by token.

## Color palette

The app uses a fixed dark palette defined in `constants/colors.ts` and `constants/theme.ts`.

| Token | Hex | Usage |
|---|---|---|
| `bone` | `#E8E4D9` | Primary foreground text |
| `shu` | `#C8553D` | Accent — buttons, highlights, errors |
| `moss` | `#A8B5A0` | Secondary accents |
| `ochre` | `#D4A574` | Inline code, warm highlights |
| `indigo` | `#7A8BA3` | Info/note accents |
| `bg` | `#0c0c0e` | Main background |
| `bg1` | `#131316` | Card / sidebar background |
| `bg2` | `#1a1a1e` | Elevated surfaces |
| `bg3` | `#222226` | Pill / chip backgrounds |

## State management

Zustand stores live in `store/`. Each slice of state (auth, calendars, events) is a separate store file. Access them with their respective hooks — never mutate state directly.

<Aside type="tip">
  Keep the Zustand stores as the single source of truth. Components should read from stores and call service functions which update the store after a successful API response.
</Aside>

## Adding a new screen

1. Create a file in the appropriate `app/` folder (e.g. `app/(tabs)/my-screen.tsx`).
2. Export a default React component.
3. If it's a tab, add it to `app/(tabs)/_layout.tsx`.
4. Use `colors` from `constants/theme.ts` and `styles` from `constants/theme.ts` — don't hardcode colors.
