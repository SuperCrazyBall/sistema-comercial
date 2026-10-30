(function (root) {
  'use strict';

  // One scheduler per resource. A queued event never overlaps an active request.
  function createSyncController(options) {
    var timer, debounce, running = null, queued = false, pending = false, stopped = true, connected = false;
    var lastFull = 0, generation = 0;
    var doc = options.document || root.document;
    var clock = options.clock || root;
    var now = options.now || Date.now;
    function schedule() {
      clock.clearTimeout(timer);
      if (!stopped && !doc.hidden) timer = clock.setTimeout(function () {
        request(connected);
      }, connected ? 300000 : 60000);
    }
    function request(full) {
      if (stopped || doc.hidden || (options.authorized && !options.authorized())) return Promise.resolve();
      queued = queued || !!full;
      if (running) { pending = true; return running; }
      var token = generation;
      var reconcile = queued || !lastFull || now() - lastFull >= 300000;
      queued = false; pending = false;
      running = Promise.resolve().then(function () { return options.run(reconcile); }).then(function () {
        if (token === generation && reconcile) lastFull = now();
      }).catch(function (error) {
        if (options.onError) options.onError(error);
      }).finally(function () {
        running = null;
        if (token !== generation || stopped) return;
        if (pending || queued) event(queued);
        else schedule();
      });
      return running;
    }
    function event(full) {
      if (stopped) return;
      queued = queued || !!full;
      clock.clearTimeout(debounce);
      debounce = clock.setTimeout(function () { request(queued); }, 150);
    }
    function visibility() {
      clock.clearTimeout(timer);
      if (!doc.hidden) event(true);
    }
    return {
      start: function () {
        if (!stopped) return;
        stopped = false; generation++;
        doc.addEventListener('visibilitychange', visibility);
        request(true);
      },
      request: request,
      event: event,
      status: function (status) {
        var wasConnected = connected;
        connected = status === 'SUBSCRIBED';
        if (connected && !wasConnected) event(true);
        schedule();
      },
      stop: function () {
        stopped = true; generation++; queued = false; pending = false;
        clock.clearTimeout(timer); clock.clearTimeout(debounce);
        doc.removeEventListener('visibilitychange', visibility);
      }
    };
  }

  function openCache(indexedDB) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('comercial-cache-v3', 1);
      req.onupgradeneeded = function () {
        ['summaries', 'details', 'meta'].forEach(function (name) {
          req.result.createObjectStore(name, { keyPath: ['scope', 'id'] }).createIndex('scope', 'scope');
        });
      };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onblocked = function () { reject(new Error('Feche outras abas para atualizar o cache.')); };
    });
  }
  function transaction(db, scope, changes) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(['summaries', 'details', 'meta'], 'readwrite');
      changes.forEach(function (change) {
        var store = tx.objectStore(change.store);
        if (change.remove) store.delete([scope, change.id]);
        else store.put({ scope: scope, id: change.id, value: change.value });
      });
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Falha ao persistir cache.')); };
    });
  }
  function readScope(db, scope, name) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(name).objectStore(name).index('scope').getAll(scope);
      req.onsuccess = function () {
        var data = Object.create(null);
        req.result.forEach(function (row) { data[row.id] = row.value; });
        resolve(data);
      };
      req.onerror = function () { reject(req.error); };
    });
  }
  function summarize(item) {
    var summary = Object.assign({}, item), counts = { total: 0, sent: 0, cut: 0, partial: 0 };
    (item.products || []).forEach(function (p) {
      counts.total++;
      if (Object.prototype.hasOwnProperty.call(counts, p.status)) counts[p.status]++;
    });
    delete summary.products;
    summary.__counts = item.__counts || counts;
    return summary;
  }
  function createHistoryStore(options) {
    var db, scope, summaries = Object.create(null), details = Object.create(null), meta = {}, writes = Promise.resolve();
    var inFlight = new Map(), revision = 0;
    function persist(changes) {
      var targetDb = db, targetScope = scope;
      var next = writes.then(function () { return transaction(targetDb, targetScope, changes); });
      writes = next.catch(function (error) { if (options.onError) options.onError(error); });
      return next;
    }
    function list() {
      return Object.keys(summaries).map(function (id) {
        var s = summaries[id], d = details[id];
        return d && (d.local || d.version === s.updated_at)
          ? Object.assign({}, JSON.parse(JSON.stringify(d.data)), { updated_at: s.updated_at })
          : Object.assign({}, s, { __summary: true });
      }).sort(function (a, b) { return String(b.savedAt || '').localeCompare(String(a.savedAt || '')) || String(a.id).localeCompare(String(b.id)); });
    }
    return {
      init: async function (owner, legacy) {
        db = await openCache(options.indexedDB || root.indexedDB); scope = owner;
        var values = await Promise.all(['summaries', 'details', 'meta'].map(function (name) { return readScope(db, scope, name); }));
        summaries = values[0]; details = values[1]; meta = values[2];
        if (!meta.migrated) {
          var changes = [];
          (legacy || []).forEach(function (item) {
            if (!item.id || !Array.isArray(item.products)) return;
            var id = String(item.id);
            summaries[id] = Object.assign(summarize(item), { updated_at: item.updated_at || null });
            details[id] = { data: item, version: item.updated_at || null, local: false };
            changes.push({ store: 'summaries', id: id, value: summaries[id] }, { store: 'details', id: id, value: details[id] });
          });
          changes.push({ store: 'meta', id: 'migrated', value: true });
          await persist(changes); meta.migrated = true;
        }
      },
      list: list,
      cursor: function () { return meta.cursor || null; },
      pendingWrites: function () { return writes; },
      setLocal: function (items) {
        revision++;
        var next = Object.create(null), changes = [];
        items.forEach(function (item) {
          var id = String(item.id);
          next[id] = summarize(item);
          if (Array.isArray(item.products)) {
            var previous = details[id];
            if (!previous || JSON.stringify(previous.data) !== JSON.stringify(item)) {
              details[id] = { data: JSON.parse(JSON.stringify(item)), version: item.updated_at || null, local: true };
              changes.push({ store: 'details', id: id, value: details[id] });
            }
          }
          changes.push({ store: 'summaries', id: id, value: next[id] });
        });
        Object.keys(summaries).forEach(function (id) {
          if (!next[id]) { delete details[id]; changes.push({ store: 'summaries', id: id, remove: true }, { store: 'details', id: id, remove: true }); }
        });
        summaries = next;
        return persist(changes);
      },
      apply: async function (rows, cursor, pending, full) {
        var startRevision = revision;
        var next = Object.assign(Object.create(null), summaries), nextDetails = Object.assign(Object.create(null), details), changes = [], seen = new Set();
        var protectedIds = new Set((pending || []).filter(function (op) { return op.id; }).map(function (op) { return String(op.id); }));
        var clearPending = (pending || []).some(function (op) { return op.type === 'clear'; });
        rows.forEach(function (row) {
          var id = String(row.id); seen.add(id);
          if (clearPending || protectedIds.has(id)) return;
          if (row.deleted_at) {
            delete next[id]; delete nextDetails[id];
            changes.push({ store: 'summaries', id: id, remove: true }, { store: 'details', id: id, remove: true });
          } else {
            next[id] = Object.assign({}, row.summary, { id: row.id, updated_at: row.updated_at });
            changes.push({ store: 'summaries', id: id, value: next[id] });
            // A successful local upsert is acknowledged only after the server version is known.
            if (nextDetails[id] && nextDetails[id].local) {
              delete nextDetails[id]; changes.push({ store: 'details', id: id, remove: true });
            }
          }
        });
        if (full && !clearPending) Object.keys(next).forEach(function (id) {
          if (!seen.has(id) && !protectedIds.has(id)) {
            delete next[id]; delete nextDetails[id];
            changes.push({ store: 'summaries', id: id, remove: true }, { store: 'details', id: id, remove: true });
          }
        });
        changes.push({ store: 'meta', id: 'cursor', value: cursor });
        await persist(changes);
        if (revision === startRevision) { summaries = next; details = nextDetails; meta.cursor = cursor; }
      },
      acknowledge: async function (record) {
        var id = String(record.id), current = details[id];
        function clean(item) { var copy = Object.assign({}, item); delete copy.updated_at; delete copy.__counts; return JSON.stringify(copy); }
        if (!record.updated_at || !current || clean(current.data) !== clean(record)) return;
        revision++;
        var next = { data: Object.assign({}, current.data, { updated_at: record.updated_at }), version: record.updated_at, local: false };
        var summary = Object.assign({}, summaries[id], { updated_at: record.updated_at });
        details[id] = next; summaries[id] = summary;
        await persist([{ store: 'details', id: id, value: next }, { store: 'summaries', id: id, value: summary }]);
      },
      ensure: function (id, fetchDetail, offline) {
        id = String(id);
        var s = summaries[id], cached = details[id];
        if (!s) return Promise.reject(new Error('Orçamento não disponível.'));
        if (cached && (cached.local || cached.version === s.updated_at)) return Promise.resolve(cached.data);
        if (offline) return Promise.reject(new Error('Conecte-se para baixar os detalhes deste orçamento.'));
        if (inFlight.has(id)) return inFlight.get(id);
        var request = Promise.resolve().then(function () { return fetchDetail(id); }).then(async function (row) {
          if (!row || row.deleted_at) throw new Error('Orçamento excluído ou indisponível.');
          // If reconciliation changed the summary during the download, retry on the next action.
          if (!summaries[id] || (summaries[id].updated_at && row.updated_at !== summaries[id].updated_at)) {
            throw new Error('Orçamento atualizado. Aguarde a sincronização e tente novamente.');
          }
          var data = Object.assign({}, row.data, { id: row.id, updated_at: row.updated_at });
          if (!Array.isArray(data.products)) throw new Error('Detalhes incompletos do orçamento.');
          var entry = { data: data, version: row.updated_at, local: false };
          await persist([{ store: 'details', id: id, value: entry }]);
          details[id] = entry; return data;
        }).finally(function () { inFlight.delete(id); });
        inFlight.set(id, request); return request;
      },
      readMeta: function (key) { return meta[key]; },
      writeMeta: async function (key, value) { await persist([{ store: 'meta', id: key, value: value }]); meta[key] = value; }
    };
  }
  async function mapLimited(items, worker, progress) {
    var next = 0, done = 0, results = new Array(items.length), failure;
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async function () {
      while (next < items.length && !failure) {
        var i = next++;
        try { results[i] = await worker(items[i]); if (progress) progress(++done, items.length); }
        catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    return results;
  }
  var api = { createSyncController: createSyncController, createHistoryStore: createHistoryStore, mapLimited: mapLimited, summarize: summarize };
  root.ComercialSync = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
