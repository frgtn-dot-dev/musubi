import {
  announcementParagraphs,
  newestAnnouncementId,
  pendingAnnouncements,
  type Announcement,
} from "@musubi/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import musubiPackage from "../../../../../package.json";
import { getAnnouncements } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { useSessionUser } from "~/auth/use-session-user";
import { useSettingsMutations } from "~/calendar/settings-mutations";
import { Dialog } from "~/ui/Dialog";
import styles from "./AnnouncementDialog.module.css";

/** Co tenhle build je. Vite ho vloží; žádný fetch. Stejný zdroj jako use-newer-server. */
const BUILD_VERSION = musubiPackage.version;

/**
 * Ten samý dotaz pro každého, kdo se ptá "co je nového" — stejný klíč, stejné
 * `staleTime`/`refetchOnWindowFocus`. Cache je sdílená, ale `staleTime` je
 * per-observer: kdyby některé volání použilo defaulty routeru
 * (`staleTime: 30_000`, refetch při focusu), refokusování by přineslo čerstvá
 * data a modal by se probudil uprostřed práce — přesně to, co komentář v
 * `AnnouncementGate` popisuje jako nežádoucí. Proto jeden hook pro všechny tři
 * volající místa (`AnnouncementGate`, sidebar v `p.$pageId.$view.tsx`, admin
 * route), místo opakování téhle dvojice voleb na třech místech.
 */
export function useAnnouncementsQuery() {
  const { user } = useSessionUser();
  const userId = user?.id;

  return useQuery({
    enabled: Boolean(userId),
    queryFn: ({ signal }) => getAnnouncements(signal),
    queryKey: queryKeys.announcements(getServerOrigin(), userId ?? ""),
    // Jednou za načtení aplikace. Novinka, která dorazí uprostřed práce, počká
    // na příští spuštění — vyskočit lidem pod rukama je horší než počkat.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

/**
 * Text zprávy: odstavce, a odkazy jako odkazy.
 *
 * Exportované zvlášť, protože to je jediná část s pravidly, která stojí za test
 * — zbytek je zapojení dat.
 */
export function AnnouncementBody({ body }: { body: string }) {
  return (
    <>
      {announcementParagraphs(body).map((segments, index) => (
        <p className={styles.paragraph} key={index}>
          {segments.map((segment, segmentIndex) =>
            segment.type === "link" ? (
              <a
                href={segment.url}
                key={segmentIndex}
                // Odkaz ven nesmí dostat window.opener na Musubi.
                rel="noreferrer noopener"
                target="_blank"
              >
                {segment.value}
              </a>
            ) : (
              <span key={segmentIndex}>{segment.value}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}

/**
 * Prezentace samotného modalu: nejnovější zprávy a zavírací akce.
 *
 * Vyexportováno zvlášť od `AnnouncementGate`, aby si ho Storybook mohl
 * vykreslit se vzorovými daty bez query klienta nebo session.
 */
export function AnnouncementDialogView({
  announcements,
  onClose,
}: {
  announcements: Announcement[];
  onClose: () => void;
}) {
  const single = announcements.length === 1;

  return (
    <Dialog
      // Radix uvnitř Dialogu drží focus trap, Escape i vrácení focusu — obojí
      // směřuje sem, takže zavření jakoukoli cestou posune značku.
      closeLabel="Close"
      description={
        single
          ? undefined
          : `${announcements.length} updates since you were last here.`
      }
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title={single ? announcements[0].title : "What's new"}
    >
      <div className={styles.list}>
        {announcements.map((announcement) => (
          <section className={styles.entry} key={announcement.id}>
            {/* U jediné zprávy je titulek už v hlavičce dialogu; opakovat ho
                uvnitř by byly dva nadpisy pro totéž. */}
            {single ? null : (
              <h3 className={styles.title}>{announcement.title}</h3>
            )}
            <AnnouncementBody body={announcement.body} />
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * Ukáže, co je nového — jednou.
 *
 * Server už odfiltroval, co uživatel viděl; `minVersion` dořeší tenhle build,
 * protože server neví, jaká verze se ho ptá. Zavření posune značku v nastavení,
 * takže se totéž neukáže na telefonu.
 */
export function AnnouncementGate() {
  const { user } = useSessionUser();
  const userId = user?.id;
  const [dismissed, setDismissed] = useState(false);

  const { data } = useAnnouncementsQuery();

  const { getSettingsDocument, patchSettings } = useSettingsMutations(
    userId ?? "",
  );

  async function mark(lastSeenAnnouncement: string) {
    try {
      const document = await getSettingsDocument();
      await patchSettings({
        baseRevision: document.revision,
        patch: { lastSeenAnnouncement },
      });
    } catch {
      // Značka se neuložila — zpráva se příště ukáže znovu. Otravné, ale
      // neškodné; ztratit ji úplně by bylo horší.
    }
  }

  // První pohled: nic se neukazuje, jen se posune značka. Bez toho by nový účet
  // (a v den nasazení každý stávající) dostal celou historii produktu naráz.
  //
  // V efektu, ne při renderu: patch je vedlejší efekt, a při renderu by ho
  // StrictMode vyvolal dvakrát a opakoval při každém dalším renderu.
  const markTo = data?.markTo;
  useEffect(() => {
    if (markTo) void mark(markTo);
    // `mark` se mění s každým renderem (uzavírá mutace), a značka se má poslat
    // právě jednou na hodnotu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markTo]);

  const pending =
    data && !markTo
      ? pendingAnnouncements(data.announcements, BUILD_VERSION)
      : [];
  if (dismissed || pending.length === 0) return null;

  function close() {
    setDismissed(true);
    const newest = newestAnnouncementId(pending);
    // Značka se posouvá jen na to, co se OPRAVDU ukázalo. Co odfiltroval
    // minVersion, zůstává nevyřízené a vyskočí po aktualizaci.
    if (newest) void mark(newest);
  }

  return <AnnouncementDialogView announcements={pending} onClose={close} />;
}
