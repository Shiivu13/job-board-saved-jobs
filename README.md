# Job board starter

A small job board for an insiderOne work sample. It is made up: the jobs and
companies are not real.

## Run it

You need Node 20 or newer. There are no packages to install.

```
npm start      # then open http://localhost:3000
npm test       # runs the tests in test/
```

## What is here

- `server.js`: the web server. `GET /api/jobs?q=` lists jobs, `/api/saved` handles saved jobs, `GET /` serves the page.
- `lib/jobs.js`: reading and searching the jobs. Pure functions.
- `lib/saved.js`: the saved jobs store, kept in `data/saved.json` (made on the first save).
- `jobs.json`: the jobs.
- `public/`: the page and its script.
- `test/`: tests, using Node's built-in test runner.

## Your task

See the work sample brief on insiderOne: add saved jobs (save, list, remove),
with tests, and add a short section to this README about what you built.

## Saved jobs

### What I built

Each job now has a Save button. Once a job is saved the button turns into
"Saved", and clicking it again unsaves it. Saved jobs are listed above all
jobs, each with a Remove button. They are stored on the server in
`data/saved.json`, so they survive a reload or a server restart.

| Request | Response |
| --- | --- |
| `GET /api/saved` | `200`, saved jobs, oldest first |
| `POST /api/saved` with `{ "jobId": "j2" }` | `201` with the job, or `200` if it was already saved (it is still saved once) |
| `DELETE /api/saved/j2` | `204`, also when that job wasn't saved |

Errors are JSON, e.g. `{ "error": "No job with id \"j99\"" }`. An id that isn't
in `jobs.json` gets 404, a body that isn't JSON or has no `jobId` string gets
400, a body over 10 KB gets 413, and a wrong method gets 405 with an `Allow`
header.

Notes on the code:

- `lib/saved.js` is the new store. It only keeps ids. Job details are looked
  up in `jobs.json` each time, so a saved job can't show outdated info.
- `createApp({ savedFile })` takes the file path, so every test gets its own
  temp file. `SAVED_FILE` does the same when running the server.
- In `public/app.js` a button ignores clicks while its request is running, so
  a double click doesn't send twice. Keyboard focus stays on the job you
  clicked, and after Remove it moves to the next saved job. I also fixed a
  starter bug where typing fast in the search box could show results for an
  older query; the saved list uses the same check.
- The page got a new look: cards, a theme switch (Auto follows the device,
  Light and Dark override it and are remembered in `localStorage`), and short
  animations when a job is saved or removed. Search results don't animate
  because they change on every keystroke. The animations use plain CSS and
  `element.animate()`, only touch `transform` and `opacity`, and become simple
  fades when reduced motion is turned on in the OS.

### Running it

```
npm start      # http://localhost:3000
npm test       # 26 tests: 3 starter, 9 for the store, 14 for the API
```

`test/saved.test.js` tests the store directly with temp files.
`test/api.test.js` starts the real server on a random port and tests it over
HTTP: saving, duplicates, unknown ids, bad bodies, removing, order, a restart,
an id that was removed from `jobs.json`, and several saves sent at once.

### One decision: writes go through a queue

Saving reads the file, adds the id and writes the file back. If two saves come
in at the same time (a double click, two tabs), both read the same old list and
the second write wipes out the first save, with no error anywhere. So the store
chains each change behind the previous one. It's about ten lines and needs no
package. Writes also go to a temp file that is then renamed over the real one,
so a crash mid-write can't leave a half-written file.

To make sure the queue matters, I removed it and reran the tests: both "at the
same time" tests failed. The catch is that it only works inside one Node
process. If the app ran as several processes, the saved lists would need a
database.

### What I'd do next

- Separate saved lists per student. Right now everyone using the server shares
  one list. With login, the file would hold one list per user, or the lists
  would move to a database.
- Update the button straight away and roll back if the request fails, instead
  of waiting for the server.
- Browser tests for the page. I tested it by hand (save, remove, reload, a
  search with no results, an error message, focus after Remove, phone width).
  Playwright could automate that, but it's a package and the brief asks for
  none.
