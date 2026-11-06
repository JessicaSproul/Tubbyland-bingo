import { firebaseConfig } from "./firebase-config.js";
import { PHRASES } from "./phrases.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, onSnapshot, getDocs, writeBatch, serverTimestamp,
  query, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TUBBIES = [
  { key: "tinky", name: "Tinky Winky" },
  { key: "dipsy", name: "Dipsy" },
  { key: "laa", name: "Laa-Laa" },
  { key: "po", name: "Po" }
];
const FREE_INDEX = 12;
const CARD_SQUARES = 24;
const LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push({ name: `row ${r + 1}`, cells: [0, 1, 2, 3, 4].map(c => r * 5 + c) });
  for (let c = 0; c < 5; c++) lines.push({ name: `column ${"TUBBY"[c]}`, cells: [0, 1, 2, 3, 4].map(r => r * 5 + c) });
  lines.push({ name: "the diagonal", cells: [0, 6, 12, 18, 24] });
  lines.push({ name: "the other diagonal", cells: [4, 8, 12, 16, 20] });
  return lines;
})();

/* ---------- Drawings ---------- */

const antennas = {
  tinky: '<line x1="30" y1="17" x2="30" y2="12" style="stroke:var(--tinky);stroke-width:3"/><path d="M22 12 L38 12 L30 2 Z" style="fill:none;stroke:var(--tinky);stroke-width:3;stroke-linejoin:round"/>',
  dipsy: '<rect x="28" y="1" width="4" height="17" rx="2" style="fill:var(--dipsy)"/>',
  laa: '<path d="M30 17 C30 11 22 11 23.5 6 C25 1.5 34 2 33 7.5 C32.4 10 29 9.6 29 7.6" style="fill:none;stroke:var(--laa);stroke-width:3;stroke-linecap:round"/>',
  po: '<line x1="30" y1="17" x2="30" y2="12" style="stroke:var(--po);stroke-width:3"/><circle cx="30" cy="7" r="5" style="fill:none;stroke:var(--po);stroke-width:3"/>'
};
const tubbySVG = key => `
<svg viewBox="0 0 60 86" aria-hidden="true" focusable="false">
  ${antennas[key]}
  <ellipse cx="9" cy="54" rx="6" ry="10" transform="rotate(20 9 54)" style="fill:var(--${key})"/>
  <ellipse cx="51" cy="54" rx="6" ry="10" transform="rotate(-20 51 54)" style="fill:var(--${key})"/>
  <rect x="17" y="70" width="10" height="15" rx="4" style="fill:var(--${key})"/>
  <rect x="33" y="70" width="10" height="15" rx="4" style="fill:var(--${key})"/>
  <rect x="11" y="40" width="38" height="38" rx="17" style="fill:var(--${key});stroke:rgba(0,0,0,.15);stroke-width:1"/>
  <rect x="21" y="50" width="18" height="13" rx="3" style="fill:var(--screen);stroke:rgba(0,0,0,.25);stroke-width:1"/>
  <circle cx="30" cy="30" r="14" style="fill:var(--${key});stroke:rgba(0,0,0,.15);stroke-width:1"/>
  <circle cx="30" cy="31" r="9.5" style="fill:var(--face)"/>
  <circle cx="26.5" cy="29.5" r="1.4" style="fill:var(--ink)"/>
  <circle cx="33.5" cy="29.5" r="1.4" style="fill:var(--ink)"/>
  <path d="M26.5 34 Q30 37.5 33.5 34" style="fill:none;stroke:var(--ink);stroke-width:1.3;stroke-linecap:round"/>
</svg>`;
const bowlSVG = '<svg class="bowl" viewBox="0 0 60 30" aria-hidden="true"><path d="M4 8 H56 Q54 28 30 28 Q6 28 4 8 Z" style="fill:var(--po)"/><path d="M8 8 Q30 -2 52 8 Z" style="fill:var(--custard)"/><circle cx="30" cy="4" r="3" style="fill:var(--custard)"/></svg>';

/* ---------- Helpers ---------- */

const $ = id => document.getElementById(id);
const hashString = str => { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; };
const seededRandom = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ordinal = n => ["1st", "2nd", "3rd"][n - 1] || `${n}th`;
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
const toMillis = value => (value && typeof value.toMillis === "function" ? value.toMillis() : Date.now());

const avatarFor = (name, photoURL) => {
  const el = document.createElement("span");
  el.className = "avatar";
  if (photoURL) {
    const img = document.createElement("img");
    img.src = photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    el.append(img);
    return el;
  }
  const tubby = TUBBIES[hashString(name || "?") % TUBBIES.length].key;
  el.style.background = `var(--${tubby})`;
  el.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return el;
};

const heatClass = best => {
  if (best >= 5) return "heat-5";
  if (best === 4) return "heat-4";
  if (best === 3) return "heat-3";
  return "heat-1";
};

/* ---------- State ---------- */

const state = {
  user: null,
  isAdmin: false,
  round: 1,
  card: [],
  marks: {},
  selected: null,
  wonRound: null,
  players: [],
  winners: [],
  extraPhrases: [],
  removedPhrases: [],
  suggestions: [],
  board: null,
  previewBoard: null,
  monthWins: [],
  unsubscribers: []
};

const displayName = () => state.user?.displayName || state.user?.email?.split("@")[0] || "A Tubby fan";

/* ---------- Views ---------- */

const showView = name => {
  $("loading-view").hidden = name !== "loading";
  $("setup-view").hidden = name !== "setup";
  $("auth-view").hidden = name !== "auth";
  $("game-view").hidden = name !== "game";
};

