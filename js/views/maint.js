// Maintenance (server/Maint.gs): a fault in a shop, a department or a store.
//  - the reporter: a new report (place, equipment, kind of fault, description, photos) and their reports,
//    where they confirm a fix or say it is still broken;
//  - the maintenance team: the reports (receive with urgency, answer with a fix or a visit date, the result,
//    money asked from the accountant, expenses with their invoice), the equipment of each place, the kinds of fault;
//  - the accountant: the money asked (approve, refuse, paid) and the expenses to review;
//  - the management: every report and the figures (most frequent places, equipment and faults, cost, times).
import { call } from '../api.js';
import { Data } from '../data.js';
import { t, errText, getLang } from '../i18n.js';
import { h, toast, dialog, fmtNum, fmtDate } from '../ui.js';
import { field, newId } from '../components.js';
import { shrink, photoButton } from '../photos.js';

let tab = '';
let rootEl = null;
let cache = null;      // { places, faults, assets }
let listCache = null;  // the reports
const when = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) + ' ' + String(iso).slice(11, 16) : '');
const catName = (c) => { const p = String(c || '').split('|').map((x) => x.trim()).filter(Boolean); return (getLang() === 'en' ? p[1] : p[0]) || p[0] || ''; };
const placeName = (id, fallback) => (String(id).indexOf('ST:') === 0 ? t('store_' + String(id).slice(3)) : fallback || ((cache && cache.places.find((p) => p.id === id)) || {}).name || id);
const hours = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 36e5 : null);
const LIMIT_H = { urgent: 24, important: 72, normal: 24 * 7 };

export function render(root) {
  rootEl = root;
  const report = Data.can('maint.create'), manage = Data.can('maint.act'), money = Data.can('maint.money'), view = Data.can('maint.view');
  const keys = [].concat(report && !manage ? ['new', 'mine'] : [], manage ? ['inbox', 'new', 'assets'] : [], money ? ['money'] : [],
    view && !manage ? ['all'] : [], manage || money || view ? ['stats'] : [], manage ? ['faults'] : []);
  if (!keys.includes(tab)) tab = keys[0];
  const box = h('div');
  const bar = h('div.tabs');
  const draw = () => {
    bar.replaceChildren(...keys.map((k) => h('button', { type: 'button', class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, t('mt_tab_' + k))));
    ({ new: newReport, mine: (b) => tickets(b, true), inbox: (b) => tickets(b, false), all: (b) => tickets(b, false), assets, money: moneyTab, stats, faults })[tab](box);
  };
  root.replaceChildren(h('div.card', h('div.card-head', h('h2', t('maint')), keys.length > 1 ? bar : ''), box));
  draw();
}

function loadPlaces() {
  return call('maint.places').then((d) => { cache = d; return d; });
}
function withPlaces(box, fn) {
  if (cache) fn(cache);
  else box.replaceChildren(h('p.empty', t('refreshing')));
  loadPlaces().then((d) => { if (box.isConnected) fn(d); }).catch((e) => { if (!cache) box.replaceChildren(h('p.empty', errText(e))); });
}
const actions = (close, okText, danger) => h('div.actions', h('button.btn.secondary', { type: 'button', onclick: () => close(false) }, t('cancel')),
  h('button.btn' + (danger ? '.danger' : ''), { type: 'button', onclick: () => close(true) }, okText || t('save')));

/** A photo picker: up to max photos, made small on the phone. */
function photoPicker(max, label) {
  const photos = [];
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const count = h('small.muted', '');
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try { photos.push(await shrink(f)); count.textContent = t('fl_photos_n', { n: photos.length }); } catch { toast(t('err.photo_invalid'), 'err'); }
    file.value = '';
  });
  const el = h('div.fl-photo', h('button.btn.secondary', { type: 'button', onclick: () => { if (photos.length < max) file.click(); } }, '📷 ' + label), count, file);
  return { el, photos };
}

