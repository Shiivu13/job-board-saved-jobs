// A small job board: a JSON API and one page. Run with `npm start`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { findJob, loadJobs, searchJobs } from "./lib/jobs.js";
import { createSavedStore, savedJobs } from "./lib/saved.js";

const PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_SAVED_FILE = new URL("./data/saved.json", import.meta.url);
const MAX_BODY_BYTES = 10 * 1024; // a job id is a few bytes

/** An error whose status and message are sent to the client as-is. */
class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

/** Reads `{ "jobId": "..." }` from the request body. */
async function readJobId(req) {
  const chunks = [];
  let size = 0;
  // Drain an oversized body instead of bailing out mid-stream: bailing resets
  // the connection and the client never sees the 413.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, 'Request body must be JSON, like {"jobId": "j1"}');
  }
  const jobId = body?.jobId;
  if (typeof jobId !== "string" || jobId === "") {
    throw new HttpError(400, 'Request body needs a "jobId" string, like {"jobId": "j1"}');
  }
  return jobId;
}

function decodeJobId(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new HttpError(400, "Job id in the URL is not valid");
  }
}

const methodNotAllowed = (allowed) => new HttpError(405, `Use ${allowed} here`, { allow: allowed });

/**
 * GET    /api/saved         saved jobs, oldest first
 * POST   /api/saved         { "jobId": "..." } → 201 if new, 200 if already saved
 * DELETE /api/saved/:jobId  → 204
 */
async function handleSaved(req, res, saved, pathname) {
  if (pathname === "/api/saved") {
    if (req.method === "GET") {
      const [jobs, ids] = await Promise.all([loadJobs(), saved.list()]);
      return sendJson(res, 200, savedJobs(jobs, ids));
    }
    if (req.method === "POST") {
      const jobId = await readJobId(req);
      const job = findJob(await loadJobs(), jobId);
      if (!job) throw new HttpError(404, `No job with id "${jobId}"`);
      const added = await saved.add(jobId);
      return sendJson(res, added ? 201 : 200, job);
    }
    throw methodNotAllowed("GET, POST");
  }

  if (req.method !== "DELETE") throw methodNotAllowed("DELETE");
  const jobId = decodeJobId(pathname.slice("/api/saved/".length));
  const removed = await saved.remove(jobId);
  // Deleting a real job that isn't saved is a no-op, so 204 is still right.
  // An id that is neither saved nor a job is probably a typo: say so.
  if (!removed && !findJob(await loadJobs(), jobId)) {
    throw new HttpError(404, `No job with id "${jobId}"`);
  }
  res.writeHead(204).end();
}

export function createApp({ savedFile = process.env.SAVED_FILE ?? DEFAULT_SAVED_FILE } = {}) {
  const saved = createSavedStore(savedFile);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/jobs") {
        const jobs = await loadJobs();
        return sendJson(res, 200, searchJobs(jobs, url.searchParams.get("q")));
      }
      if (/^\/api\/saved(\/[^/]+)?$/.test(url.pathname)) {
        return await handleSaved(req, res, saved, url.pathname);
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/app.js")) {
        const file = url.pathname === "/" ? "index.html" : "app.js";
        const type = file.endsWith(".html") ? "text/html" : "text/javascript";
        const body = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
        return res.end(body);
      }
      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.headers);
      console.error(err);
      sendJson(res, 500, { error: "Something went wrong" });
    }
  });
}

// Started directly (npm start), not imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(PORT, () => console.log(`Job board on http://localhost:${PORT}`));
}
