import { type HTMLAttributes, type ReactNode, useId } from "react";
import { classNames } from "./class-names";
import { SectionLabel } from "./SectionLabel";
import styles from "./primitives.module.css";

export type SettingsSectionProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> & {
  children: ReactNode;
  /** One line under the heading, for what the whole group does or does not do. */
  description?: ReactNode;
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
  title,
  ...sectionProps
}: SettingsSectionProps) {
  const headingId = useId();

  return (
    <section
      {...sectionProps}
      aria-labelledby={headingId}
      className={classNames(styles.settingsSection, className)}
    >
      <SectionLabel id={headingId} level={3}>
        {title}
      </SectionLabel>
      {description ? (
        <p className={styles.settingsSectionDescription}>{description}</p>
      ) : null}
      <div className={styles.settingsSectionRows}>{children}</div>
    </section>
  );
}
