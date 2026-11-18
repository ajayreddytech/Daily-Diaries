// Daily Diaries - app logic
// Data lives only in Cloud Firestore (users/{uid}/days/{date} and users/{uid}/tasks/{id}).
// Nothing is written to localStorage or sessionStorage.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider,
  signOut, setPersistence, indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { QUOTES } from "./quotes.js";

/* ==========================================================================
   Constants
   ========================================================================== */

// The four priority buckets. Keys are kept from the earlier version so saved tasks still match.
const PRIORITIES = [
  { key: "urgent",   label: "High priority",              color: "#FDA4AF", hint: "Must do now" },
  { key: "normal",   label: "Medium priority",            color: "#FDE047", hint: "Should do soon" },
  { key: "okay",     label: "Low priority",               color: "#7DD3FC", hint: "Nice to do" },
  { key: "whenever", label: "No priority / Whenever",     color: "#52525B", hint: "Whenever I like, have time or am in the mood" }
];
// Old saved values that map onto the four buckets above.
const LEGACY_PRIORITY = { none: "whenever" };
const normalizePriority = p => (p in LEGACY_PRIORITY ? LEGACY_PRIORITY[p] : (p ?? null));
// Fallback colour for tasks that are not yet in a bucket (not shown as a chip).
const UNSORTED = { key: null, label: "Not sorted", color: "#475569", hint: "Not prioritised yet" };
const PRIORITY_BY_KEY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]));

// Ratings are shown with a medal name first and the original day name second.
// Keys are unchanged, so existing saved ratings still match.
const RATINGS = [
  { key: "gold",    metal: "Golden day", title: "Stood out",   desc: "I achieved something, made a difference, and this day stood out.", color: "#facc15" },
  { key: "best",    metal: "Silver day", title: "Best day",    desc: "I made good use of everything and I feel happy.",                   color: "#cbd5e1" },
  { key: "average", metal: "Bronze day", title: "Average day", desc: "Some done, some not. Nothing spent, nothing bad.",                 color: "#d97706" },
  { key: "wasted",  metal: "Iron day",   title: "Wasted day",  desc: "A flop. The day was totally wasted.",                              color: "#64748b" }
];

