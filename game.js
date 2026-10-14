"use strict";

/* Line upon line
   Study a quote, then test yourself with a random game.
   Quotes are read from data.json. Each item looks like:
   { "id": 1, "type": "quote", "prompt": "Who, where, when",
     "answer": "The text to learn", "tags": ["faith"] }
*/

// ---------- Settings ----------

const LEVELS = ["easy", "medium", "hard"];

// Fill the gaps: share of words hidden
const GAP_SHARE = { easy: 0.2, medium: 0.4, hard: 0.7 };

// Spot the wrong word: how many words get swapped
const SWAP_COUNT = { easy: 1, medium: 2, hard: 3 };

// Word jumble: how many extra pieces from other quotes are mixed in
const DECOY_COUNT = { easy: 1, medium: 2, hard: 3 };

// Word jumble: how many pieces the quote is cut into.
// Easy = a handful of big chunks, hard = one piece per word.
function pieceCount(wordTotal, level) {
  if (level === "easy") return Math.min(wordTotal, Math.max(3, Math.ceil(wordTotal / 4)));
  if (level === "medium") return Math.min(wordTotal, Math.max(4, Math.ceil(wordTotal / 2)));
  return wordTotal;
}

// The kinds of content, each with its own tab and its own JSON file.
// Items are given their kind by the file they come from, or by their own "type".
// Facts will need a different game, so they are not here yet.
const TYPES = {
  quote: {
    label: "Quotes",
    one: "quote",
    many: "quotes",
    file: "data.json",
    empty: "No quotes yet.",
  },
  scripture: {
    label: "Scriptures",
    one: "scripture",
    many: "scriptures",
    file: "scriptures.json",
    empty:
      "No scriptures yet. Add a scriptures.json file next to data.json, using the same format as your quotes.",
  },
};

// Topics with fewer items than this are tucked under "Other topics"
const MIN_TOPIC_SIZE = 3;

// ---- Settings you might want to change ----
// How many quotes you work through in one go (one "round").
const SESSION_SIZE = 2;

// How many different tests you must do on each quote before moving on.
// (Up to 5, because there are five kinds of test.)
const TESTS_PER_QUOTE = 2;

// Opposites used by "Spot the wrong word" so some swaps look believable.
const SWAPS = {
  more: "less", less: "more", increase: "decrease", easier: "harder",
  love: "hate", good: "bad", best: "worst", better: "worse", true: "false",
  light: "darkness", joy: "sorrow", always: "never", faith: "doubt",
  strength: "weakness", eternal: "temporary", righteous: "wicked",
  peace: "conflict", learn: "forget",
};

const PREFS_KEY = "line-upon-line:prefs:v4";
const HISTORY_KEY = "line-upon-line:history:v1";
const PROGRESS_KEY = "line-upon-line:progress:v1";

// ---- How learning is tracked ----
// Every quote sits in a box from 0 to 5.
//   0 = new, 1-2 = short-term, 3-5 = long-term.
// A quote moves up a box when you get a strong test perfect AFTER it is due.
// INTERVAL_DAYS says how long to wait before it is due again.
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_BOX = INTERVAL_DAYS.length - 1;
const LONG_TERM_BOX = 3;
const DAY = 24 * 60 * 60 * 1000;

// ---------- State ----------

const state = {
  quotes: [],         // every quote and scripture, all types together
  wordPool: [],       // every word in the data, used for believable swaps
  tagLabels: new Map(), // "doctrine of christ" -> "Doctrine of christ"
  fileStatus: {},     // type -> "ok" | "missing" | "broken"
  progress: {},       // item key -> { box, due, attempts, perfects, last }
  history: {},        // "2026-10-11" -> { new: [keys], reviewed: [keys] }
  view: "home",       // "home" or "play"

  // the topic chooser
  tab: "quote",
  selection: { quote: [], scripture: [] }, // chosen topics for each tab
  search: "",
  othersOpen: false,

  // what is being played
  session: { type: "quote", tags: [], kind: "learn" }, // kind: "learn", "due" or "learned"
  deck: [],
  position: 0,
  activeMode: null,   // the test on screen
  lastMode: null,     // so the same test never comes up twice running
  level: "medium",
  hints: false,
  phase: "study",     // "study" -> "test" -> "done"
  current: null,
  ctrl: null,         // controller of the test on screen
  counted: false,     // result for this quote already recorded?

  // the tests on the current quote
  testNumber: 0,      // 1 for the first test, 2 for the second...
  results: [],        // one { mode, perfect, strong } for each finished test
  testResult: null,   // did the test on screen go right on the first check?

  // the current round
  roundCount: 0,      // quotes finished so far
  roundLog: [],       // [{ label, perfect }] for the round summary
};

// ---------- Page elements ----------

const $ = (id) => document.getElementById(id);

const el = {
  home: $("home"),
  play: $("play"),
  homeLink: $("home-link"),
  backLink: $("back-link"),
  streakNow: $("streak-now"),
  streakNote: $("streak-note"),
  streakBest: $("streak-best"),
  week: $("week"),
  periods: $("periods"),
  totals: $("totals"),
  dueText: $("due-text"),
  review: $("review"),
  reviewLearned: $("review-learned"),
  typeTabs: $("type-tabs"),
  typePanel: $("type-panel"),
  typeEmpty: $("type-empty"),
  chooserBody: $("chooser-body"),
  search: $("topic-search"),
  chips: $("topic-chips"),
  other: $("other-topics"),
  otherLabel: $("other-label"),
  otherChips: $("other-chips"),
  noMatch: $("no-match"),
  selectionSummary: $("selection-summary"),
  clear: $("clear-selection"),
  learn: $("learn"),
  progress: $("progress"),
  prompt: $("prompt"),
  testName: $("test-name"),
  studyTip: $("study-tip"),
  stage: $("stage"),
  result: $("result"),
  setup: $("setup"),
  difficulty: $("difficulty"),
  hints: $("hints"),
  actionsStudy: $("actions-study"),
  actionsTest: $("actions-test"),
  actionsDone: $("actions-done"),
  start: $("start"),
  skip: $("skip"),
  check: $("check"),
  reveal: $("reveal"),
  again: $("again"),
  next: $("next"),
  actionsBetween: $("actions-between"),
  nextTest: $("next-test"),
  sheet: $("quote-sheet"),
  round: $("round"),
  roundSummary: $("round-summary"),
  roundList: $("round-list"),
  roundMore: $("round-more"),
  roundHome: $("round-home"),
};