const isConfigured = Object.values(firebaseConfig).every(value => typeof value === "string" && value.length > 0);
if (!isConfigured) {
  showView("setup");
  throw new Error("Add your Firebase settings to firebase-config.js");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- Sign in ---------- */

$("auth-tubbies").innerHTML = TUBBIES.map(t => tubbySVG(t.key)).join("");
let isCreatingAccount = false;

const authErrorMessage = error => {
  const messages = {
    "auth/invalid-credential": "That email and password don't match. Try again or reset your password.",
    "auth/wrong-password": "That email and password don't match. Try again or reset your password.",
    "auth/user-not-found": "There's no account with that email yet. Create one below.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/weak-password": "Pick a password with at least 6 characters.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/missing-password": "Enter your password.",
    "auth/too-many-requests": "Too many tries. Wait a minute, then try again.",
    "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
    "auth/unauthorized-domain": "This web address isn't approved in Firebase yet. Add it under Authentication > Settings > Authorized domains.",
    "auth/operation-not-allowed": "This sign-in method isn't turned on in Firebase yet."
  };
  return messages[error?.code] || "Something went wrong signing in. Try again.";
};

const setAuthMessage = (text, isError = true) => {
  $("auth-error").hidden = !isError || !text;
  $("auth-ok").hidden = isError || !text;
  $(isError ? "auth-error" : "auth-ok").textContent = text;
};

const setAuthMode = creating => {
  isCreatingAccount = creating;
  $("name-field").hidden = !creating;
  $("auth-title").textContent = creating ? "Create your account" : "Sign in to play";
  $("email-submit").textContent = creating ? "Create account" : "Sign in";
  $("toggle-mode").textContent = creating ? "Already have an account? Sign in" : "New here? Create an account";
  $("auth-password").autocomplete = creating ? "new-password" : "current-password";
  setAuthMessage("");
};

$("toggle-mode").addEventListener("click", () => setAuthMode(!isCreatingAccount));

$("google-sign-in").addEventListener("click", async () => {
  setAuthMessage("");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    if (error?.code !== "auth/popup-closed-by-user" && error?.code !== "auth/cancelled-popup-request") setAuthMessage(authErrorMessage(error));
  }
});

$("email-form").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  if (isCreatingAccount && !name) { setAuthMessage("Add your name so people know who's winning."); return; }
  $("email-submit").disabled = true;
  setAuthMessage("");
  try {
    if (isCreatingAccount) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      state.user = auth.currentUser;
      renderUserChip();
      savePlayer();
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    $("email-submit").disabled = false;
  }
});

$("forgot").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  if (!email) { setAuthMessage("Type your email above first, then click Forgot password."); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    setAuthMessage(`We sent a reset link to ${email}. Check your inbox (and spam).`, false);
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  }
});

$("sign-out").addEventListener("click", () => signOut(auth));

const renderUserChip = () => {
  $("user-chip").hidden = !state.user;
  if (!state.user) return;
  $("user-name").textContent = displayName();
  $("user-avatar").replaceWith(Object.assign(avatarFor(displayName(), state.user.photoURL), { id: "user-avatar" }));
};

/* ---------- Card ---------- */

const grid = $("grid");
const tray = $("tray");
const statusEl = $("status");

/* ---------- Phrase pool ---------- */

const normalizePhrase = text => String(text).toLowerCase().replace(/[“”"'‘’!?.,*()-]/g, " ").replace(/\s+/g, " ").trim();

const isRemovedBy = (entry, round) => state.removedPhrases.some(r =>
  Number(r.fromRound) <= round &&
  (entry.source === "added" ? r.phraseId === entry.id : r.source === "builtin" && r.text === entry.text));

const pendingRemoval = (entry, round) => state.removedPhrases.find(r =>
  Number(r.fromRound) > round &&
  (entry.source === "added" ? r.phraseId === entry.id : r.source === "builtin" && r.text === entry.text));

// Every phrase a card could use in a given round. Approved suggestions and removals
// take effect from a set round, in a fixed order, so a card never changes partway through a round.
const phraseEntries = round => [
  ...PHRASES.map(text => ({ text, source: "builtin" })),
  ...state.extraPhrases
    .filter(p => Number(p.fromRound) <= round)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(p => ({ text: p.text, source: "added", id: p.id }))
].filter(entry => !isRemovedBy(entry, round));

// Each player gets four different cards per round, one per Tubby. "legacy" is the single
// card from before boards existed, kept so nobody's card changes mid-round on update day.
const dealFor = boardKey => {
  const seed = boardKey === "legacy" ? `${state.user.uid}|round-${state.round}` : `${state.user.uid}|round-${state.round}|${boardKey}`;
  const rand = seededRandom(hashString(seed));
  const pool = phraseEntries(state.round).map(entry => entry.text);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = pool.slice(0, CARD_SQUARES);
  picks.splice(FREE_INDEX, 0, "Tubby Custard");
  return picks;
};

// No card is dealt until the player locks in a board, so the pick is pure luck.
const dealCard = () => { state.card = state.board ? dealFor(state.board) : []; };

const boardName = key => {
  const tubby = TUBBIES.find(t => t.key === key);
  return tubby ? `${tubby.name}'s board` : "Your board";
};

/* ---------- Choosing a board ---------- */

const renderBoardPicker = () => {
  const choosing = !state.board;
  document.body.classList.toggle("choosing", choosing);
  grid.classList.toggle("previewing", choosing);
  $("board-picker").hidden = !choosing;
  const label = $("board-label");
  label.hidden = choosing || state.board === "legacy";
  if (!choosing && state.board !== "legacy") {
    label.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = `var(--${state.board})`;
    label.append(dot, `Playing ${boardName(state.board)}`);
  }
  if (!choosing) return;
  $("pick-round").textContent = state.round;
  const options = $("board-options");
  options.replaceChildren(...TUBBIES.map(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "board-option";
    btn.dataset.board = t.key;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(state.previewBoard === t.key));
    btn.style.setProperty("--board-color", `var(--${t.key})`);
    const dot = document.createElement("span");
    dot.className = "dot";
    btn.append(dot, t.name);
    return btn;
  }));
  $("board-confirm").disabled = !state.previewBoard;
  $("board-confirm").textContent = state.previewBoard ? `Draw ${boardName(state.previewBoard)}` : "Pick a Tubby first";
};

