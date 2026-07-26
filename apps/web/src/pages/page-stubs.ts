// Pages do not have a server contract yet. These navigation stubs preserve the
// planned route shape without introducing a second calendar/event data model.
export const pageStubs = [
  { id: "my-calendar", name: "My calendar", icon: "calendar" },
  { id: "work", name: "Work", icon: "briefcase" },
  { id: "family", name: "Family", icon: "home" },
  { id: "planning", name: "Planning", icon: "grid" },
] as const;
