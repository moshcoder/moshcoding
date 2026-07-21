import assert from "node:assert/strict";
import test from "node:test";

import { mediaTypeForUpload } from "../lib/media.ts";

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

test("media upload type ignores inherited Object.prototype keys as MIME types", () => {
  // A crafted Content-Type must not resolve through the prototype chain and
  // slip a non-video file past the allow-list.
  assert.equal(mediaTypeForUpload("evil.html", "constructor"), null);
  assert.equal(mediaTypeForUpload("evil.html", "__proto__"), null);
  assert.equal(mediaTypeForUpload("evil.exe", "hasOwnProperty"), null);
  // An explicit non-allowed type is rejected outright, even with a video name.
  assert.equal(mediaTypeForUpload("clip.mp4", "constructor"), null);
});
