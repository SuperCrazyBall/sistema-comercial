(function () {
  'use strict';

  var FIREBASE_BASE_URL = 'https://comercial-norte-default-rtdb.firebaseio.com/';
  var ACTIVE_BACKEND = 'firebase';
  var DEFAULT_SUPABASE_CONFIG = {
    url: '',
    anonKey: ''
  };
  var SUPABASE_AUTH_STORAGE_KEY = 'comercial_supabase_auth_v1';
  var supabaseSession = loadSupabaseSession();

  var SUPABASE_TABLES = {
    historico: {
      table: 'historico_usuarios',
      keyColumn: 'sync_key',
      keyValue: 'transferencia',
      kind: 'data'
    },
    supplierMemory: {
      table: 'cortes_fornecedores_memoria',
      keyColumn: 'sync_key',
      keyValue: 'transferencia',
      kind: 'data'
    },
    financeLatest: {
      table: 'financeiro_ultima_analise',
      keyColumn: 'id',
      keyValue: 'ultima',
      kind: 'finance'
    }
  };

  function cleanBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function firebaseUrl(path) {
    return cleanBaseUrl(FIREBASE_BASE_URL) + '/' + String(path || '').replace(/^\/+/, '');
  }

  function supabaseConfig() {
    return window.SUPABASE_CONFIG || DEFAULT_SUPABASE_CONFIG;
  }

  function supabaseConfigured() {
    var config = supabaseConfig();
    return !!(config.url && config.anonKey);
  }

  function supabaseUrl(path) {
    return cleanBaseUrl(supabaseConfig().url) + '/rest/v1/' + String(path || '').replace(/^\/+/, '');
  }

  function supabaseAuthUrl(path) {
    return cleanBaseUrl(supabaseConfig().url) + '/auth/v1/' + String(path || '').replace(/^\/+/, '');
  }

  function supabaseHeaders(extraHeaders) {
    var config = supabaseConfig();
    var headers = {
      apikey: config.anonKey,
      Authorization: 'Bearer ' + ((supabaseSession && supabaseSession.access_token) || config.anonKey),
      'Content-Type': 'application/json'
    };

    Object.keys(extraHeaders || {}).forEach(function (key) {
      headers[key] = extraHeaders[key];
    });
    return headers;
  }

  function supabaseAnonHeaders(extraHeaders) {
    var config = supabaseConfig();
    var headers = {
      apikey: config.anonKey,
      Authorization: 'Bearer ' + config.anonKey,
      'Content-Type': 'application/json'
    };

    Object.keys(extraHeaders || {}).forEach(function (key) {
      headers[key] = extraHeaders[key];
    });
    return headers;
  }

  function assertOk(response) {
    if (!response.ok) {
      return responseText(response).then(function (body) {
        throw new Error('HTTP ' + response.status + (body ? ' - ' + body : ''));
      });
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

  function loadSupabaseSession() {
    var raw;

    try {
      raw = window.localStorage ? window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY) : '';
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function saveSupabaseSession(session) {
    supabaseSession = session || null;
    try {
      if (!window.localStorage) return;
      if (supabaseSession) {
        window.localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(supabaseSession));
      } else {
        window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      }
    } catch (err) {}
  }

  function supabaseEmailForOperator(operatorName) {
    var name = String(operatorName || '').trim().toUpperCase();
    var configured = supabaseConfig().authEmails || {};

    if (configured[name]) return configured[name];
    return name.toLowerCase() + '@comercial.local';
  }

  function safeSessionInfo() {
    if (!supabaseSession) {
      return {
        signedIn: false
      };
    }
    return {
      signedIn: true,
      email: supabaseSession.email || '',
      userId: supabaseSession.userId || '',
      expiresAt: supabaseSession.expires_at || null
    };
  }

  function normalizeOperatorName(value) {
    return String(value || '').trim().toUpperCase();
  }

  function normalizeRole(role, operatorName) {
    var normalized = String(role || '').trim().toLowerCase();
    var operator = normalizeOperatorName(operatorName);

    if (normalized === 'master') return 'master';
    if (normalized === 'financeiro') return 'financeiro';
    if (normalized === 'compras') return 'compras';
    if (normalized === 'viewer' || normalized === 'gerente') return 'viewer';
    if (normalized === 'admin' || normalized === 'transferencia') return 'admin';
    if (operator === 'MASTER') return 'master';
    if (operator === 'FINANCEIRO') return 'financeiro';
    if (operator === 'COMPRAS') return 'compras';
    if (operator === 'GERENTE') return 'viewer';
    if (operator === 'TRANSFERENCIA') return 'admin';
    return normalized || 'viewer';
  }

  function normalizeProfile(row, fallbackOperatorName) {
    var operatorName = normalizeOperatorName(
      row && (row.operator_name || row.operator || row.name || row.usuario || row.user)
    ) || normalizeOperatorName(fallbackOperatorName);

    return {
      id: row && row.id ? row.id : '',
      appUserId: row && row.app_user_id ? row.app_user_id : null,
      name: operatorName,
      role: normalizeRole(row && row.role, operatorName),
      raw: row || null
    };
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
    if (Object.prototype.hasOwnProperty.call(row, 'analysis') || Object.prototype.hasOwnProperty.call(row, 'ui_snapshot')) {
      return {
        schemaVersion: row.schema_version || 2,
        ts: row.ts || 0,
        publishedAt: row.published_at || null,
        publishedBy: row.published_by || '',
        fileName: row.file_name || '',
        periodMode: row.period_mode || 'all',
        dateFrom: row.date_from || '',
        dateTo: row.date_to || '',
        analysis: row.analysis || null,
        uiSnapshot: row.ui_snapshot || null
      };
    }
    return {
      ts: row.ts || row.updated_ts || 0,
      user: row.user_name || row.user || row.usuario || row.updated_by || '',
      data: row.data == null ? null : row.data
    };
  }

  function payloadToRow(config, payload) {
    var row;

    payload = payload || {};
    if (config.kind === 'finance') {
      row = {
        id: config.keyValue,
        ts: payload.ts || Date.now(),
        published_at: payload.publishedAt || null,
        published_by: payload.publishedBy || '',
        file_name: payload.fileName || '',
        period_mode: payload.periodMode || 'all',
        date_from: payload.dateFrom || null,
        date_to: payload.dateTo || null,
        schema_version: payload.schemaVersion || 2,
        analysis: payload.analysis || {},
        ui_snapshot: payload.uiSnapshot || {},
        updated_at: new Date().toISOString()
      };
      return row;
    }
    row = {
      ts: payload.ts || Date.now(),
      user_name: payload.user || '',
      data: Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : {},
      updated_at: new Date().toISOString()
    };
    if (config.keyColumn) {
      row[config.keyColumn] = config.keyValue;
    }
    return row;
  }

  function getSupabaseSingleton(config) {
    var path;

    if (!supabaseConfigured()) {
      return Promise.reject(new Error('Supabase não configurado.'));
    }
    path = config.table + '?select=*&limit=1';
    if (config.keyColumn) {
      path += '&' + encodeURIComponent(config.keyColumn) + '=eq.' + encodeURIComponent(config.keyValue);
    } else {
      path += '&order=updated_at.desc';
    }

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
    return fetch(supabaseUrl(config.table + (config.keyColumn ? '?on_conflict=' + encodeURIComponent(config.keyColumn) : '')), {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: config.keyColumn ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' }),
      body: JSON.stringify(payloadToRow(config, payload))
    }).then(assertOk).then(function () {
      return payload;
    });
  }

  function useSupabase() {
    return ACTIVE_BACKEND === 'supabase';
  }

  function payloadSummary(payload) {
    var data = payload && payload.data;
    var analysis = payload && payload.analysis;
    var uiSnapshot = payload && payload.uiSnapshot;
    var memory = data || {};

    return {
      exists: !!payload,
      ts: payload && payload.ts ? payload.ts : null,
      user: payload && (payload.user || payload.publishedBy) ? (payload.user || payload.publishedBy) : '',
      historicoItems: Array.isArray(data) ? data.length : null,
      supplierCount: Array.isArray(memory.suppliers) ? memory.suppliers.length : null,
      supplierCodeRules: Array.isArray(memory.codeRules) ? memory.codeRules.length : (memory.codeRules ? Object.keys(memory.codeRules).length : null),
      supplierAliasRules: Array.isArray(memory.aliasRules) ? memory.aliasRules.length : (memory.aliasRules ? Object.keys(memory.aliasRules).length : null),
      supplierTokenRules: Array.isArray(memory.tokenRules) ? memory.tokenRules.length : (memory.tokenRules ? Object.keys(memory.tokenRules).length : null),
      supplierIgnoredWarnings: Array.isArray(memory.ignoredWarnings) ? memory.ignoredWarnings.length : (memory.ignoredWarnings ? Object.keys(memory.ignoredWarnings).length : null),
      financeRecords: analysis && Array.isArray(analysis.records) ? analysis.records.length : null,
      financePaymentDays: analysis && analysis.paymentFlow && Array.isArray(analysis.paymentFlow.daily) ? analysis.paymentFlow.daily.length : null,
      financeSnapshotRecords: uiSnapshot && Array.isArray(uiSnapshot.records) ? uiSnapshot.records.length : null
    };
  }

  function getFirebaseHistorico(syncKey) {
    return getJson(firebaseUrl(historicoPath(syncKey)));
  }

  function saveFirebaseHistorico(syncKey, payload) {
    return putJson(firebaseUrl(historicoPath(syncKey)), payload);
  }

  function getFirebaseSupplierMemory() {
    return getJson(firebaseUrl('/usuarios/transferencia/cortesFornecedoresMemoria.json'));
  }

  function saveFirebaseSupplierMemory(payload) {
    return putJson(firebaseUrl('/usuarios/transferencia/cortesFornecedoresMemoria.json'), payload);
  }

  function getFirebaseFinanceLatest() {
    return getJson(firebaseUrl('/financeiro/ultimaAnalise.json'));
  }

  function saveFirebaseFinanceLatest(payload) {
    return putJson(firebaseUrl('/financeiro/ultimaAnalise.json'), payload);
  }

  function getSupabaseHistorico(syncKey) {
    return getSupabaseSingleton(Object.assign({}, SUPABASE_TABLES.historico, {
      keyValue: syncKey || SUPABASE_TABLES.historico.keyValue
    }));
  }

  function saveSupabaseHistorico(syncKey, payload) {
    return saveSupabaseSingleton(Object.assign({}, SUPABASE_TABLES.historico, {
      keyValue: syncKey || SUPABASE_TABLES.historico.keyValue
    }), payload);
  }

  function getSupabaseSupplierMemory() {
    return getSupabaseSingleton(SUPABASE_TABLES.supplierMemory);
  }

  function saveSupabaseSupplierMemory(payload) {
    return saveSupabaseSingleton(SUPABASE_TABLES.supplierMemory, payload);
  }

  function getSupabaseFinanceLatest() {
    return getSupabaseSingleton(SUPABASE_TABLES.financeLatest);
  }

  function saveSupabaseFinanceLatest(payload) {
    return saveSupabaseSingleton(SUPABASE_TABLES.financeLatest, payload);
  }

  function readFirebaseSnapshot() {
    return Promise.all([
      getFirebaseHistorico('transferencia').catch(function (err) { return { error: err.message }; }),
      getFirebaseSupplierMemory().catch(function (err) { return { error: err.message }; }),
      getFirebaseFinanceLatest().catch(function (err) { return { error: err.message }; })
    ]).then(function (items) {
      return {
        historico: items[0],
        supplierMemory: items[1],
        financeLatest: items[2]
      };
    });
  }

  function readSupabaseSnapshot() {
    return Promise.all([
      getSupabaseHistorico('transferencia').catch(function (err) { return { error: err.message }; }),
      getSupabaseSupplierMemory().catch(function (err) { return { error: err.message }; }),
      getSupabaseFinanceLatest().catch(function (err) { return { error: err.message }; })
    ]).then(function (items) {
      return {
        historico: items[0],
        supplierMemory: items[1],
        financeLatest: items[2]
      };
    });
  }

  function snapshotSummary(snapshot) {
    return {
      historico: snapshot && snapshot.historico && snapshot.historico.error ? { error: snapshot.historico.error } : payloadSummary(snapshot && snapshot.historico),
      supplierMemory: snapshot && snapshot.supplierMemory && snapshot.supplierMemory.error ? { error: snapshot.supplierMemory.error } : payloadSummary(snapshot && snapshot.supplierMemory),
      financeLatest: snapshot && snapshot.financeLatest && snapshot.financeLatest.error ? { error: snapshot.financeLatest.error } : payloadSummary(snapshot && snapshot.financeLatest)
    };
  }

  function previewFirebaseMigration() {
    return Promise.all([
      readFirebaseSnapshot(),
      readSupabaseSnapshot()
    ]).then(function (snapshots) {
      return {
        activeBackend: ACTIVE_BACKEND,
        firebase: snapshotSummary(snapshots[0]),
        supabase: snapshotSummary(snapshots[1]),
        nextStep: 'Se o Firebase estiver preenchido e o Supabase estiver vazio/desatualizado, rode ComercialDataProvider.migrateFirebaseToSupabase().'
      };
    });
  }

  function migrateFirebaseToSupabase() {
    return readFirebaseSnapshot().then(function (snapshot) {
      var result = {
        historico: null,
        supplierMemory: null,
        financeLatest: null
      };

      return saveSupabaseHistorico('transferencia', snapshot.historico).then(function () {
        result.historico = payloadSummary(snapshot.historico);
        return saveSupabaseSupplierMemory(snapshot.supplierMemory);
      }).then(function () {
        result.supplierMemory = payloadSummary(snapshot.supplierMemory);
        return saveSupabaseFinanceLatest(snapshot.financeLatest);
      }).then(function () {
        result.financeLatest = payloadSummary(snapshot.financeLatest);
        return {
          ok: true,
          migratedAt: new Date().toISOString(),
          result: result,
          rollback: 'Firebase não foi alterado. Para rollback, mantenha ACTIVE_BACKEND=firebase.'
        };
      });
    });
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

  function signInSupabase(operatorName, password) {
    var email = supabaseEmailForOperator(operatorName);

    if (!supabaseConfigured()) {
      return Promise.resolve({
        ok: false,
        configured: false,
        skipped: true,
        message: 'Supabase ainda não configurado.'
      });
    }

    return fetch(supabaseAuthUrl('token?grant_type=password'), {
      method: 'POST',
      headers: supabaseAnonHeaders(),
      body: JSON.stringify({
        email: email,
        password: password
      })
    }).then(function (response) {
      return responseText(response).then(function (bodyText) {
        var body;

        try {
          body = JSON.parse(bodyText || '{}');
        } catch (err) {
          body = {};
        }
        if (!response.ok || !body.access_token) {
          saveSupabaseSession(null);
          return {
            ok: false,
            configured: true,
            status: response.status,
            email: email,
            message: body.msg || body.message || 'Supabase Auth não autenticou este usuário.',
            body: bodyText
          };
        }
        saveSupabaseSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token || '',
          expires_at: body.expires_at || (Date.now() + ((body.expires_in || 3600) * 1000)),
          token_type: body.token_type || 'bearer',
          email: email,
          operatorName: String(operatorName || '').trim().toUpperCase(),
          userId: body.user && body.user.id ? body.user.id : ''
        });
        return {
          ok: true,
          configured: true,
          status: response.status,
          email: email,
          userId: body.user && body.user.id ? body.user.id : ''
        };
      });
    }).catch(function (err) {
      saveSupabaseSession(null);
      return {
        ok: false,
        configured: true,
        status: 0,
        email: email,
        message: err && err.message ? err.message : 'Não foi possível autenticar no Supabase.'
      };
    });
  }

  function getCurrentProfile(fallbackOperatorName) {
    var userId = supabaseSession && supabaseSession.userId;
    var path;

    if (!userId) {
      return Promise.reject(new Error('Sessão Supabase ausente.'));
    }
    path = 'app_profiles?select=*&id=eq.' + encodeURIComponent(userId) + '&limit=1';
    return fetch(supabaseUrl(path), {
      method: 'GET',
      headers: supabaseHeaders()
    }).then(assertOk).then(function (response) {
      return response.json();
    }).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : null;

      if (!row) {
        throw new Error('Perfil não encontrado em app_profiles.');
      }
      return normalizeProfile(row, fallbackOperatorName);
    });
  }

  function authenticateOperator(operatorName, password) {
    return signInSupabase(operatorName, password).then(function (auth) {
      if (!auth.ok) return auth;
      return getCurrentProfile(operatorName).then(function (profile) {
        var expected = normalizeOperatorName(operatorName);

        if (profile.name && expected && profile.name !== expected) {
          signOutSupabase();
          return {
            ok: false,
            configured: true,
            status: 403,
            message: 'Usuário autenticado não corresponde ao operador informado.',
            profile: profile
          };
        }
        return Object.assign({}, auth, {
          profile: profile
        });
      }).catch(function (err) {
        signOutSupabase();
        return {
          ok: false,
          configured: true,
          status: 403,
          message: err && err.message ? err.message : 'Não foi possível carregar app_profiles.'
        };
      });
    });
  }

  function signOutSupabase() {
    saveSupabaseSession(null);
    return Promise.resolve({ ok: true });
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
        supabaseUrl: supabaseConfig().url ? cleanBaseUrl(supabaseConfig().url) : '',
        supabaseConfigKeys: Object.keys(supabaseConfig().authEmails || {}),
        supabaseAuth: safeSessionInfo(),
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

    previewFirebaseMigration: previewFirebaseMigration,

    migrateFirebaseToSupabase: migrateFirebaseToSupabase,

    signInSupabase: signInSupabase,

    authenticateOperator: authenticateOperator,

    getCurrentProfile: getCurrentProfile,

    signOutSupabase: signOutSupabase,

    getHistorico: function (syncKey) {
      if (useSupabase()) {
        return getSupabaseHistorico(syncKey);
      }
      return getFirebaseHistorico(syncKey);
    },

    saveHistorico: function (syncKey, payload) {
      if (useSupabase()) {
        return saveSupabaseHistorico(syncKey, payload);
      }
      return saveFirebaseHistorico(syncKey, payload);
    },

    getSupplierMemory: function () {
      if (useSupabase()) {
        return getSupabaseSupplierMemory();
      }
      return getFirebaseSupplierMemory();
    },

    saveSupplierMemory: function (payload) {
      if (useSupabase()) {
        return saveSupabaseSupplierMemory(payload);
      }
      return saveFirebaseSupplierMemory(payload);
    },

    getFinanceLatest: function () {
      if (useSupabase()) {
        return getSupabaseFinanceLatest();
      }
      return getFirebaseFinanceLatest();
    },

    saveFinanceLatest: function (payload) {
      if (useSupabase()) {
        return saveSupabaseFinanceLatest(payload);
      }
      return saveFirebaseFinanceLatest(payload);
    }
  };

  window.FIREBASE_URL = FIREBASE_BASE_URL;
  window.ComercialDataProvider = provider;
})();
