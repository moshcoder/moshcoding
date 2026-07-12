import assert from "node:assert/strict";
import test from "node:test";

import { parseHttpByteRange } from "../lib/http-range.ts";

test("HTTP range parser handles bounded and open-ended byte ranges", () => {
  assert.deepEqual(parseHttpByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseHttpByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseHttpByteRange("bytes=2-99", 10), { start: 2, end: 9 });
});

test("HTTP range parser handles suffix byte ranges", () => {
  assert.deepEqual(parseHttpByteRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.deepEqual(parseHttpByteRange("bytes=-99", 10), { start: 0, end: 9 });
});

test("HTTP range parser rejects malformed or unsatisfiable ranges", () => {
  assert.equal(parseHttpByteRange("bytes=-0", 10), null);
  assert.equal(parseHttpByteRange("bytes=9-2", 10), null);
  assert.equal(parseHttpByteRange("bytes=10-11", 10), null);
  assert.equal(parseHttpByteRange("garbage bytes=1-2", 10), null);
  assert.equal(parseHttpByteRange("bytes=--", 10), null);
});
