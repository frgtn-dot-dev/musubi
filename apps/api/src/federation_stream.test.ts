import assert from "node:assert/strict";
import { parseSseFrames } from "./federation_stream";

// Frame splitting for the federated fan-in. Chunk boundaries land anywhere, so
// the leftover handling is the part that matters.

// A complete frame yields its data and leaves nothing behind.
{
  const { payloads, rest } = parseSseFrames('data: {"type":"event_created"}\n\n');
  assert.deepEqual(payloads, ['{"type":"event_created"}']);
  assert.equal(rest, "");
}

// Several frames in one chunk.
{
  const { payloads, rest } = parseSseFrames(
    'data: {"type":"a"}\n\ndata: {"type":"b"}\n\n',
  );
  assert.deepEqual(payloads, ['{"type":"a"}', '{"type":"b"}']);
  assert.equal(rest, "");
}

// A partial frame is held back until its terminator arrives.
{
  const first = parseSseFrames('data: {"type":"a"}\n\ndata: {"ty');
  assert.deepEqual(first.payloads, ['{"type":"a"}']);
  assert.equal(first.rest, 'data: {"ty');

  const second = parseSseFrames(`${first.rest}pe":"b"}\n\n`);
  assert.deepEqual(second.payloads, ['{"type":"b"}']);
  assert.equal(second.rest, "");
}

// Keepalive comments carry no data and must not be emitted.
{
  const { payloads } = parseSseFrames(":ok\n\n:keepalive\n\n");
  assert.deepEqual(payloads, []);
}

// Multi-line data frames are joined, per the SSE spec.
{
  const { payloads } = parseSseFrames("data: line one\ndata: line two\n\n");
  assert.deepEqual(payloads, ["line one\nline two"]);
}

// Event fields other than data are ignored.
{
  const { payloads } = parseSseFrames(
    'id: 7\nevent: ping\ndata: {"type":"a"}\n\n',
  );
  assert.deepEqual(payloads, ['{"type":"a"}']);
}

// Nothing complete yet.
{
  const { payloads, rest } = parseSseFrames("data: partial");
  assert.deepEqual(payloads, []);
  assert.equal(rest, "data: partial");
}

console.log("federated stream frame self-check: OK");
