// Tests for the saved jobs API, over real HTTP against the real server.
// Each test gets its own server and its own saved file, so tests cannot affect each other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.js";

async function tempSavedFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "job-board-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "saved.json");
}

/** Starts the app on a free port and returns helpers to call it. */
async function startApp(t, savedFile) {
  const server = createApp({ savedFile: savedFile ?? (await tempSavedFile(t)) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body), // undefined stays undefined
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  return {
    base,
    call,
    save: (jobId) => call("POST", "/api/saved", { jobId }),
    savedIds: async () => (await call("GET", "/api/saved")).body.map((job) => job.id),
  };
}

test("GET /api/saved is an empty list at first", async (t) => {
  const app = await startApp(t);
  const res = await app.call("GET", "/api/saved");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("POST /api/saved saves a job and returns it with 201", async (t) => {
  const app = await startApp(t);
  const res = await app.save("j2");
  assert.equal(res.status, 201);
  assert.equal(res.body.id, "j2");
  assert.equal(res.body.company, "Kite Learning");

  const list = await app.call("GET", "/api/saved");
  assert.deepEqual(list.body, [res.body]);
});

test("saving the same job twice keeps one copy", async (t) => {
  const app = await startApp(t);
  assert.equal((await app.save("j2")).status, 201);
  const again = await app.save("j2");
  assert.equal(again.status, 200);
  assert.equal(again.body.id, "j2");
  assert.deepEqual(await app.savedIds(), ["j2"]);
});

test("saved jobs come back in the order they were saved", async (t) => {
  const app = await startApp(t);
  await app.save("j6");
  await app.save("j1");
  await app.save("j4");
  assert.deepEqual(await app.savedIds(), ["j6", "j1", "j4"]);
});

test("saving an unknown job id is a 404 with a clear message", async (t) => {
  const app = await startApp(t);
  const res = await app.save("nope");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'No job with id "nope"' });
  assert.deepEqual(await app.savedIds(), []);
});

test("a bad request body is a 400 with a clear message, not a crash", async (t) => {
  const app = await startApp(t);
  const bad = ["{ not json", "", "null", "[]", {}, { jobId: "" }, { jobId: 2 }, { id: "j1" }];
  for (const body of bad) {
    const res = await app.call("POST", "/api/saved", body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)}`);
    assert.match(res.body.error, /jobId|JSON/);
  }
  assert.deepEqual(await app.savedIds(), []);
});

test("a body that is far too big is refused with 413", async (t) => {
  const app = await startApp(t);
  const res = await app.call("POST", "/api/saved", { jobId: "j1", padding: "x".repeat(2_000_000) });
  assert.equal(res.status, 413);
  assert.deepEqual(await app.savedIds(), []);
});

test("DELETE /api/saved/:jobId removes a saved job with 204", async (t) => {
  const app = await startApp(t);
  await app.save("j2");
  await app.save("j5");
  const res = await app.call("DELETE", "/api/saved/j2");
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.deepEqual(await app.savedIds(), ["j5"]);
});

test("DELETE of a real job that is not saved is fine, an unknown id is a 404", async (t) => {
  const app = await startApp(t);
  assert.equal((await app.call("DELETE", "/api/saved/j3")).status, 204);

  const res = await app.call("DELETE", "/api/saved/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'No job with id "nope"' });

  const broken = await app.call("DELETE", "/api/saved/%E0%A4%A");
  assert.equal(broken.status, 400);
});

test("saved jobs stay saved after the server restarts", async (t) => {
  const savedFile = await tempSavedFile(t);
  const first = await startApp(t, savedFile);
  await first.save("j7");
  await first.save("j1");

  const second = await startApp(t, savedFile);
  assert.deepEqual(await second.savedIds(), ["j7", "j1"]);
  assert.deepEqual(JSON.parse(await readFile(savedFile, "utf8")), ["j7", "j1"]);
});

test("a saved id that is no longer a job is hidden, and can still be removed", async (t) => {
  const savedFile = await tempSavedFile(t);
  await writeFile(savedFile, JSON.stringify(["gone", "j1"]));
  const app = await startApp(t, savedFile);
  assert.deepEqual(await app.savedIds(), ["j1"]);

  assert.equal((await app.call("DELETE", "/api/saved/gone")).status, 204);
  assert.deepEqual(JSON.parse(await readFile(savedFile, "utf8")), ["j1"]);
});

test("saves sent at the same moment are all kept", async (t) => {
  const app = await startApp(t);
  const ids = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"];
  const results = await Promise.all(ids.map((id) => app.save(id)));
  assert.ok(results.every((r) => r.status === 201));
  assert.deepEqual((await app.savedIds()).sort(), ids);
});

test("a wrong method on a saved route is a 405 that says what is allowed", async (t) => {
  const app = await startApp(t);
  const list = await app.call("PUT", "/api/saved", { jobId: "j1" });
  assert.equal(list.status, 405);
  assert.equal(list.headers.get("allow"), "GET, POST");

  const one = await app.call("GET", "/api/saved/j1");
  assert.equal(one.status, 405);
  assert.equal(one.headers.get("allow"), "DELETE");
});

test("the page and the jobs API still work", async (t) => {
  const app = await startApp(t);
  const jobs = await app.call("GET", "/api/jobs?q=remote");
  assert.equal(jobs.status, 200);
  assert.deepEqual(jobs.body.map((j) => j.id), ["j1", "j3", "j6", "j8"]);

  const page = await fetch(`${app.base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="saved"/);
  assert.match(html, /id="jobs"/);
});
