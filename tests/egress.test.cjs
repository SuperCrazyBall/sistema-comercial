const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { createHistoryStore, createSyncController, mapLimited } = require('../sync-core');
const v1 = '2026-10-30T12:00:00.123456+00:00';
const v2 = '2026-10-30T12:01:00.123457+00:00';
function summary(id, version = v1, deleted = false) {
  return { id: String(id), updated_at: version, deleted_at: deleted ? version : null,
    summary: { id: String(id), numero: String(id), filial: 'A', savedAt: version,
      __counts: { total: 2, sent: 1, cut: 1, partial: 0 } } };
}
function detail(id, version = v1) {
  return { id: String(id), updated_at: version, data: { id: String(id), numero: String(id), products: [{ status: 'sent', codigo: '10', vlTotal: '3,00' }, { status: 'cut', codigo: '20', vlTotal: '5,00' }] } };
}
async function cache() {
  const indexedDB = new IDBFactory();
  const store = createHistoryStore({ indexedDB });
  await store.init('operator', []);
  return { store, indexedDB };
}
test('metadata sync does not fetch products; cache validates exact updated_at and survives reload', async () => {
  const { store, indexedDB } = await cache();
  await store.apply([summary(1)], v1, [], true);
  assert.equal(store.list()[0].__summary, true);
  let downloads = 0;
  const fetch = async () => { downloads++; return detail(1); };
  await Promise.all([store.ensure(1, fetch), store.ensure(1, fetch)]);
  assert.equal(downloads, 1);
  await store.ensure(1, fetch);
  assert.equal(downloads, 1);
  const reopened = createHistoryStore({ indexedDB });
  await reopened.init('operator', []);
  assert.equal((await reopened.ensure(1, fetch, true)).products.length, 2);
  await reopened.apply([summary(1, v2)], v2, [], false);
  await assert.rejects(reopened.ensure(1, fetch, true), /Conecte-se/);
  assert.equal(reopened.list()[0].__summary, true);
  assert.equal(reopened.cursor(), v2);
});
test('deletions and clear propagate and pending local writes remain intact', async () => {
  const { store } = await cache();
  await store.apply([summary(1), summary(2)], v1, [], true);
  await store.setLocal([detail(1).data, detail(2).data]);
  await store.apply([summary(1, v2, true), summary(2, v2, true)], v2, [{ type: 'upsert', id: '2' }], false);
  assert.deepEqual(store.list().map(x => x.id), ['2']);
  assert.equal(store.list()[0].products.length, 2);
  await store.apply([summary(2, v2, true)], v2, [], false);
  assert.deepEqual(store.list(), []);
  await store.setLocal([]);
  await store.apply([summary(1)], v1, [{ type: 'clear' }], true);
  assert.deepEqual(store.list(), []);
});
test('full reconciliation removes absent records and a summary cannot overwrite detail cache', async () => {
  const { store } = await cache();
  await store.apply([summary(1), summary(2)], v1, [], true);
  await store.ensure(1, async () => detail(1));
  await store.apply([summary(1)], v1, [], true);
  assert.equal(store.list().length, 1);
  await store.setLocal(store.list());
  assert.equal((await store.ensure(1, null, true)).products.length, 2);
});
test('legacy records migrate once and keep offline details; cache is scoped to session owner', async () => {
  const indexedDB = new IDBFactory();
  const first = createHistoryStore({ indexedDB });
  await first.init('first', [detail(1).data]);
  assert.equal((await first.ensure(1, null, true)).products.length, 2);
  const second = createHistoryStore({ indexedDB });
  await second.init('second', []);
  assert.equal(second.list().length, 0);
  await first.setLocal([]);
  const reload = createHistoryStore({ indexedDB });
  await reload.init('first', [detail(1).data]);
  assert.equal(reload.list().length, 0);
});
test('remote reconciliation cannot overwrite a local edit made while persistence is pending', async () => {
  const { store } = await cache();
  await store.apply([summary(1)], v1, [], true);
  const syncing = store.apply([summary(1, v2)], v2, [], false);
  const writing = store.setLocal([Object.assign(detail(1).data, { numero: 'local edit' })]);
  await Promise.all([syncing, writing]);
  assert.equal(store.list()[0].numero, 'local edit');
});
test('detail fetch rejects a stale response after the remote version changed', async () => {
  const { store } = await cache();
  await store.apply([summary(1, v2)], v2, [], true);
  await assert.rejects(store.ensure(1, async () => detail(1)), /atualizado/);
  assert.equal(store.list()[0].__summary, true);
});
test('acknowledged saves keep their details available offline without downloading again', async () => {
  const { store } = await cache();
  await store.setLocal([detail(1).data]);
  await store.acknowledge(Object.assign({}, detail(1).data, { updated_at: v1 }));
  await store.apply([summary(1)], v1, [], false);
  assert.equal((await store.ensure(1, null, true)).products.length, 2);
  const newer = Object.assign({}, detail(1).data, { numero: 'new local edit' });
  await store.setLocal([newer]);
  await store.acknowledge(Object.assign({}, detail(1).data, { updated_at: v2 }));
  assert.equal(store.list()[0].numero, 'new local edit');
});
test('different microsecond versions invalidate a detail even in the same millisecond', async () => {
  const { store } = await cache();
  await store.apply([summary(1)], v1, [], true);
  await store.ensure(1, async () => detail(1));
  const microsecondVersion = v1.replace('123456', '123457');
  await store.apply([summary(1, microsecondVersion)], microsecondVersion, [], false);
  await assert.rejects(store.ensure(1, null, true), /Conecte-se/);
});
test('report hydration uses at most three simultaneous requests and fails as a whole offline', async () => {
  let active = 0, max = 0;
  const values = await mapLimited(Array.from({ length: 12 }, (_, i) => i), async i => {
    active++; max = Math.max(active, max);
    await new Promise(resolve => setImmediate(resolve)); active--; return i * 2;
  });
  assert.equal(max, 3); assert.equal(values.length, 12);
  await assert.rejects(mapLimited([1, 2, 3, 4], async i => { if (i === 2) throw new Error('offline'); return i; }), /offline/);
});
function harness(fetch) {
  const window = { SUPABASE_CONFIG: { url: 'https://test.supabase.co', anonKey: 'public-key' } };
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const context = vm.createContext({ window, localStorage, fetch, console, Date, URLSearchParams, Event: class {}, setTimeout, clearTimeout });
  window.localStorage = localStorage;
  vm.runInContext(fs.readFileSync(require.resolve('../data-provider.js'), 'utf8'), context);
  return { context, provider: window.ComercialDataProvider, window };
}
function response(body) { return { ok: true, json: async () => body }; }
test('provider cursor pages 451 same-timestamp rows without offset or lost IDs', async () => {
  const paths = [], rows = Array.from({ length: 451 }, (_, i) => summary(String(i).padStart(4, '0')));
  let page = 0;
  const { provider } = harness(async url => { paths.push(decodeURIComponent(url)); return response(rows.slice(page++ * 200, page * 200)); });
  const result = await provider.listHistoricoSummaries('transferencia', v1);
  assert.equal(result.length, 451); assert.equal(new Set(result.map(x => x.id)).size, 451);
  assert.equal(paths.length, 3);
  assert.match(paths[1], /updated_at.eq.2026-10-30T12:00:00.123456\+00:00/);
  assert.match(paths[1], /id.gt."0199"/);
  assert.match(paths[0], /updated_at=gte./);
  assert.ok(paths.every(path => !path.includes('offset') && !path.includes('deleted_at=is.null')));
});
test('failed second page rejects instead of acknowledging a partial history', async () => {
  let count = 0;
  const { provider } = harness(async () => { if (count++) throw new Error('offline'); return response(Array.from({ length: 200 }, (_, i) => summary(i))); });
  await assert.rejects(provider.listHistoricoSummaries('transferencia', null), /offline/);
});
test('provider refuses saving summaries and never sends client updated_at on history writes', async () => {
  const calls = [];
  const { provider } = harness(async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return response(null); });
  assert.throws(() => provider.saveHistoricoRecord('transferencia', { id: '1', __summary: true }), /resumo/);
  await provider.saveHistoricoRecord('transferencia', Object.assign(detail(1).data, { updated_at: v1 }), 'test');
  await provider.deleteHistoricoRecord('transferencia', '1', 'test');
  await provider.clearHistoricoRecords('transferencia', 'test');
  assert.ok(calls.every(c => !Object.hasOwn(c.body, 'updated_at')));
  assert.ok(!Object.hasOwn(calls[0].body.data, 'updated_at'));
});
test('singleton reads metadata only when unchanged; content race stores actual response version', async () => {
  const metadata = new Map(); let calls = [], version = v1;
  const fakeStore = { init: async () => {}, readMeta: key => metadata.get(key), writeMeta: async (key, val) => metadata.set(key, val) };
  const provider = { sessionInfo: () => ({ userId: '1' }),
    saveSupplierMemory: async () => {}, saveFinanceLatest: async () => {},
    request: async path => { calls.push(path); return path.includes('select=*') ? [{ updated_at: version, ts: 1, data: { products: [] } }] : [{ updated_at: version }]; }
  };
  const window = { ComercialDataProvider: provider, ComercialSync: { createHistoryStore: () => fakeStore, createSyncController() {} }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../egress-provider.js'), 'utf8'), { window, localStorage: { getItem: () => null }, navigator: { onLine: true }, Date, console });
  await provider.getSupplierMemory(); await provider.getSupplierMemory();
  assert.equal(calls.filter(x => x.includes('select=*')).length, 1);
  assert.equal(calls.length, 3);
  version = v2;
  await provider.getSupplierMemory();
  assert.equal(calls.filter(x => x.includes('select=*')).length, 2);
  await provider.saveSupplierMemory({}); await provider.getSupplierMemory();
  assert.equal(calls.filter(x => x.includes('select=*')).length, 3);
});
test('singleton version changed between metadata and content is acknowledged using content version', async () => {
  const metadata = new Map(); let metadataCalls = 0, contentCalls = 0;
  const fakeStore = { init: async () => {}, readMeta: key => metadata.get(key), writeMeta: async (key, val) => metadata.set(key, val) };
  const provider = { sessionInfo: () => ({ userId: '1' }), saveSupplierMemory: async () => {}, saveFinanceLatest: async () => {},
    request: async path => {
      if (path.includes('select=*')) { contentCalls++; return [{ updated_at: v2, analysis: { records: [] }, ts: 2 }]; }
      return [{ updated_at: metadataCalls++ ? v2 : v1 }];
    }
  };
  const window = { ComercialDataProvider: provider, ComercialSync: { createHistoryStore: () => fakeStore, createSyncController() {} }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../egress-provider.js'), 'utf8'), { window, localStorage: { getItem: () => null }, navigator: { onLine: true }, Date, console });
  const first = await provider.getFinanceLatest(); const second = await provider.getFinanceLatest();
  assert.equal(first.ts, 2); assert.equal(second.ts, 2); assert.equal(contentCalls, 1);
});
function fakeClock() {
  let now = 1, id = 0; const tasks = new Map();
  return { now: () => now, setTimeout(fn, delay) { const key = ++id; tasks.set(key, { fn, time: now + delay }); return key; },
    clearTimeout(key) { tasks.delete(key); }, async advance(ms) { now += ms; for (const [key, t] of [...tasks]) if (t.time <= now) { tasks.delete(key); t.fn(); } for (let i = 0; i < 12; i++) await Promise.resolve(); }, tasks };
}
test('scheduler uses 60s fallback, 5min connected, visibility reconciliation and logout cleanup', async () => {
  const clock = fakeClock(), listeners = new Map(), runs = [];
  const doc = { hidden: false, addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) };
  const controller = createSyncController({ document: doc, clock, now: clock.now, run: async full => runs.push(full) });
  controller.start(); await clock.advance(0);
  assert.deepEqual(runs, [true]);
  await clock.advance(59999); assert.equal(runs.length, 1);
  await clock.advance(1); assert.equal(runs.length, 2); assert.equal(runs[1], false);
  controller.status('SUBSCRIBED'); await clock.advance(150);
  const before = runs.length;
  await clock.advance(299999); assert.equal(runs.length, before);
  await clock.advance(1); assert.equal(runs.length, before + 1);
  doc.hidden = true; listeners.get('visibilitychange')();
  await clock.advance(600000); assert.equal(runs.length, before + 1);
  doc.hidden = false; listeners.get('visibilitychange')(); await clock.advance(150);
  assert.equal(runs.at(-1), true);
  controller.stop(); assert.equal(clock.tasks.size, 0); assert.equal(listeners.size, 0);
});
test('realtime bursts are coalesced and do not overlap active work', async () => {
  const clock = fakeClock(); let finish, count = 0, active = 0, max = 0;
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const controller = createSyncController({ document: doc, clock, now: clock.now, run: async () => {
    count++; active++; max = Math.max(max, active); await new Promise(resolve => { finish = resolve; }); active--;
  } });
  controller.start(); await clock.advance(0);
  for (let i = 0; i < 20; i++) controller.event(false);
  await clock.advance(150); assert.equal(count, 1);
  finish(); await clock.advance(0); await clock.advance(150);
  assert.equal(count, 2); assert.equal(max, 1); finish(); controller.stop();
});
test('all shipped JS and inline application scripts parse', () => {
  for (const path of ['data-provider.js', 'sync-core.js', 'egress-provider.js', 'history-ui.js', 'modulos/cortes-fornecedores/cortes-fornecedores.js', 'modulos/saldos-cheques/src/app.js']) {
    new vm.Script(fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8'), { filename: path });
  }
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
  assert.match(html.slice(-150), /history-ui.js/);
});
