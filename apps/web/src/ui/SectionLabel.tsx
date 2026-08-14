import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type SectionLabelProps = HTMLAttributes<HTMLHeadingElement> & {
  children: ReactNode;
  level?: 2 | 3;
};

export function SectionLabel({
  children,
  className,
  level = 2,
  ...headingProps
}: SectionLabelProps) {
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <Heading
      {...headingProps}
      className={classNames(styles.sectionLabel, className)}
    >
      {children}
    </Heading>
  );
}
