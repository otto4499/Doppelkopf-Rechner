'use strict';

/* ---------- Daten ---------- */

const KEY = 'doko-rechner-v1';
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 7;
const TABLE = 4;          // Es spielen immer 4 Personen pro Runde
const MAX_POINTS = 50;    // Obergrenze im Drehrad

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emptyDb() {
  return { settings: { cents: 10 }, evenings: [], activeId: null };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.evenings)) {
      return { settings: { ...emptyDb().settings, ...d.settings }, evenings: d.evenings, activeId: d.activeId ?? null };
    }
  } catch (e) { /* ignorieren */ }
  return emptyDb();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Speichern fehlgeschlagen'); }
}

let db = load();

const ui = {
  tab: 'abend',
  setupNames: null,
  sheet: null,   // { type: 'editor' | 'rounds' | 'evening', ... }
};

let edit = null;  // Zustand des Runden-Editors

/* ---------- Rechnen ---------- */

const getEvening = (id) => db.evenings.find((e) => e.id === id);
const activeEvening = () => getEvening(db.activeId);
const multiplier = (r) => 2 ** (r.bock || 0) * (r.factor || 1);

function roundDeltas(ev, r) {
  const d = {};
  ev.players.forEach((p) => { d[p.id] = 0; });
  const active = ev.players.map((p) => p.id).filter((id) => !r.sitOut.includes(id));
  const winners = r.winners.filter((id) => active.includes(id));
  const losers = active.filter((id) => !winners.includes(id));
  if (!winners.length || !losers.length) return d;
  const base = r.value * multiplier(r);
  if (winners.length === losers.length) {
    winners.forEach((id) => { d[id] = base; });
    losers.forEach((id) => { d[id] = -base; });
  } else {
    // Solo: Einzelspieler bekommt/zahlt den Wert für jeden Gegner
    winners.forEach((id) => { d[id] = base * losers.length; });
    losers.forEach((id) => { d[id] = -base * winners.length; });
  }
  return d;
}

function eveningTotals(ev) {
  const t = {};
  ev.players.forEach((p) => { t[p.id] = 0; });
  ev.rounds.forEach((r) => {
    const d = roundDeltas(ev, r);
    for (const id in d) t[id] += d[id];
  });
  return t;
}

function overallTotals() {
  const map = new Map();
  db.evenings.forEach((ev) => {
    const t = eveningTotals(ev);
    ev.players.forEach((p) => {
      const key = p.name.trim().toLowerCase();
      const entry = map.get(key) || { name: p.name.trim(), pts: 0, evenings: 0 };
      entry.pts += t[p.id];
      entry.evenings += 1;
      map.set(key, entry);
    });
  });
  return [...map.values()].sort((a, b) => b.pts - a.pts);
}

/* ---------- Formatierung ---------- */

