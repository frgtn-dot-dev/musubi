import assert from "node:assert/strict";
import { config } from "@musubi/config";
import { microsoftRsvpEvidence } from "./microsoft_rsvp";
import { graphRsvpSession } from "./microsoft_rsvp_delivery";
import { graphRsvpSeriesFixture, graphRsvpSeriesNative } from "./microsoft_rsvp_series.fixture";
import { microsoftRsvpSeriesVersion, matchesMicrosoftSeriesRsvp } from "./microsoft_rsvp_series";

const slot = {
  externalSeriesID: "series",
  originalStart: { kind: "instant" as const, value: "2026-03-28T08:00:00.000Z" },
};
async function main() {
  const flag = config.api.providerRsvpEditsEnabled;
  config.api.providerRsvpEditsEnabled = true;
  try {
    for (const response of ["accepted", "tentative", "declined"] as const) {
      const fixture = await graphRsvpSeriesFixture();
      try {
        const session = await graphRsvpSession("fixture", "account", "calendar");
        await assert.rejects(
          () => session.read("slot-28", response, slot),
          "Initial response cannot pretend to affect one slot",
        );
        const saved = (await session.read("slot-28", response, slot, true))!;
        assert.equal(saved.series?.length, 3, "Includes moved exception outside range plus explicit cancellation");
        const version = microsoftRsvpSeriesVersion(saved);
        assert.equal(microsoftRsvpSeriesVersion({ ...saved, response: "accepted" }), version);
        const result = await session.write(
          saved,
          false,
          async () => {
            fixture.state.marked = true;
          },
          async () => {},
        );
        assert.equal(result.kind, "observed");
        assert.equal(fixture.state.posts, 1);
        if (result.kind === "observed")
          assert.equal(
            result.evidence.series?.find((item) => item.type === "exception")?.responseStatus &&
              (result.evidence.series.find((item) => item.type === "exception")!.responseStatus as any).response,
            "accepted",
          );
        assert.equal(
          (
            await session.write(
              saved,
              true,
              async () => assert.fail("resend"),
              async () => {},
            )
          ).kind,
          "observed",
        );
        assert.equal(fixture.state.posts, 1);
      } finally {
        await fixture.close();
      }
    }
    for (const mode of [
      "lost",
      "not-observed",
      "decline-absent",
      "exception-change",
      "override-change",
      "foreign-page",
      "before-dispatch-change",
      "already-answered",
      "marked-not-sent",
    ] as const) {
      const fixture = await graphRsvpSeriesFixture();
      try {
        const session = await graphRsvpSession("fixture", "account", "calendar");
        if (mode === "foreign-page") {
          fixture.state.mode = mode;
          await assert.rejects(() => session.read("slot-28", "accepted", slot, true));
          assert.equal(fixture.state.posts, 0);
          continue;
        }
        if (mode === "already-answered")
          for (const item of [fixture.state.master, ...fixture.state.instances])
            item.responseStatus.response = "accepted";
        const saved = (await session.read("slot-28", "accepted", slot, true))!;
        fixture.state.mode = mode;
        if (mode === "before-dispatch-change") fixture.state.instances[1].location.displayName = "Changed";
        const send = () =>
          session.write(
            saved,
            mode === "marked-not-sent",
            async () => {
              fixture.state.marked = true;
            },
            async () => {},
          );
        if (["lost", "before-dispatch-change"].includes(mode)) await assert.rejects(send);
        else
          assert.equal(
            (await send()).kind,
            mode === "decline-absent" ? "absent" : mode === "already-answered" ? "observed" : "unconfirmed",
          );
        if (mode === "before-dispatch-change") {
          assert.equal(fixture.state.posts, 0);
          continue;
        }
        assert.equal(
          (
            await session.write(
              saved,
              true,
              async () => assert.fail("resend"),
              async () => {},
            )
          ).kind,
          mode === "decline-absent"
            ? "absent"
            : ["lost", "already-answered"].includes(mode)
              ? "observed"
              : "unconfirmed",
        );
        assert.equal(fixture.state.posts, ["marked-not-sent", "already-answered"].includes(mode) ? 0 : 1);
      } finally {
        await fixture.close();
      }
    }
    for (const variant of ["windows-zone", "until", "tokyo", "all-day"] as const) {
      const fixture = await graphRsvpSeriesFixture();
      try {
        const { master, instances } = fixture.state;
        if (variant === "until") {
          master.recurrence.range.type = "endDate";
          master.recurrence.range.endDate = "2026-03-31";
          delete master.recurrence.range.numberOfOccurrences;
        } else {
          const zone =
            variant === "windows-zone" ? "Central Europe Standard Time" : variant === "tokyo" ? "Asia/Tokyo" : "UTC";
          master.recurrence.range.recurrenceTimeZone = zone;
          for (const item of [master, ...instances]) {
            item.originalStartTimeZone = zone;
            item.originalEndTimeZone = zone;
            if (variant === "windows-zone") continue;
            item.isAllDay = variant === "all-day";
            item.start.dateTime = item.start.dateTime.slice(0, 10) + "T00:00:00";
            item.end.dateTime = item.isAllDay
              ? new Date(new Date(item.start.dateTime + "Z").getTime() + 86400000).toISOString().slice(0, 19)
              : item.start.dateTime.slice(0, 10) + "T01:00:00";
            if (item.type !== "seriesMaster") item.originalStart = item.originalStart.slice(0, 10) + "T00:00:00.000Z";
          }
        }
        const session = await graphRsvpSession("fixture", "account", "calendar");
        const original = {
          externalSeriesID: "series",
          originalStart: { kind: "instant" as const, value: instances[0].originalStart },
        };
        const saved = (await session.read("slot-28", "accepted", original, true))!;
        assert.equal(saved.series?.length, 3, variant);
        assert.equal(
          saved.master!.originalStartTimeZone,
          master.originalStartTimeZone,
          "Raw labels are never normalized in the baseline",
        );
        assert.equal(
          (
            await session.write(
              saved,
              false,
              async () => {
                fixture.state.marked = true;
              },
              async () => {},
            )
          ).kind,
          "observed",
          variant,
        );
        assert.equal(fixture.state.posts, 1);
      } finally {
        await fixture.close();
      }
    }
    const raw = graphRsvpSeriesNative();
    const build = (master = raw.master, series = raw.instances) =>
      microsoftRsvpEvidence(series[0], "self@example.test", "accepted", undefined, slot, master, series);
    const saved = build();
    for (const mutate of [
      (v: any) => {
        v.master.recurrence.range.type = "noEnd";
      },
      (v: any) => {
        v.master.recurrence.range.numberOfOccurrences = 367;
      },
      (v: any) => {
        v.instances.pop();
      },
      (v: any) => {
        v.instances.push(v.instances[0]);
      },
      (v: any) => {
        v.master.cancelledOccurrences = [];
      },
      (v: any) => {
        v.master["exceptionOccurrences@odata.nextLink"] = "partial";
      },
      (v: any) => {
        v.instances[2].organizer.emailAddress.address = "foreign@example.test";
      },
      (v: any) => {
        v.instances[2].attendees.push(v.instances[2].attendees[0]);
      },
      (v: any) => {
        v.master.exceptionOccurrences[0].subject = "Concurrent expanded content";
      },
    ]) {
      const changed = structuredClone(raw);
      mutate(changed);
      assert.throws(() => build(changed.master, changed.instances));
    }
    assert.equal(matchesMicrosoftSeriesRsvp(saved, { ...saved, series: [] }), false);
    console.log(
      "Graph whole-series RSVP: complete finite reads, exception preservation, scope, drift and no-resend: OK",
    );
  } finally {
    config.api.providerRsvpEditsEnabled = flag;
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