$("board-options").addEventListener("click", e => {
  const btn = e.target.closest(".board-option");
  if (!btn || state.board) return;
  state.previewBoard = btn.dataset.board;
  renderBoardPicker();
  renderGrid();
  $("board-options").querySelector(`[data-board="${state.previewBoard}"]`)?.focus();
});

$("board-options").addEventListener("keydown", e => {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
  e.preventDefault();
  const i = TUBBIES.findIndex(t => t.key === state.previewBoard);
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
  const next = TUBBIES[(Math.max(i, 0) + (i < 0 ? 0 : step) + TUBBIES.length) % TUBBIES.length].key;
  $("board-options").querySelector(`[data-board="${next}"]`)?.click();
});

$("board-confirm").addEventListener("click", () => {
  if (state.board || !state.previewBoard) return;
  state.board = state.previewBoard;
  state.marks = {};
  state.revealing = true;
  dealCard();
  renderBoardPicker();
  renderGrid();
  savePlayer();
  statusEl.textContent = `You're playing ${boardName(state.board)}. Good luck!`;
});

const isMarked = idx => idx === FREE_INDEX || Boolean(state.marks[idx]);
const winningLines = () => LINES.filter(line => line.cells.every(isMarked));
const bestLineCount = () => Math.max(...LINES.map(line => line.cells.filter(isMarked).length));

const renderFaceDown = () => {
  grid.innerHTML = "";
  for (let idx = 0; idx < CARD_SQUARES + 1; idx++) {
    const cell = document.createElement("div");
    cell.className = "cell face-down";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", "Hidden square");
    cell.style.animationDelay = `${(idx % 5 + Math.floor(idx / 5)) * 90}ms`;
    grid.append(cell);
  }
  statusEl.textContent = state.previewBoard
    ? `${boardName(state.previewBoard)} it is? Lock it in to flip your card.`
    : "Pick a Tubby to draw your card. No peeking!";
};

const renderGrid = () => {
  if (!state.board) { renderFaceDown(); return; }
  const lines = winningLines();
  const inLine = new Set(lines.flatMap(l => l.cells));
  grid.innerHTML = "";
  state.card.forEach((phrase, idx) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    if (phrase.length > 58) cell.classList.add("xlong");
    else if (phrase.length > 40) cell.classList.add("long");
    cell.dataset.idx = idx;
    cell.setAttribute("role", "gridcell");
    const text = document.createElement("span");
    text.className = "phrase";
    text.textContent = phrase;
    cell.append(text);
    if (idx === FREE_INDEX) {
      cell.classList.add("free", "marked");
      cell.insertAdjacentHTML("beforeend", bowlSVG);
      cell.setAttribute("aria-label", "Free space: Tubby Custard");
    } else if (state.marks[idx]) {
      const tubby = TUBBIES.find(t => t.key === state.marks[idx]) || TUBBIES[0];
      cell.classList.add("marked");
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.dataset.tubby = tubby.key;
      mark.innerHTML = tubbySVG(tubby.key);
      if (state.justPlaced === idx) mark.classList.add("pop");
      cell.append(mark);
      cell.setAttribute("aria-label", `${phrase}. Marked by ${tubby.name}. Press Delete to remove.`);
    } else {
      cell.setAttribute("aria-label", `${phrase}. Not marked.`);
    }
    if (inLine.has(idx)) cell.classList.add("in-line");
    grid.append(cell);
  });
  state.justPlaced = null;
  if (state.revealing) {
    // Flip the squares over one by one, corner to corner, right after the board is drawn.
    grid.querySelectorAll(".cell").forEach((cell, idx) => {
      cell.classList.add("reveal");
      cell.style.animationDelay = `${(idx % 5 + Math.floor(idx / 5)) * 60}ms`;
    });
    state.revealing = false;
  }
  const count = Object.keys(state.marks).length;
  statusEl.textContent = lines.length ? `BINGO on ${lines.map(l => l.name).join(", ")}!` : `${count} of ${CARD_SQUARES} squares marked`;
};

const renderTray = () => {
  tray.innerHTML = "";
  TUBBIES.forEach(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tubby-btn";
    btn.dataset.tubby = t.key;
    btn.setAttribute("aria-pressed", String(state.selected === t.key));
    btn.setAttribute("aria-label", `${t.name}. Drag onto a square, or select and then choose a square.`);
    btn.innerHTML = tubbySVG(t.key) + `<span>${t.name}</span>`;
    tray.append(btn);
  });
  document.body.classList.toggle("selecting", Boolean(state.selected));
};

/* ---------- Saving ---------- */

let saveTimer = null;
let saveInFlight = Promise.resolve();

const savePlayer = () => {
  if (!state.user) return;
  const user = state.user;
  const payload = {
    name: displayName(),
    photoURL: user.photoURL || null,
    round: state.round,
    board: state.board,
    marks: { ...state.marks },
    marked: Object.keys(state.marks).length,
    best: bestLineCount(),
    updatedAt: serverTimestamp()
  };
  saveInFlight = saveInFlight
    .then(() => setDoc(doc(db, "players", user.uid), payload))
    .catch(() => { statusEl.textContent = "Couldn't save your card just now. Check your connection."; });
};

const queueSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePlayer, 500);
};

const placeMark = (idx, tubbyKey) => {
  if (idx === FREE_INDEX) return;
  if (!state.board) { statusEl.textContent = "Pick your board first, then start marking."; return; }
  state.marks[idx] = tubbyKey;
  state.justPlaced = idx;
  renderGrid();
  queueSave();
  checkForBingo();
};

const removeMark = idx => {
  delete state.marks[idx];
  renderGrid();
  queueSave();
};

/* ---------- Bingo ---------- */

const checkForBingo = async () => {
  const lines = winningLines();
  if (!lines.length || state.wonRound === state.round) return;
  state.wonRound = state.round;
  showCelebration(lines[0].name);
  try {
    const ref = doc(db, "winners", state.user.uid);
    const existing = await getDoc(ref);
    if (existing.exists() && existing.data().round === state.round) return;
    await setDoc(ref, {
      name: displayName(),
      photoURL: state.user.photoURL || null,
      round: state.round,
      line: lines[0].name,
      at: serverTimestamp()
    });
  } catch {
    showNote("Couldn't post your win to the board just now. Your card still shows it.");
  }
  // A permanent record for the monthly leaderboard. One per player per round.
  try {
    await setDoc(doc(db, "wins", `${state.user.uid}_${state.round}`), {
      uid: state.user.uid,
      name: displayName(),
      photoURL: state.user.photoURL || null,
      round: state.round,
      at: serverTimestamp()
    });
  } catch {
    // Already recorded for this round, or offline. The round's winners board still has it.
  }
};

const celebrate = $("celebrate");
const showCelebration = lineName => {
  $("dance").innerHTML = TUBBIES.map(t => tubbySVG(t.key)).join("");
  $("celebrate-msg").textContent = `Big hug! You filled ${lineName}.`;
  celebrate.hidden = false;
  $("celebrate-close").focus();
};
$("celebrate-close").addEventListener("click", () => { celebrate.hidden = true; });
celebrate.addEventListener("click", e => { if (e.target === celebrate) celebrate.hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !celebrate.hidden) celebrate.hidden = true; });

/* ---------- Dragging ---------- */

let drag = null;
let suppressClick = false;
const suppressNextClick = () => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); };

const cellAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest(".cell");
  return cell && grid.contains(cell) ? cell : null;
};
const clearDropTarget = () => grid.querySelectorAll(".drop-target").forEach(c => c.classList.remove("drop-target"));

const handlePointerDown = (e, tubbyKey, fromIdx) => {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  drag = { tubbyKey, fromIdx, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
};

tray.addEventListener("pointerdown", e => {
  const btn = e.target.closest(".tubby-btn");
  if (btn) handlePointerDown(e, btn.dataset.tubby, null);
});
grid.addEventListener("pointerdown", e => {
  const mark = e.target.closest(".mark");
  if (mark) handlePointerDown(e, mark.dataset.tubby, Number(mark.closest(".cell").dataset.idx));
});

window.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
    drag.moved = true;
    drag.ghost = document.createElement("div");
    drag.ghost.className = "ghost";
    drag.ghost.innerHTML = tubbySVG(drag.tubbyKey);
    document.body.append(drag.ghost);
  }
  if (!drag.moved) return;
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  clearDropTarget();
  const cell = cellAt(e.clientX, e.clientY);
  if (cell && !cell.classList.contains("free")) cell.classList.add("drop-target");
});

const endDrag = (e, cancelled) => {
  if (!drag) return;
  const current = drag;
  drag = null;
  clearDropTarget();
  if (current.ghost) current.ghost.remove();
  suppressNextClick();
  if (!current.moved) {
    if (current.fromIdx === null) {
      state.selected = state.selected === current.tubbyKey ? null : current.tubbyKey;
      renderTray();
    }
    return;
  }
  if (cancelled) return;
  const cell = cellAt(e.clientX, e.clientY);
  const targetIdx = cell ? Number(cell.dataset.idx) : null;
  if (targetIdx === null) {
    if (current.fromIdx !== null) removeMark(current.fromIdx);
    return;
  }
  if (targetIdx === FREE_INDEX || targetIdx === current.fromIdx) return;
  if (current.fromIdx !== null) delete state.marks[current.fromIdx];
  placeMark(targetIdx, current.tubbyKey);
};
window.addEventListener("pointerup", e => endDrag(e, false));
window.addEventListener("pointercancel", e => endDrag(e, true));

/* ---------- Click and keyboard ---------- */

tray.addEventListener("click", e => {
  if (suppressClick) return;
  const btn = e.target.closest(".tubby-btn");
  if (!btn) return;
  state.selected = state.selected === btn.dataset.tubby ? null : btn.dataset.tubby;
  renderTray();
});
grid.addEventListener("click", e => {
  if (suppressClick) return;
  const cell = e.target.closest(".cell");
  if (!cell) return;
  const idx = Number(cell.dataset.idx);
  if (idx === FREE_INDEX || state.marks[idx]) return;
  if (!state.board) { statusEl.textContent = "Pick your board first, then start marking."; return; }
  if (!state.selected) {
    statusEl.textContent = "Pick a Tubby from the tray first, then tap the square.";
    return;
  }
  placeMark(idx, state.selected);
  grid.querySelector(`[data-idx="${idx}"]`)?.focus();
});
grid.addEventListener("dblclick", e => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  const idx = Number(cell.dataset.idx);
  if (state.marks[idx]) removeMark(idx);
});
grid.addEventListener("keydown", e => {
  const cell = e.target.closest(".cell");
  if (!cell || (e.key !== "Delete" && e.key !== "Backspace")) return;
  const idx = Number(cell.dataset.idx);
  if (!state.marks[idx]) return;
  e.preventDefault();
  removeMark(idx);
  grid.querySelector(`[data-idx="${idx}"]`)?.focus();
});

