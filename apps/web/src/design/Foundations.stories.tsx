import { MUSUBI_CALENDAR_COLORS } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import type { CSSProperties, ReactNode } from "react";
import { getReadableEventTextColor } from "~/calendar/event-color";
import { DESKTOP_MODES } from "../../.storybook/modes";
import styles from "./Foundations.stories.module.css";

const SURFACE_TOKENS = [
  "--surface-canvas",
  "--surface-panel",
  "--surface-raised",
  "--surface-overlay",
] as const;

const TEXT_TOKENS = [
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-faint",
] as const;

const ACTION_TOKENS = [
  "--accent-primary",
  "--accent-on-primary",
  "--control-fill",
  "--control-on-fill",
  "--draft-fill",
] as const;

const BORDER_TOKENS = [
  "--border-subtle",
  "--border-medium",
  "--border-strong",
] as const;

const TYPE_SCALE = [10, 11, 12, 13, 14, 15, 19, 22, 26] as const;

const FONT_FAMILIES = [
  { label: "Interface", token: "--font-sans", sample: "Plan the week" },
  { label: "Editorial", token: "--font-serif", sample: "August 2026" },
  { label: "Kanji accent", token: "--font-kanji", sample: "結び" },
  { label: "Technical", token: "--font-mono", sample: "2026-08-01 09:30" },
] as const;

const SPACING_SCALE = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const RADIUS_TOKENS = [
  "--radius-sm",
  "--event-radius",
  "--radius-chip",
  "--radius-md",
  "--radius-control",
  "--radius-lg",
  "--radius-card",
  "--radius-sheet",
  "--radius-pill",
] as const;

const MOTION_TOKENS = [
  "--motion-fast",
  "--motion-standard",
  "--motion-slow",
] as const;

const BREAKPOINTS = [
  {
    description: "Overlay navigation, FAB, and sheet adaptations.",
    label: "Narrow",
    range: "≤599 px",
  },
  {
    description: "Compact navigation and constrained workspace chrome.",
    label: "Compact",
    range: "600–1023 px",
  },
  {
    description: "Permanent sidebar with compact desktop controls.",
    label: "Desktop",
    range: "1024–1439 px",
  },
  {
    description: "Full calendar shell and comfortable content rhythm.",
    label: "Wide",
    range: "≥1440 px",
  },
] as const;

type TokenStyle = CSSProperties & Record<`--story-${string}`, string>;

function storyVariable(name: string, value: string): TokenStyle {
  return { [name]: value } as TokenStyle;
}

