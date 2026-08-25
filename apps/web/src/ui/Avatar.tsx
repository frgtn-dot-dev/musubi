import { type CSSProperties, type HTMLAttributes } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type AvatarProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
    image?: null | string;
    name: string;
    size?: number;
};

/**
 * A decorative identity mark. The adjacent visible name remains the accessible
 * label, so image and initial variants expose the same semantics.
 */
export function Avatar({
    className,
    image,
    name,
    size = 36,
    style,
    ...spanProps
}: AvatarProps) {
    const initial = name.trim().charAt(0).toLocaleUpperCase() || "M";
    const avatarStyle = {
        ...style,
        "--avatar-size": `${size}px`,
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
