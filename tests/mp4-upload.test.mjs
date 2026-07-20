import assert from "node:assert/strict";
import test from "node:test";

import { isMp4Upload } from "../lib/media.ts";

test("mp4 upload validation accepts mp4 files", () => {
  assert.equal(isMp4Upload("clip.mp4", "video/mp4"), true);
  assert.equal(isMp4Upload("clip.mp4", "application/octet-stream"), true);
  assert.equal(isMp4Upload("clip.mp4", ""), true);
});

test("mp4 upload validation rejects generic octet-stream non-mp4 files", () => {
  assert.equal(isMp4Upload("payload.txt", "application/octet-stream"), false);
  assert.equal(isMp4Upload("payload", "application/octet-stream"), false);
  assert.equal(isMp4Upload("payload.webm", "application/octet-stream"), false);
});