// ---------- Small helpers ----------

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Lets "don’t" and "don't" match, and ignores capitals and punctuation.
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, "");
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Splits a quote into words. Punctuation stays outside the word, so
// “converted,” becomes: before “   core converted   after ,”
function tokenise(text) {
  const tokens = [];
  const parts = text.split(/\s+/).filter(Boolean);

  for (const part of parts) {
    // Break "decisions—every" into "decisions—" and "every" (no space added)
    const pieces = part.split(/(?<=—)/);
    pieces.forEach((piece, k) => {
      const m = piece.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
      tokens.push({
        raw: piece,
        before: m[1],
        core: m[2],
        after: m[3],
        spaceAfter: k === pieces.length - 1,
      });
    });
  }
  return tokens;
}

// Which expected words did the typed words match, in order?
// (Longest common subsequence, so one missed word does not spoil the rest.)
function matchWords(expected, typed) {
  const n = expected.length;
  const m = typed.length;
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        expected[i] === typed[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const matched = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === typed[j]) {
      matched.add(i);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

// ---------- Saved preferences ----------

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (LEVELS.includes(saved.level)) state.level = saved.level;
    state.hints = Boolean(saved.hints);
    if (TYPES[saved.tab]) state.tab = saved.tab;
  } catch (err) {
    // Storage can be blocked. The game still works without it.
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ level: state.level, hints: state.hints, tab: state.tab })
    );
  } catch (err) {
    // ignore
  }
}

// =====================================================================
// THE FIVE TESTS
// Each "build" function draws its test into the stage and returns a
// controller:  { check(), reveal(), focus() }
// check() returns { right, total, complete, message }
// =====================================================================

// ---------- 1. Fill the gaps ----------

function buildGaps(stage, text, level) {
  const tokens = tokenise(text);

  // Only words with letters or numbers can be hidden (not ". . .")
  const hideable = [];
  tokens.forEach((t, i) => {
    if (t.core.length > 0) hideable.push(i);
  });

  const howMany = Math.max(1, Math.round(hideable.length * GAP_SHARE[level]));
  const hidden = new Set(shuffle(hideable).slice(0, howMany));
  const blanks = [];
  const quote = make("div", "quote");

  tokens.forEach((token, i) => {
    const word = make("span", "word");

    if (hidden.has(i)) {
      const index = blanks.length;
      const input = make("input", "gap");
      input.type = "text";
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("autocorrect", "off");
      input.setAttribute("aria-label", `Missing word ${index + 1}, ${token.core.length} letters`);
      input.style.width = `${Math.max(token.core.length, 2) + 1}ch`;
      input.placeholder = state.hints ? token.core.charAt(0) : "";

      input.addEventListener("input", () => input.classList.remove("wrong"));
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const later = blanks.slice(index + 1).find((b) => !b.input.readOnly);
        if (later) later.input.focus();
        else checkAnswer();
      });

      word.append(token.before, input, token.after);
      blanks.push({ input, answer: token.core });
    } else {
      word.textContent = token.raw;
    }

    quote.append(word);
    if (token.spaceAfter) quote.append(" ");
  });

  stage.replaceChildren(quote);

  return {
    focus() {
      if (blanks.length) blanks[0].input.focus();
    },

    check() {
      let right = 0;
      for (const { input, answer } of blanks) {
        const ok = normalise(input.value) === normalise(answer);
        input.classList.toggle("right", ok);
        input.classList.toggle("wrong", !ok);
        if (ok) {
          right += 1;
          input.readOnly = true;
        }
      }
      const total = blanks.length;
      const complete = right === total;
      return {
        right,
        total,
        complete,
        message: complete
          ? total === 1 ? "Correct." : `All ${total} correct. Well done.`
          : `${right} of ${total} correct. Fix the dashed words or show the answers.`,
      };
    },

    reveal() {
      for (const { input, answer } of blanks) {
        if (input.readOnly) continue;
        input.value = answer;
        input.readOnly = true;
        input.classList.remove("wrong");
        input.classList.add("revealed");
      }
    },
  };
}

// ---------- 2. Word jumble ----------
// A few extra pieces from other quotes are mixed in. They do not belong to
// this quote, so they are left in the tray.

function makeDecoys(text, pieces, wanted) {
  const ownWords = new Set(text.split(/\s+/).map(normalise));
  const taken = new Set(pieces.map((p) => p.toLowerCase()));
  const sizes = pieces.map((p) => p.split(" ").length);
  const notThis = state.quotes.filter((q) => q.answer !== text);
  const sameType = notThis.filter((q) => state.current && q.type === state.current.type);
  const others = sameType.length ? sameType : notThis;
  const decoys = [];

  for (let tries = 0; tries < 80 && decoys.length < wanted && others.length; tries++) {
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    const other = others[Math.floor(Math.random() * others.length)];
    const words = other.answer.split(/\s+/).filter(Boolean);
    if (words.length < size) continue;

    const start = Math.floor(Math.random() * (words.length - size + 1));
    const run = words.slice(start, start + size);
    const candidate = run.join(" ");

    if (!normalise(run[0])) continue;
    if (size === 1 && ownWords.has(normalise(run[0]))) continue; // would be a real word here
    if (taken.has(candidate.toLowerCase())) continue;

    taken.add(candidate.toLowerCase());
    decoys.push(candidate);
  }
  return decoys;
}

