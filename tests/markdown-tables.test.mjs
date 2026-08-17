import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../lib/markdown.ts";

const TABLE = [
  "| verb | what it does |",
  "|---|---|",
  "| `await whoami()` | the account as a **value** |",
  "| `logout()` | forget this machine's credentials |",
].join("\n");

test("a pipe table renders as a real table, not raw pipes", () => {
  const html = renderMarkdown(TABLE);
  assert.match(html, /<table>/);
  assert.equal(html.includes("|---|---|"), false);
  assert.match(html, /<th[^>]*>verb<\/th>/);
  assert.match(html, /<th[^>]*>what it does<\/th>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.equal((html.match(/<td/g) || []).length, 4);
});

test("cell content still goes through the inline pass, and stays escaped", () => {
  const html = renderMarkdown(TABLE);
  assert.match(html, /<code>await whoami\(\)<\/code>/);
  assert.match(html, /<strong>value<\/strong>/);
  assert.match(html, /machine&#39;s/);
});

test("a cell cannot smuggle HTML through", () => {
  const html = renderMarkdown(["| a |", "|---|", "| <img src=x onerror=alert(1)> |"].join("\n"));
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img/);
});

test("alignment colons map to a fixed set of styles", () => {
  const html = renderMarkdown(["| l | c | r |", "|:--|:-:|--:|", "| 1 | 2 | 3 |"].join("\n"));
  assert.equal((html.match(/text-align:center/g) || []).length, 2);
  assert.equal((html.match(/text-align:right/g) || []).length, 2);
  assert.equal(html.includes("text-align:left"), false);
});

test("a ragged row is padded to the header width instead of shifting columns", () => {
  const html = renderMarkdown(["| a | b | c |", "|---|---|---|", "| 1 |", "| 1 | 2 | 3 | 4 |"].join("\n"));
  const rows = html.split("<tr>").slice(2);
  for (const r of rows) assert.equal((r.match(/<td/g) || []).length, 3);
});

test("a paragraph above a horizontal rule is not mistaken for a table", () => {
  const html = renderMarkdown(["a | b", "---", "next"].join("\n"));
  assert.equal(html.includes("<table>"), false);
  assert.match(html, /<hr \/>/);
});

test("a table directly under a paragraph is not swallowed by it", () => {
  const html = renderMarkdown(["intro text", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
  assert.match(html, /<p>intro text<\/p>/);
  assert.match(html, /<table>/);
});

test("a table inside a fenced code block stays literal", () => {
  const html = renderMarkdown(["```", "| a | b |", "|---|---|", "```"].join("\n"));
  assert.equal(html.includes("<table>"), false);
  assert.match(html, /\| a \| b \|/);
});

test("the table ends at a blank line and following prose is its own paragraph", () => {
  const html = renderMarkdown([TABLE, "", "after the table"].join("\n"));
  assert.match(html, /<\/table><\/div>/);
  assert.match(html, /<p>after the table<\/p>/);
});