$("hug").addEventListener("click", () => {
  if (!state.board) return;
  state.marks = {};
  renderGrid();
  queueSave();
  statusEl.textContent = "Big hug! Your card is clear.";
});

/* ---------- Phrase suggestions ---------- */

const SUGGEST_MAX = 90;
const suggestDialog = $("suggest-dialog");
const suggestText = $("suggest-text");
const setSuggestError = text => { $("suggest-error").textContent = text; $("suggest-error").hidden = !text; };
const updateSuggestCount = () => { $("suggest-count").textContent = `${suggestText.value.length}/${SUGGEST_MAX}`; };

$("suggest").addEventListener("click", () => {
  suggestText.value = "";
  updateSuggestCount();
  setSuggestError("");
  suggestDialog.showModal();
  suggestText.focus();
});
$("suggest-cancel").addEventListener("click", () => suggestDialog.close());
suggestDialog.addEventListener("click", e => { if (e.target === suggestDialog) suggestDialog.close(); });
suggestText.addEventListener("input", () => { updateSuggestCount(); setSuggestError(""); });

$("suggest-form").addEventListener("submit", async event => {
  event.preventDefault();
  const text = suggestText.value.replace(/\s+/g, " ").trim();
  if (!text) { setSuggestError("Type a phrase first."); return; }
  if (text.length > SUGGEST_MAX) { setSuggestError(`Keep it to ${SUGGEST_MAX} characters so it fits on a square.`); return; }
  const known = phraseEntries(state.round + 1).map(entry => normalizePhrase(entry.text));
  if (known.includes(normalizePhrase(text))) { setSuggestError("That one's already in the game."); return; }
  $("suggest-submit").disabled = true;
  try {
    await addDoc(collection(db, "suggestions"), {
      text,
      uid: state.user.uid,
      name: displayName(),
      at: serverTimestamp()
    });
    suggestDialog.close();
    statusEl.textContent = "Thanks! Your phrase went to the suggestion box.";
  } catch {
    setSuggestError("Couldn't send your suggestion. Check your connection and try again.");
  } finally {
    $("suggest-submit").disabled = false;
  }
});

/* Similarity check: flags suggestions that read a lot like a phrase already in the game.
   It compares the meaningful words and the letter pairs, and keeps the higher score. */
const SIMILAR_AT = 0.6;
const STOP_WORDS = new Set("a an the is to of and or in on at it its for with he she they we you i me my our your his her their this that be are was were has have had just so".split(" "));
const stemWord = w => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
const keyWords = text => normalizePhrase(text).split(" ").filter(w => w && !STOP_WORDS.has(w)).map(stemWord);
const letterPairs = text => {
  const s = normalizePhrase(text).replace(/ /g, "");
  const pairs = [];
  for (let i = 0; i < s.length - 1; i++) pairs.push(s.slice(i, i + 2));
  return pairs;
};
const overlap = (a, b) => {
  if (!a.length || !b.length) return 0;
  const rest = [...b];
  let hits = 0;
  a.forEach(x => { const i = rest.indexOf(x); if (i > -1) { hits++; rest.splice(i, 1); } });
  return (2 * hits) / (a.length + b.length);
};
const similarity = (a, b) => Math.max(overlap(keyWords(a), keyWords(b)), overlap(letterPairs(a), letterPairs(b)));

const similarMatches = (text, skipId) => {
  if (!text.trim()) return [];
  const candidates = [
    ...phraseEntries(state.round + 1).map(entry => ({ text: entry.text, where: "in the game" })),
    ...state.suggestions.filter(s => s.id !== skipId && s.text).map(s => ({ text: s.text, where: "another suggestion" }))
  ];
  return candidates
    .map(c => ({ ...c, score: similarity(text, c.text) }))
    .filter(c => c.score >= SIMILAR_AT)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
};

const miniSquare = (text, label) => {
  const wrap = document.createElement("figure");
  wrap.className = "mini";
  const square = document.createElement("div");
  square.className = "mini-square";
  square.textContent = text;
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  wrap.append(square, caption);
  return wrap;
};

// Shows the suggestion and each close match as bingo squares side by side, so the admin
// can compare them before deciding.
const renderFlag = (flag, text, skipId) => {
  const matches = similarMatches(text, skipId);
  flag.hidden = !matches.length;
  flag.replaceChildren();
  if (!matches.length) return;
  const title = document.createElement("strong");
  title.textContent = matches.length > 1 ? "Looks similar to these squares:" : "Looks similar to this square:";
  flag.append(title);
  matches.forEach(m => {
    const pair = document.createElement("div");
    pair.className = "compare";
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = `${Math.round(m.score * 100)}% match`;
    pair.append(
      miniSquare(text, "This suggestion"),
      score,
      miniSquare(m.text, m.where === "in the game" ? "Already in the game" : "Another suggestion")
    );
    flag.append(pair);
  });
};