function buildJumble(stage, text, level) {
  const words = text.split(/\s+/).filter(Boolean);
  const count = pieceCount(words.length, level);

  // Cut the words into `count` pieces of nearly equal size
  const base = Math.floor(words.length / count);
  const extra = words.length % count;
  const pieces = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    pieces.push(words.slice(start, start + size).join(" "));
    start += size;
  }

  const real = pieces.map((piece, id) => ({ id, text: piece, decoy: false }));
  const decoyTexts = makeDecoys(text, pieces, DECOY_COUNT[level]);
  const decoys = decoyTexts.map((piece, i) => ({ id: count + i, text: piece, decoy: true }));

  const solved = (list) => list.length === count && list.every((tile, i) => tile.text === pieces[i]);
  let tray = shuffle([...real, ...decoys]);
  for (let tries = 0; tries < 10 && count > 1; tries++) {
    if (!solved(tray)) break; // make sure it does not start in the right order
    tray = shuffle([...real, ...decoys]);
  }

  let built = [];
  let marks = null;     // "right" / "wrong" / "revealed" for each built tile
  let locked = false;

  const note = make("p", "tray-note");
  if (decoys.length) {
    const n = decoys.length;
    note.textContent = `Careful: ${n} ${n === 1 ? "piece does" : "pieces do"} not belong to this quote. Leave ${n === 1 ? "it" : "them"} in the tray.`;
  } else {
    note.hidden = true;
  }
  const trayEl = make("div", "tray");
  trayEl.setAttribute("aria-label", "Pieces to place");
  const builtEl = make("div", "built");
  builtEl.setAttribute("aria-label", "Your quote so far");
  stage.replaceChildren(note, trayEl, builtEl);

  function tileButton(tile, onClick, mark) {
    const button = make("button", "tile", tile.text);
    button.type = "button";
    if (mark) button.classList.add(mark);
    button.disabled = locked;
    button.addEventListener("click", onClick);
    return button;
  }

  function draw() {
    trayEl.replaceChildren(
      ...tray.map((tile) =>
        tileButton(
          tile,
          () => {
            tray = tray.filter((t) => t !== tile);
            built.push(tile);
            marks = null;
            draw();
          },
          locked ? (tile.decoy ? "decoy" : "unused") : null
        )
      )
    );
    builtEl.replaceChildren(
      ...built.map((tile, i) =>
        tileButton(
          tile,
          () => {
            built = built.filter((t) => t !== tile);
            tray.push(tile);
            marks = null;
            draw();
          },
          marks && marks[i]
        )
      )
    );
  }
  draw();

  return {
    focus() {
      const first = trayEl.querySelector("button");
      if (first) first.focus();
    },

    check() {
      // Correct if the pieces read out as the whole quote
      const complete = built.map((t) => t.text).join(" ") === pieces.join(" ");
      marks = built.map((tile, i) => (complete || tile.text === pieces[i] ? "right" : "wrong"));
      if (complete) locked = true;
      draw();

      const total = pieces.length;
      const right = complete ? total : marks.filter((m) => m === "right").length;

      let message;
      if (complete) {
        message = "In the right order. Well done.";
      } else if (built.length < total) {
        message = `${right} of ${total} pieces in the right place. Place every piece, then check again.`;
      } else {
        message = `${right} of ${total} pieces in the right place. Move the dashed pieces and check again.`;
      }
      return { right, total, complete, message };
    },

    reveal() {
      built = real.map((tile) => ({ ...tile }));
      tray = decoys.map((tile) => ({ ...tile }));
      marks = built.map(() => "revealed");
      locked = true;
      draw();
    },
  };
}

// ---------- 3 and 5. Typing the whole quote ----------
// "First letters" shows an initial for every word. "Type from memory" shows nothing.

function buildTyping(stage, text, showInitials) {
  const tokens = tokenise(text);
  const parts = [];

  if (showInitials) {
    const cue = make("div", "quote initials");
    tokens.forEach((t) => {
      cue.append(`${t.before}${t.core.charAt(0)}${t.after}`);
      if (t.spaceAfter) cue.append(" ");
    });
    parts.push(cue);
  }

  const box = make("textarea", "typing");
  box.rows = 6;
  box.spellcheck = false;
  box.autocomplete = "off";
  box.setAttribute("autocapitalize", "off");
  box.setAttribute("autocorrect", "off");
  box.setAttribute("aria-label", "Type the whole quote here");
  box.placeholder = "Type the whole quote here";
  parts.push(box);

  const feedback = make("div", "quote feedback");
  feedback.hidden = true;
  parts.push(feedback);

  stage.replaceChildren(...parts);

  // Only words with letters or numbers count towards the score
  const expected = tokens.filter((t) => normalise(t.core) !== "").map((t) => normalise(t.core));

  // Draws the quote with each word marked. status(k) is "right", "missed" or "shown".
  function drawFeedback(status) {
    feedback.replaceChildren();
    feedback.hidden = false;
    let k = 0;
    for (const token of tokens) {
      const counts = normalise(token.core) !== "";
      const word = make("span", "word");
      if (!counts) {
        word.textContent = token.raw;
      } else {
        const mark = status(k);
        k += 1;
        if (mark === "missed") {
          word.append(token.before);
          const blank = make("span", "blank");
          blank.style.width = `${Math.max(token.core.length, 2)}ch`;
          word.append(blank, token.after);
        } else {
          word.textContent = token.raw;
          word.classList.add(mark);
        }
      }
      feedback.append(word);
      if (token.spaceAfter) feedback.append(" ");
    }
  }

  return {
    focus() {
      box.focus();
    },

    check() {
      const typed = box.value
        .replace(/[—–]/g, " ")
        .split(/\s+/)
        .map(normalise)
        .filter(Boolean);

      const matched = matchWords(expected, typed);
      const right = matched.size;
      const total = expected.length;
      const wrongExtra = typed.length - right;
      const complete = right === total && wrongExtra === 0;

      drawFeedback((k) => (matched.has(k) ? "right" : "missed"));
      if (complete) box.readOnly = true;

      let message;
      if (complete) {
        message = "Word perfect. Well done.";
      } else {
        message = `${right} of ${total} words correct.`;
        if (wrongExtra > 0) {
          message += ` ${wrongExtra} of the words you typed ${wrongExtra === 1 ? "is" : "are"} not in the quote.`;
        }
        message += " Dashed blanks are words you missed.";
      }
      return { right, total, complete, message };
    },

    reveal() {
      drawFeedback(() => "shown");
      box.readOnly = true;
    },
  };
}

