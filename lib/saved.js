// Saved jobs, stored as a JSON list of job ids, e.g. ["j2", "j6"].
// Only ids are stored; job details always come from jobs.json, so they can't go stale.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function createSavedStore(path) {
  const file = path instanceof URL ? fileURLToPath(path) : String(path);
  let pending = Promise.resolve();

  async function read() {
    const raw = await readFile(file, "utf8").catch((err) => {
      if (err.code === "ENOENT") return "[]"; // nothing saved yet
      throw err;
    });
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) throw new Error(`${file} should hold a list of job ids`);
    return ids;
  }

  // Write a temp file and rename it over the real one, so a crash mid-write
  // leaves the old file intact instead of half a file.
  async function write(ids) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, `${JSON.stringify(ids, null, 2)}\n`);
    await rename(`${file}.tmp`, file);
  }

  // Read-change-write, one at a time, so two requests can't overwrite each other.
  // `change` returns the new list, or null if there is nothing to do.
  function update(change) {
    const result = pending.then(async () => {
      const next = change(await read());
      if (next) await write(next);
      return Boolean(next);
    });
    pending = result.catch(() => {}); // a failed change mustn't block the next one
    return result;
  }

  return {
    /** Saved ids, oldest first. */
    list: read,
    /** Resolves false if the id was already saved. */
    add: (id) => update((ids) => (ids.includes(id) ? null : [...ids, id])),
    /** Resolves false if the id wasn't saved. */
    remove: (id) => update((ids) => (ids.includes(id) ? ids.filter((saved) => saved !== id) : null)),
  };
}

/** Jobs for the saved ids, in saved order. Ids no longer in the job list are skipped. */
export function savedJobs(jobs, ids) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
