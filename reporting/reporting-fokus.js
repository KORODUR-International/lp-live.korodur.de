/* Fokus nächste 14 Tage (#315): roadmap milestones that are overdue or due
 * within the window, each with the open issues that carry it, grouped by
 * status. ReportingFokus.mount(host, {snapshot, roadmap, stichtag, kuerzel})
 * returns {destroy()}. No fetch, no clock, no issue titles (public page).
 * Backlog, Später and On Hold are the pre-planned stock: counted, not listed.
 */
(function (global) {
  'use strict';
  const DAY = 86400000;
  const WINDOW = 14;
  const STALE = 30;
  const GROUPS = [
    ['In Arbeit', ['In Progress', 'Beansprucht']],
    ['In Review', ['In Review']],
    ['Blocked', ['Blocked']],
    ['Bereit', ['Bereit']],
  ];
  const STOCK = ['Backlog', 'Später', 'On Hold'];
  const ACTIVE = new Set(['In Progress', 'Beansprucht', 'In Review']);

  function calendar(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
  }
  const dateLabel = value => value.split('-').reverse().slice(0, 2).join('.') + '.';
  function identity(row, kuerzel) {
    if (typeof row.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(row.repo)) return null;
    const [owner, repo] = row.repo.split('/');
    if (['.', '..'].includes(repo) || !Number.isSafeInteger(row.nummer) || row.nummer < 1) return null;
    const short = kuerzel && typeof kuerzel[row.repo] === 'string' ? kuerzel[row.repo] : repo;
    return { key: `${row.repo}#${row.nummer}`, label: `${short}#${row.nummer}`,
      url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${row.nummer}` };
  }
  // Days in the current status as a lower bound (see #313): the earlier of the
  // observed start and the legacy status_seit when observation has a gap.
  function statusDays(row, today) {
    const observed = calendar(row.status_beobachtet_seit), legacy = calendar(row.status_seit);
    let start = observed;
    if (observed === null || row.status_beobachtung_luecke !== false) {
      start = [observed, legacy].filter(t => t !== null).reduce((a, b) => Math.min(a, b), Infinity);
    }
    return Number.isFinite(start) && start <= today ? (today - start) / DAY : null;
  }

  function compile(snapshot, roadmap, today, kuerzel) {
    if (!Array.isArray(roadmap?.lanes)) return null;
    const byMilestone = new Map();
    const seen = new Set();
    for (const row of Array.isArray(snapshot?.items) ? snapshot.items : []) {
      if (!row || typeof row !== 'object' || row.discarded === true || row.state === 'CLOSED') continue;
      const id = identity(row, kuerzel);
      if (!id || seen.has(id.key)) continue;
      seen.add(id.key);
      const ids = Array.isArray(row.meilensteine) ? new Set(row.meilensteine) : new Set();
      for (const ms of ids) {
        if (!byMilestone.has(ms)) byMilestone.set(ms, []);
        byMilestone.get(ms).push({ id, status: row.status || 'ohne Status', days: statusDays(row, today) });
      }
    }
    const milestones = [];
    for (const lane of roadmap.lanes) for (const ms of lane?.meilensteine || []) {
      const due = calendar(ms?.datum);
      if (!ms || typeof ms.id !== 'string' || !['offen', 'verschoben'].includes(ms.status) || due === null) continue;
      const diff = (due - today) / DAY;
      if (diff > WINDOW) continue;
      const issues = byMilestone.get(ms.id) || [];
      const groups = GROUPS.map(([name, statuses]) => ({ name,
        issues: issues.filter(i => statuses.includes(i.status))
          .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.id.key.localeCompare(b.id.key)) }));
      const stock = {};
      for (const i of issues) if (!GROUPS.some(([, s]) => s.includes(i.status))) stock[i.status] = (stock[i.status] || 0) + 1;
      milestones.push({ id: ms.id, titel: typeof ms.titel === 'string' && ms.titel ? ms.titel : ms.id,
        lane: typeof lane.name === 'string' ? lane.name : '', datum: ms.datum, diff, verschoben: ms.status === 'verschoben',
        groups, stock, warn: !issues.some(i => ACTIVE.has(i.status)) });
    }
    milestones.sort((a, b) => a.diff - b.diff || a.titel.localeCompare(b.titel));
    return { milestones };
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
    const link = (text, url, className, external = true) => {
      const a = el('a', className, text);
      a.setAttribute('href', url);
      if (external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
      return a;
    };
    const root = el('section', 'status-section reporting-fokus fade-in');
    root.setAttribute('aria-label', `Fokus nächste ${WINDOW} Tage`);
    host.replaceChildren(root);
    const handle = { destroy() { root.remove(); } };
    root.append(el('h3', 'status-section__title', `FOKUS NÄCHSTE ${WINDOW} TAGE`));
    const today = calendar(stichtag);
    const data = today === null ? null : compile(snapshot, roadmap, today, kuerzel);
    if (!data) {
      root.append(el('p', 'matrix__hinweis', 'Roadmap oder Stichtag fehlen, der Fokus ist für diesen Stand nicht verfügbar.'));
      return handle;
    }
    root.append(el('p', 'matrix__hinweis', `Meilensteine bis ${WINDOW} Tage voraus und überfällige, mit den Issues daran · Stand ${stichtag.split('-').reverse().join('.')}`));
    if (!data.milestones.length) root.append(el('p', 'fk-empty', `Keine offenen Meilensteine in den nächsten ${WINDOW} Tagen.`));
    const list = el('ol', 'fk-list');
    for (const ms of data.milestones) {
      const li = el('li', `fk-ms${ms.diff < 0 ? ' fk-ms--late' : ''}`);
      li.setAttribute('data-meilenstein', ms.id);
      const head = el('div', 'fk-ms__head');
      const when = ms.diff < 0 ? `${-ms.diff} Tage überfällig` : ms.diff === 0 ? 'heute fällig'
        : ms.diff === 1 ? 'morgen fällig' : `noch ${ms.diff} Tage`;
      head.append(el('span', 'fk-when', `${dateLabel(ms.datum)} · ${when}`),
        link(ms.titel, `roadmap.html?sel=${encodeURIComponent(ms.id)}`, 'fk-titel', false));
      if (ms.verschoben) head.append(el('span', 'fk-tag', 'verschoben'));
      if (ms.warn) head.append(el('span', 'fk-tag fk-tag--warn', 'nichts in Arbeit'));
      li.append(head);
      if (ms.lane) li.append(el('div', 'fk-lane', ms.lane));
      const rows = el('div', 'fk-groups');
      for (const group of ms.groups) {
        if (!group.issues.length) continue;
        const g = el('div', 'fk-group');
        g.setAttribute('data-gruppe', group.name);
        g.append(el('span', 'fk-group__name', group.name));
        for (const issue of group.issues) {
          const chip = el('span', 'fk-chip');
          chip.append(link(issue.id.label, issue.id.url, 'fk-issue'));
          if (group.name === 'In Arbeit' && issue.status === 'Beansprucht') chip.append(el('span', 'fk-sub', 'beansprucht'));
          if (issue.days !== null && issue.days > STALE) chip.append(el('span', 'fk-stale', `${issue.days} T.`));
          g.append(chip);
        }
        rows.append(g);
      }
      const stock = STOCK.concat(Object.keys(ms.stock).filter(s => !STOCK.includes(s)))
        .filter(s => ms.stock[s]).map(s => `${ms.stock[s]} ${s}`);
      if (stock.length) rows.append(el('div', 'fk-stock', `+ ${stock.join(' · ')}`));
      if (!rows.children.length) rows.append(el('div', 'fk-stock', 'Keine Issues zugeordnet'));
      li.append(rows);
      list.append(li);
    }
    root.append(list);
    const foot = el('p', 'matrix__hinweis');
    foot.append(el('span', '', `„N T.“: mindestens so viele Tage im aktuellen Status, gezeigt ab ${STALE + 1} Tagen. Alle Meilensteine im Reiter `),
      link('Roadmap', 'roadmap.html', '', false), el('span', '', '.'));
    root.append(foot);
    return handle;
  }
  global.ReportingFokus = Object.freeze({ mount, compile });
})(window);