// ---------- 4. Spot the wrong word ----------

function similarWord(core, avoid) {
  const key = normalise(core);
  let pick;

  if (SWAPS[key] && !avoid.has(SWAPS[key])) {
    pick = SWAPS[key];
  } else {
    const usable = state.wordPool.filter((w) => !avoid.has(w));
    const close = usable.filter((w) => Math.abs(w.length - key.length) <= 2);
    const options = close.length ? close : usable;
    pick = options.length ? options[Math.floor(Math.random() * options.length)] : "never";
  }
  return /^\p{Lu}/u.test(core) ? capitalise(pick) : pick;
}

function buildSpot(stage, text, level) {
  const tokens = tokenise(text);

  const hideable = [];
  tokens.forEach((t, i) => {
    if (t.core.length > 0) hideable.push(i);
  });

  const howMany = Math.min(SWAP_COUNT[level], Math.max(1, Math.floor(hideable.length / 4)));
  const swapped = new Set(shuffle(hideable).slice(0, howMany));
  const avoid = new Set(tokens.map((t) => normalise(t.core)));

  const items = [];
  const quote = make("div", "quote");

  tokens.forEach((token, i) => {
    const word = make("span", "word");

    if (token.core.length === 0) {
      word.textContent = token.raw;
    } else {
      const changed = swapped.has(i);
      let shown = token.core;
      if (changed) {
        shown = similarWord(token.core, avoid);
        avoid.add(normalise(shown));
      }

      const button = make("button", "pick", shown);
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        const on = !button.classList.contains("picked");
        button.classList.remove("right", "wrong");
        button.classList.toggle("picked", on);
        button.setAttribute("aria-pressed", String(on));
      });

      word.append(token.before, button, token.after);
      items.push({ button, changed, original: token.core });
    }

    quote.append(word);
    if (token.spaceAfter) quote.append(" ");
  });

  stage.replaceChildren(quote);

  return {
    focus() {
      if (items.length) items[0].button.focus();
    },

    check() {
      let right = 0;
      let falsePicks = 0;

      for (const { button, changed } of items) {
        button.classList.remove("right", "wrong");
        if (!button.classList.contains("picked")) continue;
        if (changed) {
          right += 1;
          button.classList.add("right");
        } else {
          falsePicks += 1;
          button.classList.add("wrong");
        }
      }

      const total = items.filter((i) => i.changed).length;
      const complete = right === total && falsePicks === 0;
      if (complete) items.forEach(({ button }) => (button.disabled = true));

      let message;
      if (complete) {
        message = total === 1 ? "Found it. Well done." : `Found all ${total}. Well done.`;
      } else {
        message = `Found ${right} of ${total} swapped word${total === 1 ? "" : "s"}.`;
        if (falsePicks > 0) {
          message += ` ${falsePicks} of your picks ${falsePicks === 1 ? "was" : "were"} not swapped (dashed). Tap again to unpick.`;
        }
      }
      return { right, total, complete, message };
    },

    reveal() {
      for (const item of items) {
        item.button.disabled = true;
        item.button.className = "pick";
        if (item.changed) {
          item.button.textContent = item.original;
          item.button.classList.add("revealed");
        }
      }
    },
  };
}

// ---------- The list of tests ----------

const MODES = {
  gaps: { label: "Fill the gaps", build: buildGaps },
  jumble: { label: "Word jumble", build: buildJumble },
  initials: { label: "First letters", build: (stage, text) => buildTyping(stage, text, true) },
  spot: { label: "Spot the wrong word", build: buildSpot },
  memory: { label: "Type from memory", build: (stage, text) => buildTyping(stage, text, false) },
};

// =====================================================================
// PROGRESS: short-term and long-term learning
// =====================================================================

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    if (saved && typeof saved === "object") state.progress = saved;
  } catch (err) {
    // Storage can be blocked. Progress then only lasts until the page closes.
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
  } catch (err) {
    // ignore
  }
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    if (saved && typeof saved === "object") state.history = saved;
  } catch (err) {
    // ignore
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch (err) {
    // ignore
  }
}

// The key progress is saved under. Quotes keep their plain id, so progress
// saved before scriptures existed still works. Other types get a prefix, so a
// scripture with id 1 never clashes with a quote with id 1.
function keyOf(quote) {
  return quote.type === "quote" ? String(quote.id) : `${quote.type}-${quote.id}`;
}

function boxOf(quote) {
  const record = state.progress[keyOf(quote)];
  return record ? record.box : 0;
}

// "new", "short" or "long"
function category(quote) {
  const box = boxOf(quote);
  if (box === 0) return "new";
  return box >= LONG_TERM_BOX ? "long" : "short";
}

function isDue(quote) {
  const record = state.progress[keyOf(quote)];
  return Boolean(record) && record.box > 0 && record.due <= Date.now();
}

// A test counts as real recall (and can move a quote up) only if it is hard enough.
function isStrongTest() {
  const key = state.activeMode;
  if (key === "memory" || key === "initials") return true;
  if (key === "gaps" || key === "jumble") return state.level === "hard";
  return false; // spotting a swapped word is recognition, not recall
}

