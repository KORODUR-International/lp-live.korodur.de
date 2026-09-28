/* Gezielt nachfassen (#313): open issues longer than 30 calendar days in the
 * same status, in three blocks (In Review, Blocked, Liegt bei uns), longest
 * first. ReportingNachfassen.mount(host, {snapshot, roadmap, stichtag, kuerzel})
 * returns {destroy()}. No fetch, no clock, no issue titles (public page).
 * Duration: status_beobachtet_seit without a gap is exact to the day. With
 * status_beobachtung_luecke the issue was already in this status when daily
 * observation began (16.08.2026), so the duration is a lower bound ("≥").
 * Legacy snapshots without it fall back to status_seit ("ca.").
 */
(function (global) {
  'use strict';
  const DAY = 86400000;
  const LIMIT = 30;
  const BLOCKS = [
    ['In Review', ['In Review'], 'wartet auf Abstimmung'],
    ['Blocked', ['Blocked'], 'wartet auf andere'],
    ['Liegt bei uns', ['In Progress', 'Beansprucht'], 'In Progress und Beansprucht'],
  ];
  const BOARD_URL = 'https://github.com/orgs/KORODUR-International/projects/1';
  const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };

  function calendar(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
  }
  const dateLabel = value => value.split('-').reverse().join('.');
  function identity(row, kuerzel) {
    if (typeof row.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(row.repo)) return null;
    const [owner, repo] = row.repo.split('/');
    if (['.', '..'].includes(repo) || !Number.isSafeInteger(row.nummer) || row.nummer < 1) return null;
    const short = kuerzel && typeof kuerzel[row.repo] === 'string' ? kuerzel[row.repo] : repo;
    return { key: `${row.repo}#${row.nummer}`, label: `${short}#${row.nummer}`, title: `${row.repo}#${row.nummer}`,
      url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${row.nummer}` };
  }
  function duration(row, today) {
    const observed = calendar(row.status_beobachtet_seit);
    const legacy = calendar(row.status_seit);
    const legacyOk = legacy !== null && legacy <= today;
    if (observed !== null && observed <= today) {
      if (row.status_beobachtung_luecke === false) return { days: (today - observed) / DAY, prefix: '' };
      // Both dates are lower bounds here: status_seit started from updatedAt,
      // which a status change always moves, so the earlier one wins.
      const start = legacyOk ? Math.min(observed, legacy) : observed;
      return { days: (today - start) / DAY, prefix: '≥ ' };
    }
    if (legacyOk) return { days: (today - legacy) / DAY, prefix: 'ca. ' };
    return null;
  }
  function milestoneText(row, roadmap) {
    const titles = new Map();
    if (Array.isArray(roadmap?.lanes)) for (const lane of roadmap.lanes) for (const ms of lane?.meilensteine || []) {
      if (typeof ms?.id === 'string' && typeof ms.titel === 'string' && ms.titel) titles.set(ms.id, ms.titel);
    }
    const ids = Array.isArray(row.meilensteine) ? [...new Set(row.meilensteine.filter(id => typeof id === 'string' && id))] : [];
    return ids.length ? ids.map(id => titles.get(id) || id).join(' · ') : '–';
  }

  function compile(snapshot, roadmap, today, kuerzel) {
    const blocks = BLOCKS.map(([name, statuses, hint]) => ({ name, statuses, hint, rows: [] }));
    let bereit = 0;
    const seen = new Set();
    for (const row of Array.isArray(snapshot?.items) ? snapshot.items : []) {
      if (!row || typeof row !== 'object' || row.discarded === true || row.state === 'CLOSED') continue;
      const id = identity(row, kuerzel);
      if (!id || seen.has(id.key)) continue;
      const info = duration(row, today);
      if (!info || info.days <= LIMIT) continue;
      seen.add(id.key);
      if (row.status === 'Bereit') { bereit++; continue; }
      const block = blocks.find(b => b.statuses.includes(row.status));
      if (!block) continue;
      block.rows.push({ id, ...info, status: row.status, milestones: milestoneText(row, roadmap),
        priority: typeof row.prioritaet === 'string' && row.prioritaet in PRIORITY ? row.prioritaet : '' });
    }
    for (const block of blocks) block.rows.sort((a, b) => b.days - a.days
      || (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9) || a.id.key.localeCompare(b.id.key));
    return { blocks, bereit, available: Array.isArray(snapshot?.items) };
  }

  function mount(host, { snapshot, roadmap, stichtag, kuerzel } = {}) {
    if (!host?.ownerDocument) throw new TypeError('mount requires a DOM host element');
    const doc = host.ownerDocument;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const link = (text, url, className) => {
      const a = el('a', className, text);
      a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
      return a;
    };
    const root = el('section', 'status-section reporting-nachfassen fade-in');
    root.setAttribute('aria-label', 'Gezielt nachfassen');
    host.replaceChildren(root);
    const handle = { destroy() { root.remove(); } };
    root.append(el('h3', 'status-section__title', 'GEZIELT NACHFASSEN'));
    const today = calendar(stichtag);
    const data = today === null ? null : compile(snapshot, roadmap, today, kuerzel);
    if (!data || !data.available) {
      root.append(el('p', 'matrix__hinweis', 'Für diesen Stand gibt es keine auswertbaren Issue-Daten.'));
      return handle;
    }
    root.append(el('p', 'matrix__hinweis', `Seit über ${LIMIT} Tagen im selben Status, längste zuerst · Stand ${dateLabel(stichtag)}`));
    const grid = el('div', 'rn-blocks');
    for (const block of data.blocks) {
      const col = el('div', 'rn-block');
      col.setAttribute('data-block', block.name);
      const head = el('div', 'rn-block__head');
      head.append(el('span', 'rn-block__name', block.name), el('span', 'rn-block__count', String(block.rows.length)));
      col.append(head, el('div', 'rn-block__hint', block.hint));
      if (!block.rows.length) col.append(el('p', 'rn-empty', 'Nichts über 30 Tage.'));
      else {
        const list = el('ol', 'rn-list');
        for (const row of block.rows) {
          const li = el('li', 'rn-row');
          const top = el('div', 'rn-row__top');
          const a = link(row.id.label, row.id.url, 'rn-issue'); a.setAttribute('title', row.id.title);
          top.append(a, el('span', 'rn-days', `${row.prefix}${row.days} Tage`));
          if (row.priority) top.append(el('span', 'rn-prio', row.priority));
          if (block.statuses.length > 1) top.append(el('span', 'rn-status', row.status));
          li.append(top, el('div', 'rn-ms', row.milestones));
          list.append(li);
        }
        col.append(list);
      }
      grid.append(col);
    }
    root.append(grid);
    const foot = el('p', 'matrix__hinweis rn-foot');
    foot.append(el('span', '', `≥ heißt: mindestens so lange, der genaue Beginn liegt vor den Tages-Snapshots. Bereit wird nicht gelistet: ${data.bereit} Bereit-Issues liegen über ${LIMIT} Tage, `));
    foot.append(link('Board', BOARD_URL), el('span', '', '.'));
    root.append(foot);
    return handle;
  }
  global.ReportingNachfassen = Object.freeze({ mount, compile });
})(window);
