import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadJobs } from "../lib/jobs.js";
import { createSavedStore, savedJobs } from "../lib/saved.js";

/** A path in a fresh temporary folder, removed after the test. */
async function tempFile(t, name = "saved.json") {
  const dir = await mkdtemp(join(tmpdir(), "job-board-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, name);
}

test("a store with no file yet is empty", async (t) => {
  const store = createSavedStore(await tempFile(t));
  assert.deepEqual(await store.list(), []);
});

test("add saves an id once and says whether it was new", async (t) => {
  const store = createSavedStore(await tempFile(t));
  assert.equal(await store.add("j2"), true);
  assert.equal(await store.add("j5"), true);
  assert.equal(await store.add("j2"), false);
  assert.deepEqual(await store.list(), ["j2", "j5"]);
});

test("remove drops an id and says whether it was saved", async (t) => {
  const store = createSavedStore(await tempFile(t));
  await store.add("j2");
  await store.add("j5");
  assert.equal(await store.remove("j2"), true);
  assert.equal(await store.remove("j2"), false);
  assert.deepEqual(await store.list(), ["j5"]);
});

test("saved ids are kept in the file, so a new store sees them", async (t) => {
  const file = await tempFile(t);
  await createSavedStore(file).add("j3");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), ["j3"]);
  assert.deepEqual(await createSavedStore(file).list(), ["j3"]);
});

test("the folder for the file is made when missing", async (t) => {
  const file = join(await tempFile(t, "data"), "nested", "saved.json");
  const store = createSavedStore(file);
  await store.add("j1");
  assert.deepEqual(await store.list(), ["j1"]);
});

test("many adds at once all land, none overwrite another", async (t) => {
  const store = createSavedStore(await tempFile(t));
  const ids = Array.from({ length: 20 }, (_, i) => `j${i}`);
  await Promise.all(ids.map((id) => store.add(id)));
  assert.deepEqual((await store.list()).sort(), [...ids].sort());
});

test("a broken file is an error, not silently replaced", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, "{ not json");
  const store = createSavedStore(file);
  await assert.rejects(store.list(), SyntaxError);
  await assert.rejects(store.add("j1"), SyntaxError);
  assert.equal(await readFile(file, "utf8"), "{ not json");

  await writeFile(file, '{"jobId": "j1"}');
  await assert.rejects(store.list(), /should hold a list of job ids/);
});

test("one failed change does not block the next", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, "{ not json");
  const store = createSavedStore(file);
  await assert.rejects(store.add("j1"));
  await writeFile(file, "[]");
  assert.equal(await store.add("j1"), true);
});

test("savedJobs keeps saved order and skips ids that are no longer jobs", async () => {
  const jobs = await loadJobs();
  const result = savedJobs(jobs, ["j4", "gone", "j1"]);
  assert.deepEqual(result.map((j) => j.id), ["j4", "j1"]);
  assert.equal(result[0].company, "Kosha Fintech");
});
