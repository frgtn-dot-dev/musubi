import { type CSSProperties, type HTMLAttributes } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

/**
 * Three jobs an identity mark has here: a name in a dense list, a name in a
 * row or a stack of faces, and the account photo itself.
 */
const AVATAR_SIZES = {
    compact: 26,
    default: 32,
    profile: 64,
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

export type AvatarProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
    image?: null | string;
    name: string;
    /** A number is the way out for a measured exception, not a fourth step. */
    size?: AvatarSize | number;
};

/**
 * A decorative identity mark. The adjacent visible name remains the accessible
 * label, so image and initial variants expose the same semantics.
 */
export function Avatar({
    className,
    image,
    name,
    size = "default",
    style,
    ...spanProps
}: AvatarProps) {
    const initial = name.trim().charAt(0).toLocaleUpperCase() || "M";
    const pixels = typeof size === "number" ? size : AVATAR_SIZES[size];
    const avatarStyle = {
        ...style,
        "--avatar-size": `${pixels}px`,
    } as CSSProperties;

    return (
        <span
            {...spanProps}
            aria-hidden="true"
            className={classNames(styles.avatar, className)}
            style={avatarStyle}
        >
            <span>{initial}</span>
            {image ? (
                <img
                    alt=""
                    src={image}
                    onError={(event) => event.currentTarget.remove()}
                />
            ) : null}
        </span>
    );
}
