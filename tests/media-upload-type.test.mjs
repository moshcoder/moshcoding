import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_UPLOAD_BYTES,
  mediaTypeForUpload,
  parseMaxUploadBytes,
} from "../lib/media.ts";

test("media upload limit accepts positive decimal byte values", () => {
  assert.equal(parseMaxUploadBytes("1048576"), 1_048_576);
  assert.equal(parseMaxUploadBytes(" 2048 "), 2_048);
});

test("media upload limit falls back for unsafe values", () => {
  const unsafeValues = [
    undefined,
    "",
    "0",
    "-1",
    "1.5",
    "1e6",
    "Infinity",
    "invalid",
    "9007199254740992",
  ];
  for (const value of unsafeValues) {
    assert.equal(parseMaxUploadBytes(value), DEFAULT_MAX_UPLOAD_BYTES);
  }
});

test("media upload type accepts explicit allowed video MIME types", () => {
  assert.equal(mediaTypeForUpload("clip.mp4", "video/mp4"), "video/mp4");
  assert.equal(mediaTypeForUpload("clip.webm", "video/webm"), "video/webm");
  assert.equal(mediaTypeForUpload("clip.mov", "video/quicktime"), "video/quicktime");
});

test("media upload type infers allowed types from generic uploads only by extension", () => {
  assert.equal(mediaTypeForUpload("clip.mp4", ""), "video/mp4");
  assert.equal(mediaTypeForUpload("clip.webm", "application/octet-stream"), "video/webm");
  assert.equal(mediaTypeForUpload("clip.mov", "application/octet-stream"), "video/quicktime");
});

test("media upload type rejects empty or generic non-video names", () => {
  assert.equal(mediaTypeForUpload("payload.txt", ""), null);
  assert.equal(mediaTypeForUpload("payload", "application/octet-stream"), null);
  assert.equal(mediaTypeForUpload("clip.gif", "application/octet-stream"), null);
});
