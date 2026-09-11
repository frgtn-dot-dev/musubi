import type { ButtonHTMLAttributes } from "react";
import { Avatar } from "./Avatar";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type AvatarStackPerson = {
  id: string;
  image?: null | string;
  name: string;
};

export type AvatarStackProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  /** Accessible name: the stack is the way into the list, not a label for it. */
  label: string;
  limit?: number;
  people: readonly AvatarStackPerson[];
};

const DEFAULT_LIMIT = 7;

/**
 * Overlapping faces that open the full list.
 *
 * What separates the circles is a ring drawn in the colour behind them, so a
 * consumer on its own palette sets `--avatar-stack-ring` and the two
 * `--avatar-stack-more-*` properties instead of restating the anatomy.
 */
export function AvatarStack({
  className,
  label,
  limit = DEFAULT_LIMIT,
  people,
  type = "button",
  ...buttonProps
}: AvatarStackProps) {

  return (
    <button
      {...buttonProps}
      aria-label={label}
      className={classNames(styles.avatarStack, className)}
      type={type}
    >
      <AvatarStackFaces people={people} limit={limit} />
    </button>
  );
}

/** Decorative stack inside an existing trigger, avoiding nested buttons. */
export function AvatarStackPreview({ people, limit = DEFAULT_LIMIT }: Pick<AvatarStackProps, "people" | "limit">) {
  return <span aria-hidden="true" className={styles.avatarStack}><AvatarStackFaces people={people} limit={limit} /></span>;
}

function AvatarStackFaces({ people, limit }: { people: readonly AvatarStackPerson[]; limit: number }) {
  const shown = people.slice(0, Math.max(0, limit));
  const hidden = people.length - shown.length;
  return <>
      {shown.map((person) => (
        <Avatar
          image={person.image}
          key={person.id}
          name={person.name}
        />
      ))}
      {hidden > 0 ? (
        <span aria-hidden="true" className={styles.avatarStackMore}>
          +{hidden}
        </span>
      ) : null}
  </>;
}