// results = one { perfect, strong } for each test done on this quote.
// It only counts as a pass if EVERY test was right on the first check.
function recordResult(quote, results) {
  const now = Date.now();
  const key = keyOf(quote);
  const record = state.progress[key] || { box: 0, due: 0, attempts: 0, perfects: 0, last: 0 };
  const wasNew = record.box === 0;
  const perfect = results.every((r) => r.perfect);
  const strong = results.some((r) => r.strong);

  record.attempts += 1;
  record.last = now;

  if (perfect) {
    record.perfects += 1;
    logPass(key, wasNew);

    if (record.box === 0) {
      // First pass: it becomes short-term
      record.box = 1;
      record.due = now + INTERVAL_DAYS[1] * DAY;
    } else if (now >= record.due) {
      // It was due. A strong test moves it up a box.
      // Without one it stays due, so it comes back for a harder test.
      if (strong) {
        record.box = Math.min(MAX_BOX, record.box + 1);
        record.due = now + INTERVAL_DAYS[record.box] * DAY;
      }
    } else {
      // An early review: the waiting time starts again from today
      record.due = Math.max(record.due, now + INTERVAL_DAYS[record.box] * DAY);
    }
  } else if (record.box > 0) {
    // Forgot it: drop a box and bring it back tomorrow
    record.box = Math.max(1, record.box - 1);
    record.due = now + DAY;
  }

  state.progress[key] = record;
  saveProgress();
}

function countsFor(list) {
  const counts = { long: 0, short: 0, new: 0, due: 0 };
  for (const quote of list) {
    counts[category(quote)] += 1;
    if (isDue(quote)) counts.due += 1;
  }
  return counts;
}

// ---------- The daily log: streaks and the calendar ----------

