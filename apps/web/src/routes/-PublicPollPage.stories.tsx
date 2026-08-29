import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { useState } from "react";
import { MOBILE_MODES } from "../../.storybook/modes";
import {
  PublicPollPage,
  type PublicPollOption,
  type PublicPollParticipant,
  type PublicPollVote,
} from "./-PublicPollPage";

const ORGANIZER = {
  id: "organizer",
  image: null,
  name: "Tomas Novák",
};

const PARTICIPANTS: PublicPollParticipant[] = [
  {
    id: "petra",
    image: null,
    name: "Petra Svobodová",
    responseLabel: "Answered",
  },
  {
    id: "martin",
    image: null,
    name: "Martin Dvořák",
    responseLabel: "Answered",
  },
  { id: "jana", image: null, name: "Jana Kovářová", responseLabel: "Answered" },
  { id: "jakub", image: null, name: "Jakub Malý", responseLabel: "Answered" },
];

const OPTIONS: PublicPollOption[] = [
  {
    counts: { yes: 3, "if-needed": 1, no: 0 },
    dateLabel: "Wednesday, 11 June",
    id: "wed-11",
    note: "Early option",
    start: "2026-06-11T19:00:00+02:00",
    timeLabel: "19:00–20:30",
  },
  {
    counts: { yes: 4, "if-needed": 0, no: 0 },
    dateLabel: "Friday, 13 June",
    id: "fri-13",
    note: "Most popular so far",
    start: "2026-06-13T19:00:00+02:00",
    timeLabel: "19:00–20:30",
  },
  {
    counts: { yes: 2, "if-needed": 2, no: 0 },
    dateLabel: "Saturday, 14 June",
    id: "sat-14",
    note: "Weekend option",
    start: "2026-06-14T19:00:00+02:00",
    timeLabel: "19:00–20:30",
  },
  {
    counts: { yes: 2, "if-needed": 1, no: 1 },
    dateLabel: "Friday, 20 June",
    id: "fri-20",
    note: "Backup option",
    start: "2026-06-20T19:00:00+02:00",
    timeLabel: "19:00–20:30",
  },
];

const ANSWERS: Record<string, PublicPollVote | null> = {
  "fri-13": "yes",
  "fri-20": "no",
  "sat-14": "if-needed",
  "wed-11": "yes",
};

type PreviewState = "open" | "answered" | "closed";

function PublicPollPreview({
  initialState = "open",
}: {
  initialState?: PreviewState;
}) {
  const [answers, setAnswers] = useState<Record<string, PublicPollVote | null>>(
    initialState === "open" ? {} : ANSWERS,
  );
  const [submitted, setSubmitted] = useState(initialState !== "open");
  const [dirty, setDirty] = useState(false);
  const state =
    initialState === "closed" ? "closed" : submitted ? "answered" : "open";
  const participants = submitted
    ? [
        { id: "you", image: null, name: "You", responseLabel: "Saved" },
        ...PARTICIPANTS,
      ]
    : PARTICIPANTS;
  const options = OPTIONS.map((option) => {
    const answer = submitted ? answers[option.id] : null;
    if (!answer) return option;

    return {
      ...option,
      counts: {
        ...option.counts,
        [answer]: option.counts[answer] + 1,
      },
    };
  });

  return (
    <PublicPollPage
      answers={answers}
      deadlineLabel="Monday, 8 June · 18:00"
      description="Choose every evening that could work for our team dinner after the June release."
      durationLabel="90 minutes"
      leadingOptionIds={["fri-13"]}
      onAnswer={(optionId, answer) => {
        setAnswers((current) => ({ ...current, [optionId]: answer }));
        setDirty(true);
      }}
      onSubmit={() => {
        setSubmitted(true);
        setDirty(false);
      }}
      options={options}
      organizer={ORGANIZER}
      organizerNote="We are planning an unhurried team dinner after the June release. Pick every time you could make—even if one is only a maybe."
      participants={participants}
      selectedOptionId={initialState === "closed" ? "fri-13" : undefined}
      state={state}
      submitDisabled={submitted && !dirty}
      title="June release dinner"
    />
  );
}

const meta = {
  component: PublicPollPreview,
  parameters: {
    layout: "fullscreen",
  },
  title: "Screens/Public scheduler",
} satisfies Meta<typeof PublicPollPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const Answered: Story = {
  args: {
    initialState: "answered",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstNoAnswer = canvas.getAllByRole("button", { name: "No" })[0];

    await userEvent.click(firstNoAnswer);
    await expect(firstNoAnswer).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getByRole("button", { name: "Save changes" }),
    ).toBeEnabled();
  },
};

export const ParticipantModal: Story = {
  args: {
    initialState: "answered",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", { name: "View 5 participants" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Participants" });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};

export const Closed: Story = {
  args: {
    initialState: "closed",
  },
};

export const Narrow: Story = {
  globals: {
    isRotated: false,
    value: "mobile1",
  },
  parameters: {
    chromatic: {
      modes: MOBILE_MODES,
    },
  },
};
