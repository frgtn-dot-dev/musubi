import styles from "./styles/event-delivery.module.css";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getEventDeliveryInbox } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { InlineError } from "~/ui/InlineError";
import { Row, RowAction } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import { EventDeliveryDialog } from "./EventDeliveryDialog";

type Props = {
  userId: string;
  connectionId?: string;
  onClose: () => void;
  returnFocus: HTMLElement | null;
};

export function EventDeliveryInboxDialog({
  userId,
  connectionId,
  onClose,
  returnFocus,
}: Props) {
  const [selected, setSelected] = useState<{
    id: string;
    trigger: HTMLElement;
  }>();
  const query = useInfiniteQuery({
    queryKey: [
      ...queryKeys.delivery(getServerOrigin(), userId, connectionId),
      "inbox",
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getEventDeliveryInbox(pageParam, signal, connectionId),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: "always",
  });
  const items = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.eventId, item]),
    ).values(),
  ];
  return (
    <div
      className={styles.layerBoundary}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Unfinished deliveries"
        description="Your saved changes that still need delivery or attention, including deleted events."
        closeLabel="Close unfinished deliveries"
        bodyLayout="flush"
        returnFocus={returnFocus}
        footer={
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh list
          </Button>
        }
      >
        <SettingsSection title="Saved changes">
          {query.isPending ? <Row label="Loading saved deliveries…" /> : null}
          {query.isError ? (
            <InlineError>
              Could not load unfinished deliveries. This server may be
              unavailable or may need an update.
            </InlineError>
          ) : null}
          {!query.isError && query.data && items.length === 0 ? (
            <Row
              label="No unfinished deliveries found"
              detail="This list contains your own saved operations only. It does not certify every connected calendar."
            />
          ) : null}
          {!query.isError
            ? items.map((item) => (
                <RowAction
                  key={item.eventId}
                  label={item.savedTitle || "Untitled event"}
                  detail="Open delivery records · saved title"
                  onClick={(event) =>
                    setSelected({
                      id: item.eventId,
                      trigger: event.currentTarget,
                    })
                  }
                />
              ))
            : null}
          {query.hasNextPage ? (
            <Row
              label="More saved deliveries"
              trailing={
                <Button
                  disabled={query.isFetching}
                  variant="secondary"
                  onClick={() => void query.fetchNextPage()}
                >
                  Load more
                </Button>
              }
            />
          ) : null}
        </SettingsSection>
      </Dialog>
      {selected ? (
        <EventDeliveryDialog
          key={`${userId}:${connectionId ?? "home"}:${selected.id}`}
          userId={userId}
          connectionId={connectionId}
          eventId={selected.id}
          returnFocus={selected.trigger}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </div>
  );
}