const fmtPts = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');
const fmtEur = (n) => {
  const v = (n * db.settings.cents) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
};
const fmtDate = (iso, opts) => new Date(iso).toLocaleDateString('de-DE', opts || { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (iso) => fmtDate(iso, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const bockLabel = (b) => (b === 2 ? 'Doppelbock ×4' : b === 1 ? 'Bock ×2' : 'Kein Bock');

function balanceHtml(pts) {
  return `<div class="balance"><div class="pts ${cls(pts)}">${fmtPts(pts)}</div><div class="eur">${fmtEur(pts)}</div></div>`;
}

/* ---------- Ansichten ---------- */

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const v = $('#view');
  if (ui.tab === 'abend') v.innerHTML = activeEvening() ? viewEvening() : viewSetup();
  else if (ui.tab === 'verlauf') v.innerHTML = viewHistory();
  else v.innerHTML = viewSettings();
}

function viewSetup() {
  if (!ui.setupNames) {
    const last = db.evenings[db.evenings.length - 1];
    ui.setupNames = last ? last.players.map((p) => p.name) : ['', '', '', ''];
  }
  const n = ui.setupNames.length;
  return `
    <div class="head"><div><div class="eyebrow">${esc(fmtDate(new Date().toISOString()))}</div><h1>Neues Spiel</h1></div></div>
    <h3>Spieler (${MIN_PLAYERS}–${MAX_PLAYERS})</h3>
    <div class="card">
      ${ui.setupNames.map((name, i) => `
        <div class="name-row">
          <span class="num">${i + 1}</span>
          <input data-idx="${i}" value="${esc(name)}" placeholder="Name" autocomplete="off" autocapitalize="words" enterkeyhint="next" maxlength="20">
          ${n > MIN_PLAYERS ? `<button class="remove" data-action="remove-name" data-idx="${i}" aria-label="Entfernen">×</button>` : ''}
        </div>`).join('')}
    </div>
    ${n < MAX_PLAYERS ? '<button class="btn ghost" data-action="add-name">+ Spieler hinzufügen</button>' : ''}
    <p class="hint">Reihenfolge = Sitzordnung. Bei mehr als 4 Spielern setzen pro Runde die übrigen aus.</p>
    <div class="stack"><button class="btn primary" data-action="start" aria-label="Spiel starten"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fefefe" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play preview-icon"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg></button></div>`;
}

function viewEvening() {
  const ev = activeEvening();
  const t = eveningTotals(ev);
  return `
    <div class="head">
      <div><div class="eyebrow">${esc(fmtDate(ev.date))}</div><h1>Spiel</h1></div>
      <button class="icon-btn" data-action="open-rounds" aria-label="Alle Runden">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
    <div class="badges">
      <span class="badge">${ev.rounds.length} ${ev.rounds.length === 1 ? 'Runde' : 'Runden'}</span>
      ${ev.bock ? `<span class="badge bock">${bockLabel(ev.bock)} aktiv</span>` : ''}
    </div>
    <div class="card">
      ${ev.players.map((p) => `
        <div class="row">
          <div class="grow"><div class="name">${esc(p.name)}</div></div>
          ${balanceHtml(t[p.id])}
        </div>`).join('')}
    </div>
    <div class="stack">
      <button class="btn primary" data-action="new-round" aria-label="Runde eintragen"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fefefe" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus preview-icon"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>
      <div class="btn-row">
        <button class="btn" data-action="open-cards" aria-label="Kartenübersicht">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.832 8.445a1 1 0 00-1.589-.098l-2.075 3.098a1 1 0 000 1.11l2 3a1 1 0 001.664 0l2-3a1 1 0 000-1.11z"/><path d="m7.18 20.827-5-11a2 2 0 01.993-2.647L7 5.44"/><rect x="7" y="2" width="14" height="20" rx="2"/></svg>
        </button>
        <button class="btn" data-action="end-evening" aria-label="Spiel beenden">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff3737" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-chevrons-right preview-icon"><path d="M14 15L17 12L14 9"/><path d="M8 15L11 12L8 9"/><circle cx="12" cy="12" r="10"/></svg>
          </svg>
        </button>
      </div>
    </div>`;
}

function viewHistory() {
  const totals = overallTotals();
  const evs = [...db.evenings].reverse();
  return `
    <div class="head"><div><div class="eyebrow">Alle Spiele</div><h1>Verlauf</h1></div></div>
    <h3>Gesamtstand</h3>
    <div class="card">
      ${totals.length ? totals.map((p, i) => `
        <div class="row">
          <span class="rank">${i + 1}</span>
          <div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${p.evenings} ${p.evenings === 1 ? 'Spiel' : 'Spiele'}</div></div>
          ${balanceHtml(p.pts)}
        </div>`).join('') : '<div class="empty">Noch keine Spiele.</div>'}
    </div>
    <h3>Spielverzeichnis</h3>
    <div class="card">
      ${evs.length ? evs.map((ev) => `
        <button class="row" data-action="open-evening" data-id="${ev.id}">
          <div class="grow">
            <div class="name">${esc(fmtShort(ev.date))}${ev.id === db.activeId ? '<span class="tag">läuft</span>' : ''}</div>
            <div class="sub">${ev.rounds.length} Runden · ${ev.players.map((p) => esc(p.name)).join(', ')}</div>
          </div>
          <span class="chev">›</span>
        </button>`).join('') : '<div class="empty">Hier erscheinen deine Spiele.</div>'}
    </div>`;
}

function viewSettings() {
  return `
    <div class="head"><div><div class="eyebrow">Doppelkopf-Rechner</div><h1>Einstellungen</h1></div></div>
    <h3>Abrechnung</h3>
    <div class="card">
      <div class="field">
        <label for="cents">Wert pro Punkt</label>
        <input id="cents" type="number" inputmode="decimal" min="0" step="1" value="${db.settings.cents}">
        <span class="unit">Cent</span>
      </div>
    </div>
    <p class="hint">Aktuell: 1 Punkt = ${(db.settings.cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>

    <h3>Datensicherung</h3>
    <div class="card">
      <button class="row" data-action="export"><div class="grow"><div class="name">Backup exportieren</div><div class="sub">Alle Spiele als Datei sichern</div></div><span class="chev">›</span></button>
      <label class="row" style="cursor:pointer"><div class="grow"><div class="name">Backup importieren</div><div class="sub">Ersetzt die aktuellen Daten</div></div><span class="chev">›</span>
        <input type="file" id="import" accept="application/json,.json" hidden></label>
    </div>

    <h3>Auf dem iPhone installieren</h3>
    <div class="card">
      <ol class="steps">
        <li>Seite in <b>Safari</b> öffnen</li>
        <li>Unten auf <b>Teilen</b> tippen (Quadrat mit Pfeil)</li>
        <li><b>Zum Home-Bildschirm</b> wählen und bestätigen</li>
      </ol>
    </div>
    <p class="hint">Die Daten werden nur auf diesem Gerät gespeichert.</p>

    <div class="stack"><button class="btn danger" data-action="reset">Alle Daten löschen</button></div>`;
}

/* ---------- Sheets ---------- */

function openSheet(state) {
  ui.sheet = state;
  renderSheet();
  $('#backdrop').classList.add('open');
  $('#sheet').classList.add('open');
}

function closeSheet() {
  ui.sheet = null;
  edit = null;
  $('#backdrop').classList.remove('open');
  $('#sheet').classList.remove('open');
}

function renderSheet() {
  const s = ui.sheet;
  if (!s) return;
  const el = $('#sheet');
  if (s.type === 'editor') el.innerHTML = sheetEditor();
  else if (s.type === 'rounds') el.innerHTML = sheetRounds(getEvening(s.evId));
  else if (s.type === 'evening') el.innerHTML = sheetEvening(getEvening(s.evId));
  else if (s.type === 'cards') el.innerHTML = sheetCards();
  if (s.type === 'editor') initWheel();
}

function sheetHead(title) {
  return `<div class="grabber"></div><div class="sheet-head"><h2>${title}</h2><button class="close" data-action="close" aria-label="Schließen">×</button></div>`;
}

function roundSummary(ev, r) {
  const name = (id) => esc(ev.players.find((p) => p.id === id)?.name ?? '?');
  const w = r.winners.map(name).join(' & ');
  const tags = (r.bock ? `<span class="tag bock">${r.bock === 2 ? '×4' : '×2'}</span>` : '') + (r.factor > 1 ? `<span class="tag">Solo ×${r.factor}</span>` : '');
  return `${w} · ${r.value} ${r.value === 1 ? 'Punkt' : 'Punkte'}${tags}`;
}

function roundsList(ev) {
  if (!ev.rounds.length) return '<div class="empty">Noch keine Runden eingetragen.</div>';
  return ev.rounds.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
    const d = roundDeltas(ev, r);
    const parts = ev.players.filter((p) => d[p.id] !== 0).map((p) => `<span class="${cls(d[p.id])}">${esc(p.name)} ${fmtPts(d[p.id])}</span>`).join('');
    return `
      <button class="row" data-action="edit-round" data-ev="${ev.id}" data-id="${r.id}">
        <span class="round-no">${i + 1}</span>
        <div class="grow"><div class="name">${roundSummary(ev, r)}</div><div class="deltas">${parts}</div></div>
        <span class="chev">›</span>
      </button>`;
  }).join('');
}

