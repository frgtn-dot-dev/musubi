import { type HTMLAttributes, type ReactNode, useId } from "react";
import { classNames } from "./class-names";
import { HelpTooltip } from "./HelpTooltip";
import { SectionLabel } from "./SectionLabel";
import styles from "./primitives.module.css";

export type SettingsSectionProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> & {
  children: ReactNode;
  /** One line under the heading, for what the whole group does or does not do. */
  description?: ReactNode;
  /** Optional background help, separate from the visible section description. */
  help?: ReactNode;
  /** Use 2 directly under a page title; dialogs normally use 3. */
  headingLevel?: 2 | 3;
  /** Let an already padded parent own the outer spacing; rows keep their inset. */
  inset?: boolean;
  title: ReactNode;
};

/**
 * One named group of settings rows.
 *
 * The section owns the layer-aligned outer rhythm and the inset group surface;
 * Row continues to own each item's content, state, and interaction semantics.
 */
export function SettingsSection({
  children,
  className,
  description,
  help,
  headingLevel = 3,
  inset = true,
  title,
  ...sectionProps
}: SettingsSectionProps) {
  const headingId = useId();
  const heading = <SectionLabel id={headingId} level={headingLevel}>{title}</SectionLabel>;

  return (
    <section
      {...sectionProps}
      aria-labelledby={headingId}
      className={classNames(styles.settingsSection, className)}
      data-inset={inset ? undefined : "false"}
    >
      {help ? <div className={styles.labelWithHelp}>
        {heading}
        <HelpTooltip label={typeof title === "string" ? `Help for ${title}` : "Section help"}>{help}</HelpTooltip>
      </div> : heading}
      {description ? (
        <p className={styles.settingsSectionDescription}>{description}</p>
      ) : null}
      <div className={styles.settingsSectionRows}>{children}</div>
    </section>
  );
}
