// ============================================================
// Niggr · ንግግር — app engine
// ============================================================

const $ = (sel) => document.querySelector(sel);
const app = $("#app");

// ---------- persistent state ----------
const KEY = "niggr_v1";
function load() {
  try { return Object.assign({ xp: 0, streak: 0, lastDay: "", done: {}, wordStats: {} }, JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return { xp: 0, streak: 0, lastDay: "", done: {}, wordStats: {} }; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
let S = load();

// ---------- helpers ----------
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sample(a, n) { return shuffle(a).slice(0, n); }
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function today() { return new Date().toISOString().slice(0, 10); }
function fidelChar(fam, order) { return String.fromCodePoint(fam.base + order); }
function level() { return Math.floor(S.xp / 100) + 1; }

const ALL_WORDS = LESSONS.filter(l => l.type === "vocab").flatMap(l => l.words);

// Amharic text → transliteration, including per-word entries for phrases
// whose transliteration is word-aligned (used for tile hints).
const WORD_TR = {};
ALL_WORDS.forEach(w => {
  WORD_TR[w.am] = w.tr;
  const aw = w.am.split(" "), tw = w.tr.split(" ");
  if (aw.length > 1 && aw.length === tw.length) {
    aw.forEach((a, i) => { if (!WORD_TR[a]) WORD_TR[a] = tw[i]; });
  }
});
function trHint(am) {
  const tr = WORD_TR[am];
  return tr ? ` <small class="tr-hint">(${esc(tr)})</small>` : "";
}

// Amharic text-to-speech if the system has an am-ET voice
let amVoice = null;
function findVoice() {
  if (!window.speechSynthesis) return;
  amVoice = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith("am")) || null;
}
if (window.speechSynthesis) { findVoice(); speechSynthesis.onvoiceschanged = findVoice; }
// Prefer bundled recordings, then a local Amharic voice, then streamed TTS.
let ttsAudio = null;
function speak(text) {
  const t = text.replace(/\.\.\./g, "").replace(/\s+/g, " ").trim();
  if (!t) return;
  const file = typeof AUDIO_MAP !== "undefined" && AUDIO_MAP[t];
  if (file) {
    if (ttsAudio) ttsAudio.pause();
    ttsAudio = new Audio("audio/" + file);
    ttsAudio.play().catch(() => {});
    return;
  }
  if (amVoice) {
    const u = new SpeechSynthesisUtterance(t);
    u.voice = amVoice; u.lang = amVoice.lang; u.rate = 0.85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    return;
  }
  try {
    if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    ttsAudio = new Audio("https://translate.google.com/translate_tts?ie=UTF-8&tl=am&client=tw-ob&q=" + encodeURIComponent(t));
    ttsAudio.play().catch(() => {});
  } catch (e) { /* no audio available — stay silent */ }
}
function speakBtn(text) {
  return `<button class="speak" onclick="speak('${esc(text)}')">🔊</button>`;
}

function updateStreak() {
  const t = today();
  if (S.lastDay === t) return;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  S.streak = S.lastDay === y ? S.streak + 1 : 1;
  S.lastDay = t;
}

function stat(wordAm) {
  if (!S.wordStats[wordAm]) S.wordStats[wordAm] = { ok: 0, bad: 0 };
  return S.wordStats[wordAm];
}

// ---------- home screen ----------
function renderHome() {
  const anyDone = Object.keys(S.done).length > 0;
  let firstOpenFound = false;
  const rows = LESSONS.map((l, i) => {
    const done = !!S.done[l.id];
    let cls = "locked";
    if (done) cls = "done";
    else if (!firstOpenFound) { cls = "open"; firstOpenFound = true; }
    const side = i % 2 === 0 ? "left" : "right";
    return `
      <div class="node-row ${side}">
        <button class="node ${cls}" ${cls === "locked" ? "disabled" : `onclick="startLesson('${l.id}')"`}>
          ${cls === "locked" ? "🔒" : `<span class="${l.type === "fidel" ? "am" : ""}">${l.emoji}</span>`}
          ${done ? '<span class="check">✅</span>' : ""}
        </button>
        <div class="node-meta"><div class="t">${l.title}</div><div class="d">${l.desc}</div></div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="title"><span class="am">ንግግር</span> Niggr</div>
        <div class="sub">Learn Amharic · Level ${level()}</div>
      </div>
      <div class="stats">
        <div class="stat">🔥 ${S.lastDay === today() || S.lastDay === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? S.streak : 0}</div>
        <div class="stat">⚡ ${S.xp}</div>
      </div>
    </div>
    <div class="actions">
      <button class="chip" onclick="renderChart()">📜 Fidel Chart</button>
      <button class="chip" ${anyDone ? 'onclick="startReview()"' : "disabled"}>🧠 Review Practice</button>
    </div>
    <div class="path">
      <div class="unit-label">Your path</div>
      ${rows}
    </div>`;
}

// ---------- question builders ----------
function mcq(promptHtml, promptSpeak, answer, distractors, opts) {
  return Object.assign({ t: "mcq", promptHtml, promptSpeak, answer, options: shuffle([answer, ...distractors]) }, opts || {});
}

function vocabQuestions(lesson, includeTeach) {
  const q = [];
  if (includeTeach) lesson.words.forEach(w => q.push({ t: "teach", w }));
  const mcqs = lesson.words.map(w => {
    const others = lesson.words.filter(o => o !== w);
    const pool = others.length >= 3 ? others : others.concat(ALL_WORDS.filter(o => o.am !== w.am));
    if (Math.random() < 0.5) {
      return mcq(`<div class="prompt am">${esc(w.am)}<span class="prompt-tr">(${esc(w.tr)})</span></div>`, w.am, w.en, sample(pool, 3).map(o => o.en), { w, amOpts: false, title: "What does this mean?" });
    }
    return mcq(`<div class="prompt small">${esc(w.en)}</div>`, null, w.am, sample(pool, 3).map(o => o.am), { w, amOpts: true, title: "Choose the Amharic" });
  });
  q.push(...shuffle(mcqs));
  // sentence-building with word tiles, for multi-word entries
  const multi = lesson.words.filter(w => w.am.includes(" ") && !w.am.includes("..."));
  sample(multi, 3).forEach(w => {
    const distract = sample(ALL_WORDS.filter(o => !o.am.includes(" ") && o.am !== w.am), 2).map(o => o.am);
    q.push({ t: "assemble", w, tiles: shuffle(w.am.split(" ").concat(distract)) });
  });
  const pairs = sample(lesson.words, Math.min(5, lesson.words.length)).map(w => ({ a: w.am, b: w.en }));
  q.push({ t: "match", pairs });
  return q;
}

function fidelQuestions(lesson, includeTeach) {
  const fams = lesson.fams.map(i => FIDEL_FAMILIES[i]);
  const q = [];
  if (includeTeach) fams.forEach(f => q.push({ t: "teachF", f }));
  const mcqs = [];
  fams.forEach(f => {
    const ch = fidelChar(f, 0);
    const wrongSounds = [...new Set(FIDEL_FAMILIES.map(o => o.sound))].filter(s => s !== f.sound);
    mcqs.push(mcq(`<div class="prompt am">${esc(ch)}</div>`, ch, f.sound + "ä", sample(wrongSounds, 3).map(s => s + "ä"), { title: "What sound is this letter?" }));
    // reverse direction only for sounds that are unambiguous
    const sameSound = FIDEL_FAMILIES.filter(o => o.sound === f.sound);
    if (sameSound.length === 1) {
      const wrongChars = fams.filter(o => o.sound !== f.sound);
      mcqs.push(mcq(`<div class="prompt small">${esc(f.sound + "ä")}</div>`, null, ch, sample(wrongChars, 3).map(o => fidelChar(o, 0)), { amOpts: true, title: "Choose the letter" }));
    }
  });
  q.push(...shuffle(mcqs).slice(0, 12));
  return q;
}

// ---------- lesson runner ----------
let L = null; // { lesson, queue, idx, hearts, correct, wrong, xp, review }

function startLesson(id) {
  const lesson = LESSONS.find(l => l.id === id);
  const first = !S.done[id];
  const queue = lesson.type === "fidel" ? fidelQuestions(lesson, first) : vocabQuestions(lesson, first);
  L = { lesson, queue, idx: 0, hearts: 3, correct: 0, wrong: 0, xp: 0, review: false };
  renderQuestion();
}

function startReview() {
  const seen = ALL_WORDS.filter(w => S.wordStats[w.am]);
  const ranked = seen.sort((a, b) => (stat(b.am).bad - stat(b.am).ok) - (stat(a.am).bad - stat(a.am).ok));
  const words = ranked.slice(0, 10);
  const queue = shuffle(words.map(w => {
    const pool = ALL_WORDS.filter(o => o.am !== w.am);
    return Math.random() < 0.5
      ? mcq(`<div class="prompt am">${esc(w.am)}<span class="prompt-tr">(${esc(w.tr)})</span></div>`, w.am, w.en, sample(pool, 3).map(o => o.en), { w, title: "What does this mean?" })
      : mcq(`<div class="prompt small">${esc(w.en)}</div>`, null, w.am, sample(pool, 3).map(o => o.am), { w, amOpts: true, title: "Choose the Amharic" });
  }));
  L = { lesson: { id: "__review", title: "Review", emoji: "🧠" }, queue, idx: 0, hearts: Infinity, correct: 0, wrong: 0, xp: 0, review: true };
  renderQuestion();
}

function lessonHeader() {
  const pct = Math.round((L.idx / L.queue.length) * 100);
  const hearts = L.review ? "∞ ❤️" : "❤️".repeat(L.hearts) + "🖤".repeat(3 - L.hearts);
  return `
    <div class="lesson-top">
      <button class="quitbtn" onclick="renderHome()">✕</button>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="hearts">${hearts}</div>
    </div>`;
}

function renderQuestion() {
  if (L.idx >= L.queue.length) return renderComplete();
  const q = L.queue[L.idx];
  if (q.t === "teach") return renderTeach(q);
  if (q.t === "teachF") return renderTeachFidel(q);
  if (q.t === "match") return renderMatch(q);
  if (q.t === "assemble") return renderAssemble(q);
  renderMcq(q);
}

function renderTeach(q) {
  app.innerHTML = `${lessonHeader()}
    <div class="qwrap">
      <div class="qtitle">✨ New word</div>
      <div class="teachcard">
        <div class="big am">${esc(q.w.am)}</div>
        <div class="tr">${esc(q.w.tr)}</div>
        <div class="en">${esc(q.w.en)}</div>
        ${speakBtn(q.w.am)}
      </div>
    </div>
    <div class="footer"><button class="bigbtn" onclick="next()">Continue</button></div>`;
  speak(q.w.am);
}

function renderTeachFidel(q) {
  const forms = VOWEL_ORDERS.map((v, i) =>
    `<span><span class="am">${fidelChar(q.f, i)}</span><small>${q.f.sound}${v}</small></span>`).join("");
  app.innerHTML = `${lessonHeader()}
    <div class="qwrap">
      <div class="qtitle">✨ New letter</div>
      <div class="teachcard">
        <div class="big am">${fidelChar(q.f, 0)}</div>
        <div class="tr">"${esc(q.f.sound)}" sound</div>
        ${q.f.note ? `<div class="note">${esc(q.f.note)}</div>` : ""}
        ${speakBtn(fidelChar(q.f, 0))}
        <div class="forms">${forms}</div>
        <div class="note">One letter, seven vowel forms</div>
      </div>
    </div>
    <div class="footer"><button class="bigbtn" onclick="next()">Continue</button></div>`;
  speak(fidelChar(q.f, 0));
}

let picked = null;
function renderMcq(q) {
  picked = null;
  const opts = q.options.map((o, i) =>
    `<button class="opt ${q.amOpts ? "am am-opt" : ""}" id="opt${i}" onclick="pick(${i})">${esc(o)}${q.amOpts ? trHint(o) : ""}</button>`).join("");
  app.innerHTML = `${lessonHeader()}
    <div class="qwrap">
      <div class="qtitle">${q.title}</div>
      <div class="prompt-line">${q.promptHtml}${q.promptSpeak ? speakBtn(q.promptSpeak) : ""}</div>
      <div class="opts">${opts}</div>
    </div>
    <div class="footer" id="foot"><button class="bigbtn" id="checkbtn" disabled onclick="check()">Check</button></div>`;
  if (q.promptSpeak) speak(q.promptSpeak);
}

function pick(i) {
  picked = i;
  document.querySelectorAll(".opt").forEach((b, j) => b.classList.toggle("sel", i === j));
  $("#checkbtn").disabled = false;
}

function check() {
  const q = L.queue[L.idx];
  const chosen = q.options[picked];
  const good = chosen === q.answer;
  document.querySelectorAll(".opt").forEach((b, j) => {
    b.disabled = true;
    if (q.options[j] === q.answer) b.classList.add("right");
    else if (j === picked) b.classList.add("wrong");
  });
  if (q.w) { good ? stat(q.w.am).ok++ : stat(q.w.am).bad++; }
  if (good) {
    L.correct++; L.xp++;
    $("#foot").innerHTML = `<div class="feedback good">Nice! ⚡+1 XP</div><button class="bigbtn" onclick="next()">Continue</button>`;
  } else {
    L.wrong++;
    if (!L.review) L.hearts--;
    // re-queue a fresh copy of the missed question at the end
    L.queue.push(Object.assign({}, q, { options: shuffle(q.options) }));
    const fx = q.w ? `${esc(q.answer)}${q.w.tr ? ` <i>(${esc(q.w.tr)})</i>` : ""}` : esc(q.answer);
    $("#foot").innerHTML = `<div class="feedback bad">Correct answer:<div class="fx ${q.amOpts ? "am" : ""}">${fx}</div></div>
      <button class="bigbtn" onclick="${L.hearts <= 0 ? "renderFail()" : "next()"}">Continue</button>`;
  }
  save();
}

function next() { L.idx++; renderQuestion(); }

// ---------- sentence building ----------
let asm = [];
function renderAssemble(q) {
  asm = [];
  app.innerHTML = `${lessonHeader()}
    <div class="qwrap">
      <div class="qtitle">Build it in Amharic</div>
      <div class="prompt-line"><div class="prompt small">${esc(q.w.en)}</div></div>
      <div class="answerline" id="aline"></div>
      <div class="tilebank" id="bank"></div>
    </div>
    <div class="footer" id="foot"><button class="bigbtn" id="checkbtn" disabled onclick="checkAsm()">Check</button></div>`;
  drawAsm();
}
function drawAsm() {
  const q = L.queue[L.idx];
  $("#aline").innerHTML = asm.map((ti, pos) =>
    `<button class="tile am" onclick="asmRemove(${pos})">${esc(q.tiles[ti])}</button>`).join("")
    || `<span class="hint">Tap the tiles below</span>`;
  $("#bank").innerHTML = q.tiles.map((t, i) => asm.includes(i)
    ? `<button class="tile ghost" disabled>${esc(t)}</button>`
    : `<button class="tile am" onclick="asmAdd(${i})">${esc(t)}${trHint(t)}</button>`).join("");
  $("#checkbtn").disabled = asm.length === 0;
}
function asmAdd(i) { asm.push(i); drawAsm(); }
function asmRemove(pos) { asm.splice(pos, 1); drawAsm(); }
function checkAsm() {
  const q = L.queue[L.idx];
  const built = asm.map(i => q.tiles[i]).join(" ");
  const good = built === q.w.am;
  document.querySelectorAll(".tile").forEach(b => b.disabled = true);
  good ? stat(q.w.am).ok++ : stat(q.w.am).bad++;
  if (good) {
    L.correct++; L.xp++;
    speak(q.w.am);
    $("#foot").innerHTML = `<div class="feedback good">Nice! ⚡+1 XP</div><button class="bigbtn" onclick="next()">Continue</button>`;
  } else {
    L.wrong++;
    if (!L.review) L.hearts--;
    L.queue.push(Object.assign({}, q, { tiles: shuffle(q.tiles) }));
    $("#foot").innerHTML = `<div class="feedback bad">Correct answer:<div class="fx am">${esc(q.w.am)} <i>(${esc(q.w.tr)})</i></div></div>
      <button class="bigbtn" onclick="${L.hearts <= 0 ? "renderFail()" : "next()"}">Continue</button>`;
  }
  save();
}

// ---------- matching ----------
let mSel = { a: null, b: null }, mLeft = 0;
function renderMatch(q) {
  mSel = { a: null, b: null }; mLeft = q.pairs.length;
  const left = shuffle(q.pairs.map(p => p.a));
  const right = shuffle(q.pairs.map(p => p.b));
  const tiles = [];
  for (let i = 0; i < left.length; i++) {
    tiles.push(`<button class="mtile am am-opt" data-side="a" data-v="${esc(left[i])}" onclick="mPick(this)">${esc(left[i])}${trHint(left[i])}</button>`);
    tiles.push(`<button class="mtile" data-side="b" data-v="${esc(right[i])}" onclick="mPick(this)">${esc(right[i])}</button>`);
  }
  app.innerHTML = `${lessonHeader()}
    <div class="qwrap">
      <div class="qtitle">Match the pairs</div>
      <div class="matchgrid">${tiles.join("")}</div>
    </div>
    <div class="footer"></div>`;
}

function mPick(el) {
  if (el.classList.contains("gone")) return;
  const side = el.dataset.side;
  const prev = mSel[side];
  if (prev) prev.classList.remove("sel");
  mSel[side] = el; el.classList.add("sel");
  if (mSel.a && mSel.b) {
    const q = L.queue[L.idx];
    const pair = q.pairs.find(p => p.a === mSel.a.dataset.v);
    const ok = pair && pair.b === mSel.b.dataset.v;
    const a = mSel.a, b = mSel.b;
    mSel = { a: null, b: null };
    if (ok) {
      [a, b].forEach(t => { t.classList.remove("sel"); t.classList.add("gone"); });
      L.xp++; L.correct++;
      if (--mLeft === 0) setTimeout(next, 350);
    } else {
      [a, b].forEach(t => { t.classList.remove("sel"); t.classList.add("err"); setTimeout(() => t.classList.remove("err"), 350); });
      if (!L.review && --L.hearts <= 0) { save(); return setTimeout(renderFail, 400); }
    }
  }
}

// ---------- end screens ----------
function renderComplete() {
  const first = !L.review && !S.done[L.lesson.id];
  if (!L.review) {
    S.done[L.lesson.id] = true;
    L.xp += first ? 10 : 5;
  }
  S.xp += L.xp;
  updateStreak();
  save();
  const acc = L.correct + L.wrong === 0 ? 100 : Math.round((L.correct / (L.correct + L.wrong)) * 100);
  app.innerHTML = `
    <div class="endscreen">
      <div class="big-emoji">🎉</div>
      <h2>${L.review ? "Review complete!" : `${L.lesson.title} complete!`}</h2>
      <p>ጎበዝ! (gobez — well done!)</p>
      <div class="endstats">
        <div class="endstat"><div class="v">⚡ ${L.xp}</div><div class="k">XP earned</div></div>
        <div class="endstat"><div class="v">🎯 ${acc}%</div><div class="k">Accuracy</div></div>
        <div class="endstat"><div class="v">🔥 ${S.streak}</div><div class="k">Day streak</div></div>
      </div>
      <button class="bigbtn gold" onclick="renderHome()" style="max-width:280px">Continue</button>
    </div>`;
  confetti();
}

function renderFail() {
  app.innerHTML = `
    <div class="endscreen">
      <div class="big-emoji">💔</div>
      <h2>Out of hearts!</h2>
      <p>አይዞህ! (ayzoh — take heart!) Try this lesson again.</p>
      <button class="bigbtn" onclick="startLesson('${L.lesson.id}')" style="max-width:280px">Try again</button>
      <button class="chip" onclick="renderHome()" style="max-width:280px">Back to path</button>
    </div>`;
}

function confetti() {
  const colors = ["#16a34a", "#f59e0b", "#ef4444", "#3b82f6", "#a855f7"];
  for (let i = 0; i < 60; i++) {
    const d = document.createElement("div");
    d.className = "confetti";
    d.style.cssText = `left:${Math.random() * 100}vw;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px;background:${colors[i % colors.length]};animation-duration:${1.8 + Math.random() * 2}s;animation-delay:${Math.random() * .8}s`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }
}

// ---------- fidel reference chart ----------
function renderChart() {
  const head = `<tr><th></th>${VOWEL_ORDERS.map(v => `<th>${v}</th>`).join("")}</tr>`;
  const rows = FIDEL_FAMILIES.map(f =>
    `<tr><td>${esc(f.sound)}</td>${VOWEL_ORDERS.map((v, i) => `<td class="am">${fidelChar(f, i)}</td>`).join("")}</tr>`).join("");
  app.innerHTML = `
    <button class="back" onclick="renderHome()">← Back to path</button>
    <h2 style="margin-bottom:6px">The Fidel <span class="am">ፊደል</span></h2>
    <p style="color:var(--muted);font-weight:700;font-size:14px;margin-bottom:14px">
      Each consonant has 7 forms — one per vowel. Rows are consonants, columns are vowels.</p>
    <table class="chart-table">${head}${rows}</table>`;
  window.scrollTo(0, 0);
}

renderHome();

// offline support + installability (PWA)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