function sheetRounds(ev) {
  return `${sheetHead('Alle Runden')}
    <p class="hint" style="margin-bottom:14px">Tippe auf eine Runde, um sie zu bearbeiten.</p>
    <div class="card">${roundsList(ev)}</div>`;
}

/* ---------- Kartenübersicht ---------- */

const SUITS = {
  kreuz: { red: false, svg: '<circle cx="12" cy="7.2" r="4.3"/><circle cx="7" cy="13.6" r="4.3"/><circle cx="17" cy="13.6" r="4.3"/><circle cx="12" cy="12" r="2.5"/><path d="M10.9 12.5c0 4.2-1 6.6-3.2 8.5h8.6c-2.2-1.9-3.2-4.3-3.2-8.5z"/>' },
  pik: { red: false, svg: '<path d="M12 2C9 6.5 3.5 9.4 3.5 13.6c0 2.6 2 4.5 4.4 4.5 1.4 0 2.6-.6 3.3-1.6-.2 2-1 3.5-2.7 4.5h7c-1.7-1-2.5-2.5-2.7-4.5.7 1 1.9 1.6 3.3 1.6 2.4 0 4.4-1.9 4.4-4.5C20.5 9.4 15 6.5 12 2z"/>' },
  herz: { red: true, svg: '<path d="M12 21s-7.6-4.7-9.5-9.3C1.2 8.5 3.3 5 6.8 5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.6 3.5 4.3 6.7C19.6 16.3 12 21 12 21z"/>' },
  karo: { red: true, svg: '<path d="M12 2l7.5 10L12 22 4.5 12z"/>' },
};