const renderSuggestions = () => {
  const box = $("suggestions");
  // Keep any edits the admin is in the middle of when the list refreshes.
  const drafts = new Map([...box.querySelectorAll("li")].map(li => [li.dataset.id, li.querySelector("input").value]));
  const items = [...state.suggestions].sort((a, b) => toMillis(a.at) - toMillis(b.at));
  $("suggest-review-title").textContent = items.length ? `Phrase suggestions (${items.length})` : "Phrase suggestions";
  if (!items.length) {
    box.innerHTML = '<p class="empty">No suggestions waiting.</p>';
    return;
  }
  const list = document.createElement("ul");
  list.className = "suggestions";
  items.forEach(item => {
    const li = document.createElement("li");
    li.dataset.id = item.id;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = SUGGEST_MAX;
    input.value = drafts.get(item.id) ?? item.text ?? "";
    input.setAttribute("aria-label", `Phrase suggested by ${item.name || "a player"}`);
    const from = document.createElement("span");
    from.className = "from";
    from.textContent = `Suggested by ${item.name || "a player"}`;
    const flag = document.createElement("p");
    flag.className = "flag";
    flag.setAttribute("aria-live", "polite");
    renderFlag(flag, input.value, item.id);
    input.addEventListener("input", () => renderFlag(flag, input.value, item.id));
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<button class="btn primary" type="button" data-action="add">Add to game</button><button class="btn" type="button" data-action="dismiss">Dismiss</button>';
    li.append(input, from, flag, row);
    list.append(li);
  });
  box.replaceChildren(list);
};

$("suggestions").addEventListener("click", async e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const li = btn.closest("li");
  const id = li.dataset.id;
  const item = state.suggestions.find(s => s.id === id);
  li.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    if (btn.dataset.action === "dismiss") {
      await deleteDoc(doc(db, "suggestions", id));
      return;
    }
    const text = li.querySelector("input").value.replace(/\s+/g, " ").trim();
    if (!text) { showNote("Type the phrase before adding it."); li.querySelectorAll("button").forEach(b => { b.disabled = false; }); return; }
    const nextRound = state.round + 1;
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "phrases")), {
      text,
      fromRound: nextRound,
      suggestedBy: item?.name || null,
      addedAt: serverTimestamp()
    });
    batch.delete(doc(db, "suggestions", id));
    await batch.commit();
    showNote(`Added. It can show up on cards starting round ${nextRound}.`);
  } catch {
    li.querySelectorAll("button").forEach(b => { b.disabled = false; });
    showNote("Couldn't update that suggestion. Make sure your account is listed as an admin.");
  }
});

/* ---------- Admin: manage card phrases ---------- */

const managedPhrases = () => {
  const round = state.round;
  const builtins = PHRASES.map(text => ({ text, source: "builtin" }));
  const added = [...state.extraPhrases]
    .sort((a, b) => toMillis(a.addedAt) - toMillis(b.addedAt))
    .map(p => ({ text: p.text, source: "added", id: p.id, fromRound: Number(p.fromRound) }));
  return [...builtins, ...added]
    .filter(entry => !isRemovedBy(entry, round))
    .map(entry => ({ ...entry, leaving: pendingRemoval(entry, round), upcoming: entry.source === "added" && entry.fromRound > round }));
};

const renderPhraseManager = () => {
  const box = $("phrase-list");
  if (!box) return;
  const nextCount = phraseEntries(state.round + 1).length;
  $("phrase-count").textContent = `${nextCount} phrases next round`;
  const filter = normalizePhrase($("phrase-filter").value);
  const items = managedPhrases().filter(entry => !filter || normalizePhrase(entry.text).includes(filter));
  if (!items.length) {
    box.innerHTML = '<p class="empty">No phrases match that search.</p>';
    return;
  }
  const list = document.createElement("ul");
  list.className = "phrase-list";
  items.forEach(entry => {
    const li = document.createElement("li");
    if (entry.leaving) li.classList.add("leaving");
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = entry.text;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = entry.leaving ? "Leaving next round" : entry.upcoming ? "New next round" : entry.source === "added" ? "Added" : "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    if (entry.leaving) {
      btn.textContent = "Keep it";
      btn.dataset.action = "keep";
      btn.dataset.removalId = entry.leaving.id;
    } else {
      btn.textContent = "Remove";
      btn.dataset.action = "remove";
    }
    btn.setAttribute("aria-label", `${btn.textContent}: ${entry.text}`);
    btn.dataset.source = entry.source;
    btn.dataset.text = entry.text;
    if (entry.id) btn.dataset.id = entry.id;
    if (entry.upcoming) btn.dataset.upcoming = "1";
    li.append(text, tag, btn);
    list.append(li);
  });
  box.replaceChildren(list);
};

$("phrase-filter").addEventListener("input", renderPhraseManager);

$("phrase-list").addEventListener("click", async e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  btn.disabled = true;
  try {
    if (btn.dataset.action === "keep") {
      await deleteDoc(doc(db, "removedPhrases", btn.dataset.removalId));
      showNote("Kept. That phrase stays in the game.");
      return;
    }
    if (phraseEntries(state.round + 1).length - 1 < CARD_SQUARES) {
      showNote(`The game needs at least ${CARD_SQUARES} phrases to fill a card. Add another before removing this one.`);
      btn.disabled = false;
      return;
    }
    if (btn.dataset.upcoming) {
      // Not on anyone's card yet, so it can go right away.
      await deleteDoc(doc(db, "phrases", btn.dataset.id));
      showNote("Removed.");
      return;
    }
    // Already on cards this round, so it leaves when the next round starts.
    await addDoc(collection(db, "removedPhrases"), {
      text: btn.dataset.text,
      source: btn.dataset.source,
      phraseId: btn.dataset.id || null,
      fromRound: state.round + 1,
      removedAt: serverTimestamp()
    });
    showNote(`Removed. It comes off cards starting round ${state.round + 1}.`);
  } catch {
    btn.disabled = false;
    showNote("Couldn't change that phrase. Make sure your account is listed as an admin and the latest rules are published.");
  }
});