// ---------- a new report
function newReport(box) {
  withPlaces(box, (d) => {
    if (!d.places.length) { box.replaceChildren(h('p.empty', t('mt_no_place'))); return; }
    const place = h('select.input', d.places.map((p) => h('option', { value: p.id }, placeName(p.id, p.name))));
    const asset = h('select.input');
    const other = h('input.input', { placeholder: t('mt_asset_other_ph'), hidden: true });
    const fillAssets = () => {
      const list = d.assets.filter((a) => a.place === place.value);
      asset.replaceChildren(h('option', { value: '' }, t('mt_asset_pick')), ...list.map((a) => h('option', { value: a.asset_id }, a.name)), h('option', { value: '_other' }, t('mt_asset_other')));
      other.hidden = true;
    };
    place.addEventListener('change', fillAssets);
    asset.addEventListener('change', () => { other.hidden = asset.value !== '_other'; });
    fillAssets();
    const fault = h('select.input', d.faults.map((f) => h('option', { value: f }, catName(f))));
    const desc = h('textarea.input', { rows: 3, placeholder: t('mt_desc_ph') });
    const stops = h('input', { type: 'checkbox' });
    const pics = photoPicker(2, t('fl_photo'));
    const send = h('button.btn', { type: 'button' }, t('mt_send'));
    send.addEventListener('click', async () => {
      if (!desc.value.trim()) { toast(t('err.maint_description'), 'err'); return; }
      send.disabled = true;
      try {
        await call('maint.create', { client_id: newId(), place: place.value, asset_id: asset.value === '_other' ? '' : asset.value, asset_text: asset.value === '_other' ? other.value : '',
          fault: fault.value, description: desc.value, stops_work: stops.checked, photos: pics.photos });
        toast(t('mt_sent'), 'ok');
        listCache = null;
        tab = Data.can('maint.act') ? 'inbox' : 'mine';
        render(rootEl);
      } catch (e) { toast(errText(e), 'err'); send.disabled = false; }
    });
    box.replaceChildren(h('div.form-grid', field(t('mt_place'), place), field(t('mt_asset'), h('div', asset, other)), field(t('mt_fault'), fault)),
      field(t('mt_desc'), desc), h('label.fl-urgent', stops, ' 🚨 ' + t('mt_stops')), pics.el, h('div.form-actions', send));
  });
}