function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function keyToUTC(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Remember that a quote was passed today. "new" = learned for the first time.
// Remember that a quote was passed today.
// "new" = learned for the first time. "reviewed" = passed again after that.
// A quote can be in both on the same day (learned, then reviewed).
function logPass(quoteKey, wasNew) {
  const key = dayKey(new Date());
  const day = state.history[key] || { new: [], reviewed: [] };
  day.new = day.new.map(String);
  day.reviewed = day.reviewed.map(String);

  const list = wasNew ? day.new : day.reviewed;
  if (!list.includes(quoteKey)) list.push(quoteKey);

  state.history[key] = day;
  saveHistory();
}

function passedOn(key) {
  const day = state.history[key];
  if (!day) return 0;
  return new Set([...day.new, ...day.reviewed].map(String)).size;
}

// How many different quotes were learned, and how many were reviewed, across some days.
// The two are counted separately, so one quote can appear in both.
function totalsFor(keys) {
  const learned = new Set();
  const reviewed = new Set();
  for (const key of keys) {
    const day = state.history[key];
    if (!day) continue;
    day.new.forEach((id) => learned.add(String(id)));
    day.reviewed.forEach((id) => reviewed.add(String(id)));
  }
  return { learned: learned.size, reviewed: reviewed.size };
}

// A streak is a run of days in a row with at least one passed test.
function streaks() {
  const active = Object.keys(state.history).filter((k) => passedOn(k) > 0).sort();
  if (!active.length) return { current: 0, best: 0 };

  const gap = (a, b) => (keyToUTC(b) - keyToUTC(a)) / DAY;

  let best = 1;
  let run = 1;
  for (let i = 1; i < active.length; i++) {
    run = gap(active[i - 1], active[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  // The streak is still alive if the last active day was today or yesterday
  const today = new Date();
  const last = active[active.length - 1];
  let current = 0;
  if (last === dayKey(today) || last === dayKey(addDays(today, -1))) {
    current = 1;
    for (let i = active.length - 1; i > 0; i--) {
      if (gap(active[i - 1], active[i]) === 1) current += 1;
      else break;
    }
  }
  return { current, best };
}

// =====================================================================
// THE HOME PAGE
// =====================================================================

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function renderStreak() {
  const { current, best } = streaks();
  const today = new Date();
  const todayKey = dayKey(today);

  el.streakNow.textContent = String(current);
  if (current === 0) el.streakNote.textContent = "Pass a test today to start a streak.";
  else if (passedOn(todayKey) > 0) el.streakNote.textContent = "You have practised today.";
  else el.streakNote.textContent = "Pass a test today to keep your streak going.";
  el.streakBest.textContent = best ? `Best streak: ${best} ${best === 1 ? "day" : "days"}` : "";

  // This week, Monday to Sunday
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  el.week.replaceChildren(
    ...DAY_NAMES.map((name, i) => {
      const key = dayKey(addDays(monday, i));
      const n = passedOn(key);
      const cell = make("li", "day");
      cell.classList.toggle("is-today", key === todayKey);
      cell.classList.toggle("is-future", key > todayKey);
      cell.classList.toggle("is-active", n > 0);

      const count = make("span", "day-count", n ? String(n) : "–");
      count.setAttribute("aria-hidden", "true");
      cell.append(
        make("span", "day-name", name),
        count,
        make("span", "sr-only", `${DAY_NAMES_LONG[i]}: ${n} ${n === 1 ? "quote" : "quotes"} passed`)
      );
      return cell;
    })
  );

  // Today, this week and this month
  const weekKeys = DAY_NAMES.map((_, i) => dayKey(addDays(monday, i))).filter((k) => k <= todayKey);
  const monthKeys = [];
  for (let d = new Date(today.getFullYear(), today.getMonth(), 1); dayKey(d) <= todayKey; d = addDays(d, 1)) {
    monthKeys.push(dayKey(d));
  }

  const rows = [
    ["Today", [todayKey]],
    ["This week", weekKeys],
    ["This month", monthKeys],
  ];
  el.periods.replaceChildren(
    ...rows.map(([label, keys]) => {
      const t = totalsFor(keys);
      const row = make("tr");
      const head = make("th", "", label);
      head.scope = "row";
      row.append(head, make("td", "", String(t.learned)), make("td", "", String(t.reviewed)));
      return row;
    })
  );
}

function renderHome() {
  renderStreak();

  const all = countsFor(state.quotes);
  const stats = [
    [all.long, "long-term"],
    [all.short, "short-term"],
    [all.new, "not started"],
  ];
  el.totals.replaceChildren(
    ...stats.map(([n, label]) => {
      const item = make("li");
      item.append(make("strong", "", String(n)), ` ${label}`);
      return item;
    })
  );

  el.dueText.textContent = all.due
    ? `${all.due} ${all.due === 1 ? "item is" : "items are"} due for review.`
    : "Nothing is due for review right now.";
  el.review.hidden = all.due === 0;
  el.review.textContent = `Review ${all.due} due`;

  renderChooser();
}

// ---------- The topic chooser: tabs, search, chips ----------

function quotesOfType(type) {
  return state.quotes.filter((q) => q.type === type);
}

// [{ key, label, count }] for the topics used in a list, A to Z
function topicList(items) {
  const counts = new Map();
  for (const q of items) {
    for (const key of q.tagKeys) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => ({ key, label: state.tagLabels.get(key), count }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

// "Faith", "Faith and Trials", "Faith, Trials and 3 more"
function listNames(keys) {
  const names = keys.map((k) => state.tagLabels.get(k) || k);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function makeChip(topic, selected) {
  const chip = make("button", "chip", topic.label);
  chip.type = "button";
  chip.dataset.key = topic.key;
  chip.setAttribute("aria-pressed", String(selected));
  chip.append(make("span", "count", String(topic.count)));
  return chip;
}

function renderTabs() {
  el.typeTabs.replaceChildren(
    ...Object.entries(TYPES).map(([type, info]) => {
      const active = type === state.tab;
      const tab = make("button", "type-tab", info.label);
      tab.type = "button";
      tab.id = `tab-${type}`;
      tab.dataset.type = type;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("aria-controls", "type-panel");
      tab.tabIndex = active ? 0 : -1;
      tab.append(make("span", "count", String(quotesOfType(type).length)));
      return tab;
    })
  );
  el.typePanel.setAttribute("aria-labelledby", `tab-${state.tab}`);
}

function renderChooser() {
  renderTabs();

  const type = state.tab;
  const items = quotesOfType(type);

  // Nothing in this tab yet
  el.typeEmpty.hidden = items.length > 0;
  el.chooserBody.hidden = items.length === 0;
  if (!items.length) {
    el.typeEmpty.textContent =
      state.fileStatus[type] === "broken"
        ? `${TYPES[type].file} could not be read. Check it for a missing comma, quote mark or bracket.`
        : TYPES[type].empty;
    return;
  }

  const topics = topicList(items);
  const selected = new Set(state.selection[type]);
  const query = state.search.trim().toLowerCase();

  let main;
  let others = [];
  if (query) {
    // Searching: one flat list of every match
    main = topics.filter((t) => t.label.toLowerCase().includes(query));
  } else {
    main = topics.filter((t) => t.count >= MIN_TOPIC_SIZE);
    others = topics.filter((t) => t.count < MIN_TOPIC_SIZE);
    if (!main.length) {
      // Everything is small, so there is nothing to tuck away
      main = others;
      others = [];
    }
  }

  el.chips.replaceChildren(...main.map((t) => makeChip(t, selected.has(t.key))));
  el.noMatch.hidden = !(query && !main.length);

  el.other.hidden = others.length === 0;
  el.otherLabel.textContent = `Other topics (${others.length})`;
  el.otherChips.replaceChildren(...others.map((t) => makeChip(t, selected.has(t.key))));
  el.other.open = state.othersOpen || others.some((t) => selected.has(t.key));

  renderSelectionSummary();
}

function renderSelectionSummary() {
  const type = state.tab;
  const info = TYPES[type];
  const items = quotesOfType(type);
  const keys = state.selection[type];

  const pool = keys.length ? items.filter((q) => q.tagKeys.some((k) => keys.includes(k))) : items;
  const counts = countsFor(pool);
  const learned = pool.filter((q) => boxOf(q) > 0).length;
  const noun = pool.length === 1 ? info.one : info.many;
  const progress = `${counts.long} long-term, ${counts.short} short-term, ${counts.new} not started`;
  const pace = `You learn ${SESSION_SIZE} at a time.`;

  el.selectionSummary.textContent = keys.length
    ? `${pool.length} ${noun} from ${listNames(keys)}. ${progress}. ${pace}`
    : `${pool.length} ${noun} in total. ${progress}. ${pace}`;

  el.learn.textContent = keys.length ? "Learn selected topics" : "Start learning";
  el.learn.disabled = pool.length === 0;
  el.reviewLearned.hidden = learned === 0;
  el.reviewLearned.textContent = `Review learned (${learned})`;
  el.clear.hidden = keys.length === 0;
}

function setTab(type) {
  if (!TYPES[type] || type === state.tab) return;
  state.tab = type;
  state.search = "";
  el.search.value = "";
  savePrefs();
  renderChooser();
}

function toggleTopic(chip) {
  const keys = state.selection[state.tab];
  const index = keys.indexOf(chip.dataset.key);
  if (index >= 0) keys.splice(index, 1);
  else keys.push(chip.dataset.key);

  chip.setAttribute("aria-pressed", String(index < 0));
  renderSelectionSummary();
}

function showHome() {
  state.view = "home";
  state.ctrl = null;
  el.play.hidden = true;
  el.home.hidden = false;
  renderHome();
  try {
    window.scrollTo({ top: 0 });
  } catch (err) {
    // ignore
  }
}

// The quotes for what was chosen: one kind, and any of the chosen topics.
function sessionPool() {
  const { type, tags } = state.session;
  let pool = state.quotes;
  if (type) pool = pool.filter((q) => q.type === type);
  if (tags.length) pool = pool.filter((q) => q.tagKeys.some((k) => tags.includes(k)));
  return pool;
}

function buildDeck() {
  const pool = sessionPool();
  const { kind } = state.session;

  if (kind === "due") {
    // Only what is due, the most overdue first
    const byDue = (a, b) => state.progress[keyOf(a)].due - state.progress[keyOf(b)].due;
    state.deck = pool.filter(isDue).sort(byDue);
  } else if (kind === "learned") {
    // Everything you have learned: due first, then whatever you saw longest ago
    const byLast = (a, b) => {
      if (isDue(a) !== isDue(b)) return isDue(a) ? -1 : 1;
      return state.progress[keyOf(a)].last - state.progress[keyOf(b)].last;
    };
    state.deck = pool.filter((q) => boxOf(q) > 0).sort(byLast);
  } else {
    // Learning: due first, then new ones, then the rest
    const due = shuffle(pool.filter(isDue));
    const fresh = shuffle(pool.filter((q) => category(q) === "new"));
    const rest = shuffle(pool.filter((q) => !isDue(q) && category(q) !== "new"));
    state.deck = [...due, ...fresh, ...rest];
  }
  state.position = 0;
}

function sessionLabel() {
  const { type, tags, kind } = state.session;
  if (kind === "due") return "Review due";
  if (kind === "learned") return "Review learned";
  if (!tags.length) return `All ${TYPES[type].many}`;
  return listNames(tags);
}

function startPlay(type, tags, kind) {
  state.session = { type, tags: [...tags], kind };
  buildDeck();
  if (!state.deck.length) {
    showHome();
    return;
  }
  state.roundCount = 0;
  state.roundLog = [];
  state.view = "play";
  el.home.hidden = true;
  el.play.hidden = false;
  el.sheet.hidden = false;
  el.round.hidden = true;
  showQuote();
}

// =====================================================================
// THE GAME FLOW: study -> test -> done
// =====================================================================

function setPhase(phase) {
  state.phase = phase; // "study", "test", "between" (waiting for the next test) or "done"
  el.studyTip.hidden = phase !== "study";
  el.setup.hidden = phase !== "study";
  el.testName.hidden = phase === "study";
  el.actionsStudy.hidden = phase !== "study";
  el.actionsTest.hidden = phase !== "test";
  el.actionsBetween.hidden = phase !== "between";
  el.actionsDone.hidden = phase !== "done";
}

function testsPerQuote() {
  return Math.max(1, Math.min(TESTS_PER_QUOTE, Object.keys(MODES).length));
}

// How many quotes this round holds
function roundTotal() {
  return Math.max(1, Math.min(SESSION_SIZE, state.deck.length));
}

function showQuote() {
  state.current = state.deck[state.position];
  state.counted = false;
  showStudy();
}

function showStudy() {
  state.ctrl = null;
  state.testNumber = 0;
  state.results = [];

  const tests = testsPerQuote();
  const n = state.counted ? state.roundCount : state.roundCount + 1;
  const label = isDue(state.current) ? " (due for review)" : "";
  el.progress.textContent = `${sessionLabel()}: item ${n} of ${roundTotal()}${label}`;
  el.prompt.textContent = state.current.prompt || "";
  el.studyTip.textContent =
    `Read it through a few times. Then you will do ${tests} different ${tests === 1 ? "test" : "tests"} on it.`;
  el.stage.replaceChildren(make("div", "quote", state.current.answer));
  el.result.textContent = "";
  setPhase("study");
}

// A random test each time (never the same one twice running)
// A random test each time. It is never one you have already done on this
// quote, and never the same as the test just before.
function pickMode() {
  const used = new Set(state.results.map((r) => r.mode));
  if (state.lastMode) used.add(state.lastMode);

  let keys = Object.keys(MODES).filter((k) => !used.has(k));
  if (!keys.length) keys = Object.keys(MODES).filter((k) => k !== state.lastMode);
  return keys[Math.floor(Math.random() * keys.length)];
}

function startTest() {
  if (state.phase !== "study") return;
  state.testNumber = 1;
  state.results = [];
  launchTest();
}

function nextTest() {
  if (state.phase !== "between") return;
  state.testNumber += 1;
  launchTest();
}

function launchTest() {
  state.activeMode = pickMode();
  state.lastMode = state.activeMode;
  state.testResult = null;

  const mode = MODES[state.activeMode];
  state.ctrl = mode.build(el.stage, state.current.answer, state.level);
  el.testName.textContent = `Test ${state.testNumber} of ${testsPerQuote()}: ${mode.label}`;
  el.result.textContent = "";
  setPhase("test");
  state.ctrl.focus();
}

// Called when a test is finished (all right, or answers shown)
function finishTest(message) {
  state.results.push({
    mode: state.activeMode,
    perfect: state.testResult === true,
    strong: isStrongTest(),
  });
  const total = testsPerQuote();

  // More tests to do on this quote
  if (state.results.length < total) {
    el.result.textContent = message;
    el.nextTest.textContent = `Start test ${state.results.length + 1} of ${total}`;
    setPhase("between");
    el.nextTest.focus();
    return;
  }

  // That was the last test: record how it went (once per quote)
  let summary;
  if (!state.counted) {
    state.counted = true;
    const allPerfect = state.results.every((r) => r.perfect);
    recordResult(state.current, state.results);
    state.roundCount += 1;
    state.roundLog.push({ label: state.current.prompt || "Item", perfect: allPerfect });
    summary = allPerfect
      ? total === 1 ? "Passed first time." : `All ${total} tests passed first time.`
      : "You will see this one again soon.";
  } else {
    summary = "This was extra practice, so it is not recorded.";
  }

  el.result.textContent = `${message} ${summary}`;
  el.next.textContent = state.roundCount >= roundTotal() ? "Finish round" : "Next quote";
  setPhase("done");
  el.next.focus();
}

function checkAnswer() {
  if (state.phase !== "test" || !state.ctrl) return;
  const outcome = state.ctrl.check();
  if (state.testResult === null) state.testResult = outcome.complete; // the first check is what counts
  if (outcome.complete) finishTest(outcome.message);
  else el.result.textContent = outcome.message;
}

function revealAnswers() {
  if (state.phase !== "test" || !state.ctrl) return;
  if (state.testResult === null) state.testResult = false;
  state.ctrl.reveal();
  finishTest("Answers shown.");
}

function nextQuote() {
  state.position += 1;
  if (state.position >= state.deck.length) {
    if (state.session.kind !== "learn") {
      // A review has a fixed list, and it has run out
      if (state.roundCount > 0) showRound();
      else showHome();
      return;
    }
    buildDeck();
  }
  showQuote();
}

// After the last test on a quote: another quote, or the end of the round
function afterQuote() {
  if (state.roundCount >= roundTotal()) showRound();
  else nextQuote();
}

function showRound() {
  buildDeck(); // what is left, so we know whether to offer "more"
  const more = state.deck.length > 0;
  const n = state.roundLog.length;

  el.sheet.hidden = true;
  el.round.hidden = false;
  el.roundSummary.textContent = `You worked through ${n} ${n === 1 ? "item" : "items"}.`;
  el.roundList.replaceChildren(
    ...state.roundLog.map((entry) => {
      const item = make("li", "round-item");
      item.append(
        make("span", "round-label", entry.label),
        make("span", entry.perfect ? "round-status is-ok" : "round-status", entry.perfect ? "Passed all tests" : "Needs more practice")
      );
      return item;
    })
  );

  const verb = state.session.kind === "learn" ? "Learn" : "Review";
  el.roundMore.textContent = `${verb} ${SESSION_SIZE} more`;
  el.roundMore.hidden = !more;
  try {
    window.scrollTo({ top: 0 });
  } catch (err) {
    // ignore
  }
}

// ---------- Difficulty ----------

function syncControls() {
  for (const button of el.difficulty.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.level === state.level));
  }
  el.hints.checked = state.hints;
}

// ---------- Start up ----------

function showLoadError() {
  el.home.hidden = true;
  el.play.hidden = false;
  el.progress.textContent = "";
  el.prompt.textContent = "";
  el.studyTip.hidden = true;
  el.setup.hidden = true;
  el.stage.replaceChildren(
    make(
      "div",
      "quote",
      "Could not load data.json. Check that it is in the same folder as index.html. " +
        "If you opened index.html by double-clicking it, use Live Server in VS Code instead."
    )
  );
  for (const button of [el.start, el.skip]) button.disabled = true;
}

function wireUpControls() {
  // The title and the back link both go home
  for (const link of [el.homeLink, el.backLink]) {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return; // let "open in new tab" work
      event.preventDefault();
      if (state.quotes.length) showHome();
    });
  }

  // Tabs for the kind of content
  el.typeTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("button[data-type]");
    if (tab) setTab(tab.dataset.type);
  });
  el.typeTabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const types = Object.keys(TYPES);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = types[(types.indexOf(state.tab) + step + types.length) % types.length];
    setTab(next);
    $(`tab-${next}`).focus();
    event.preventDefault();
  });

  // Search and topic chips
  el.search.addEventListener("input", () => {
    state.search = el.search.value;
    renderChooser();
  });
  for (const group of [el.chips, el.otherChips]) {
    group.addEventListener("click", (event) => {
      const chip = event.target.closest("button[data-key]");
      if (chip) toggleTopic(chip);
    });
  }
  el.other.addEventListener("toggle", () => {
    state.othersOpen = el.other.open;
  });
  el.clear.addEventListener("click", () => {
    state.selection[state.tab] = [];
    renderChooser();
    el.learn.focus();
  });

  // Starting a round
  el.learn.addEventListener("click", () => startPlay(state.tab, state.selection[state.tab], "learn"));
  el.reviewLearned.addEventListener("click", () =>
    startPlay(state.tab, state.selection[state.tab], "learned")
  );
  el.review.addEventListener("click", () => startPlay(null, [], "due"));

  el.difficulty.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-level]");
    if (!button) return;
    state.level = button.dataset.level;
    savePrefs();
    syncControls();
  });

  el.hints.addEventListener("change", () => {
    state.hints = el.hints.checked;
    savePrefs();
  });

  // Playing
  el.start.addEventListener("click", startTest);
  el.skip.addEventListener("click", nextQuote);
  el.check.addEventListener("click", checkAnswer);
  el.reveal.addEventListener("click", revealAnswers);
  el.nextTest.addEventListener("click", nextTest);
  el.again.addEventListener("click", showStudy);
  el.next.addEventListener("click", afterQuote);

  // End of a round
  el.roundMore.addEventListener("click", () =>
    startPlay(state.session.type, state.session.tags, state.session.kind)
  );
  el.roundHome.addEventListener("click", showHome);
}

