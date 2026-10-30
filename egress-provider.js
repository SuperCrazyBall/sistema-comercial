(function () {
  'use strict';
  var provider = window.ComercialDataProvider, core = window.ComercialSync;
  var controllers = new Set(), singletonRequests = new Map();
  function newStore() {
    return core.createHistoryStore({ onError: function (error) {
      console.error('Cache local:', error);
      if (window.toast) window.toast('Não foi possível persistir o cache local. ' + error.message, 'err');
    } });
  }
  var store = newStore();
  var initialized = null, owner = null, epoch = 0;
  var originalCreate = core.createSyncController;
  core.createSyncController = function (options) {
    var controller = originalCreate(options), stop = controller.stop;
    controller.stop = function () { stop(); controllers.delete(controller); };
    controllers.add(controller); return controller;
  };
  core.stopAll = function () { controllers.forEach(function (controller) { controller.stop(); }); controllers.clear(); epoch++; };
  provider.historyStore = store;
  provider.initializeCache = function () {
    var user = provider.sessionInfo().userId;
    if (!user) return Promise.reject(new Error('Sessão necessária para abrir o cache.'));
    if (!initialized || owner !== user) {
      owner = user;
      store = newStore(); provider.historyStore = store;
      var legacy = [];
      try { legacy = JSON.parse(localStorage.getItem('vsorcamentos_v2') || '[]'); } catch (_) {}
      if (!Array.isArray(legacy)) legacy = [];
      var targetStore = store;
      initialized = (async function () {
        await targetStore.init(user, legacy);
        var pending = [];
        try { pending = JSON.parse(localStorage.getItem('vsorcamentos_pending_ops_v1') || '[]'); } catch (_) {}
        if (!Array.isArray(pending)) pending = [];
        if (pending.length) {
          var records = targetStore.list();
          pending.forEach(function (op) {
            if (op.type === 'clear') records = [];
            if (op.type === 'delete') records = records.filter(function (r) { return String(r.id) !== String(op.id); });
            if (op.type === 'upsert' && op.record && Array.isArray(op.record.products)) {
              records = records.filter(function (r) { return String(r.id) !== String(op.record.id); });
              records.push(op.record);
            }
          });
          await targetStore.setLocal(records);
        }
        // Free localStorage quota only after the IndexedDB migration committed.
        if (legacy.length) localStorage.removeItem('vsorcamentos_v2');
      })();
    }
    return initialized;
  };
  provider.syncHistoricoSummaries = async function (full, pending) {
    await provider.initializeCache();
    var targetStore = store, token = epoch, cursor = targetStore.cursor();
    var since = !full && cursor ? new Date(Date.parse(cursor) - 300000).toISOString() : null;
    var rows = await provider.listHistoricoSummaries('transferencia', since);
    if (token !== epoch) return;
    // Preserve the original timestamp string (including microseconds) as the watermark.
    rows.forEach(function (row) { if (!cursor || Date.parse(row.updated_at) > Date.parse(cursor) || (Date.parse(row.updated_at) === Date.parse(cursor) && row.updated_at > cursor)) cursor = row.updated_at; });
    await targetStore.apply(rows, cursor, pending(), full || !since);
  };
  provider.ensureHistoricoDetail = async function (id) {
    await provider.initializeCache();
    return store.ensure(id, function (key) { return provider.getHistoricoDetail('transferencia', key); }, navigator.onLine === false);
  };
  provider.ensureHistoricoDetails = async function (items, progress) {
    return core.mapLimited(items, function (item) { return provider.ensureHistoricoDetail(item.id); }, progress);
  };
  function singleton(name, table, keyColumn, keyValue) {
    provider[name] = function () {
      var key = name + ':' + provider.sessionInfo().userId;
      if (singletonRequests.has(key)) return singletonRequests.get(key);
      var task = (async function () {
        await provider.initializeCache();
        var targetStore = store, token = epoch;
        var cached = targetStore.readMeta(key);
        var path = table + '?select=' + keyColumn + ',updated_at&' + keyColumn + '=eq.' + encodeURIComponent(keyValue) + '&limit=1';
        var versions = await provider.request(path);
        if (token !== epoch) throw new Error('Sessão encerrada.');
        if (!versions.length) { await targetStore.writeMeta(key, null); return null; }
        if (cached && cached.version === versions[0].updated_at) return cached.payload;
        // Read the content and its version in the same response, not the metadata version.
        var rows = await provider.request(table + '?select=*&' + keyColumn + '=eq.' + encodeURIComponent(keyValue) + '&limit=1');
        if (token !== epoch) throw new Error('Sessão encerrada.');
        if (!rows.length) return null;
        var row = rows[0];
        var payload = table === 'financeiro_ultima_analise' ? {
          schemaVersion: row.schema_version || 2, ts: row.ts, publishedAt: row.published_at,
          publishedBy: row.published_by, fileName: row.file_name, periodMode: row.period_mode,
          dateFrom: row.date_from, dateTo: row.date_to, analysis: row.analysis, uiSnapshot: row.ui_snapshot
        } : { ts: row.ts, user: row.user_name, data: row.data };
        await targetStore.writeMeta(key, { version: row.updated_at, payload: payload });
        return payload;
      })().finally(function () { singletonRequests.delete(key); });
      singletonRequests.set(key, task); return task;
    };
    var saveName = name.replace(/^get/, 'save'), save = provider[saveName];
    provider[saveName] = async function (payload) {
      await provider.initializeCache();
      var targetStore = store, key = name + ':' + provider.sessionInfo().userId;
      var result = await save(payload);
      await targetStore.writeMeta(key, null);
      return result;
    };
  }
  singleton('getSupplierMemory', 'cortes_fornecedores_memoria', 'sync_key', 'transferencia');
  singleton('getFinanceLatest', 'financeiro_ultima_analise', 'id', 'ultima');
  window.addEventListener('comercial:logout', function () { owner = null; initialized = null; });
})();
