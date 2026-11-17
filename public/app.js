const jobList = document.getElementById("jobs");
const jobsEmpty = document.getElementById("jobs-empty");
const jobsSection = document.getElementById("jobs-section");
const savedList = document.getElementById("saved");
const savedEmpty = document.getElementById("saved-empty");
const savedCount = document.getElementById("saved-count");
const savedHeading = document.getElementById("saved-heading");
const search = document.getElementById("search");
const message = document.getElementById("message");

const BOOKMARK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';

let jobs = []; // jobs matching the current search
let saved = []; // saved jobs, oldest first
let searchVersion = 0;
let savedVersion = 0;

// Motion: only transform and opacity. With reduced motion, things fade but don't move.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

function enter(node, delay = 0) {
  const from = reduceMotion.matches ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px) scale(0.98)" };
  node.animate([from, { opacity: 1, transform: "none" }], { duration: 220, delay, easing: EASE_OUT, fill: "backwards" });
}

function exit(node) {
  const to = reduceMotion.matches ? { opacity: 0 } : { opacity: 0, transform: "scale(0.98)" };
  const animation = node.animate([{ opacity: 1 }, to], { duration: 160, easing: EASE_OUT, fill: "forwards" });
  // Browsers pause animations in hidden tabs; don't let the card get stuck.
  const timeout = new Promise((resolve) => setTimeout(resolve, 400));
  return Promise.race([animation.finished.catch(() => {}), timeout]);
}

/** Applies `change`, then slides `nodes` from where they were, so the page doesn't jump. */
function glide(nodes, change) {
  const before = nodes.map((node) => node.getBoundingClientRect().top);
  change();
  if (reduceMotion.matches) return;
  nodes.forEach((node, i) => {
    const dy = before[i] - node.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) node.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 220, easing: EASE_OUT });
  });
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

async function save(jobId) {
  await api("/api/saved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  await refreshSaved();
}

async function unsave(jobId) {
  await api(`/api/saved/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  await refreshSaved();
}

// Both loaders ignore a reply that arrives after a newer request was sent,
// so a slow old response can't overwrite a newer list.
async function refreshSaved() {
  const version = ++savedVersion;
  const list = await api("/api/saved");
  if (version !== savedVersion) return;
  saved = list;
  renderSaved();
}

async function showJobs(query = "", { animate = false } = {}) {
  const version = ++searchVersion;
  const results = await api(`/api/jobs?q=${encodeURIComponent(query)}`);
  if (version !== searchVersion) return;
  jobs = results;
  renderJobs(animate);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function jobCard(job, button) {
  const stipend = el("p", { className: "stipend" }, `₹${job.stipend.toLocaleString("en-IN")} `, el("span", { textContent: "a month" }));
  const text = el(
    "div",
    {},
    el("h3", { textContent: job.title }),
    el("p", { className: "meta", textContent: `${job.company} · ${job.location}` }),
    stipend,
  );
  const li = el("li", { className: "job" }, text, button);
  li.dataset.id = job.id;
  return li;
}

/** A button that ignores clicks while its action runs, so a double click can't send twice. */
function actionButton(className, label, action) {
  const button = el("button", { type: "button", className });
  button.setAttribute("aria-label", label);
  button.addEventListener("click", async () => {
    // aria-disabled instead of disabled, so keyboard focus stays on the button.
    if (button.getAttribute("aria-disabled") === "true") return;
    button.setAttribute("aria-disabled", "true");
    message.textContent = "";
    try {
      const focusNext = await action();
      focusNext?.focus();
    } catch (err) {
      message.textContent = err.message;
    } finally {
      button.removeAttribute("aria-disabled");
    }
  });
  return button;
}

const isSaved = (jobId) => saved.some((job) => job.id === jobId);

function renderJobs(animate) {
  jobList.replaceChildren(
    ...jobs.map((job) => {
      const toggle = actionButton("save", `Save ${job.title} at ${job.company}`, () =>
        isSaved(job.id) ? unsave(job.id) : save(job.id),
      );
      toggle.dataset.job = job.id;
      toggle.innerHTML = `${BOOKMARK_ICON}<span></span>`;
      return jobCard(job, toggle);
    }),
  );
  jobsEmpty.hidden = jobs.length > 0;
  updateSaveButtons();
  if (animate) [...jobList.children].forEach((li, i) => enter(li, Math.min(i, 10) * 40));
}

// Updated in place rather than re-rendered, so the colour change can transition.
function updateSaveButtons() {
  for (const button of jobList.querySelectorAll("button[data-job]")) {
    const on = isSaved(button.dataset.job);
    button.setAttribute("aria-pressed", String(on));
    button.querySelector("span").textContent = on ? "Saved" : "Save";
  }
}

function savedCard(job) {
  const remove = actionButton("remove", `Remove ${job.title} at ${job.company} from saved jobs`, async () => {
    // The card is about to go, so hand focus to a neighbour instead of losing it.
    const li = remove.closest("li");
    const neighbour = [li.nextElementSibling, li.previousElementSibling].find((n) => n && !n.dataset.leaving);
    await unsave(job.id);
    return neighbour?.querySelector("button") ?? savedHeading;
  });
  remove.textContent = "Remove";
  return jobCard(job, remove);
}

// Adds and removes only the cards that changed, so only those animate.
function renderSaved() {
  const shown = new Map([...savedList.children].filter((li) => !li.dataset.leaving).map((li) => [li.dataset.id, li]));
  const wanted = new Set(saved.map((job) => job.id));
  for (const [id, li] of shown) if (!wanted.has(id)) leave(li);

  const added = saved.filter((job) => !shown.has(job.id)).map(savedCard);
  if (added.length) {
    glide([jobsSection], () => {
      savedList.append(...added);
      savedEmpty.hidden = true;
    });
    added.forEach((li) => enter(li));
  }
  savedCount.textContent = String(saved.length);
  updateSaveButtons();
}

async function leave(li) {
  li.dataset.leaving = "true";
  li.inert = true;
  await exit(li);
  const others = [...savedList.children].filter((n) => n !== li && !n.dataset.leaving);
  glide([...others, jobsSection], () => {
    li.remove();
    savedEmpty.hidden = savedList.children.length > 0;
  });
}

// Theme: "system" follows the device. The <head> script has already applied a stored choice.
const themeButtons = document.querySelectorAll("[data-theme-choice]");

function applyTheme(choice) {
  const root = document.documentElement;
  // Turn transitions off for the switch, or cards would fade while the background snaps.
  root.classList.add("theme-switching");
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  getComputedStyle(root).color; // flush styles before transitions come back
  root.classList.remove("theme-switching");
  for (const button of themeButtons) button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
}

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    const choice = button.dataset.themeChoice;
    try {
      if (choice === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", choice);
    } catch {} // storage blocked (private window): switch anyway, just don't remember
    applyTheme(choice);
  });
}
applyTheme(document.documentElement.dataset.theme ?? "system");

const showError = (err) => (message.textContent = err.message);
search.addEventListener("input", () => showJobs(search.value).catch(showError));
// Saved first, so Save buttons are right on first paint.
refreshSaved()
  .catch(showError)
  .finally(() => showJobs("", { animate: true }).catch(showError));