/* ---------- Standings and winners ---------- */

const showNote = text => { $("board-note").textContent = text; $("board-note").hidden = !text; };

const renderStandings = () => {
  const container = $("standings");
  const players = state.players
    .filter(p => p.round === state.round)
    .sort((a, b) => (b.best - a.best) || (b.marked - a.marked) || a.name.localeCompare(b.name));
  if (!players.length) {
    container.innerHTML = '<p class="empty">Nobody has marked a square yet this round.</p>';
    return;
  }
  const list = document.createElement("ul");
  list.className = "standings";
  players.forEach(p => {
    const li = document.createElement("li");
    if (p.id === state.user?.uid) li.classList.add("me");
    const body = document.createElement("div");
    const top = document.createElement("div");
    top.className = "top";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = p.name || "A Tubby fan";
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = p.best >= 5 ? `${p.marked}/${CARD_SQUARES} · BINGO` : `${p.marked}/${CARD_SQUARES} · ${p.best} in a row`;
    top.append(who, score);
    const track = document.createElement("div");
    track.className = "track";
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", `${p.name}: ${p.marked} of ${CARD_SQUARES} squares, best line ${p.best} of 5`);
    const bar = document.createElement("div");
    bar.className = `bar ${heatClass(p.best)}`;
    bar.style.width = `${Math.round((p.marked / CARD_SQUARES) * 100)}%`;
    track.append(bar);
    body.append(top, track);
    li.append(avatarFor(p.name, p.photoURL), body);
    list.append(li);
  });
  container.replaceChildren(list);
};

const renderWinners = () => {
  $("round-label").textContent = `Round ${state.round}`;
  const winners = state.winners.filter(w => w.round === state.round).sort((a, b) => toMillis(a.at) - toMillis(b.at));
  if (!winners.length) {
    $("board").innerHTML = '<p class="empty">No winners yet. First to five in a row takes the top spot.</p>';
    return;
  }
  const list = document.createElement("ol");
  list.className = "winners";
  winners.forEach((w, i) => {
    const li = document.createElement("li");
    if (i === 0) li.className = "first";
    const place = document.createElement("span");
    place.className = "place";
    place.textContent = ordinal(i + 1);
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = (w.name || "A Tubby fan") + (w.id === state.user?.uid ? " (you)" : "");
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = timeFormat.format(new Date(toMillis(w.at)));
    li.append(place, avatarFor(w.name, w.photoURL), who, when);
    list.append(li);
  });
  $("board").replaceChildren(list);
};

/* ---------- Monthly leaderboard ---------- */

// Points per BINGO, by finishing order within its round: 1st gets 3, 2nd gets 2, everyone after gets 1.
const POINTS_BY_PLACE = [3, 2];
const pointsFor = place => POINTS_BY_PLACE[place - 1] ?? 1;
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const monthName = new Intl.DateTimeFormat(undefined, { month: "long" });

const monthlyTotals = () => {
  const start = monthStart().getTime();
  const wins = state.monthWins.filter(w => toMillis(w.at) >= start);
  const byRound = new Map();
  wins.forEach(w => { if (!byRound.has(w.round)) byRound.set(w.round, []); byRound.get(w.round).push(w); });
  const totals = new Map();
  byRound.forEach(list => {
    list.sort((a, b) => toMillis(a.at) - toMillis(b.at)).forEach((w, i) => {
      const t = totals.get(w.uid) || { uid: w.uid, name: w.name, photoURL: w.photoURL, points: 0, wins: 0, firsts: 0 };
      t.points += pointsFor(i + 1);
      t.wins += 1;
      if (i === 0) t.firsts += 1;
      t.name = w.name || t.name;
      t.photoURL = w.photoURL || t.photoURL;
      totals.set(w.uid, t);
    });
  });
  return [...totals.values()].sort((a, b) => (b.points - a.points) || (b.wins - a.wins) || (b.firsts - a.firsts) || (a.name || "").localeCompare(b.name || ""));
};