// ---------- the reports
const STATUS_ICON = { new: '🆕', open: '🛠', done: '✅', closed: '🔒' };
function statusText(x) {
  if (x.status === 'closed') return x.confirmed === 'yes' ? t('mt_st_confirmed') : t('mt_st_closed');
  return t('mt_st_' + x.status);
}
function overdue(x) {
  if (x.status !== 'open' && x.status !== 'new') return false;
  if (x.reply_kind === 'visit' && x.visit_date && x.visit_date < new Date().toISOString().slice(0, 10)) return true;
  const lim = LIMIT_H[x.urgency || 'normal'];
  return hours(x.created_at, new Date().toISOString()) > lim;
}
function ticketRow(x, reload, mine) {
  const manage = Data.can('maint.act');
  const lines = [
    h('div.fl-top', h('b', STATUS_ICON[x.status] + ' ' + placeName(x.place, x.place_name)), x.asset_name ? h('span', '· ' + x.asset_name) : '',
      h('span.pill', catName(x.fault)), x.urgency ? h('span.pill.mt-' + x.urgency, t('mt_u_' + x.urgency)) : '', x.stops_work ? h('span.pill.mt-urgent', '🚨 ' + t('mt_stops_short')) : '',
      h('small.muted', x.ticket_id + ' · ' + when(x.created_at)), x.reporter_name && !mine ? h('small.muted', '· ' + x.reporter_name) : '',
      overdue(x) ? h('span.pill.mt-urgent', '⏰ ' + t('mt_late')) : ''),
    h('div', x.description),
    x.photos.length ? photoButton(x.photos) : '',
    h('small', h('b', statusText(x))),
    x.reply_kind === 'fix' ? h('div.mt-reply', '💡 ' + t('mt_fix') + ': ' + x.reply_text) : '',
    x.reply_kind === 'visit' ? h('div.mt-reply', '📅 ' + t('mt_visit') + ': ' + fmtDate(x.visit_date) + (x.reply_text ? ' – ' + x.reply_text : '')) : '',
    x.result ? h('div', '🔧 ' + t('mt_r_' + x.result) + (x.result_note ? ' – ' + x.result_note : '')) : '',
    x.confirm_note ? h('small.muted', (x.confirmed === 'no' ? '⚠️ ' + t('mt_still_broken') : '✓') + ': ' + x.confirm_note) : '',
    Number(x.reopened) ? h('small.muted', t('mt_reopened', { n: x.reopened })) : '',
    x.closed_reason ? h('small.muted', '🔒 ' + x.closed_reason) : '',
  ];
  if (!mine && ((x.money || []).length || (x.expenses || []).length)) lines.push(moneyLines(x, reload));
  const btns = [];
  const act = (p, msg) => async () => { try { await call('maint.act', Object.assign({ ticket_id: x.ticket_id }, p)); toast(msg || t('saved'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); } };
  if (manage && !mine && (x.status === 'new' || x.status === 'open')) {
    if (x.status === 'new') ['urgent', 'important', 'normal'].forEach((u) => btns.push(h('button.btn' + (u === 'urgent' ? '.danger' : '.secondary'), { type: 'button', onclick: act({ act: 'receive', urgency: u }) }, '✓ ' + t('mt_receive_as', { u: t('mt_u_' + u) }))));
    else {
      btns.push(h('button.btn.secondary', { type: 'button', onclick: () => replyDialog(x, reload) }, '💬 ' + t('mt_answer')));
      btns.push(h('button.btn', { type: 'button', onclick: () => doneDialog(x, reload) }, '🔧 ' + t('mt_done')));
      btns.push(h('button.btn.secondary', { type: 'button', onclick: () => askMoneyDialog(x, reload) }, '💵 ' + t('mt_ask_money')));
      btns.push(h('button.btn.secondary', { type: 'button', onclick: () => expenseDialog(x, reload) }, '🧾 ' + t('mt_expense')));
    }
    btns.push(h('button.btn.secondary', { type: 'button', onclick: async () => {
      const reason = h('input.input', { placeholder: t('mt_close_ph') });
      if (!(await dialog((close) => [h('h3', t('mt_close_q')), reason, actions(close, t('mt_close'))]))) return;
      act({ act: 'close', reason: reason.value })();
    } }, '🔒 ' + t('mt_close')));
  }
  if (manage && !mine && x.status === 'done') btns.push(h('button.btn.secondary', { type: 'button', onclick: () => expenseDialog(x, reload) }, '🧾 ' + t('mt_expense')));
  if (x.reporter === Data.user.user_id) {
    const conf = (p) => async () => { try { await call('maint.confirm', Object.assign({ ticket_id: x.ticket_id }, p)); toast(t('saved'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); } };
    if (x.status === 'done') {
      btns.push(h('button.btn', { type: 'button', onclick: conf({ ok: true }) }, '✓ ' + t('mt_confirm_ok')));
      btns.push(h('button.btn.danger', { type: 'button', onclick: async () => {
        const note = h('input.input', { placeholder: t('mt_still_ph') });
        if (!(await dialog((close) => [h('h3', t('mt_still_broken')), note, actions(close, t('mt_send'), true)]))) return;
        conf({ ok: false, note: note.value })();
      } }, '✗ ' + t('mt_still_broken')));
    }
    if (x.status === 'new') btns.push(h('button.btn.secondary', { type: 'button', onclick: conf({ cancel: true }) }, t('mt_cancel')));
  }
  return h('div.fl-row', { class: x.status === 'new' || overdue(x) ? 'open' : '' }, ...lines, btns.length ? h('div.form-actions.mt-btns', ...btns) : '');
}

function moneyLines(x, reload) {
  const spent = (x.expenses || []).reduce((a, e) => a + e.amount, 0);
  const got = (x.money || []).filter((m) => m.status === 'paid').reduce((a, m) => a + m.amount, 0);
  return h('div.mt-money',
    ...(x.money || []).map((m) => h('div', '💵 ' + fmtNum(m.amount) + ' ' + t('ol_qr') + ' · ' + m.reason + ' · ', h('b', t('mt_m_' + m.status)), m.note ? ' – ' + m.note : '',
      Data.can('maint.money') && (m.status === 'pending' || m.status === 'approved') ? moneyButtons(m, reload) : '')),
    ...(x.expenses || []).map((e) => h('div', '🧾 ' + e.item + ' · ' + fmtNum(e.amount) + ' ' + t('ol_qr') + (e.supplier ? ' · ' + e.supplier : '') + ' · ' + when(e.at), e.photos.length ? photoButton(e.photos) : '')),
    spent || got ? h('small.muted', t('mt_balance', { got: fmtNum(got), spent: fmtNum(spent), rest: fmtNum(got - spent) })) : '');
}
function moneyButtons(m, reload) {
  const go = (p) => async () => { try { await call('maint.money', Object.assign({ req_id: m.req_id }, p)); toast(t('saved'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); } };
  return h('span.mt-mbtns',
    m.status === 'pending' ? h('button.link', { type: 'button', onclick: go({ act: 'approve' }) }, t('mt_m_approve')) : '',
    h('button.link', { type: 'button', onclick: go({ act: 'paid' }) }, t('mt_m_pay')),
    m.status === 'pending' ? h('button.link', { type: 'button', onclick: async () => {
      const note = h('input.input', { placeholder: t('note') });
      if (!(await dialog((close) => [h('h3', t('mt_m_reject')), note, actions(close, t('mt_m_reject'), true)]))) return;
      go({ act: 'reject', note: note.value })();
    } }, t('mt_m_reject')) : '');
}

async function replyDialog(x, reload) {
  const kind = h('select.input', h('option', { value: 'visit' }, t('mt_visit')), h('option', { value: 'fix' }, t('mt_fix')));
  const date = h('input.input', { type: 'date', value: x.visit_date || new Date().toISOString().slice(0, 10) });
  const text = h('textarea.input', { rows: 2, placeholder: t('mt_answer_ph'), value: x.reply_text || '' });
  const dateF = field(t('mt_visit_date'), date);
  kind.addEventListener('change', () => { dateF.hidden = kind.value !== 'visit'; });
  if (!(await dialog((close) => [h('h3', t('mt_answer') + ' · ' + x.ticket_id), field(t('mt_answer_kind'), kind), dateF, field(t('mt_answer_text'), text), actions(close, t('mt_send'))]))) return;
  try { await call('maint.act', { ticket_id: x.ticket_id, act: 'reply', kind: kind.value, visit_date: date.value, text: text.value }); toast(t('saved'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); }
}
async function doneDialog(x, reload) {
  const result = h('select.input', ['full', 'partial', 'none'].map((r) => h('option', { value: r }, t('mt_r_' + r))));
  const note = h('textarea.input', { rows: 2, placeholder: t('mt_done_ph') });
  if (!(await dialog((close) => [h('h3', t('mt_done') + ' · ' + x.ticket_id), field(t('mt_result'), result), field(t('note'), note), h('small.muted', t('mt_done_help')), actions(close)]))) return;
  try { await call('maint.act', { ticket_id: x.ticket_id, act: 'done', result: result.value, note: note.value }); toast(t('saved'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); }
}
async function askMoneyDialog(x, reload) {
  const amount = h('input.input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0 });
  const reason = h('input.input', { placeholder: t('mt_money_reason_ph') });
  if (!(await dialog((close) => [h('h3', t('mt_ask_money') + ' · ' + x.ticket_id), field(t('fl_amount'), amount), field(t('mt_money_reason'), reason), actions(close, t('mt_send'))]))) return;
  try { await call('maint.askMoney', { ticket_id: x.ticket_id, amount: amount.value, reason: reason.value }); toast(t('mt_money_sent'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); }
}
async function expenseDialog(x, reload) {
  const item = h('input.input', { placeholder: t('mt_exp_item_ph') });
  const amount = h('input.input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0 });
  const supplier = h('input.input');
  const pic = photoPicker(1, t('fl_photo_receipt'));
  if (!(await dialog((close) => [h('h3', t('mt_expense') + ' · ' + x.ticket_id), field(t('mt_exp_item'), item), field(t('fl_amount'), amount), field(t('mt_exp_supplier'), supplier), pic.el, actions(close)]))) return;
  try { await call('maint.expense', { client_id: newId(), ticket_id: x.ticket_id, item: item.value, amount: amount.value, supplier: supplier.value, photo: pic.photos[0] || '' }); toast(t('saved'), 'ok'); reload(); } catch (e) { toast(errText(e), 'err'); }
}

let filter = 'active';
let search = '';
function tickets(box, mine) {
  const body = h('div');
  const reload = () => call('maint.list', { mine }).then((d) => { listCache = { mine, d }; if (box.isConnected) show(); }).catch((e) => { if (!listCache) body.replaceChildren(h('p.empty', errText(e))); });
  const sel = h('select.input', ['active', 'new', 'open', 'done', 'closed', 'all'].map((k) => h('option', { value: k }, t('mt_f_' + k))));
  sel.value = filter;
  const q = h('input.input', { type: 'search', placeholder: t('mt_search'), value: search });
  const list = h('div.fl-list');
  const show = () => {
    const d = listCache && listCache.mine === mine ? listCache.d : [];
    const s = search.toLowerCase();
    const rows = d.filter((x) => (filter === 'all' || (filter === 'active' ? x.status !== 'closed' : x.status === filter))
      && (!s || [x.ticket_id, x.place_name, placeName(x.place, x.place_name), x.asset_name, catName(x.fault), x.description, x.reporter_name].join(' ').toLowerCase().includes(s)));
    // the urgent and late first, then the newest
    const rank = (x) => (x.status === 'new' ? 0 : overdue(x) ? 1 : x.urgency === 'urgent' && x.status === 'open' ? 2 : 3);
    rows.sort((a, b) => rank(a) - rank(b) || String(b.created_at).localeCompare(String(a.created_at)));
    list.replaceChildren(...(rows.length ? rows.map((x) => ticketRow(x, reload, mine)) : [h('p.empty', t('mt_none'))]));
  };
  sel.addEventListener('change', () => { filter = sel.value; show(); });
  q.addEventListener('input', () => { search = q.value; show(); });
  body.replaceChildren(h('div.form-grid', field(t('mt_show'), sel), field(t('mt_search'), q)), list);
  box.replaceChildren(body);
  if (listCache && listCache.mine === mine) show(); else list.replaceChildren(h('p.empty', t('refreshing')));
  if (!cache) loadPlaces().catch(() => {});
  reload();
}

// ---------- the accountant: the money asked, then the expenses to review
function moneyTab(box) {
  const body = h('div');
  box.replaceChildren(body);
  const draw = (d) => {
    const asked = [], spent = [];
    d.forEach((x) => { (x.money || []).forEach((m) => asked.push({ x, m })); (x.expenses || []).forEach((e) => spent.push({ x, e })); });
    asked.sort((a, b) => (a.m.status === 'pending' ? 0 : a.m.status === 'approved' ? 1 : 2) - (b.m.status === 'pending' ? 0 : b.m.status === 'approved' ? 1 : 2) || String(b.m.created_at).localeCompare(String(a.m.created_at)));
    spent.sort((a, b) => String(b.e.at).localeCompare(String(a.e.at)));
    const reload = () => call('maint.list', {}).then((n) => { if (box.isConnected) draw(n); });
    const tot = (st) => asked.filter((a) => a.m.status === st).reduce((s, a) => s + a.m.amount, 0);
    body.replaceChildren(
      h('div.mt-sums', h('div', h('small', t('mt_m_pending')), h('b', fmtNum(tot('pending')))), h('div', h('small', t('mt_m_approved')), h('b', fmtNum(tot('approved')))),
        h('div', h('small', t('mt_m_paid')), h('b', fmtNum(tot('paid')))), h('div', h('small', t('mt_spent')), h('b', fmtNum(spent.reduce((s, a) => s + a.e.amount, 0))))),
      h('h3', t('mt_money_asked')),
      asked.length ? h('div.table-wrap', h('table', h('thead', h('tr', ...['mt_ticket', 'mt_place', 'fl_amount', 'mt_money_reason', 'mt_state', ''].map((k) => h('th', k ? t(k) : '')))),
        h('tbody', asked.map(({ x, m }) => h('tr', h('td.num', x.ticket_id), h('td', placeName(x.place, x.place_name) + (x.asset_name ? ' · ' + x.asset_name : '')), h('td.num', fmtNum(m.amount)),
          h('td', m.reason), h('td', h('b', t('mt_m_' + m.status)), m.note ? h('small.muted', ' – ' + m.note) : ''),
          h('td', m.status === 'pending' || m.status === 'approved' ? moneyButtons(m, reload) : '')))))) : h('p.empty', t('mt_none')),
      h('h3', t('mt_expenses')),
      spent.length ? h('div.table-wrap', h('table', h('thead', h('tr', ...['date', 'mt_ticket', 'mt_place', 'mt_exp_item', 'mt_exp_supplier', 'fl_amount', ''].map((k) => h('th', k ? t(k) : '')))),
        h('tbody', spent.map(({ x, e }) => h('tr', h('td', when(e.at)), h('td.num', x.ticket_id), h('td', placeName(x.place, x.place_name)), h('td', e.item), h('td', e.supplier),
          h('td.num', fmtNum(e.amount)), h('td', e.photos.length ? photoButton(e.photos) : '—')))))) : h('p.empty', t('mt_none')));
  };
  body.replaceChildren(h('p.empty', t('refreshing')));
  call('maint.list', {}).then((d) => { if (box.isConnected) draw(d); }).catch((e) => body.replaceChildren(h('p.empty', errText(e))));
}

// ---------- the equipment of each place (maintenance)
function assets(box) {
  withPlaces(box, (d) => {
    const place = h('select.input', d.places.map((p) => h('option', { value: p.id }, placeName(p.id, p.name))));
    const list = h('div');
    const edit = async (a) => {
      const name = h('input.input', { value: a ? a.name : '' });
      const active = h('input', { type: 'checkbox', checked: true });
      if (!(await dialog((close) => [h('h3', a ? a.name : t('mt_asset_new')), field(t('mt_asset_name'), name), a ? h('label', active, ' ' + t('fl_active')) : '', actions(close)]))) return;
      try {
        await call('maint.saveAsset', a ? { asset_id: a.asset_id, name: name.value, active: active.checked } : { place: place.value, name: name.value });
        toast(t('saved'), 'ok');
        await loadPlaces(); show();
      } catch (e) { toast(errText(e), 'err'); }
    };
    const show = () => {
      const rows = cache.assets.filter((a) => a.place === place.value);
      list.replaceChildren(rows.length ? h('ul.mt-assets', rows.map((a) => h('li', h('span', a.name), h('button.link', { type: 'button', onclick: () => edit(a) }, t('wk_edit_btn'))))) : h('p.empty', t('mt_no_assets')));
    };
    place.addEventListener('change', show);
    box.replaceChildren(h('small.muted', t('mt_assets_help')), h('div.form-grid', field(t('mt_place'), place),
      h('div.field', h('label', ' '), h('button.btn.secondary', { type: 'button', onclick: () => edit(null) }, '+ ' + t('mt_asset_new')))), list);
    show();
  });
}

// ---------- the kinds of fault (maintenance)
function faults(box) {
  withPlaces(box, (d) => {
    const area = h('textarea.input', { rows: 10, dir: 'auto' });
    area.value = d.faults.join('\n');
    const save = async () => {
      try { await call('maint.setFaults', { list: area.value.split('\n') }); toast(t('saved'), 'ok'); await loadPlaces(); } catch (e) { toast(errText(e), 'err'); }
    };
    box.replaceChildren(h('small.muted', t('mt_faults_help')), area, h('div.form-actions', h('button.btn', { type: 'button', onclick: save }, t('save'))));
  });
}

// ---------- the figures (management)
let from = '', to = '';
function stats(box) {
  const body = h('div');
  const f = h('input.input', { type: 'date', value: from }), tt = h('input.input', { type: 'date', value: to });
  const out = h('div');
  const draw = (d) => {
    const rows = d.filter((x) => (!from || String(x.created_at).slice(0, 10) >= from) && (!to || String(x.created_at).slice(0, 10) <= to));
    const count = (key) => {
      const m = {};
      rows.forEach((x) => { const k = key(x); if (k) m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10);
    };
    const cost = {};
    rows.forEach((x) => { const k = (x.asset_name || t('mt_no_asset')) + ' · ' + placeName(x.place, x.place_name); const c = (x.expenses || []).reduce((s, e) => s + e.amount, 0); if (c) cost[k] = (cost[k] || 0) + c; });
    const avg = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
    const recv = avg(rows.map((x) => hours(x.created_at, x.received_at)).filter((v) => v !== null));
    const fix = avg(rows.map((x) => hours(x.created_at, x.done_at)).filter((v) => v !== null));
    const doneRows = rows.filter((x) => x.result || x.confirmed);
    const full = doneRows.filter((x) => x.result === 'full' || x.confirmed === 'yes').length;
    const late = rows.filter(overdue);
    const hrs = (v) => (v === null ? '—' : v < 48 ? fmtNum(Math.round(v * 10) / 10) + ' ' + t('mt_hours') : fmtNum(Math.round(v / 2.4) / 10) + ' ' + t('mt_days'));
    const table = (title, list, unit) => h('div', h('h3', title), list.length ? h('table.mt-top', h('tbody', list.map(([k, v]) => h('tr', h('td', k), h('td.num', fmtNum(v) + (unit ? ' ' + unit : '')))))) : h('p.empty', t('mt_none')));
    out.replaceChildren(
      h('div.mt-sums', h('div', h('small', t('mt_total')), h('b', String(rows.length))), h('div', h('small', t('mt_open_now')), h('b', String(rows.filter((x) => x.status !== 'closed').length))),
        h('div', h('small', t('mt_avg_receive')), h('b', hrs(recv))), h('div', h('small', t('mt_avg_fix')), h('b', hrs(fix))),
        h('div', h('small', t('mt_full_rate')), h('b', doneRows.length ? Math.round((full / doneRows.length) * 100) + '%' : '—')), h('div', h('small', t('mt_late')), h('b', String(late.length)))),
      h('div.mt-stats',
        table(t('mt_by_place'), count((x) => placeName(x.place, x.place_name))),
        table(t('mt_by_asset'), count((x) => (x.asset_name ? x.asset_name + ' · ' + placeName(x.place, x.place_name) : ''))),
        table(t('mt_by_fault'), count((x) => catName(x.fault))),
        table(t('mt_by_cost'), Object.entries(cost).sort((a, b) => b[1] - a[1]).slice(0, 10), t('ol_qr'))),
      late.length ? h('div', h('h3', '⏰ ' + t('mt_late')), ...late.map((x) => ticketRow(x, () => stats(box), false))) : '');
  };
  let data = null;
  const redo = () => { from = f.value; to = tt.value; if (data) draw(data); };
  f.addEventListener('change', redo); tt.addEventListener('change', redo);
  body.replaceChildren(h('div.form-grid', field(t('from'), f), field(t('to'), tt)), out);
  box.replaceChildren(body);
  out.replaceChildren(h('p.empty', t('refreshing')));
  call('maint.list', {}).then((d) => { data = d; if (box.isConnected) draw(d); }).catch((e) => out.replaceChildren(h('p.empty', errText(e))));
}
