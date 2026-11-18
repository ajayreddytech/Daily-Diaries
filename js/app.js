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

const PRIORITIES = [
  { key: "urgent",   label: "Very high",       color: "#f43f5e", hint: "Must happen first" },
  { key: "normal",   label: "Normal",          color: "#fb923c", hint: "Important, needed" },
  { key: "okay",     label: "Okay",            color: "#38bdf8", hint: "Good to do" },
  { key: "none",     label: "Not a priority",  color: "#94a3b8", hint: "Only if there is time" },
  { key: "whenever", label: "Whenever I can",  color: "#a78bfa", hint: "No deadline, no pressure" }
];
const UNSORTED = { key: null, label: "Decide later", color: "#475569", hint: "Not sorted yet" };
const PRIORITY_BY_KEY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]));

const RATINGS = [
  { key: "wasted",  name: "Wasted day",  desc: "A flop. Nothing went to plan.",                       color: "#ef4444" },
  { key: "average", name: "Average day", desc: "Some done, some not. Nothing spent, nothing bad.",    color: "#60a5fa" },
  { key: "best",    name: "Best day",    desc: "Good use of everything. I feel happy.",              color: "#34d399" },
  { key: "gold",    name: "Golden day",  desc: "Achieved something, made a difference, stood out.",   color: "#facc15" }
];

const FIELDS = ["gratitude", "frustrations"];
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
let newTaskPriority = undefined;   // undefined = nothing chosen yet, null = decide later
let managerNewPriority = undefined;
let dragging = false;
let managerPendingRender = false;

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
  frustrations: $("#frustrations"),
  taskForm: $("#task-form"),
  taskInput: $("#task-input"),
  taskPickerWrap: $("#new-task-priorities"),
  addTaskBtn: $("#add-task-btn"),
  newTaskHint: $("#new-task-hint"),
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
  managerAddInput: null,
  toast: $("#toast")
};

/* ==========================================================================
   Helpers
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

function nextOrder() {
  const open = openTasks();
  return open.length ? (open[open.length - 1].order ?? open.length) + 1 : 0;
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
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBoard();
    renderCompleted();
    if (!els.manager.hidden) renderManager();
  }, err => toast("Could not load tasks: " + err.message, 5000));
}

function stopListeners() {
  if (dayUnsub) dayUnsub();
  if (tasksUnsub) tasksUnsub();
  dayUnsub = tasksUnsub = null;
  tasks = [];
  dayData = {};
  dirty.clear();
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
  renderRatings();
  renderSubmitState();
  renderQuote();
  renderCompleted();
}

/* ==========================================================================
   Saving (gratitude & release text, autosave to Firestore)
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
  for (const f of dirty) payload[f] = $("#" + f).value;
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
    renderBoard();
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
   Voice input (Web Speech API, live transcription into the field)
   ========================================================================== */

function attachSpeech(btn, field, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.disabled = true;
    btn.title = "Voice input works in Chrome, Edge and Safari";
    return;
  }
  let rec = null;
  let active = false;
  let base = "";
  let committed = "";
  let lastSet = "";

  btn.setAttribute("aria-pressed", "false");

  btn.addEventListener("click", () => {
    if (active) { rec.stop(); return; }

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
      if (e.error !== "no-speech" && e.error !== "aborted") toast("Voice input stopped: " + e.error);
    };

    rec.onend = () => {
      active = false;
      btn.classList.remove("recording");
      btn.setAttribute("aria-pressed", "false");
      if (onEnd) onEnd();
    };

    try {
      rec.start();
      active = true;
      btn.classList.add("recording");
      btn.setAttribute("aria-pressed", "true");
    } catch (err) {
      toast("Could not start the microphone. Check permissions.");
    }
  });
}

attachSpeech($('[data-speech="gratitude"]'), els.gratitude, () => flushSave());
attachSpeech($('[data-speech="frustrations"]'), $("#frustrations"), () => flushSave());
attachSpeech($('[data-speech="task"]'), els.taskInput);

/* ==========================================================================
   Rating
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
      el("span", { class: "r-name", text: r.name }),
      el("span", { class: "r-desc", text: r.desc })
    ));
  }
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
   Priority pickers
   ========================================================================== */