const FIELDS = ["gratitude", "frustrations"];
const GRATITUDE_SPLIT = /(?=\bI\s*(?:['’]\s*m|\s+am)\s+grateful\b)/i;
const STAR_PATH = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6-4.9-4.6 6.6-.8z";
const DOTS_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>`;
const TRASH_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`;

/* ==========================================================================
   Firebase
   ========================================================================== */

const configured = firebaseConfig && !String(firebaseConfig.apiKey).startsWith("YOUR_");
let auth = null;
let db = null;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Keep the sign-in in IndexedDB (not localStorage).
  setPersistence(auth, indexedDBLocalPersistence).catch(() => {});
  // Offline-capable Firestore cache, stored in IndexedDB.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
}

const dayRef = (uid, key) => doc(db, "users", uid, "days", key);
const tasksCol = uid => collection(db, "users", uid, "tasks");
const taskRef = (uid, id) => doc(db, "users", uid, "tasks", id);

/* ==========================================================================
   Date and text helpers (function declarations are hoisted, so they are safe
   to call from the state block below)
   ========================================================================== */

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); }
function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 864e5); }
function dayOfYear(k) { const d = parseKey(k); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
function longDate(k) {
  return parseKey(k).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function shortDate(k) {
  return parseKey(k).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Splits "I'm grateful to ... I'm grateful for ..." into separate numbered entries.
function splitGratitude(text) {
  return text.split(GRATITUDE_SPLIT).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/* ==========================================================================
   State
   ========================================================================== */

let user = null;
let today = dateKey(new Date());
let viewKey = today;
let dayData = {};
let tasks = [];
let dayUnsub = null;
let tasksUnsub = null;
let saveTimer = null;
const dirty = new Set();
let view = null;                // "dump" | "prioritize" | "buckets"; null until tasks load
let preparing = new Set();      // task ids being coloured in the prioritise step
let dragging = false;
let pendingRender = false;
let taskSpeech = null;
let managerSpeech = null;

/* ==========================================================================
   DOM refs
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const els = {
  loading: $("#loading-screen"),
  auth: $("#auth-screen"),
  authError: $("#auth-error"),
  app: $("#app"),
  signin: $("#google-signin"),
  signout: $("#signout"),
  avatar: $("#user-avatar"),
  prev: $("#prev-day"),
  next: $("#next-day"),
  jumpToday: $("#jump-today"),
  dateLong: $("#page-date-long"),
  quoteText: $("#quote-text"),
  quoteAuthor: $("#quote-author"),
  saveStatus: $("#save-status"),
  submittedBadge: $("#submitted-badge"),
  gratitude: $("#gratitude"),
  gratitudeList: $("#gratitude-list"),
  gratitudeEmpty: $("#gratitude-empty"),
  frustrations: $("#frustrations"),
  viewDump: $("#view-dump"),
  viewPrioritize: $("#view-prioritize"),
  viewBuckets: $("#view-buckets"),
  taskForm: $("#task-form"),
  taskInput: $("#task-input"),
  dumpList: $("#dump-list"),
  dumpEmpty: $("#dump-empty"),
  dumpCount: $("#dump-count"),
  goPrioritize: $("#go-prioritize"),
  prioritizeList: $("#prioritize-list"),
  backDump: $("#back-dump"),
  showBuckets: $("#show-buckets"),
  addMore: $("#add-more"),
  buckets: $("#buckets"),
  bucketsEmpty: $("#buckets-empty"),
  completed: $("#completed-today"),
  completedCount: $("#completed-count"),
  completedList: $("#completed-list"),
  ratings: $("#ratings"),
  submitBtn: $("#submit-page"),
  submitNote: $("#submit-note"),
  openManager: $("#open-manager"),
  manager: $("#manager"),
  managerList: $("#manager-list"),
  managerEmpty: $("#manager-empty"),
  managerCount: $("#manager-count"),
  toast: $("#toast")
};

/* ==========================================================================
   UI helpers
   ========================================================================== */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) node.style.setProperty(sk, sv); else node.style[sk] = sv;
      }
    } else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  children.flat().forEach(c => { if (c !== null && c !== undefined) node.append(c); });
  return node;
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

function setStatus(text, kind = "") {
  els.saveStatus.textContent = text;
  els.saveStatus.className = "save-status " + kind;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function openTasks() {
  return tasks
    .filter(t => t.status !== "done")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
// Dump = added but not yet prioritised (no colour).
const dumpTasks = () => openTasks().filter(t => !t.priority);
const sortedTasks = () => openTasks().filter(t => !!t.priority);

function nextOrder() {
  const open = openTasks();
  return open.length ? Math.max(...open.map(t => t.order ?? 0)) + 1 : 0;
}

function svgFromString(markup) {
  const wrap = document.createElement("span");
  wrap.innerHTML = markup;
  return wrap.firstElementChild;
}

function checkSvg() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5");
  svg.append(p);
  return svg;
}

function svgStar() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "star");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", STAR_PATH);
  svg.append(path);
  return svg;
}

/* ==========================================================================
   Auth
   ========================================================================== */

function showScreen(name) {
  els.loading.hidden = name !== "loading";
  els.auth.hidden = name !== "auth";
  els.app.hidden = name !== "app";
}

if (!configured) {
  showScreen("auth");
  els.signin.disabled = true;
  els.authError.hidden = false;
  els.authError.textContent = "Add your Firebase config in js/firebase-config.js to start.";
} else {
  onAuthStateChanged(auth, u => {
    if (u) {
      user = u;
      if (u.photoURL) { els.avatar.src = u.photoURL; els.avatar.hidden = false; }
      showScreen("app");
      startListeners();
      renderDate();
      renderQuote();
      renderRatings();
    } else {
      user = null;
      stopListeners();
      showScreen("auth");
    }
  });

  els.signin.addEventListener("click", async () => {
    els.authError.hidden = true;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        // Installed PWAs on phones often can't open popups; use a full-page redirect.
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        els.authError.hidden = false;
        els.authError.textContent = "Sign-in failed: " + (err.message || code);
      }
    }
  });

  els.signout.addEventListener("click", async () => {
    await flushSave();
    await signOut(auth);
  });
}

/* ==========================================================================
   Firestore listeners
   ========================================================================== */

function startListeners() {
  stopListeners();
  subscribeDay();
  tasksUnsub = onSnapshot(tasksCol(user.uid), snap => {
    tasks = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, priority: normalizePriority(data.priority) };
    });
    if (view === null) showView(sortedTasks().length ? "buckets" : "dump");
    refreshTasksUI();
  }, err => toast("Could not load tasks: " + err.message, 5000));
}