// Reads one JSON file. A missing optional file is not an error.
async function loadFile(type) {
  try {
    const response = await fetch(TYPES[type].file);
    if (response.status === 404) return { items: [], status: "missing" };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("not a list");

    const items = data
      .filter((item) => item && item.answer)
      .map((item) => ({ ...item, type: item.type || type }))
      .filter((item) => TYPES[item.type]);
    return { items, status: "ok" };
  } catch (err) {
    return { items: [], status: "broken" };
  }
}

// Works out each item's topics. "Faith" and "faith" count as one topic.
function prepareTopics(quote) {
  const keys = [];
  for (const raw of Array.isArray(quote.tags) ? quote.tags : []) {
    const label = String(raw).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!state.tagLabels.has(key)) state.tagLabels.set(key, capitalise(label));
    if (!keys.includes(key)) keys.push(key);
  }
  quote.tagKeys = keys;
  return quote;
}

async function init() {
  loadPrefs();
  loadProgress();
  loadHistory();
  wireUpControls();

  const types = Object.keys(TYPES);
  const results = await Promise.all(types.map(loadFile));
  types.forEach((type, i) => (state.fileStatus[type] = results[i].status));

  // data.json is required. The others are optional.
  const main = results[types.indexOf("quote")];
  if (main.status !== "ok" || !main.items.length) {
    showLoadError();
    return;
  }

  state.quotes = results.flatMap((r) => r.items).map(prepareTopics);

  // Every plain word in the data, for believable swaps
  const pool = new Set();
  for (const q of state.quotes) {
    for (const t of tokenise(q.answer)) {
      const word = normalise(t.core);
      if (/^\p{L}{3,}$/u.test(word)) pool.add(word);
    }
  }
  state.wordPool = [...pool];

  syncControls();
  showHome();
}

init();