import { Info, X } from "lucide-react";
import { useId } from "react";
import { IconButton } from "~/ui/Button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "~/ui/Popover";
import { focusMovedToAnotherLayer } from "../layer-focus";
import styles from "./CalendarCoverageInfo.module.css";

/** Standing provider limits stay available without taking space from events. */
export function CalendarCoverageInfo({ message }: { message: string }) {
  const descriptionId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Calendar sync coverage" size="compact">
          <Info aria-hidden="true" size={17} strokeWidth={1.6} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-describedby={descriptionId}
        aria-label="Calendar sync coverage"
        className={styles.details}
        onClick={(event) => event.stopPropagation()}
        onFocusOutside={(event) => {
          if (!focusMovedToAnotherLayer(event.target)) event.preventDefault();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Sync coverage</h2>
          <PopoverClose asChild>
            <IconButton label="Close sync coverage" size="compact">
              <X aria-hidden="true" size={17} strokeWidth={1.6} />
            </IconButton>
          </PopoverClose>
        </div>
        <div className={styles.body}>
          <p className={styles.description} id={descriptionId}>{message}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
