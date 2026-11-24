import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readConfig } from "../src/core/store.ts";

test("readConfig never writes, even to a read-only config.json", () => {
 const dir = mkdtempSync(join(tmpdir(), "dibs-readonly-"));
 const path = join(dir, "config.json");
 const text = '{\n  // committed by an older version\n  "$schema": "https://x/v0.0.1/schema.json",\n  "file": "~/a.jsonl"\n}\n';
 try {
  writeFileSync(path, text);
  chmodSync(path, 0o444);
  expect(readConfig(dir)).toMatchObject({ file: "~/a.jsonl" });
  expect(readFileSync(path, "utf8")).toBe(text);
 } finally {
  chmodSync(path, 0o644);
  rmSync(dir, { recursive: true, force: true });
 }
});