// Reihenfolge nach Stichstärke, stärkste Karte zuerst
const CARD_ROWS = {
  trumpf: [
    { label: 'Dulle', cards: [['herz', '10']] },
    { label: 'Damen', cards: [['kreuz', 'D'], ['pik', 'D'], ['herz', 'D'], ['karo', 'D']] },
    { label: 'Buben', cards: [['kreuz', 'B'], ['pik', 'B'], ['herz', 'B'], ['karo', 'B']] },
    { label: 'Karo', cards: [['karo', 'A'], ['karo', '10'], ['karo', 'K']] },
  ],
  fehl: [
    { label: 'Kreuz', cards: [['kreuz', 'A'], ['kreuz', '10'], ['kreuz', 'K']] },
    { label: 'Pik', cards: [['pik', 'A'], ['pik', '10'], ['pik', 'K']] },
    { label: 'Herz', cards: [['herz', 'A'], null, ['herz', 'K']] },
  ],
};

function cardHtml(c) {
  if (!c) return '<div class="pcard empty"></div>';
  const [suit, rank] = c;
  const s = SUITS[suit];
  return `<div class="pcard${s.red ? ' red' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${s.svg}</svg><span>${rank}</span></div>`;
}

function cardRows(rows) {
  return rows.map((r) => `
    <div class="card-row">
      <div class="card-row-label">${r.label}</div>
      <div class="card-row-cards">${r.cards.map(cardHtml).join('')}</div>
    </div>`).join('');
}

function sheetCards() {
  return `${sheetHead('Kartenübersicht')}
    <h3>Trumpf</h3>
    <div class="card pad">${cardRows(CARD_ROWS.trumpf)}</div>
    <h3>Fehl</h3>
    <div class="card pad">${cardRows(CARD_ROWS.fehl)}</div>`;
}

function sheetEvening(ev) {
  const t = eveningTotals(ev);
  const isActive = ev.id === db.activeId;
  return `${sheetHead(esc(fmtShort(ev.date)))}
    <h3>Kontostand</h3>
    <div class="card">
      ${ev.players.map((p) => `<div class="row"><div class="grow"><div class="name">${esc(p.name)}</div></div>${balanceHtml(t[p.id])}</div>`).join('')}
    </div>
    <h3>Runden</h3>
    <div class="card">${roundsList(ev)}</div>
    <div class="stack">
      ${isActive ? '' : `<button class="btn primary" data-action="resume" data-id="${ev.id}">Spiel fortsetzen</button>`}
      <button class="btn danger" data-action="delete-evening" data-id="${ev.id}">Spiel löschen</button>
    </div>`;
}

