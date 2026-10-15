/* =====================================================================
   SYNC: keeps S.data in step with the Supabase `records` table.
   Each object in a collection (a task, a comment, a member…) is one row; every other
   top-level key of S.data is one 'meta' row. After each save() the store is diffed
   against what the server last confirmed and only changed rows are written, so two
   people editing different tasks never overwrite each other. Changes from others
   arrive over Realtime and are patched into S.data in place.
   ===================================================================== */
import { uid } from '../core/utils.js';
import { D, S, hooks } from '../core/store.js';
import { sb } from '../core/supabase.js';
import { seed } from '../data/seed.js';
import { toast } from '../ui/toast.js';
import { render } from './render.js';

const TABLE = 'records';
const META = 'meta';
const COLLECTIONS = ['members', 'projects', 'tasks', 'comments', 'activity', 'notifs', 'files', 'events', 'savedViews', 'teams'];
// Newest-first lists: the app unshifts into these, so the server's insertion order is reversed for them.
const NEWEST_FIRST = new Set(['activity', 'notifs', 'files']);
// Per-person keys that stay in this browser.
const LOCAL = new Set(['me', 'recentSearches']);

let synced = new Map(); // row key -> canonical JSON the server holds
let user = null;
let channel = null;
let busy = false;
let again = false;
let retryT = 0;
let renderT = 0;

const rk = (c, id) => c + '\u0000' + id;
/* jsonb does not keep key order, so compare objects by a key-sorted serialisation */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canon(x))).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .filter(k => v[k] !== undefined && typeof v[k] !== 'function')
        .sort()
        .map(k => JSON.stringify(k) + ':' + canon(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v ?? null);
}

/* the store as rows: Map key -> { collection, id, data, json } */
function rowsOf(data) {
  const out = new Map();
  for (const [k, v] of Object.entries(data)) {
    if (LOCAL.has(k) || v === undefined) continue;
    if (COLLECTIONS.includes(k) && Array.isArray(v)) {
      for (const o of v) if (o && o.id != null) out.set(rk(k, o.id), { collection: k, id: String(o.id), data: o, json: canon(o) });
    } else out.set(rk(META, k), { collection: META, id: k, data: v, json: canon(v) });
  }
  return out;
}

/* rows (in server insertion order) back into an S.data object */
function dataOf(rows) {
  const d = {};
  for (const c of COLLECTIONS) d[c] = [];
  for (const r of rows) {
    if (r.collection === META) d[r.id] = r.data;
    else if (COLLECTIONS.includes(r.collection)) d[r.collection][NEWEST_FIRST.has(r.collection) ? 'unshift' : 'push'](r.data);
  }
  return d;
}

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from(TABLE)
      .select('collection,id,data')
      .order('seq')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function insertAll(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(TABLE).insert(rows.slice(i, i + 500).map(({ collection, id, data }) => ({ collection, id, data })));
    if (error) throw error;
  }
}

const nameFromEmail = e =>
  e
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

/* point D().me at the signed-in person's member record, creating it on their first visit */
function adoptMe() {
  const email = (user?.email || '').toLowerCase();
  if (!email) return;
  const d = D();
  let m = d.members.find(x => (x.email || '').toLowerCase() === email);
  if (!m) {
    m = {
      id: uid('m'),
      name: nameFromEmail(email),
      email,
      role: 'Member',
      team: d.members[0]?.team || 'product',
      title: '',
      c: '#6B7280',
      status: 'active',
      last: 0,
      tz: '—',
    };
    d.members.push(m);
  } else if (m.status === 'invited') m.status = 'active';
  d.me = m.id;
  S.prefs.name = m.name;
  S.prefs.title = m.title || '';
}

/* first sign-in on an empty database: start from the sample workspace, owned by this person */
async function bootstrap() {
  const d = seed();
  const owner = d.members.find(m => m.id === d.me);
  owner.email = user.email.toLowerCase();
  owner.name = nameFromEmail(user.email);
  const rows = [...rowsOf(d).values()];
  // insert newest-first lists oldest-first so the server order matches dataOf()
  const order = [];
  for (const r of rows) if (!NEWEST_FIRST.has(r.collection)) order.push(r);
  for (const c of NEWEST_FIRST) order.push(...rows.filter(r => r.collection === c).reverse());
  await insertAll(order);
  return order;
}

