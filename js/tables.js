// Table twin for a chart card: the same numbers as a plain table, plus the
// status chips and external-evidence links a table cell can carry. Shared by
// the dashboard (js/charts.js) and the cross-post embeds
// (dashboard/embed_runtime.js) so a pasted figure and the dashboard render an
// identical table.

export function statusChip(status) {
  const chip = document.createElement('span');
  chip.className = `chip ${status.tone || 'muted'}`;
  chip.textContent = status.value;
  return chip;
}

export function externalLink(link) {
  const a = document.createElement('a');
  a.className = 'external-evidence';
  a.href = link.href;
  a.textContent = link.value || link.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function renderTable(root, table) {
  if (table.note) {
    // a statement shared by every row (e.g. the sample) sits above the table
    const note = document.createElement('p');
    note.className = 'table-note';
    note.textContent = table.note;
    root.appendChild(note);
  }
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const col of table.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  t.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of table.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      if (cell && typeof cell === 'object' && cell.kind === 'status') {
        td.appendChild(statusChip(cell));
      } else if (cell && typeof cell === 'object' && cell.kind === 'link') {
        td.appendChild(externalLink(cell));
      } else {
        const text = cell == null ? '—' : String(cell);
        td.textContent = text;
        if (/^[-+]?[$0-9][0-9,./%$ ]*$/.test(text)) td.className = 'num';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  wrap.appendChild(t);
  root.appendChild(wrap);
}

