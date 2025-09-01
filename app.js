/* app.js — “spanish” minimal mobile app: Flashcards + Glossary
   Data source: window.SPANISH_DATA (object keyed by categories)
   Categories: Basics, People, Places, Things, Adjectives, Verbs
*/
(function () {
  const CATS = ["Basics","People","Places","Things","Adjectives","Verbs"];
  const LS_KEY = "spanish_settings_v1";

  let allWords = [];      // {cat, es, ipa, en}
  let enabled = loadEnabled();
  let deck = [];
  let deckIdx = 0;
  let flipped = false;

  // ---- TTS: prefer Paulina (Mexican female), else any es-*
  const PREFER_VOICE_NAME = "Paulina";
  const PREFER_LANG = "es-MX";

  let _voices = [];
  let _voicesReady = false;

  function loadVoicesOnce() {
    if (_voicesReady) return;
    const tryLoad = () => {
      _voices = window.speechSynthesis ? (speechSynthesis.getVoices() || []) : [];
      if (_voices.length > 0) _voicesReady = true;
    };
    tryLoad();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = tryLoad;
    }
  }

  function pickSpanishVoice(preferName = PREFER_VOICE_NAME, preferLang = PREFER_LANG) {
    loadVoicesOnce();
    if (!_voices.length) return null;

    const voicesEs = _voices.filter(v => (v.lang || "").toLowerCase().startsWith("es"));
    if (!voicesEs.length) return null;

    const byName = voicesEs.find(v => (v.name || "").includes(preferName));
    if (byName) return byName;

    const exactLang = voicesEs.find(v => (v.lang || "").toLowerCase() === preferLang.toLowerCase());
    if (exactLang) return exactLang;

    const score = v => {
      let s = 0;
      const name = (v.name || "").toLowerCase();
      const lang = (v.lang || "").toLowerCase();
      if (lang.startsWith("es")) s += 10;
      if (lang === "es-mx") s += 5;
      if (/siri|enhanced|premium/.test(name)) s += 3;
      if (/mex/.test(name)) s += 2;
      return s;
    };
    voicesEs.sort((a,b)=>score(b)-score(a));
    return voicesEs[0] || null;
  }

  function speakText(text, preferName = PREFER_VOICE_NAME, preferLang = PREFER_LANG, rate = 1.0) {
    if (!text || !window.speechSynthesis) return;
    loadVoicesOnce();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = preferLang;
    u.rate = rate;
    u.pitch = 1.0;

    const v = pickSpanishVoice(preferName, preferLang);
    if (v) u.voice = v;

    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const src = window.SPANISH_DATA;
    if (!src || typeof src !== "object") {
      showFatal("No data found. Ensure spanish_full_vocab.js is loaded before app.js.");
      return;
    }
    allWords = normalizeData(src);

    loadVoicesOnce();

    wireSettings();
    wireFlashcards();
    wireGlossaryTabs();
    wireTabs();

    recomputeDeck();
    renderFlashcard();
    renderGlossary();
  }

  // ---------- data
  function normalizeData(src) {
    const out = [];
    for (const k of Object.keys(src)) {
      const cat = fixCat(k);
      if (!CATS.includes(cat)) continue;
      for (const row of (src[k] || [])) {
        if (!row) continue;
        const es  = row.es || row.spanish || row.word || "";
        const ipa = row.ipa || row.phonetic || "";
        const en  = row.en || row.english || "";
        if (es && en) out.push({cat, es, ipa, en});
      }
    }
    return out;
  }
  function fixCat(s) {
    const t = String(s||"").trim().toLowerCase();
    if (t.startsWith("basic")) return "Basics";
    if (t.startsWith("people")) return "People";
    if (t.startsWith("place")) return "Places";
    if (t.startsWith("thing")) return "Things";
    if (t.startsWith("adj"))   return "Adjectives";
    if (t.startsWith("verb"))  return "Verbs";
    const hit = CATS.find(c => c.toLowerCase() === t);
    return hit || "";
  }

  // ---------- storage
  function loadEnabled() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const c of CATS) if (typeof obj[c] !== "boolean") obj[c] = true;
        return obj;
      }
    } catch {}
    const d = {}; for (const c of CATS) d[c]=true; return d;
  }
  function saveEnabled(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(enabled)); }catch{} }

  // ---------- shuffle helper
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- filtering
  function recomputeDeck() {
    const active = new Set(CATS.filter(c => enabled[c]));
    const filtered = allWords.filter(w => active.has(w.cat));
    deck = shuffle(filtered);
    deckIdx = 0;
    flipped = false;
  }

  // ---------- settings (with dialog toggle + fallback)
  function wireSettings() {
    const openBtn = byId("btnSettings");
    const modal   = byId("settingsModal");
    const close   = byId("btnCloseSettings");
    const btnAll  = byId("btnSelectAll");
    const btnReset= byId("btnReset");
    const boxWrap = byId("catBoxes");

    if (boxWrap) {
      boxWrap.innerHTML = "";
      for (const c of CATS) {
        const id = "cat_"+c;
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML = `
          <label>
            <input type="checkbox" id="${id}" data-cat="${c}">
            <span>${c}</span>
          </label>`;
        boxWrap.appendChild(div);
      }
      boxWrap.addEventListener("change", (e) => {
        const t = e.target;
        if (t && t.matches('input[type="checkbox"][data-cat]')) {
          enabled[t.getAttribute("data-cat")] = !!t.checked;
          saveEnabled();
          recomputeDeck();
          renderFlashcard();
          renderGlossary();
        }
      });
    }

    if (btnAll) btnAll.addEventListener("click", () => {
      for (const c of CATS) enabled[c] = true;
      saveEnabled(); syncChecks(); recomputeDeck(); renderFlashcard(); renderGlossary();
    });
    if (btnReset) btnReset.addEventListener("click", () => {
      for (const c of CATS) enabled[c] = false;
      saveEnabled(); syncChecks(); recomputeDeck(); renderFlashcard(); renderGlossary();
    });

    if (openBtn && modal) {
      openBtn.addEventListener("click", () => {
        if (isOpen(modal)) closeDialog(modal);
        else { syncChecks(); openDialog(modal); }
      });
    }
    if (close && modal) {
      close.addEventListener("click", () => { closeDialog(modal); });
    }

    function syncChecks() {
      for (const c of CATS) {
        const el = byId("cat_"+c);
        if (el) el.checked = !!enabled[c];
      }
    }
  }

  // dialog helpers with fallback
  function isDialog(el){ return el && el.tagName === "DIALOG"; }
  function openDialog(modal){
    if (isDialog(modal) && typeof modal.showModal === "function") modal.showModal();
    else { modal.setAttribute("open",""); modal.style.display = "block"; }
  }
  function closeDialog(modal){
    if (isDialog(modal) && typeof modal.close === "function") modal.close();
    else { modal.removeAttribute("open"); modal.style.display = "none"; }
  }
  function isOpen(modal){
    if (isDialog(modal)) return !!modal.open;
    return modal.hasAttribute("open") || modal.style.display === "block";
  }

  // ---------- flashcards
  function wireFlashcards() {
    onClick("btnSpeak", speakCurrent);
    onClick("btnFlip", () => { flipped = !flipped; renderFlashcard(); });
    onClick("btnNext", () => { nextCard(); renderFlashcard(); });
  }

  function renderFlashcard() {
    const w = deck[deckIdx];
    const fcWord = byId("fcWord");
    const fcIpa = byId("fcIpa");
    const fcMeaning = byId("fcMeaning");
    if (!w) {
      if (fcWord) fcWord.textContent = "No words";
      if (fcIpa) fcIpa.textContent = "Enable categories in Settings";
      if (fcMeaning) fcMeaning.textContent = "";
      return;
    }
    if (fcWord) fcWord.textContent = w.es;
    if (fcIpa) fcIpa.textContent = w.ipa ? `/${w.ipa}/` : "";
    if (fcMeaning) fcMeaning.textContent = flipped ? w.en : "Tap Flip to reveal";
  }

  function nextCard() {
    if (!deck.length) return;
    deckIdx++;
    if (deckIdx >= deck.length) {
      // end reached: reshuffle for a fresh pass
      deck = shuffle(deck);
      deckIdx = 0;
    }
    flipped = false;
  }

  function speakCurrent() {
    const w = deck[deckIdx];
    if (!w) return;
    speakText(w.es, PREFER_VOICE_NAME, PREFER_LANG, 1.0);
  }

  // ---------- glossary jump buttons
  function wireGlossaryTabs() {
    document.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-jump]");
      if (b) {
        const target = document.getElementById("gloss-" + b.getAttribute("data-jump"));
        if (target) target.scrollIntoView({behavior:"smooth", block:"start"});
      }
    });
  }

  // ---------- glossary grid
  function renderGlossary() {
    const root = byId("glossaryRoot");
    if (!root) return;
    root.innerHTML = "";

    const active = new Set(CATS.filter(c => enabled[c]));
    const items = allWords.filter(w => active.has(w.cat));

    if (!items.length) {
      root.textContent = "No words. Enable categories in Settings.";
      return;
    }

    const byCat = Object.fromEntries(CATS.map(c => [c, []]));
    for (const w of items) byCat[w.cat].push(w);

    for (const c of CATS) {
      const rows = byCat[c];
      if (!rows.length) continue;

      const sec = document.createElement("div");
      sec.className = "gloss-category";
      sec.id = "gloss-" + c;

      const h = document.createElement("h3");
      h.textContent = c;
      sec.appendChild(h);

      for (const w of rows) {
        const row = document.createElement("div");
        row.className = "gloss-row";
        row.innerHTML = `
          <div class="gloss-cell">${w.es}</div>
          <div class="gloss-cell">${w.ipa ? `/${w.ipa}/` : ""}</div>
          <div class="gloss-cell">${w.en}</div>
        `;
        row.addEventListener("click", () => {
          speakText(w.es, PREFER_VOICE_NAME, PREFER_LANG, 1.0);
        });
        sec.appendChild(row);
      }
      root.appendChild(sec);
    }
  }

  // ---------- tabs
  function wireTabs() {
    const btnFlash = byId("tabFlashBtn");
    const btnGloss = byId("tabGlossBtn");
    const tabFlash = byId("flashTab");
    const tabGloss = byId("glossTab");
    if (!btnFlash || !btnGloss || !tabFlash || !tabGloss) return;

    btnFlash.addEventListener("click", () => {
      btnFlash.classList.add("active");
      btnGloss.classList.remove("active");
      tabFlash.classList.add("active");
      tabGloss.classList.remove("active");
    });
    btnGloss.addEventListener("click", () => {
      btnGloss.classList.add("active");
      btnFlash.classList.remove("active");
      tabGloss.classList.add("active");
      tabFlash.classList.remove("active");
    });
  }

  // ---------- utils
  function byId(id){ return document.getElementById(id); }
  function onClick(id, fn){ const b = byId(id); if (b) b.addEventListener("click", fn); }
  function showFatal(msg){
    const p = document.createElement("p");
    p.style.color = "#fff";
    p.textContent = msg;
    document.body.appendChild(p);
  }
})();