function renderPicker(container, selected, onChange) {
  container.innerHTML = "";
  for (const p of [...PRIORITIES, UNSORTED]) {
    const isSel = selected === p.key;
    container.append(el("button", {
      type: "button", class: "swatch", role: "radio",
      "aria-checked": String(isSel), style: { "--c": p.color }, title: p.hint,
      onclick: () => onChange(p.key)
    }, p.label));
  }
}

function renderNewTaskPicker() {
  renderPicker(els.taskPickerWrap, newTaskPriority, v => {
    newTaskPriority = v;
    renderNewTaskPicker();
    updateAddButton();
  });
}

function updateAddButton() {
  const ready = els.taskInput.value.trim().length > 0 && newTaskPriority !== undefined;
  els.addTaskBtn.disabled = !ready;
  els.newTaskHint.textContent = newTaskPriority === undefined
    ? "Pick a colour to add the task."
    : (els.taskInput.value.trim() ? "Ready. Press Add task." : "Type or speak the task.");
}

els.taskInput.addEventListener("input", updateAddButton);
renderNewTaskPicker();
updateAddButton();

async function addTask(text, priority) {
  if (!user || !text.trim()) return;
  try {
    await addDoc(tasksCol(user.uid), {
      text: text.trim().slice(0, 300),
      priority,
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

els.taskForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (newTaskPriority === undefined || !els.taskInput.value.trim()) return;
  const text = els.taskInput.value;
  const pr = newTaskPriority;
  els.taskInput.value = "";
  newTaskPriority = undefined;
  renderNewTaskPicker();
  updateAddButton();
  els.taskInput.focus();
  try { await addTask(text, pr); } catch { els.taskInput.value = text; newTaskPriority = pr; updateAddButton(); }
});

/* ==========================================================================
   Task board (buckets by priority)
   ========================================================================== */

function carriedLabel(t) {
  const days = t.createdOn ? daysBetween(t.createdOn, today) : 0;
  if (days <= 0) return "Added today";
  return `Carried ${days} day${days === 1 ? "" : "s"}, from ${shortDate(t.createdOn)}`;
}

function renderBoard() {
  const open = openTasks();
  els.buckets.innerHTML = "";
  els.bucketsEmpty.hidden = open.length > 0;

  const groups = [
    ...(open.some(t => !t.priority) ? [{ ...UNSORTED, items: open.filter(t => !t.priority) }] : []),
    ...PRIORITIES.map(p => ({ ...p, items: open.filter(t => t.priority === p.key) }))
  ];

  for (const g of groups) {
    const list = el("ul", { class: "bucket-list" },
      g.items.length
        ? g.items.map(t => taskItem(t))
        : [el("li", { class: "bucket-empty", text: "Nothing here" })]
    );
    els.buckets.append(el("section", { class: "bucket", style: { "--c": g.color }, "aria-label": g.label },
      el("div", { class: "bucket-head" },
        el("span", { class: "bucket-title", text: g.label }),
        el("span", { class: "bucket-count", text: String(g.items.length) })
      ),
      el("p", { class: "bucket-hint", text: g.hint }),
      list
    ));
  }
}

function taskItem(t) {
  const color = (PRIORITY_BY_KEY[t.priority] || UNSORTED).color;
  const li = el("li", { class: "task", "data-id": t.id, style: { "--c": color } },
    el("button", {
      type: "button", class: "check", "aria-label": "Mark as done", title: "Done",
      onclick: e => completeTask(t.id, e.currentTarget.closest("li"))
    }, checkSvg()),
    el("div", { class: "task-text" },
      t.text,
      el("span", { class: "task-meta" }, el("span", { class: t.createdOn < today ? "carry" : "", text: carriedLabel(t) }))
    )
  );
  return li;
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
      el("button", {
        type: "button", class: "link-btn",
        onclick: () => restoreTask(t.id)
      }, "Restore")
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
   Centralised task manager (edit, recolour, delete, reorder)
   ========================================================================== */

function renderMiniColors(container, task) {
  container.innerHTML = "";
  for (const p of [...PRIORITIES, UNSORTED]) {
    const selected = (task.priority ?? null) === p.key;
    container.append(el("button", {
      type: "button", class: "m-color" + (p.key === null ? " none-option" : ""),
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

  const text = el("input", {
    type: "text", class: "m-text", value: t.text, maxlength: 300, "aria-label": "Task text"
  });
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

function renderManager() {
  if (dragging || managerIsEditing()) { managerPendingRender = true; return; }
  managerPendingRender = false;
  const open = openTasks();
  els.managerList.innerHTML = "";
  open.forEach(t => els.managerList.append(managerItem(t)));
  els.managerEmpty.hidden = open.length > 0;
  els.managerCount.textContent = `${open.length} open task${open.length === 1 ? "" : "s"}`;
}

function managerIsEditing() {
  const a = document.activeElement;
  return !!a && els.managerList.contains(a) && a.classList.contains("m-text");
}

els.managerList.addEventListener("focusout", () => {
  setTimeout(() => { if (managerPendingRender && !els.manager.hidden) renderManager(); }, 0);
});

async function setTaskPriority(id, key) {
  if (!user) return;
  const t = tasks.find(x => x.id === id);
  if (t) t.priority = key;   // optimistic
  renderManager();
  renderBoard();
  try { await updateDoc(taskRef(user.uid, id), { priority: key }); }
  catch (err) { toast("Could not set priority: " + err.message); }
}

async function deleteTask(t) {
  if (!user) return;
  if (!confirm(`Delete "${t.text}"?`)) return;
  try { await deleteDoc(taskRef(user.uid, t.id)); toast("Task deleted", 1800); }
  catch (err) { toast("Could not delete: " + err.message); }
}

/* Drag-to-reorder with pointer events (works with mouse, pen and touch). */
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
      const ids = [...container.querySelectorAll(".m-item")].map(n => n.dataset.id);
      onDrop(ids);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

enableDragReorder(els.managerList, async ids => {
  if (!user) return;
  // Apply locally first so the list does not jump back.
  ids.forEach((id, i) => {
    const t = tasks.find(x => x.id === id);
    if (t) t.order = i;
  });
  renderBoard();
  const batch = writeBatch(db);
  ids.forEach((id, i) => batch.update(taskRef(user.uid, id), { order: i }));
  try { await batch.commit(); }
  catch (err) { toast("Could not save new order: " + err.message); }
});

/* Manager add row (same colour-first rule as the main form) */
function buildManagerAddRow() {
  const input = el("input", { type: "text", class: "input", placeholder: "Add a task, by text or voice...", maxlength: 300, "aria-label": "New task" });
  const mic = el("button", { type: "button", class: "mic-btn", "aria-label": "Voice input for a new task", title: "Speak a task" });
  mic.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
  const picker = el("div", { class: "priority-picker", role: "radiogroup", "aria-label": "Priority for the new task" });
  const addBtn = el("button", { type: "button", class: "btn btn-primary", disabled: true }, "Add");

  const refresh = () => {
    addBtn.disabled = !(input.value.trim() && managerNewPriority !== undefined);
    renderPicker(picker, managerNewPriority, v => { managerNewPriority = v; refresh(); });
  };
  input.addEventListener("input", refresh);
  addBtn.addEventListener("click", async () => {
    const text = input.value, pr = managerNewPriority;
    input.value = ""; managerNewPriority = undefined; refresh(); input.focus();
    try { await addTask(text, pr); } catch { input.value = text; managerNewPriority = pr; refresh(); }
  });
  attachSpeech(mic, input, refresh);
  managerNewPriority = undefined;
  refresh();
  return el("div", { class: "m-add-wrap" },
    el("div", { class: "m-add" }, input, mic, addBtn),
    picker
  );
}

function openManager() {
  els.manager.hidden = false;
  document.body.style.overflow = "hidden";
  renderManager();
  const existing = $(".m-add-wrap", els.manager);
  if (existing) existing.remove();
  els.manager.querySelector(".modal-foot").before(buildManagerAddRow());
  setTimeout(() => $(".m-add input", els.manager)?.focus(), 50);
}

function closeManager() {
  els.manager.hidden = true;
  document.body.style.overflow = "";
  if (managerPendingRender) renderManager();
}

els.openManager.addEventListener("click", openManager);
els.manager.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeManager));
document.addEventListener("keydown", e => { if (e.key === "Escape" && !els.manager.hidden) closeManager(); });

/* ==========================================================================
   Boot
   ========================================================================== */

renderDate();
renderQuote();
renderRatings();
renderSubmitState();
