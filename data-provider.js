(function () {
  'use strict';

  var FIREBASE_BASE_URL = 'https://comercial-norte-default-rtdb.firebaseio.com/';
  var ACTIVE_BACKEND = 'firebase';
  var SUPABASE_CONFIG = window.SUPABASE_CONFIG || {
    url: '',
    anonKey: ''
  };

  var SUPABASE_TABLES = {
    historico: {
      table: 'historico_usuarios',
      keyColumn: 'id',
      keyValue: 'transferencia'
    },
    supplierMemory: {
      table: 'cortes_fornecedores_memoria',
      keyColumn: 'id',
      keyValue: 'transferencia'
    },
    financeLatest: {
      table: 'financeiro_ultima_analise',
      keyColumn: 'id',
      keyValue: 'ultima'
    }
  };

  function cleanBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function firebaseUrl(path) {
    return cleanBaseUrl(FIREBASE_BASE_URL) + '/' + String(path || '').replace(/^\/+/, '');
  }

  function supabaseConfigured() {
    return !!(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
  }

  function supabaseUrl(path) {
    return cleanBaseUrl(SUPABASE_CONFIG.url) + '/rest/v1/' + String(path || '').replace(/^\/+/, '');
  }

  function supabaseHeaders(extraHeaders) {
    var headers = {
      apikey: SUPABASE_CONFIG.anonKey,
      Authorization: 'Bearer ' + SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json'
    };

    Object.keys(extraHeaders || {}).forEach(function (key) {
      headers[key] = extraHeaders[key];
    });
    return headers;
  }

  function assertOk(response) {
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    return response;
  }

  function responseText(response) {
    return response.text().then(function (text) {
      try {
        return JSON.stringify(JSON.parse(text));
      } catch (err) {
        return text;
      }
    });
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(assertOk).then(function (response) {
      return response.json();
    });
  }

  function putJson(url, payload) {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(assertOk).then(function () {
      return payload;
    });
  }

  function historicoPath(syncKey) {
    return '/usuarios/' + encodeURIComponent(syncKey || 'transferencia') + '/historico.json';
  }

  function rowToPayload(row) {
    if (!row) return null;
    if (row.payload && typeof row.payload === 'object') return row.payload;
    return {
      ts: row.ts || row.updated_ts || 0,
      user: row.user || row.usuario || row.updated_by || '',
      data: row.data == null ? null : row.data
    };
  }

  function payloadToRow(config, payload) {
    var row = {
      payload: payload,
      ts: payload && payload.ts ? payload.ts : Date.now(),
      updated_at: new Date().toISOString()
    };

    row[config.keyColumn] = config.keyValue;
    if (payload && payload.user) {
      row.user = payload.user;
      row.usuario = payload.user;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) {
      row.data = payload.data;
    }
    return row;
  }

  function getSupabaseSingleton(config) {
    var path;

    if (!supabaseConfigured()) {
      return Promise.reject(new Error('Supabase não configurado.'));
    }
    path = config.table
      + '?select=*'
      + '&' + encodeURIComponent(config.keyColumn) + '=eq.' + encodeURIComponent(config.keyValue)
      + '&limit=1';

    return fetch(supabaseUrl(path), {
      method: 'GET',
      headers: supabaseHeaders()
    }).then(assertOk).then(function (response) {
      return response.json();
    }).then(function (rows) {
      return rowToPayload(Array.isArray(rows) ? rows[0] : null);
    });
  }

  function saveSupabaseSingleton(config, payload) {
    if (!supabaseConfigured()) {
      return Promise.reject(new Error('Supabase não configurado.'));
    }
    return fetch(supabaseUrl(config.table), {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(payloadToRow(config, payload))
    }).then(assertOk).then(function () {
      return payload;
    });
  }

  function useSupabase() {
    return ACTIVE_BACKEND === 'supabase';
  }

  function testSupabaseConnection() {
    var table = 'app_profiles';
    var path = table + '?select=*&limit=1';

    if (!supabaseConfigured()) {
      return Promise.resolve({
        ok: false,
        configured: false,
        status: 0,
        message: 'Supabase ainda não configurado. Preencha supabase-config.js.'
      });
    }

    return fetch(supabaseUrl(path), {
      method: 'GET',
      headers: supabaseHeaders()
    }).then(function (response) {
      return responseText(response).then(function (body) {
        return {
          ok: response.ok,
          configured: true,
          status: response.status,
          statusText: response.statusText,
          table: table,
          authHint: response.ok ? 'Conexão REST funcionando.' : 'Conexão chegou ao Supabase, mas tabela, Auth ou RLS pode ter bloqueado.',
          body: body
        };
      });
    }).catch(function (err) {
      return {
        ok: false,
        configured: true,
        status: 0,
        message: err && err.message ? err.message : 'Não foi possível conectar ao Supabase.'
      };
    });
  }

  var provider = {
    backend: function () {
      return ACTIVE_BACKEND;
    },

    diagnostics: function () {
      return {
        backend: ACTIVE_BACKEND,
        firebaseUrl: FIREBASE_BASE_URL,
        supabaseConfigured: supabaseConfigured(),
        supabaseUrl: SUPABASE_CONFIG.url ? cleanBaseUrl(SUPABASE_CONFIG.url) : '',
        supabaseAuth: 'pendente',
        supabaseTables: {
          historico: SUPABASE_TABLES.historico.table,
          supplierMemory: SUPABASE_TABLES.supplierMemory.table,
          financeLatest: SUPABASE_TABLES.financeLatest.table
        }
      };
    },

    firebaseUrl: firebaseUrl,

    supabaseConfigured: supabaseConfigured,

    testSupabaseConnection: testSupabaseConnection,

    getHistorico: function (syncKey) {
      if (useSupabase()) {
        return getSupabaseSingleton(Object.assign({}, SUPABASE_TABLES.historico, {
          keyValue: syncKey || SUPABASE_TABLES.historico.keyValue
        }));
      }
      return getJson(firebaseUrl(historicoPath(syncKey)));
    },

    saveHistorico: function (syncKey, payload) {
      if (useSupabase()) {
        return saveSupabaseSingleton(Object.assign({}, SUPABASE_TABLES.historico, {
          keyValue: syncKey || SUPABASE_TABLES.historico.keyValue
        }), payload);
      }
      return putJson(firebaseUrl(historicoPath(syncKey)), payload);
    },

    getSupplierMemory: function () {
      if (useSupabase()) {
        return getSupabaseSingleton(SUPABASE_TABLES.supplierMemory);
      }
      return getJson(firebaseUrl('/usuarios/transferencia/cortesFornecedoresMemoria.json'));
    },

    saveSupplierMemory: function (payload) {
      if (useSupabase()) {
        return saveSupabaseSingleton(SUPABASE_TABLES.supplierMemory, payload);
      }
      return putJson(firebaseUrl('/usuarios/transferencia/cortesFornecedoresMemoria.json'), payload);
    },

    getFinanceLatest: function () {
      if (useSupabase()) {
        return getSupabaseSingleton(SUPABASE_TABLES.financeLatest);
      }
      return getJson(firebaseUrl('/financeiro/ultimaAnalise.json'));
    },

    saveFinanceLatest: function (payload) {
      if (useSupabase()) {
        return saveSupabaseSingleton(SUPABASE_TABLES.financeLatest, payload);
      }
      return putJson(firebaseUrl('/financeiro/ultimaAnalise.json'), payload);
    }
  };

  window.FIREBASE_URL = FIREBASE_BASE_URL;
  window.ComercialDataProvider = provider;
})();
