(function () {
  'use strict';

  var FIREBASE_BASE_URL = 'https://comercial-norte-default-rtdb.firebaseio.com/';
  var ACTIVE_BACKEND = 'firebase';

  function cleanBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function firebaseUrl(path) {
    return cleanBaseUrl(FIREBASE_BASE_URL) + '/' + String(path || '').replace(/^\/+/, '');
  }

  function assertOk(response) {
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    return response;
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

  var provider = {
    backend: function () {
      return ACTIVE_BACKEND;
    },

    firebaseUrl: firebaseUrl,

    getHistorico: function (syncKey) {
      return getJson(firebaseUrl(historicoPath(syncKey)));
    },

    saveHistorico: function (syncKey, payload) {
      return putJson(firebaseUrl(historicoPath(syncKey)), payload);
    },

    getSupplierMemory: function () {
      return getJson(firebaseUrl('/usuarios/transferencia/cortesFornecedoresMemoria.json'));
    },

    saveSupplierMemory: function (payload) {
      return putJson(firebaseUrl('/usuarios/transferencia/cortesFornecedoresMemoria.json'), payload);
    },

    getFinanceLatest: function () {
      return getJson(firebaseUrl('/financeiro/ultimaAnalise.json'));
    },

    saveFinanceLatest: function (payload) {
      return putJson(firebaseUrl('/financeiro/ultimaAnalise.json'), payload);
    }
  };

  window.FIREBASE_URL = FIREBASE_BASE_URL;
  window.ComercialDataProvider = provider;
})();