function PageIntro({ children, title }: { children: ReactNode; title: string }) {
  return (
    <header className={styles.intro}>
      <span className={styles.eyebrow}>Implemented source of truth</span>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

function Section({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <p className={styles.sectionCopy}>{description}</p>
      </header>
      {children}
    </section>
  );
}

function SwatchGrid({ tokens }: { tokens: readonly string[] }) {
  return (
    <div className={styles.grid}>
      {tokens.map((token) => (
        <article className={styles.tokenCard} key={token}>
          <div
            className={styles.swatch}
            style={storyVariable("--story-token", `var(${token})`)}
          />
          <div className={styles.tokenCopy}>
            <code className={styles.tokenName}>{token}</code>
          </div>
        </article>
      ))}
    </div>
  );
}

function ColorsStory() {
  return (
    <main className={styles.page}>
      <PageIntro title="Color and surfaces">
        Semantic roles change with the Storybook theme switch. Calendar pigments
        remain stable and always pair color with readable content.
      </PageIntro>
      <Section
        description="The canvas, panels, raised controls, and transient overlays."
        title="Surfaces"
      >
        <SwatchGrid tokens={SURFACE_TOKENS} />
      </Section>
      <Section
        description="Text-role pigments shown as tokens. Primary and secondary carry content; muted and faint are reserved for decorative or disabled treatment."
        title="Text"
      >
        <SwatchGrid tokens={TEXT_TOKENS} />
      </Section>
      <Section
        description="Action emphasis, filled controls, and the non-committed draft veil."
        title="Actions and state"
      >
        <SwatchGrid tokens={ACTION_TOKENS} />
      </Section>
      <Section
        description="Borders separate structure without competing with calendar events."
        title="Borders"
      >
        <SwatchGrid tokens={BORDER_TOKENS} />
      </Section>
      <Section
        description="Named Musubi calendar pigments from the shared types package."
        title="Calendar pigments"
      >
        <div className={styles.grid}>
          {MUSUBI_CALENDAR_COLORS.map((color) => (
            <article
              className={styles.paletteSwatch}
              key={color.hex}
              style={{
                ...storyVariable("--story-token", color.hex),
                "--story-foreground": getReadableEventTextColor(color.hex),
              } as TokenStyle}
            >
              <strong>{color.name}</strong>
              <span>{color.hex}</span>
            </article>
          ))}
        </div>
      </Section>
    </main>
  );
}

function TypographyStory() {
  return (
    <main className={styles.page}>
      <PageIntro title="Typography">
        Inter Tight carries dense working UI. Serif and kanji faces provide
        orientation and meaning rather than decoration.
      </PageIntro>
      <Section
        description="Each family has a specific role and should not be substituted ad hoc."
        title="Families"
      >
        <div className={styles.grid}>
          {FONT_FAMILIES.map((font) => (
            <article className={styles.typeCard} key={font.token}>
              <span className={styles.tokenMeta}>{font.label}</span>
              <p
                className={styles.typeSample}
                style={storyVariable("--story-font", `var(${font.token})`)}
              >
                {font.sample}
              </p>
              <code className={styles.tokenName}>{font.token}</code>
            </article>
          ))}
        </div>
      </Section>
      <Section
        description="The nominal pixel names keep design handoffs readable while rem values respect browser preferences."
        title="Type scale"
      >
        <div className={styles.grid}>
          {TYPE_SCALE.map((size) => {
            const token = `--text-${size}`;
            return (
              <article className={styles.typeCard} key={token}>
                <p
                  className={styles.typeSample}
                  style={storyVariable("--story-size", `var(${token})`)}
                >
                  Week planning
                </p>
                <code className={styles.tokenName}>{token}</code>
              </article>
            );
          })}
        </div>
      </Section>
    </main>
  );
}

function SpacingStory() {
  return (
    <main className={styles.page}>
      <PageIntro title="Spacing and geometry">
        Layout rhythm comes from named tokens. Domain geometry such as the time
        grid remains owned by its shared calendar math.
      </PageIntro>
      <Section
        description="The eight-step spacing scale used for gaps, padding, and layout rhythm."
        title="Spacing"
      >
        <div className={styles.grid}>
          {SPACING_SCALE.map((step) => {
            const token = `--space-${step}`;
            return (
              <article className={styles.metricCard} key={token}>
                <div className={styles.metricRow}>
                  <span
                    className={styles.spacingBar}
                    style={storyVariable("--story-size", `var(${token})`)}
                  />
                  <code className={styles.tokenName}>{token}</code>
                </div>
              </article>
            );
          })}
        </div>
      </Section>
      <Section
        description="Radius names describe stable component roles rather than one-off shapes."
        title="Radii"
      >
        <div className={styles.grid}>
          {RADIUS_TOKENS.map((token) => (
            <article className={styles.metricCard} key={token}>
              <div className={styles.metricRow}>
                <span
                  className={styles.radiusSample}
                  style={storyVariable("--story-radius", `var(${token})`)}
                />
                <code className={styles.tokenName}>{token}</code>
              </div>
            </article>
          ))}
        </div>
      </Section>
      <Section
        description="Overlay elevation is shared instead of recreated per dialog or popover."
        title="Elevation"
      >
        <div className={styles.shadowSample} />
      </Section>
    </main>
  );
}

function MotionStory() {
  return (
    <main className={styles.page}>
      <PageIntro title="Motion">
        Motion communicates state and continuity. Hover or keyboard-focus each
        sample to compare the implemented durations.
      </PageIntro>
      <Section
        description="Reduced-motion preferences globally collapse these durations."
        title="Duration scale"
      >
        <div className={styles.grid}>
          {MOTION_TOKENS.map((token) => (
            <article className={styles.metricCard} key={token}>
              <div
                className={styles.motionSample}
                style={storyVariable("--story-duration", `var(${token})`)}
                tabIndex={0}
              >
                <span className={styles.motionDot} />
              </div>
              <code className={styles.tokenName}>{token}</code>
            </article>
          ))}
        </div>
      </Section>
    </main>
  );
}

function ResponsiveStory() {
  return (
    <main className={styles.page}>
      <PageIntro title="Responsive contract">
        Musubi adapts hierarchy and interaction at one shared breakpoint ladder;
        narrow UI is not a scaled-down desktop.
      </PageIntro>
      <Section
        description="All web feature work uses these four ranges."
        title="Breakpoint ladder"
      >
        <div className={styles.grid}>
          {BREAKPOINTS.map((breakpoint) => (
            <article className={styles.breakpointCard} key={breakpoint.label}>
              <span className={styles.range}>{breakpoint.range}</span>
              <strong>{breakpoint.label}</strong>
              <p className={styles.sectionCopy}>{breakpoint.description}</p>
            </article>
          ))}
        </div>
      </Section>
    </main>
  );
}

const meta = {
  parameters: {
    layout: "fullscreen",
  },
  title: "Foundations/Tokens",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colors: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  render: () => <ColorsStory />,
};
export const Typography: Story = { render: () => <TypographyStory /> };
export const SpacingAndShape: Story = { render: () => <SpacingStory /> };
export const Motion: Story = { render: () => <MotionStory /> };
export const Responsive: Story = { render: () => <ResponsiveStory /> };