function adopt(rows) {
  const d = dataOf(rows);
  d.me = S.data.me;
  d.recentSearches = S.data.recentSearches || [];
  S.data = d;
  synced = new Map([...rowsOf(d)].map(([k, r]) => [k, r.json]));
}

/* load the workspace for the signed-in user; resolves once S.data holds it */
export async function loadWorkspace(u) {
  user = u;
  let rows = await fetchAll();
  if (!rows.length) rows = await bootstrap();
  adopt(rows);
  adoptMe();
  hooks.afterSave = flush;
  subscribe();
  await flush(); // writes the member record when this is someone's first visit
}

/* write everything that differs from what the server holds */
export async function flush() {
  if (!user) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  clearTimeout(retryT);
  if (D().me && !D().members.some(m => m.id === D().me && (m.email || '').toLowerCase() === user.email.toLowerCase())) adoptMe();
  const now = rowsOf(S.data);
  const ups = [...now].filter(([k, r]) => synced.get(k) !== r.json);
  const dels = [...synced.keys()].filter(k => !now.has(k));
  try {
    if (ups.length) {
      const { error } = await sb.from(TABLE).upsert(
        ups.map(([, r]) => ({ collection: r.collection, id: r.id, data: r.data, updated_by: user.id })),
        { onConflict: 'collection,id' },
      );
      if (error) throw error;
      for (const [k, r] of ups) synced.set(k, r.json);
    }
    const byCol = {};
    for (const k of dels) {
      const [c, id] = k.split('\u0000');
      (byCol[c] ||= []).push(id);
    }
    for (const [c, ids] of Object.entries(byCol)) {
      const { error } = await sb.from(TABLE).delete().eq('collection', c).in('id', ids);
      if (error) throw error;
      for (const id of ids) synced.delete(rk(c, id));
    }
    if (S.ui.syncErr) {
      S.ui.syncErr = false;
      toast('Reconnected. All changes are saved.');
    }
  } catch (e) {
    console.error('[sync] save failed', e);
    if (!S.ui.syncErr) toast("Changes couldn't be saved. Retrying…", { kind: 'err' });
    S.ui.syncErr = true;
    retryT = setTimeout(flush, 5000);
  } finally {
    busy = false;
    if (again) {
      again = false;
      flush();
    }
  }
}

export const pending = () => busy || (user && [...rowsOf(S.data)].some(([k, r]) => synced.get(k) !== r.json));

function rerender() {
  clearTimeout(renderT);
  renderT = setTimeout(() => {
    if (!S.ui.auth) render();
  }, 60);
}

/* someone else's change */
function applyRemote(p) {
  const row = p.eventType === 'DELETE' ? p.old : p.new;
  if (!row?.collection || row.id == null) return;
  const { collection: c, id } = row;
  if (c !== META && !COLLECTIONS.includes(c)) return;
  if (c === META && LOCAL.has(id)) return;
  const k = rk(c, id);
  const d = D();
  if (p.eventType === 'DELETE') {
    if (!synced.has(k)) return;
    synced.delete(k);
    if (c === META) delete d[id];
    else d[c] = (d[c] || []).filter(o => String(o.id) !== id);
  } else {
    const json = canon(row.data);
    if (synced.get(k) === json) return; // our own write coming back
    synced.set(k, json);
    if (c === META) d[id] = row.data;
    else {
      const list = d[c] || (d[c] = []);
      const i = list.findIndex(o => String(o.id) === id);
      if (i >= 0) list[i] = row.data;
      else list[NEWEST_FIRST.has(c) ? 'unshift' : 'push'](row.data);
    }
  }
  rerender();
}

/* on (re)connecting, catch up on anything written while the channel was not listening */
async function resync() {
  try {
    await flush();
    adopt(await fetchAll());
    adoptMe();
    rerender();
  } catch (e) {
    console.error('[sync] resync failed', e);
  }
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('records')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, applyRemote)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') resync();
    });
}

addEventListener('beforeunload', e => {
  if (pending()) e.preventDefault();
});
