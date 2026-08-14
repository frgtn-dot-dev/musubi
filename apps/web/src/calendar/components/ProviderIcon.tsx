import { CalendarDays, Cloud, CloudCog, Grid2X2 } from "lucide-react";
import { BrandMark } from "~/components/BrandMark";
import { ProviderGlyph } from "~/ui/ProviderGlyph";
import styles from "./styles/provider-icon.module.css";

type ProviderIconProps = {
  flavor: string | null;
};

/**
 * Decorative source marks. The adjacent account heading always carries the
 * readable provider/account name, so these never become the only signal.
 */
export function ProviderIcon({ flavor }: ProviderIconProps) {
  let mark;
  if (flavor === "google") {
    mark = <CalendarDays size={17} strokeWidth={1.8} />;
  } else if (flavor === "microsoft") {
    mark = <Grid2X2 size={16} strokeWidth={1.7} />;
  } else if (flavor === "apple") {
    mark = <Cloud size={17} strokeWidth={1.7} />;
  } else if (flavor === "caldav") {
    mark = <CloudCog size={17} strokeWidth={1.7} />;
  } else {
    mark = (
      <BrandMark
        aria-hidden="true"
        className={styles.musubiMark}
        focusable="false"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={styles.icon}
      data-provider={flavor ?? "musubi"}
    >
      {mark}
    </span>
  );
}

/**
 * The mark for an *account*, rather than for an event's source.
 *
 * A connected account is the provider speaking for itself, the same as on a
 * connect button, so it gets the real brand mark. CalDAV has no brand and a
 * Musubi calendar has ours, so both fall back to the line marks above.
 */
export function AccountMark({ flavor }: ProviderIconProps) {
  const brand = <ProviderGlyph provider={flavor ?? ""} />;
  if (flavor === "google" || flavor === "microsoft" || flavor === "apple") {
    return (
      <span aria-hidden="true" className={styles.icon} data-provider={flavor}>
        {brand}
      </span>
    );
  }

  return <ProviderIcon flavor={flavor} />;
}