const renderMonthly = () => {
  $("month-title").textContent = `Top Tubbies of ${monthName.format(new Date())}`;
  const rows = monthlyTotals();
  const box = $("monthly");
  if (!rows.length) {
    box.innerHTML = '<p class="empty">No BINGOs yet this month. The first one gets 3 points.</p>';
    return;
  }
  const max = rows[0].points;
  const list = document.createElement("ol");
  list.className = "monthly";
  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (!prev || prev.points !== r.points || prev.wins !== r.wins) rank = i + 1;
    prev = r;
    const li = document.createElement("li");
    if (rank === 1) li.classList.add("lead");
    if (r.uid === state.user?.uid) li.classList.add("me");
    const place = document.createElement("span");
    place.className = "place";
    place.textContent = rank;
    const body = document.createElement("div");
    const top = document.createElement("div");
    top.className = "top";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = r.name || "A Tubby fan";
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = `${r.points} pts · ${r.wins} ${r.wins === 1 ? "win" : "wins"}`;
    top.append(who, score);
    const track = document.createElement("div");
    track.className = "track";
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", `${r.name}: ${r.points} points from ${r.wins} wins, ${r.firsts} first place`);
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${Math.max(4, Math.round((r.points / max) * 100))}%`;
    track.append(bar);
    body.append(top, track);
    li.append(place, avatarFor(r.name, r.photoURL), body);
    list.append(li);
  });
  box.replaceChildren(list);
};

/* ---------- Rounds ---------- */

const readPhrases = snap => snap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(p => typeof p.text === "string" && p.text.trim());

const loadExtraPhrases = async () => {
  const [added, removed] = await Promise.all([
    getDocs(collection(db, "phrases")).catch(() => null),
    getDocs(collection(db, "removedPhrases")).catch(() => null)
  ]);
  // On a failed read, keep whatever we had; the built-in phrases still make a full card.
  if (added) state.extraPhrases = readPhrases(added);
  if (removed) state.removedPhrases = readPhrases(removed);
};

const loadRound = async round => {
  await loadExtraPhrases();
  state.round = round;
  const snap = await getDoc(doc(db, "players", state.user.uid)).catch(() => null);
  const saved = snap?.exists() ? snap.data() : null;
  const sameRound = Boolean(saved && saved.round === round);
  const hadMarks = sameRound && saved.marks && Object.keys(saved.marks).length > 0;
  const validBoard = sameRound && TUBBIES.some(t => t.key === saved.board);
  state.board = validBoard ? saved.board : hadMarks ? "legacy" : null;
  state.previewBoard = null;
  dealCard();
  state.marks = sameRound && state.board && saved.marks ? { ...saved.marks } : {};
  state.wonRound = winningLines().length ? round : null;
  renderBoardPicker();
  renderGrid();
  renderStandings();
  renderWinners();
  renderMonthly();
  if (state.isAdmin) { renderPhraseManager(); renderSuggestions(); }
  const needsSave = !sameRound || saved.name !== displayName() || (saved.board ?? null) !== state.board;
  if (needsSave) savePlayer();
};

$("new-round").addEventListener("click", () => { $("confirm").hidden = false; });
$("confirm-no").addEventListener("click", () => { $("confirm").hidden = true; });
$("confirm-yes").addEventListener("click", async () => {
  $("confirm").hidden = true;
  try {
    const batch = writeBatch(db);
    const winners = await getDocs(collection(db, "winners"));
    winners.forEach(w => batch.delete(w.ref));
    batch.set(doc(db, "config", "game"), { round: state.round + 1 });
    await batch.commit();
    showNote("New round started. Everyone gets a fresh card.");
  } catch {
    showNote("Couldn't start a new round. Make sure your account is listed as an admin.");
  }
});

/* ---------- Session ---------- */

const stopListening = () => {
  state.unsubscribers.forEach(unsubscribe => unsubscribe());
  state.unsubscribers = [];
};

const startSession = async () => {
  showView("game");
  renderUserChip();
  renderTray();
  $("standings").innerHTML = '<p class="empty">Loading players…</p>';
  $("board").innerHTML = '<p class="empty">Checking the board…</p>';

  const adminSnap = await getDoc(doc(db, "admins", state.user.uid)).catch(() => null);
  state.isAdmin = Boolean(adminSnap?.exists());
  $("owner-tools").hidden = !state.isAdmin;

  if (state.isAdmin) {
    state.unsubscribers.push(onSnapshot(collection(db, "suggestions"), snap => {
      state.suggestions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSuggestions();
    }, () => {
      $("suggestions").innerHTML = '<p class="empty">Suggestions are unavailable right now. Check that the latest security rules are published.</p>';
    }));
    // Live phrase lists so the admin's view updates as soon as something is added or removed.
    // Cards don't change until the next round, because dealing goes by each entry's round.
    const refreshAdminLists = () => { if (state.card.length) { renderPhraseManager(); renderSuggestions(); } };
    state.unsubscribers.push(onSnapshot(collection(db, "phrases"), snap => {
      state.extraPhrases = readPhrases(snap);
      refreshAdminLists();
    }, () => {}));
    state.unsubscribers.push(onSnapshot(collection(db, "removedPhrases"), snap => {
      state.removedPhrases = readPhrases(snap);
      refreshAdminLists();
    }, () => {}));
  }

  let firstRound = true;
  state.unsubscribers.push(onSnapshot(doc(db, "config", "game"), snap => {
    const round = snap.exists() && Number(snap.data().round) > 0 ? Number(snap.data().round) : 1;
    if (!firstRound && round === state.round) return;
    if (!firstRound) statusEl.textContent = `Round ${round} started. Here's your fresh card.`;
    firstRound = false;
    loadRound(round);
  }, () => {
    if (firstRound) { firstRound = false; loadRound(1); }
  }));

  state.unsubscribers.push(onSnapshot(collection(db, "players"), snap => {
    state.players = snap.docs.map(d => ({ id: d.id, name: "", marked: 0, best: 0, ...d.data() }));
    renderStandings();
  }, () => {
    $("standings").innerHTML = '<p class="empty">Standings are unavailable right now. Your card still works.</p>';
  }));

  // Last month's wins come along too, so the board rolls over on its own if the page stays open.
  const since = new Date(monthStart().getFullYear(), monthStart().getMonth() - 1, 1);
  state.unsubscribers.push(onSnapshot(query(collection(db, "wins"), where("at", ">=", Timestamp.fromDate(since))), snap => {
    state.monthWins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMonthly();
  }, () => {
    $("monthly").innerHTML = '<p class="empty">The monthly leaderboard is unavailable right now. Check that the latest security rules are published.</p>';
  }));

  state.unsubscribers.push(onSnapshot(collection(db, "winners"), snap => {
    state.winners = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderWinners();
  }, () => {
    $("board").innerHTML = '<p class="empty">The winners board is unavailable right now. Your card still works.</p>';
  }));
};

onAuthStateChanged(auth, user => {
  stopListening();
  state.user = user;
  state.players = [];
  state.winners = [];
  state.suggestions = [];
  if (suggestDialog.open) suggestDialog.close();
  if (!user) {
    renderUserChip();
    setAuthMode(false);
    showView("auth");
    return;
  }
  startSession();
});
