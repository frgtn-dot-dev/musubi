import { CalendarDays, Cloud, CloudCog, Grid2X2 } from "lucide-react";
import { BrandMark } from "~/components/BrandMark";
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
