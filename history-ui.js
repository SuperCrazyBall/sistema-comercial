(function () {
  'use strict';
  var provider = window.ComercialDataProvider;
  var clients = new Set(), createClient = provider.createSupabaseClient;
  provider.createSupabaseClient = function () { var client = createClient(); clients.add(client); return client; };
  window.addEventListener('comercial:logout', function () {
    CURRENT_USER = null;
    clients.forEach(function (client) { client.removeAllChannels(); }); clients.clear();
    histRealtimeChannel = null; histRealtimeClient = null;
    clearTimeout(histSyncFastTimer); clearTimeout(histSyncStatusTimer);
  });
  window.histPage = function (delta) { window.__histPage = (window.__histPage || 0) + delta; renderHist(); };

  function filtered(filialId, periodId) {
    var filial = document.getElementById(filialId).value;
    var days = document.getElementById(periodId).value;
    var from = days ? Date.now() - Number(days) * 86400000 : null;
    return getHist().filter(function (h) { return (!filial || h.filial === filial) && (!from || Date.parse(h.savedAt) >= from); });
  }
  async function ensure(items) {
    await provider.ensureHistoricoDetails(items, function (done, total) {
      setSyncSt('busy', 'Carregando detalhes: ' + done + '/' + total);
    });
    setSyncSt('ok', 'Detalhes disponíveis ✓');
  }
  function guard(name, select) {
    var original = window[name];
    window[name] = async function () {
      var args = Array.prototype.slice.call(arguments), self = this;
      try {
        // Permission wrappers remain inside original; do not fetch restricted data first.
        if (!CURRENT_USER) return;
        if (['loadDirect','loadFromHist','updHistVlUnit'].indexOf(name) >= 0 && !checkPerm(name)) return;
        var ready = false;
        for (var attempt = 0; attempt < 3; attempt++) {
          await ensure(select ? select.apply(self, args) : getHist());
          var current = select ? select.apply(self, args) : getHist();
          if (current.every(function (item) { return !item.__summary && Array.isArray(item.products); })) { ready = true; break; }
        }
        if (!ready) throw new Error('Os dados mudaram durante o carregamento. Tente novamente.');
        if (!CURRENT_USER) return;
        return await original.apply(self, args);
      } catch (error) {
        setSyncSt('err', 'Detalhes indisponíveis');
        toast(error.message || 'Não foi possível carregar os detalhes.', 'err');
      }
    };
  }
  function one(id) { return getHist().filter(function (h) { return String(h.id) === String(id); }); }
  ['viewHist', 'loadDirect'].forEach(function (name) { guard(name, one); });
  ['loadFromHist', 'printHistOrc', 'excelHistOrc'].forEach(function (name) { guard(name, function () { return one(viewingId); }); });
  var updatePrice = window.updHistVlUnit;
  window.updHistVlUnit = function (input, index, id) {
    if (!checkPerm('updHistVlUnit')) return;
    var item = one(id)[0];
    if (!item || item.__summary) {
      viewHist(id);
      toast('Orçamento atualizado. Confira os produtos e refaça a alteração.', 'warn');
      return;
    }
    return updatePrice.apply(this, arguments);
  };
  ['buildAna', 'expAnaExcel'].forEach(function (name) { guard(name, function () { return filtered('af-fil', 'af-per'); }); });
  guard('gerarRelCortes', function () { return filtered('rc-fil', 'rc-per'); });
  ['searchProdHist', 'rankOpenHist', 'quickProdHist', 'rcOpenProdHist'].forEach(function (name) { guard(name); });
  // Product history printed inside an order needs the full historical product set.
  var print = window.printRows;
  window.printRows = async function (rows, title, showPct, showVal, showSum, showHist) {
    try {
      if (showHist) await ensure(getHist());
      return print.apply(this, arguments);
    } catch (error) { toast(error.message, 'err'); }
  };
  // Never calculate silently from an incomplete summary if a new entry point is added.
  var productHistory = window.getProdHistHtml;
  window.getProdHistHtml = function () {
    if (getHist().some(function (item) { return item.__summary; })) throw new Error('Carregue os detalhes do histórico antes de calcular.');
    return productHistory.apply(this, arguments);
  };
})();