function stopListeners() {
  if (dayUnsub) dayUnsub();
  if (tasksUnsub) tasksUnsub();
  dayUnsub = tasksUnsub = null;
  tasks = [];
  dayData = {};
  dirty.clear();
  view = null;
}

function subscribeDay() {
  if (dayUnsub) dayUnsub();
  dayData = {};
  dayUnsub = onSnapshot(dayRef(user.uid, viewKey), snap => {
    dayData = snap.data() || {};
    applyDay();
  }, err => toast("Could not load this page: " + err.message, 5000));
}

function applyDay() {
  for (const f of FIELDS) {
    const field = $("#" + f);
    if (!dirty.has(f) && document.activeElement !== field) field.value = dayData[f] || "";
  }
  renderGratitudeList();
  renderRatings();
  renderSubmitState();
  renderQuote();
  renderCompleted();
}

/* ==========================================================================
   Saving (gratitude & letting-go text, autosave to Firestore)
   ========================================================================== */

function scheduleSave() {
  setStatus("Saving...", "saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!user || !dirty.size) { if (user) setStatus("All changes saved"); return; }
  const key = viewKey;
  const payload = {};
  for (const f of dirty) {
    payload[f] = $("#" + f).value;
    if (f === "gratitude") payload.gratitudeItems = splitGratitude(payload.gratitude);
  }
  dirty.clear();
  payload.updatedAt = serverTimestamp();
  try {
    await setDoc(dayRef(user.uid, key), payload, { merge: true });
    setStatus("All changes saved");
  } catch (err) {
    FIELDS.forEach(f => { if (f in payload) dirty.add(f); });
    setStatus("Not saved yet, will retry", "error");
    saveTimer = setTimeout(flushSave, 3000);
  }
}

els.gratitude.addEventListener("input", renderGratitudeList);
FIELDS.forEach(f => {
  $("#" + f).addEventListener("input", () => {
    if (!user) return;
    dirty.add(f);
    scheduleSave();
  });
});

window.addEventListener("pagehide", () => { flushSave(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
  if (document.visibilityState === "visible") rolloverIfNewDay();
});

/* ==========================================================================
   Gratitude: numbered entries built from "I'm grateful to..." sentences
   ========================================================================== */

function renderGratitudeList() {
  const items = splitGratitude(els.gratitude.value);
  els.gratitudeList.innerHTML = "";
  items.forEach(text => els.gratitudeList.append(el("li", { text })));
  els.gratitudeEmpty.hidden = items.length > 0;
}

/* ==========================================================================
   Date navigation
   ========================================================================== */

function renderDate() {
  const isToday = viewKey === today;
  els.dateLong.textContent = isToday ? `Today, ${longDate(viewKey)}` : longDate(viewKey);
  els.jumpToday.hidden = isToday;
  els.next.disabled = viewKey >= today;
}

function goToDay(key) {
  if (key > today) return;
  flushSave();
  document.activeElement?.blur?.();
  viewKey = key;
  renderDate();
  renderQuote();
  if (user) subscribeDay();
  renderCompleted();
}

function rolloverIfNewDay() {
  const now = dateKey(new Date());
  if (now !== today) {
    const wasViewingToday = viewKey === today;
    today = now;
    if (wasViewingToday) viewKey = today;
    renderDate();
    if (wasViewingToday && user) subscribeDay();
    renderBlueprint();
  }
}

els.prev.addEventListener("click", () => goToDay(addDays(viewKey, -1)));
els.next.addEventListener("click", () => goToDay(addDays(viewKey, 1)));
els.jumpToday.addEventListener("click", () => goToDay(today));
setInterval(rolloverIfNewDay, 60_000);

/* ==========================================================================
   Quote of the day (one per day, cycling through 365)
   ========================================================================== */

function renderQuote() {
  const idx = (dayOfYear(viewKey) - 1) % QUOTES.length;
  const q = QUOTES[idx];
  els.quoteText.textContent = "“" + q.text + "”";
  els.quoteAuthor.textContent = "— " + q.author;
}

/* ==========================================================================
   Voice input
   The mic stays on until the user taps it again. The browser may end a
   session on its own after silence, so we restart it while the user still
   wants it on. Returns a controller so the caller can clear the dictation
   buffer after saving (for example, when Enter saves a task).
   ========================================================================== */

function attachSpeech(btn, field, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.disabled = true;
    btn.title = "Voice input works in Chrome, Edge and Safari";
    return { reset() {}, stop() {} };
  }

  let rec = null;
  let active = false;
  let wantListening = false;
  let base = "";
  let committed = "";
  let lastSet = "";

  const setUI = on => {
    btn.classList.toggle("recording", on);
    btn.setAttribute("aria-pressed", String(on));
  };
  setUI(false);

  function startSession() {
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    base = field.value;
    if (base && !/\s$/.test(base)) base += " ";
    committed = "";
    lastSet = field.value;

    rec.onresult = e => {
      // If the user typed while listening, treat their text as the new base.
      if (field.value !== lastSet) {
        base = field.value && !/\s$/.test(field.value) ? field.value + " " : field.value;
        committed = "";
      }
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) committed += r[0].transcript.trim() + " ";
        else interim += r[0].transcript;
      }
      lastSet = base + committed + interim;
      field.value = lastSet;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };

    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening = false;
        toast("Microphone access is blocked. Allow it in the browser settings.", 4000);
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        toast("Voice input: " + e.error);
      }
    };

    rec.onend = () => {
      active = false;
      if (wantListening) {
        setTimeout(() => { if (wantListening) startSessionSafe(); }, 200);
      } else {
        setUI(false);
        if (onEnd) onEnd();
      }
    };

    rec.start();
    active = true;
  }

  function startSessionSafe() {
    try { startSession(); }
    catch {
      wantListening = false;
      setUI(false);
      toast("Could not start the microphone.");
    }
  }

  btn.addEventListener("click", () => {
    if (wantListening) {
      wantListening = false;
      if (active) rec.stop(); else setUI(false);
      return;
    }
    wantListening = true;
    setUI(true);
    startSessionSafe();
  });

  return {
    reset() { base = ""; committed = ""; lastSet = ""; },
    stop() {
      if (!wantListening) return;
      wantListening = false;
      if (active) rec.stop();
      setUI(false);
    }
  };
}