/* ---------- Runden-Editor ---------- */

function startEditor(ev, round) {
  if (round) {
    edit = {
      evId: ev.id, roundId: round.id,
      sitOut: [...round.sitOut], winners: [...round.winners],
      value: round.value, bock: round.bock || 0, factor: round.factor || 1,
    };
  } else {
    const last = ev.rounds[ev.rounds.length - 1];
    const n = ev.players.length;
    let sitOut = [];
    if (n > TABLE && last) {
      // Aussetzer rotieren eine Position weiter (wie der Geber)
      sitOut = last.sitOut
        .map((id) => ev.players.findIndex((p) => p.id === id))
        .filter((i) => i >= 0)
        .map((i) => ev.players[(i + 1) % n].id);
    }
    edit = {
      evId: ev.id, roundId: null,
      sitOut, winners: [],
      value: last ? last.value : 1, bock: ev.bock || 0, factor: 1,
    };
  }
  openSheet({ type: 'editor' });
}

function sheetEditor() {
  const ev = getEvening(edit.evId);
  const n = ev.players.length;
  const needOut = n - TABLE;
  const idx = edit.roundId ? ev.rounds.findIndex((r) => r.id === edit.roundId) + 1 : ev.rounds.length + 1;
  const active = ev.players.filter((p) => !edit.sitOut.includes(p.id));

  const wheel = Array.from({ length: MAX_POINTS }, (_, i) => i + 1).map((v) => `<div class="item${v === edit.value ? ' sel' : ''}" data-v="${v}">${v}</div>`).join('');

  return `${sheetHead(`Runde ${idx}`)}
    ${needOut > 0 ? `
      <div class="label">Setzt aus <em>${edit.sitOut.length}/${needOut}</em></div>
      <div class="chips">
        ${ev.players.map((p) => `<button class="chip ${edit.sitOut.includes(p.id) ? 'out' : ''}" data-action="toggle-out" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
      </div>` : ''}

    <div class="label">Gewonnen <em>${edit.factor > 1 ? 'Solo: 1 oder 3 wählen' : 'antippen'}</em></div>
    <div class="chips">
      ${active.map((p) => `<button class="chip ${edit.winners.includes(p.id) ? 'on' : ''}" data-action="toggle-win" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
    </div>

    <div class="label">Spielwert</div>
    <div class="picker-area">
      <div class="wheel-wrap">
        <div class="wheel-band"></div>
        <div class="wheel" id="wheel"><div class="spacer"></div>${wheel}<div class="spacer"></div></div>
        <div class="wheel-unit">Pkt</div>
      </div>
      <div class="options">
        <button class="bock-btn l${edit.bock}" data-action="bock">
          <span class="t">${edit.bock === 2 ? 'Doppelbock' : 'Bock'}</span>
          <span class="s">${edit.bock === 2 ? 'alles ×4' : edit.bock === 1 ? 'alles ×2' : 'aus'}</span>
        </button>
        <div class="solo">
          <div class="t">Solo-Faktor</div>
          <div class="seg">
            ${[1, 2, 3, 4, 5].map((f) => `<button class="${edit.factor === f ? 'on' : ''}" data-action="factor" data-f="${f}">${f === 1 ? '–' : '×' + f}</button>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="label">Ergebnis <em id="mult"></em></div>
    <div class="preview" id="preview"></div>

    <div class="stack">
      <button class="btn primary" data-action="save-round">${edit.roundId ? 'Änderungen speichern' : 'Runde speichern'}</button>
      ${edit.roundId ? '<button class="btn danger" data-action="delete-round">Runde löschen</button>' : ''}
    </div>`;
}

function updatePreview() {
  const ev = getEvening(edit.evId);
  const box = $('#preview');
  if (!box) return;
  const m = multiplier(edit);
  $('#mult').textContent = m > 1 ? `Wert ×${m} = ${edit.value * m}` : '';
  const active = ev.players.filter((p) => !edit.sitOut.includes(p.id));
  if (active.length !== TABLE || !edit.winners.length || edit.winners.length >= active.length) {
    box.innerHTML = `<div class="preview-note">${active.length !== TABLE ? `Bitte ${ev.players.length - TABLE} Aussetzer wählen` : 'Gewinner antippen'}</div>`;
    return;
  }
  const d = roundDeltas(ev, edit);
  box.innerHTML = active.map((p) => `<div class="p"><span>${esc(p.name)}</span><span class="${cls(d[p.id])}">${fmtPts(d[p.id])}</span></div>`).join('');
}

function initWheel() {
  const w = $('#wheel');
  const item = w.querySelector('.item').offsetHeight || 40;
  w.scrollTop = (edit.value - 1) * item;
  let raf = 0;
  w.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const v = Math.max(1, Math.min(MAX_POINTS, Math.round(w.scrollTop / item) + 1));
      if (v !== edit.value) {
        w.querySelector('.item.sel')?.classList.remove('sel');
        w.querySelector(`.item[data-v="${v}"]`)?.classList.add('sel');
        edit.value = v;
        updatePreview();
      }
    });
  }, { passive: true });
  w.addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (it) w.scrollTo({ top: (Number(it.dataset.v) - 1) * item, behavior: 'smooth' });
  });
  updatePreview();
}

function saveRound() {
  const ev = getEvening(edit.evId);
  const active = ev.players.filter((p) => !edit.sitOut.includes(p.id));
  const needOut = ev.players.length - TABLE;
  if (active.length !== TABLE) return toast(`Bitte genau ${needOut} Aussetzer wählen`);
  const w = edit.winners.length;
  if (w < 1 || w > 3) return toast('Bitte 1 bis 3 Gewinner antippen');
  if (edit.factor > 1 && w === 2) return toast('Beim Solo 1 Gewinner (Solist) oder 3 Gewinner wählen');

  const data = { sitOut: [...edit.sitOut], winners: [...edit.winners], value: edit.value, bock: edit.bock, factor: edit.factor };
  if (edit.roundId) {
    const r = ev.rounds.find((x) => x.id === edit.roundId);
    Object.assign(r, data);
    toast('Runde geändert');
  } else {
    ev.rounds.push({ id: uid(), time: new Date().toISOString(), ...data });
    ev.bock = edit.bock; // Bock bleibt für die nächsten Runden eingestellt
    toast('Runde gespeichert');
  }
  save();
  const back = ui.sheet.back;
  if (back) { ui.sheet = back; edit = null; renderSheet(); } else closeSheet();
  render();
}

/* ---------- Aktionen ---------- */

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const actions = {
  'add-name'() { ui.setupNames.push(''); render(); $(`input[data-idx="${ui.setupNames.length - 1}"]`)?.focus(); },
  'remove-name'(el) { ui.setupNames.splice(Number(el.dataset.idx), 1); render(); },
  start() {
    const names = ui.setupNames.map((s) => s.trim());
    if (names.some((s) => !s)) return toast('Bitte alle Namen eintragen');
    const lower = names.map((s) => s.toLowerCase());
    if (new Set(lower).size !== lower.length) return toast('Jeder Name darf nur einmal vorkommen');
    const ev = { id: uid(), date: new Date().toISOString(), players: names.map((name) => ({ id: uid(), name })), rounds: [], bock: 0 };
    db.evenings.push(ev);
    db.activeId = ev.id;
    ui.setupNames = null;
    save();
    render();
  },
  'new-round'() { startEditor(activeEvening()); },
  'open-rounds'() { openSheet({ type: 'rounds', evId: db.activeId }); },
  'open-cards'() { openSheet({ type: 'cards' }); },
  'end-evening'() {
    const ev = activeEvening();
    if (!confirm('Spiel beenden? Es bleibt im Verlauf gespeichert.')) return;
    if (!ev.rounds.length) db.evenings = db.evenings.filter((e) => e.id !== ev.id);
    db.activeId = null;
    save();
    ui.tab = ev.rounds.length ? 'verlauf' : 'abend';
    render();
    window.scrollTo(0, 0);
  },
  'open-evening'(el) { openSheet({ type: 'evening', evId: el.dataset.id }); },
  'edit-round'(el) {
    const ev = getEvening(el.dataset.ev);
    const back = ui.sheet;
    startEditor(ev, ev.rounds.find((r) => r.id === el.dataset.id));
    ui.sheet.back = back;
  },
  resume(el) {
    db.activeId = el.dataset.id;
    save();
    closeSheet();
    ui.tab = 'abend';
    render();
    window.scrollTo(0, 0);
  },
  'delete-evening'(el) {
    if (!confirm('Dieses Spiel endgültig löschen?')) return;
    db.evenings = db.evenings.filter((e) => e.id !== el.dataset.id);
    if (db.activeId === el.dataset.id) db.activeId = null;
    save();
    closeSheet();
    render();
  },
  close() {
    const back = ui.sheet?.back;
    if (back) { ui.sheet = back; edit = null; renderSheet(); } else closeSheet();
  },
  'toggle-out'(el) {
    const id = el.dataset.id;
    const ev = getEvening(edit.evId);
    if (edit.sitOut.includes(id)) edit.sitOut = edit.sitOut.filter((x) => x !== id);
    else {
      edit.sitOut.push(id);
      const need = ev.players.length - TABLE;
      if (edit.sitOut.length > need) edit.sitOut.shift(); // ältesten Aussetzer abwählen
    }
    edit.winners = edit.winners.filter((x) => !edit.sitOut.includes(x));
    rerenderEditor();
  },
  'toggle-win'(el) {
    const id = el.dataset.id;
    edit.winners = edit.winners.includes(id) ? edit.winners.filter((x) => x !== id) : [...edit.winners, id];
    rerenderEditor();
  },
  bock() { edit.bock = (edit.bock + 1) % 3; rerenderEditor(); },
  factor(el) { edit.factor = Number(el.dataset.f); rerenderEditor(); },
  'save-round'() { saveRound(); },
  'delete-round'() {
    if (!confirm('Diese Runde löschen?')) return;
    const ev = getEvening(edit.evId);
    ev.rounds = ev.rounds.filter((r) => r.id !== edit.roundId);
    save();
    toast('Runde gelöscht');
    actions.close();
    render();
  },
  export() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `doppelkopf-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  reset() {
    if (!confirm('Wirklich ALLE Spiele und Einstellungen löschen?')) return;
    db = emptyDb();
    ui.setupNames = null;
    save();
    render();
    toast('Alle Daten gelöscht');
  },
};

function rerenderEditor() {
  const sheet = $('#sheet');
  const top = sheet.scrollTop;
  renderSheet();
  sheet.scrollTop = top;
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

$('#backdrop').addEventListener('click', closeSheet);

document.addEventListener('input', (e) => {
  if (e.target.matches('.name-row input')) ui.setupNames[Number(e.target.dataset.idx)] = e.target.value;
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'cents') {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!(v >= 0)) { toast('Ungültiger Betrag'); render(); return; }
    db.settings.cents = v;
    save();
    render();
    toast('Gespeichert');
  }
  if (e.target.id === 'import') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const d = JSON.parse(txt);
      if (!d || !Array.isArray(d.evenings)) throw new Error();
      if (!confirm('Backup importieren und aktuelle Daten ersetzen?')) return;
      db = { settings: { ...emptyDb().settings, ...d.settings }, evenings: d.evenings, activeId: d.activeId ?? null };
      save();
      render();
      toast('Backup importiert');
    }).catch(() => toast('Datei konnte nicht gelesen werden'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.name-row input')) {
    e.preventDefault();
    const next = $(`input[data-idx="${Number(e.target.dataset.idx) + 1}"]`);
    if (next) next.focus(); else e.target.blur();
  }
});

render();
