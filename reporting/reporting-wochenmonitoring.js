/* Woche im Verlauf (#309): closed issues of the current ISO week against the
 * previous week, cumulative, Berlin calendar days. No fetch, no clock.
 * ReportingWochenmonitoring.mount(host, {snapshot, stichtag}) returns {destroy()}.
 * stichtag is the Berlin date of the selected snapshot, not its UTC filename.
 * Source: snapshot.abschluss_monitoring.tage (docs/reporting-datenvertrag.md).
 * A day inside [von, bis] without an entry counts as 0; outside it is unknown.
 */
(function (global) {
  'use strict';
  const DAY = 86400000;
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const num = v => v === null ? '–' : String(v);
  function calendar(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const t = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(t) && iso(t) === value ? t : null;
  }
  function weekNo(monday) {
    const thursday = monday + 3 * DAY, year = new Date(thursday).getUTCFullYear();
    return Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  }

  function compile(snapshot, stichtag) {
    const block = snapshot?.abschluss_monitoring, today = calendar(stichtag);
    const von = calendar(block?.von), bis = calendar(block?.bis);
    if (!block || today === null || von === null || bis === null
        || !block.tage || typeof block.tage !== 'object' || Array.isArray(block.tage)) return null;
    const value = t => {
      if (t < von || t > bis) return null;
      const n = block.tage[iso(t)];
      if (n === undefined) return 0;
      return Number.isSafeInteger(n) && n >= 0 ? n : null;
    };
    const weekday = (new Date(today).getUTCDay() + 6) % 7, monday = today - weekday * DAY;
    const series = (first, lastIndex) => {
      let sum = 0;
      return DAYS.map((_, i) => {
        if (i > lastIndex) return { daily: null, cumulative: null };
        const daily = value(first + i * DAY);
        sum = sum === null || daily === null ? null : sum + daily;
        return { daily, cumulative: sum };
      });
    };
    const aktuell = series(monday, Math.min(weekday, Math.floor((bis - monday) / DAY)));
    const vorwoche = series(monday - 7 * DAY, 6);
    return { weekday, kw: weekNo(monday), vorKw: weekNo(monday - 7 * DAY),
      aktuell, vorwoche, luecken: Number.isSafeInteger(block.datenluecken?.anzahl) ? block.datenluecken.anzahl : 0 };
  }

  function mount(host, { snapshot, stichtag } = {}) {
    if (!host?.ownerDocument) throw new TypeError('mount requires a DOM host element');
    const doc = host.ownerDocument;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const svgEl = (tag, attrs = {}, text) => {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const root = el('section', 'status-section reporting-woche fade-in');
    root.setAttribute('aria-label', 'Woche im Verlauf');
    host.replaceChildren(root);
    const handle = { destroy() { root.remove(); } };
    root.append(el('h3', 'status-section__title', 'WOCHE IM VERLAUF'));
    const data = compile(snapshot, stichtag);
    if (!data) {
      root.append(el('p', 'matrix__hinweis', 'Für diesen Stand gibt es keine Tageswerte der Abschlüsse.'));
      return handle;
    }
    const heute = data.aktuell[data.weekday], vorGleich = data.vorwoche[data.weekday];
    const vorGesamt = data.vorwoche[6].cumulative;
    const kopf = el('div', 'rwo-kopf');
    const kachel = (label, wert, detail) => {
      const k = el('div', 'rwo-zahl');
      k.append(el('div', 'kpi-card__label', label), el('div', 'kpi-card__value', num(wert)));
      if (detail) k.append(el('div', 'kpi-card__detail', detail));
      return k;
    };
    kopf.append(
      kachel(`KW ${data.kw} bis ${DAYS[data.weekday]}`, heute.cumulative),
      kachel(`KW ${data.vorKw} bis ${DAYS[data.weekday]}`, vorGleich.cumulative),
      kachel(`KW ${data.vorKw} gesamt`, vorGesamt));
    root.append(kopf);

    const all = [...data.aktuell, ...data.vorwoche].map(d => d.cumulative).filter(v => v !== null);
    const max = Math.max(4, ...all), top = Math.ceil(max / 4) * 4;
    const x = i => 50 + i * 92, y = n => 190 - n / top * 170;
    const svg = svgEl('svg', { viewBox: '0 0 640 220', role: 'img',
      'aria-label': `Abschlüsse kumuliert, KW ${data.kw} gegen KW ${data.vorKw}` });
    for (let i = 0; i <= 4; i++) {
      const n = top * i / 4;
      svg.append(svgEl('line', { x1: 40, x2: 616, y1: y(n), y2: y(n), class: 'rwo-grid' }));
      svg.append(svgEl('text', { x: 32, y: y(n) + 4, 'text-anchor': 'end', class: 'rwo-axis' }, String(n)));
    }
    DAYS.forEach((d, i) => svg.append(svgEl('text', { x: x(i), y: 212, 'text-anchor': 'middle', class: 'rwo-axis' }, d)));
    for (const [key, rows] of [['vorwoche', data.vorwoche], ['aktuell', data.aktuell]]) {
      let seg = [];
      const flush = () => { if (seg.length > 1) svg.append(svgEl('polyline', { points: seg.join(' '), class: `rwo-line rwo-${key}` })); seg = []; };
      rows.forEach((r, i) => {
        if (r.cumulative === null) { flush(); return; }
        seg.push(`${x(i)},${y(r.cumulative)}`);
        svg.append(svgEl('circle', { cx: x(i), cy: y(r.cumulative), r: key === 'aktuell' ? 4 : 3, class: `rwo-dot rwo-${key}`, 'data-punkt': key }));
      });
      flush();
    }
    const chart = el('div', 'rwo-chart'); chart.append(svg); root.append(chart);
    const legend = el('div', 'rwo-legend');
    legend.append(el('span', 'rwo-key-aktuell', `● KW ${data.kw}`), el('span', 'rwo-key-vorwoche', `○ KW ${data.vorKw} (Vorwoche)`));
    root.append(legend);

    const table = el('table', 'rwo-table');
    const head = el('tr'); head.append(el('th', '', ''));
    DAYS.forEach(d => head.append(el('th', '', d)));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    for (const [label, rows] of [[`KW ${data.kw}`, data.aktuell], [`KW ${data.vorKw}`, data.vorwoche]]) {
      const tr = el('tr'); tr.append(el('th', '', label));
      rows.forEach(r => { const td = el('td', '', r.daily === null ? '' : String(r.daily)); td.setAttribute('data-wert', r.daily === null ? '' : String(r.daily)); tr.append(td); });
      body.append(tr);
    }
    table.append(body); root.append(table);
    const hinweis = `Geschlossene Issues je Tag (Berliner Zeit), heute vorläufig.${data.luecken ? ` ${data.luecken} geschlossenes Issue${data.luecken > 1 ? 's' : ''} nicht auf Done, nicht mitgezählt.` : ''}`;
    root.append(el('p', 'matrix__hinweis', hinweis));
    return handle;
  }
  global.ReportingWochenmonitoring = Object.freeze({ mount, compile });
})(window);