taskSpeech = attachSpeech($('[data-speech="task"]'), els.taskInput);
attachSpeech($('[data-speech="gratitude"]'), els.gratitude, () => flushSave());
attachSpeech($('[data-speech="frustrations"]'), els.frustrations, () => flushSave());

/* ==========================================================================
   Rating (medal names, original names underneath)
   ========================================================================== */

function renderRatings() {
  els.ratings.innerHTML = "";
  for (const r of RATINGS) {
    const selected = dayData.rating === r.key;
    els.ratings.append(el("button", {
      type: "button", class: "rating", role: "radio",
      "aria-checked": String(selected), style: { "--c": r.color },
      onclick: () => setRating(selected ? null : r.key)
    },
      svgStar(),
      el("span", { class: "r-name", text: r.metal }),
      el("span", { class: "r-sub", text: r.title }),
      el("span", { class: "r-desc", text: r.desc })
    ));
  }
}

async function setRating(key) {
  if (!user) return;
  try {
    await setDoc(dayRef(user.uid, viewKey), { rating: key, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    toast("Could not save rating: " + err.message);
  }
}

/* ==========================================================================
   Submit / reopen the page
   ========================================================================== */

function renderSubmitState() {
  const submitted = !!dayData.submitted;
  els.submittedBadge.hidden = !submitted;
  els.submitBtn.textContent = submitted ? "Reopen this page" : "Submit today's page";
  els.submitNote.textContent = submitted
    ? "This page is submitted. You can still edit it, and reopen to change its status."
    : "Submit when the day is done. Your page is saved as you type either way.";
}

els.submitBtn.addEventListener("click", async () => {
  if (!user) return;
  await flushSave();
  const submitted = !!dayData.submitted;
  try {
    await setDoc(dayRef(user.uid, viewKey), {
      submitted: !submitted,
      submittedAt: submitted ? null : serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    if (!submitted) {
      toast(dayData.rating ? "Page submitted. Rest well." : "Page submitted. Tip: rate the day too.", 3200);
    }
  } catch (err) {
    toast("Could not submit: " + err.message);
  }
});

/* ==========================================================================
   Blueprint views: dump -> prioritise -> buckets
   ========================================================================== */

function showView(name) {
  view = name;
  if (name === "prioritize") preparing = new Set(dumpTasks().map(t => t.id));
  else preparing = new Set();
  els.viewDump.hidden = name !== "dump";
  els.viewPrioritize.hidden = name !== "prioritize";
  els.viewBuckets.hidden = name !== "buckets";
  renderBlueprint();
}

els.goPrioritize.addEventListener("click", () => showView("prioritize"));
els.backDump.addEventListener("click", () => showView("dump"));
els.showBuckets.addEventListener("click", () => showView("buckets"));
els.addMore.addEventListener("click", () => showView("dump"));

function renderBlueprint() {
  renderDump();
  renderPrioritize();
  renderBoard();
  renderCompleted();
}

function renderDump() {
  const dump = dumpTasks();
  els.dumpList.innerHTML = "";
  for (const t of dump) {
    const del = el("button", {
      type: "button", class: "m-del", "aria-label": "Delete task", title: "Delete",
      onclick: () => deleteTask(t)
    });
    del.innerHTML = TRASH_SVG;
    els.dumpList.append(el("li", { class: "dump-item" }, el("span", { class: "dump-text", text: t.text }), del));
  }
  els.dumpEmpty.hidden = dump.length > 0;
  els.dumpCount.textContent = dump.length ? `${dump.length} to prioritise` : "";
  els.goPrioritize.disabled = dump.length === 0;
}

function renderPrioritize() {
  if (view !== "prioritize" || isEditingTaskText()) return;
  const list = openTasks().filter(t => preparing.has(t.id));
  els.prioritizeList.innerHTML = "";
  list.forEach(t => els.prioritizeList.append(managerItem(t)));
}

function renderBoard() {
  const sorted = sortedTasks();
  els.buckets.innerHTML = "";
  els.bucketsEmpty.hidden = sorted.length > 0;

  for (const p of PRIORITIES) {
    const items = sorted.filter(t => t.priority === p.key);
    els.buckets.append(el("section", { class: "bucket", style: { "--c": p.color }, "aria-label": p.label },
      el("div", { class: "bucket-head" },
        el("span", { class: "bucket-title", text: p.label }),
        el("span", { class: "bucket-count", text: String(items.length) })
      ),
      el("p", { class: "bucket-hint", text: p.hint }),
      el("ul", { class: "bucket-list" },
        items.length ? items.map(t => taskItem(t)) : [el("li", { class: "bucket-empty", text: "Nothing here" })]
      )
    ));
  }
}

function taskItem(t) {
  const color = (PRIORITY_BY_KEY[t.priority] || UNSORTED).color;
  return el("li", { class: "task", "data-id": t.id, style: { "--c": color } },
    el("button", {
      type: "button", class: "check", "aria-label": "Mark as done", title: "Done",
      onclick: e => completeTask(t.id, e.currentTarget.closest("li"))
    }, checkSvg()),
    el("div", { class: "task-text" },
      t.text,
      el("span", { class: "task-meta" }, el("span", { class: t.createdOn < today ? "carry" : "", text: carriedLabel(t) }))
    )
  );
}

function carriedLabel(t) {
  const days = t.createdOn ? daysBetween(t.createdOn, today) : 0;
  if (days <= 0) return "Added today";
  return `Carried ${days} day${days === 1 ? "" : "s"}, from ${shortDate(t.createdOn)}`;
}

async function completeTask(id, li) {
  if (!user) return;
  li?.classList.add("leaving");
  await sleep(230);
  try {
    await updateDoc(taskRef(user.uid, id), { status: "done", doneOn: today, completedAt: serverTimestamp() });
    toast("Task completed. Nice.", 1800);
  } catch (err) {
    li?.classList.remove("leaving");
    toast("Could not complete task: " + err.message);
  }
}

function renderCompleted() {
  const done = tasks
    .filter(t => t.status === "done" && t.doneOn === viewKey)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  els.completed.hidden = done.length === 0;
  els.completedCount.textContent = String(done.length);
  els.completedList.innerHTML = "";
  for (const t of done) {
    els.completedList.append(el("li", {},
      el("span", { text: t.text }),
      el("button", { type: "button", class: "link-btn", onclick: () => restoreTask(t.id) }, "Restore")
    ));
  }
}

async function restoreTask(id) {
  if (!user) return;
  try {
    await updateDoc(taskRef(user.uid, id), { status: "open", doneOn: null, order: nextOrder() });
  } catch (err) { toast("Could not restore: " + err.message); }
}

/* ==========================================================================
   Adding, editing and deleting tasks
   ========================================================================== */

async function addTask(text) {
  if (!user || !text.trim()) return;
  try {
    await addDoc(tasksCol(user.uid), {
      text: text.trim().slice(0, 300),
      priority: null,            // starts in the dump, colour comes later
      order: nextOrder(),
      status: "open",
      createdOn: today,
      doneOn: null,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    toast("Could not add task: " + err.message);
    throw err;
  }
}

// Enter saves the task. The mic keeps listening for the next one.
els.taskForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = els.taskInput.value.trim();
  if (!text) return;
  els.taskInput.value = "";
  taskSpeech.reset();
  els.taskInput.focus();
  try { await addTask(text); }
  catch { els.taskInput.value = text; }
});

async function setTaskPriority(id, key) {
  if (!user) return;
  const t = tasks.find(x => x.id === id);
  if (t) t.priority = key;   // optimistic
  refreshTasksUI();
  try { await updateDoc(taskRef(user.uid, id), { priority: key }); }
  catch (err) { toast("Could not set priority: " + err.message); }
}

async function deleteTask(t) {
  if (!user) return;
  if (!confirm(`Delete "${t.text}"?`)) return;
  try { await deleteDoc(taskRef(user.uid, t.id)); toast("Task deleted", 1800); }
  catch (err) { toast("Could not delete: " + err.message); }
}

/* Shared task row: check, text, colours, delete. Used by prioritise and manager. */
function renderMiniColors(container, task) {
  container.innerHTML = "";
  for (const p of PRIORITIES) {
    const selected = (task.priority ?? null) === p.key;
    container.append(el("button", {
      type: "button", class: "m-color",
      role: "radio", "aria-checked": String(selected),
      "aria-label": p.label, title: `${p.label}: ${p.hint}`,
      style: { "--c": p.color },
      onclick: () => setTaskPriority(task.id, p.key)
    }));
  }
}

function managerItem(t) {
  const item = el("div", { class: "m-item", "data-id": t.id });
  const handle = el("button", { type: "button", class: "drag-handle", "aria-label": "Drag to reorder", title: "Drag to reorder" });
  handle.innerHTML = DOTS_SVG;

  const check = el("button", {
    type: "button", class: "check", "aria-label": "Mark as done", title: "Done",
    style: { "--c": (PRIORITY_BY_KEY[t.priority] || UNSORTED).color },
    onclick: () => completeTask(t.id, null)
  }, checkSvg());

  const text = el("input", { type: "text", class: "m-text", value: t.text, maxlength: 300, "aria-label": "Task text" });
  text.addEventListener("keydown", e => { if (e.key === "Enter") text.blur(); });
  text.addEventListener("change", () => {
    const v = text.value.trim();
    if (!v) { text.value = t.text; return; }
    updateDoc(taskRef(user.uid, t.id), { text: v }).catch(() => toast("Could not save text"));
  });

  const colors = el("div", { class: "m-colors", role: "radiogroup", "aria-label": "Priority" });
  renderMiniColors(colors, t);

  const del = el("button", {
    type: "button", class: "m-del", "aria-label": "Delete task", title: "Delete",
    onclick: () => deleteTask(t)
  });
  del.innerHTML = TRASH_SVG;

  item.append(handle, check, el("div", { class: "m-item-main" }, text, colors), del);
  return item;
}

/* Re-render after data changes, but never while the user is typing in a task. */
function refreshTasksUI() {
  if (isEditingTaskText() || dragging) { pendingRender = true; return; }
  pendingRender = false;
  renderBlueprint();
  if (!els.manager.hidden) renderManager();
}

function isEditingTaskText() {
  const a = document.activeElement;
  return !!a && a.classList.contains("m-text");
}

document.addEventListener("focusout", () => {
  setTimeout(() => { if (pendingRender && !dragging) refreshTasksUI(); }, 0);
});

function renderManager() {
  const open = openTasks();
  els.managerList.innerHTML = "";
  open.forEach(t => els.managerList.append(managerItem(t)));
  els.managerEmpty.hidden = open.length > 0;
  els.managerCount.textContent = `${open.length} open task${open.length === 1 ? "" : "s"}`;
}

/* Drag-to-reorder with pointer events (mouse, pen and touch). */
function enableDragReorder(container, onDrop) {
  container.addEventListener("pointerdown", e => {
    const handle = e.target.closest(".drag-handle");
    if (!handle || e.button > 0) return;
    const item = handle.closest(".m-item");
    if (!item) return;
    e.preventDefault();

    const rect = item.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const placeholder = el("div", { class: "drag-placeholder" });
    placeholder.style.height = rect.height + "px";
    item.after(placeholder);

    Object.assign(item.style, {
      position: "fixed", top: rect.top + "px", left: rect.left + "px",
      width: rect.width + "px", zIndex: "200"
    });
    item.classList.add("dragging");
    dragging = true;
    document.body.style.userSelect = "none";
    handle.setPointerCapture(e.pointerId);

    const onMove = ev => {
      item.style.top = (ev.clientY - offsetY) + "px";
      const siblings = [...container.querySelectorAll(".m-item:not(.dragging)")];
      const target = siblings.find(s => {
        const r = s.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (target) {
        if (placeholder.nextElementSibling !== target) container.insertBefore(placeholder, target);
      } else if (container.lastElementChild !== placeholder) {
        container.appendChild(placeholder);
      }
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      placeholder.replaceWith(item);
      item.classList.remove("dragging");
      item.removeAttribute("style");
      document.body.style.userSelect = "";
      dragging = false;
      onDrop([...container.querySelectorAll(".m-item")].map(n => n.dataset.id));
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

// Reorders a list of tasks by reusing the slots they already occupy, so the
// global order of other tasks is not disturbed.
async function reorderTasks(ids) {
  if (!user) return;
  const moved = ids.map(id => tasks.find(t => t.id === id)).filter(Boolean);
  const slots = moved.map(t => t.order ?? 0).sort((a, b) => a - b);
  const updates = [];
  moved.forEach((t, i) => {
    if (t.order !== slots[i]) { t.order = slots[i]; updates.push([t.id, slots[i]]); }
  });
  refreshTasksUI();
  if (!updates.length) return;
  const batch = writeBatch(db);
  updates.forEach(([id, order]) => batch.update(taskRef(user.uid, id), { order }));
  try { await batch.commit(); }
  catch (err) { toast("Could not save new order: " + err.message); }
}

enableDragReorder(els.managerList, reorderTasks);
enableDragReorder(els.prioritizeList, reorderTasks);

/* Manager add row: text or voice, Enter saves, mic stays on until closed. */
function buildManagerAddRow() {
  const input = el("input", { type: "text", class: "input", placeholder: "Add a task, by text or voice...", maxlength: 300, "aria-label": "New task" });
  const mic = el("button", { type: "button", class: "mic-btn", "aria-label": "Voice input for a new task", title: "Speak tasks" });
  mic.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
  const addBtn = el("button", { type: "button", class: "btn btn-primary", disabled: true }, "Add");

  const refresh = () => { addBtn.disabled = !input.value.trim(); };
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    managerSpeech?.reset();
    refresh();
    input.focus();
    try { await addTask(text); } catch { input.value = text; refresh(); }
  };

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  addBtn.addEventListener("click", submit);
  managerSpeech = attachSpeech(mic, input);
  return el("div", { class: "m-add-wrap" }, el("div", { class: "m-add" }, input, mic, addBtn));
}

function openManager() {
  els.manager.hidden = false;
  document.body.style.overflow = "hidden";
  renderManager();
  $(".m-add-wrap", els.manager)?.remove();
  els.manager.querySelector(".modal-foot").before(buildManagerAddRow());
  setTimeout(() => $(".m-add input", els.manager)?.focus(), 50);
}

function closeManager() {
  managerSpeech?.stop();
  els.manager.hidden = true;
  document.body.style.overflow = "";
}

els.openManager.addEventListener("click", openManager);
els.manager.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeManager));
document.addEventListener("keydown", e => { if (e.key === "Escape" && !els.manager.hidden) closeManager(); });

/* ==========================================================================
   Boot (runs after every function and constant above is defined)
   ========================================================================== */

renderDate();
renderQuote();
renderRatings();
renderSubmitState();
renderGratitudeList();
renderBlueprint();
