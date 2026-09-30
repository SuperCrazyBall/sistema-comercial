(function () {
  "use strict";

  const els = {
    file: document.getElementById("excelFile"),
    fileName: document.getElementById("fileName"),
    analyze: document.getElementById("analyzeBtn"),
    openLatest: document.getElementById("openLatestBtn"),
    saveImage: document.getElementById("saveImageBtn"),
    print: document.getElementById("printBtn"),
    clear: document.getElementById("clearBtn"),
    help: document.getElementById("helpBtn"),
    syncStatus: document.getElementById("financeSyncStatus"),
    periodMode: document.getElementById("periodMode"),
    dateFrom: document.getElementById("dateFrom"),
    dateTo: document.getElementById("dateTo"),
    datePop: document.getElementById("financeDatePop"),
    summaryTitle: document.getElementById("summaryTitle"),
    summaryView: document.getElementById("summaryView"),
    detailView: document.getElementById("detailView"),
    summaryViewBtn: document.getElementById("summaryViewBtn"),
    detailViewBtn: document.getElementById("detailViewBtn"),
    paymentSummaryBtn: document.getElementById("paymentSummaryBtn"),
    paymentDetailBtn: document.getElementById("paymentDetailBtn"),
    receiptLabelHeader: document.getElementById("receiptLabelHeader"),
    payoutLabelHeader: document.getElementById("payoutLabelHeader"),
    receiptBody: document.getElementById("receiptBody"),
    payoutBody: document.getElementById("payoutBody"),
    helpDialog: document.getElementById("helpDialog"),
    status: document.getElementById("statusBox"),
    validation: document.getElementById("validationMessage"),
    recordsBody: document.getElementById("recordsBody"),
    metrics: {
      entries: document.getElementById("totalEntries"),
      exits: document.getElementById("totalExits"),
      balance: document.getElementById("periodBalance"),
      positiveDays: document.getElementById("positiveDays"),
      negativeDays: document.getElementById("negativeDays"),
      best: document.getElementById("bestBalance"),
      worst: document.getElementById("worstBalance"),
      recordCount: document.getElementById("recordCount")
    },
    details: {
      selectedPeriod: document.getElementById("selectedPeriod"),
      avgEntries: document.getElementById("avgEntries"),
      avgExits: document.getElementById("avgExits"),
      avgBalance: document.getElementById("avgBalance"),
      topEntry: document.getElementById("topEntry"),
      topExit: document.getElementById("topExit"),
      best: document.getElementById("bestDetail"),
      worst: document.getElementById("worstDetail")
    },
    payments: {
      receipts: document.getElementById("paymentReceiptsTotal"),
      payments: document.getElementById("paymentPaymentsTotal"),
      topMethod: document.getElementById("paymentTopMethod"),
      topPayment: document.getElementById("paymentTopPayment")
    },
    balanceCard: document.querySelector(".metric.balance"),
    tooltip: document.getElementById("tooltip")
  };

  const state = {
    file: null,
    analysis: null,
    latestRemote: null,
    latestAppliedTs: null,
    visibleRecords: [],
    view: "summary",
    paymentView: "summary",
    syncStarted: false,
    syncTimer: null
  };

  const FINANCE_MODULE_VERSION = "2.0.0.66";
  const FIREBASE_FALLBACK_URL = "https://comercial-norte-default-rtdb.firebaseio.com/";
  const LATEST_ANALYSIS_CACHE_KEY = "finance_latest_analysis_cache_v2";
  const DATE_MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const DATE_DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  let datePickerTarget = null;
  let datePickerView = null;
  window.FINANCE_MODULE_VERSION = FINANCE_MODULE_VERSION;

  const lineChart = new window.FinanceCharts.FinanceChart(
    document.getElementById("flowChart"),
    "line",
    els.tooltip
  );
  const barChart = new window.FinanceCharts.FinanceChart(
    document.getElementById("resultChart"),
    "bar",
    els.tooltip
  );
  const receiptChart = new window.FinanceCharts.FinanceChart(
    document.getElementById("receiptChart"),
    "methods",
    els.tooltip
  );
  const payoutChart = new window.FinanceCharts.FinanceChart(
    document.getElementById("payoutChart"),
    "methods",
    els.tooltip
  );

  function setStatus(message, mode) {
    els.status.textContent = message;
  }

  function parentSyncText(message, mode) {
    const text = String(message || "");
    if (mode === "error" || /offline|indispon/i.test(text)) {
      return { state: "err", text: "Offline" };
    }
    if (/publicando|salvando/i.test(text)) {
      return { state: "busy", text: "Salvando..." };
    }
    if (/verificando|lendo|processando/i.test(text)) {
      return { state: "busy", text: "Verificando..." };
    }
    if (/carregada|atualizada|disponível|disponivel/i.test(text)) {
      return { state: "ok", text: "Atualizado ✓" };
    }
    if (/publicado|sincronizado/i.test(text)) {
      return { state: "ok", text: "Sincronizado ✓" };
    }
    if (/nenhuma análise|nenhuma analise/i.test(text)) {
      return { state: "ok", text: "Sincronizado ✓" };
    }
    if (mode === "warn") {
      return { state: "ok", text: "Salvo local ✓" };
    }
    return { state: mode === "ok" ? "ok" : "busy", text: mode === "ok" ? "Sincronizado ✓" : "Verificando..." };
  }

  function setSyncStatus(message, mode) {
    if (els.syncStatus) {
      els.syncStatus.textContent = message;
      els.syncStatus.classList.remove("ok", "warn", "error");
      if (mode) {
        els.syncStatus.classList.add(mode);
      }
    }
    updateParentFinanceSyncStatus(message, mode);
  }

  function updateParentFinanceSyncStatus(message, mode) {
    try {
      const parentWindow = window.parent && window.parent !== window ? window.parent : null;
      const parentUser = parentWindow && parentWindow.CURRENT_USER;
      if (!parentWindow || !parentUser || parentUser.role !== "financeiro" || typeof parentWindow.setSyncSt !== "function") {
        return;
      }
      const mapped = parentSyncText(message, mode);
      parentWindow.setSyncSt(mapped.state, mapped.text);
    } catch (error) {}
  }

  function currentUser() {
    try {
      return window.parent && window.parent !== window ? window.parent.CURRENT_USER : null;
    } catch (error) {
      return null;
    }
  }

  function canUseFinanceSync() {
    const user = currentUser();
    return !!(user && (user.name === "FINANCEIRO" || user.role === "master"));
  }

  function firebaseBaseUrl() {
    try {
      if (window.parent && window.parent !== window && window.parent.FIREBASE_URL) {
        return String(window.parent.FIREBASE_URL).replace(/\/+$/, "");
      }
    } catch (error) {}
    return FIREBASE_FALLBACK_URL.replace(/\/+$/, "");
  }

  function latestAnalysisUrl() {
    return `${firebaseBaseUrl()}/financeiro/ultimaAnalise.json`;
  }

  function formatDateTimePtBr(value) {
    if (!value) {
      return "";
    }
    try {
      return new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (error) {
      return "";
    }
  }

  function rememberLatest(payload) {
    state.latestRemote = normalizeLatestPayload(payload) || null;
    refreshLatestButton();
    try {
      if (state.latestRemote) {
        localStorage.setItem(LATEST_ANALYSIS_CACHE_KEY, JSON.stringify(state.latestRemote));
      }
    } catch (error) {}
  }

  function cachedLatest() {
    try {
      return JSON.parse(localStorage.getItem(LATEST_ANALYSIS_CACHE_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function latestMetaText(payload) {
    if (!payload) {
      return "";
    }
    const when = formatDateTimePtBr(payload.publishedAt || payload.ts);
    const who = payload.publishedBy || "FINANCEIRO";
    return `Última análise: publicada por ${who}${when ? ` em ${when}` : ""}.`;
  }

  function refreshLatestButton() {
    if (els.openLatest) {
      els.openLatest.disabled = !state.latestRemote;
    }
  }

  function restoreCachedLatest() {
    if (!state.latestRemote) {
      const cached = normalizeLatestPayload(cachedLatest());
      if (cached && cached.analysis) {
        state.latestRemote = cached;
      }
    }
    refreshLatestButton();
    return state.latestRemote;
  }

  function showLatestAvailabilityStatus() {
    const latest = restoreCachedLatest();
    if (latest) {
      setSyncStatus(latestMetaText(latest), "ok");
    } else {
      setSyncStatus("Nenhuma análise financeira publicada carregada neste computador.", "warn");
    }
  }

  function redrawChartsSoon() {
    if (!state.analysis) {
      return;
    }
    const redraw = () => {
      const records = filteredRecords();
      state.visibleRecords = records;
      updatePayments();
      lineChart.draw(records);
      barChart.draw(records);
    };
    [0, 80, 160, 320, 640, 1000, 1600, 2400, 3600].forEach((delay) => {
      window.setTimeout(() => window.requestAnimationFrame(redraw), delay);
    });
  }

  function hasRenderablePaymentData() {
    return paymentDaily().some((day) => (
      cleanNumber(day.receiptsTotal) > 0 ||
      cleanNumber(day.paymentsTotal) > 0 ||
      (Array.isArray(day.methods) && day.methods.some((method) => cleanNumber(method.value) > 0)) ||
      (Array.isArray(day.paymentDetails) && day.paymentDetails.some((payment) => cleanNumber(payment.value) > 0))
    ));
  }

  function ensureRenderedCharts() {
    if (!state.analysis || !Array.isArray(state.analysis.records) || !state.analysis.records.length) {
      return;
    }
    const redraw = () => {
      const records = filteredRecords();
      state.visibleRecords = records;
      if (hasRenderablePaymentData()) {
        updatePayments();
      }
      lineChart.draw(records);
      barChart.draw(records);
    };
    [120, 420, 900, 1800, 3200].forEach((delay) => {
      window.setTimeout(() => window.requestAnimationFrame(redraw), delay);
    });
  }

  function cleanNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function cleanRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }
    return {
      key: String(record.key || ""),
      label: String(record.label || ""),
      rawLabel: String(record.rawLabel || record.label || ""),
      dateStart: String(record.dateStart || ""),
      dateEnd: String(record.dateEnd || ""),
      entries: cleanNumber(record.entries),
      exits: cleanNumber(record.exits),
      balance: cleanNumber(record.balance),
      row: record.row || null,
      col: record.col || null,
      source: record.source || ""
    };
  }

  function cleanPaymentItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    return {
      name: String(item.name || item.label || ""),
      label: String(item.label || item.name || ""),
      value: cleanNumber(item.value),
      kind: item.kind || "",
      parent: item.parent || ""
    };
  }

  function cleanPaymentDaily(day) {
    if (!day || typeof day !== "object") {
      return null;
    }
    return {
      col: day.col || null,
      label: String(day.label || ""),
      shortLabel: String(day.shortLabel || day.label || ""),
      dateStart: String(day.dateStart || ""),
      dateEnd: String(day.dateEnd || ""),
      receiptsTotal: cleanNumber(day.receiptsTotal),
      paymentsTotal: cleanNumber(day.paymentsTotal),
      methods: Array.isArray(day.methods) ? day.methods.map((method) => ({
        name: String(method.name || ""),
        value: cleanNumber(method.value),
        details: Array.isArray(method.details) ? method.details.map(cleanPaymentItem).filter(Boolean) : []
      })).filter((method) => method.name || method.value || method.details.length) : [],
      paymentDetails: Array.isArray(day.paymentDetails) ? day.paymentDetails.map(cleanPaymentItem).filter(Boolean) : []
    };
  }

  function createUiSnapshot(analysis) {
    const records = Array.isArray(analysis?.records) ? analysis.records.map(cleanRecord).filter(Boolean) : [];
    const daily = Array.isArray(analysis?.paymentFlow?.daily) ? analysis.paymentFlow.daily.map(cleanPaymentDaily).filter(Boolean) : [];
    return {
      version: 2,
      records,
      paymentFlow: { daily },
      summary: analysis?.summary || null,
      validation: analysis?.validation || null,
      fluxoSource: analysis?.fluxoSource || null,
      sheets: Array.isArray(analysis?.sheets) ? analysis.sheets.slice() : [],
      defaultPaymentAggregate: aggregatePaymentFlow(daily)
    };
  }

  function normalizeLatestPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const normalized = { ...payload };
    const snapshot = normalized.uiSnapshot && typeof normalized.uiSnapshot === "object" ? normalized.uiSnapshot : null;
    const analysis = normalized.analysis && typeof normalized.analysis === "object" ? { ...normalized.analysis } : {};

    if ((!Array.isArray(analysis.records) || !analysis.records.length) && Array.isArray(snapshot?.records)) {
      analysis.records = snapshot.records;
    }
    if (!analysis.summary && snapshot?.summary) {
      analysis.summary = snapshot.summary;
    }
    if (!analysis.validation && snapshot?.validation) {
      analysis.validation = snapshot.validation;
    }
    if (!analysis.fluxoSource && snapshot?.fluxoSource) {
      analysis.fluxoSource = snapshot.fluxoSource;
    }
    if (!Array.isArray(analysis.sheets) && Array.isArray(snapshot?.sheets)) {
      analysis.sheets = snapshot.sheets;
    }
    const snapshotDaily = snapshot?.paymentFlow?.daily;
    if (Array.isArray(snapshotDaily) && snapshotDaily.length) {
      analysis.paymentFlow = { daily: snapshotDaily.map(cleanPaymentDaily).filter(Boolean) };
    } else if (Array.isArray(analysis.paymentFlow?.daily)) {
      analysis.paymentFlow = { daily: analysis.paymentFlow.daily.map(cleanPaymentDaily).filter(Boolean) };
    }
    if (!analysis.validation) {
      analysis.validation = { status: "warn", message: "Analise carregada do Firebase." };
    }
    if (!analysis.fluxoSource) {
      analysis.fluxoSource = { message: "Fonte carregada da ultima analise publicada." };
    }
    normalized.analysis = analysis;
    return normalized;
  }

  function openDatePicker(input, event) {
    if (!input || input.disabled || !els.datePop) {
      return;
    }
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    datePickerTarget = input;
    const base = isoToDate(dateValue(input)) || new Date();
    datePickerView = new Date(base.getFullYear(), base.getMonth(), 1);
    renderDatePicker();
    const rect = input.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 198);
    let top = rect.bottom + 2;
    if (top + 205 > window.innerHeight) {
      top = Math.max(2, rect.top - 205);
    }
    els.datePop.style.left = `${Math.max(2, left)}px`;
    els.datePop.style.top = `${top}px`;
    els.datePop.classList.add("on");
  }

  function closeDatePicker() {
    if (els.datePop) {
      els.datePop.classList.remove("on");
    }
  }

  function moveDatePicker(delta, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!datePickerView) {
      datePickerView = new Date();
    }
    datePickerView = new Date(datePickerView.getFullYear(), datePickerView.getMonth() + delta, 1);
    renderDatePicker();
  }

  function pickDate(year, month, day, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!datePickerTarget) {
      return;
    }
    const iso = `${year}-${padDatePart(month + 1)}-${padDatePart(day)}`;
    setDateValue(datePickerTarget, iso);
    datePickerTarget.dispatchEvent(new Event("change", { bubbles: true }));
    closeDatePicker();
  }

  function renderDatePicker() {
    if (!els.datePop) {
      return;
    }
    const view = datePickerView || new Date();
    const selected = isoToDate(dateValue(datePickerTarget));
    const today = new Date();
    const year = view.getFullYear();
    const month = view.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - startOffset);
    let html = "";
    html += '<div class="vcal-hd">';
    html += '<button class="vcal-nav" data-cal-move="-1" type="button">◄</button>';
    html += `<div class="vcal-title">${DATE_MONTHS[month]} de ${year}</div>`;
    html += '<button class="vcal-nav" data-cal-move="1" type="button">►</button>';
    html += "</div>";
    html += `<div class="vcal-week">${DATE_DOW.map((dayName) => `<div>${dayName}</div>`).join("")}</div>`;
    html += '<div class="vcal-grid">';
    for (let i = 0; i < 42; i++) {
      const current = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      let cls = "vcal-day";
      if (current.getMonth() !== month) cls += " muted";
      if (sameDay(current, selected)) cls += " is-selected";
      if (sameDay(current, today)) cls += " is-today";
      html += `<button class="${cls}" data-cal-pick="${current.getFullYear()}-${current.getMonth()}-${current.getDate()}" type="button"><span>${current.getDate()}</span></button>`;
    }
    html += "</div>";
    html += `<button class="vcal-foot" data-cal-today="${today.getFullYear()}-${today.getMonth()}-${today.getDate()}" type="button"><span class="vcal-today-mark"></span><span>Hoje: ${formatDatePtBr(`${today.getFullYear()}-${padDatePart(today.getMonth() + 1)}-${padDatePart(today.getDate())}`)}</span></button>`;
    els.datePop.innerHTML = html;
  }

  function formatMoney(value) {
    return window.FinanceCharts.currency(value);
  }

  function summarizeRecords(records) {
    return records.reduce((acc, record) => {
      acc.entries += record.entries;
      acc.exits += record.exits;
      acc.balance += record.balance;
      if (record.balance > 0) {
        acc.positiveDays += 1;
      }
      if (record.balance < 0) {
        acc.negativeDays += 1;
      }
      if (!acc.best || record.balance > acc.best.balance) {
        acc.best = record;
      }
      if (!acc.worst || record.balance < acc.worst.balance) {
        acc.worst = record;
      }
      if (!acc.topEntry || record.entries > acc.topEntry.entries) {
        acc.topEntry = record;
      }
      if (!acc.topExit || record.exits > acc.topExit.exits) {
        acc.topExit = record;
      }
      return acc;
    }, {
      entries: 0,
      exits: 0,
      balance: 0,
      positiveDays: 0,
      negativeDays: 0,
      best: null,
      worst: null,
      topEntry: null,
      topExit: null
    });
  }

  function formatDatePtBr(key) {
    if (!key) {
      return "";
    }
    const [year, month, day] = key.split("-");
    return `${day}/${month}/${year}`;
  }

  function padDatePart(value) {
    return String(value).padStart(2, "0");
  }

  function parseDateInputValue(value) {
    const text = String(value || "").trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    return "";
  }

  function dateValue(input) {
    return input?.dataset?.iso || parseDateInputValue(input?.value);
  }

  function setDateValue(input, iso) {
    if (!input) {
      return;
    }
    const clean = parseDateInputValue(iso) || "";
    input.dataset.iso = clean;
    input.value = clean ? formatDatePtBr(clean) : "";
  }

  function isoToDate(iso) {
    const clean = parseDateInputValue(iso);
    if (!clean) {
      return null;
    }
    const [year, month, day] = clean.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function sameDay(a, b) {
    return !!(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
  }

  function formatPeriodName(records) {
    if (!records.length) {
      return "Sem registros";
    }
    const first = records[0];
    const last = records[records.length - 1];
    const start = first.dateStart ? formatDatePtBr(first.dateStart) : first.label;
    const end = last.dateEnd ? formatDatePtBr(last.dateEnd) : last.label;
    return start === end ? start : `${start} até ${end}`;
  }

  function formatMetricWithLabel(record, key) {
    return record ? `${formatMoney(record[key])} (${record.label})` : "R$ 0,00";
  }

  function configurePeriodControls(records) {
    const dated = records.filter((record) => record.dateStart && record.dateEnd);
    const first = dated[0];
    const last = dated[dated.length - 1];
    els.periodMode.disabled = !dated.length;
    els.dateFrom.disabled = els.periodMode.value !== "custom" || !dated.length;
    els.dateTo.disabled = els.periodMode.value !== "custom" || !dated.length;

    if (!dated.length) {
      setDateValue(els.dateFrom, "");
      setDateValue(els.dateTo, "");
      return;
    }

    els.dateFrom.dataset.min = first.dateStart || "";
    els.dateFrom.dataset.max = last.dateEnd || "";
    els.dateTo.dataset.min = first.dateStart || "";
    els.dateTo.dataset.max = last.dateEnd || "";

    if (!dateValue(els.dateFrom)) {
      setDateValue(els.dateFrom, first.dateStart);
    }
    if (!dateValue(els.dateTo)) {
      setDateValue(els.dateTo, last.dateEnd);
    }
  }

  function filteredRecords() {
    if (!state.analysis) {
      return [];
    }
    if (els.periodMode.value !== "custom") {
      return state.analysis.records;
    }

    const from = dateValue(els.dateFrom);
    const to = dateValue(els.dateTo);
    return state.analysis.records.filter((record) => (
      record.dateStart && record.dateEnd &&
      (!from || record.dateEnd >= from) &&
      (!to || record.dateStart <= to)
    ));
  }

  function periodMatches(item) {
    if (els.periodMode.value !== "custom") {
      return true;
    }
    const from = dateValue(els.dateFrom);
    const to = dateValue(els.dateTo);
    return item.dateStart && item.dateEnd &&
      (!from || item.dateEnd >= from) &&
      (!to || item.dateStart <= to);
  }

  function addGroupedValue(map, name, value, kind, parent) {
    if (!value) {
      return;
    }
    const key = `${kind}:${parent || ""}:${name}`;
    const current = map.get(key) || { label: name, value: 0, kind, parent };
    current.value += value;
    map.set(key, current);
  }

  function aggregatePaymentFlow(days) {
    const methodMap = new Map();
    const receiptDetailMap = new Map();
    const paymentMap = new Map();
    const paymentDetailMap = new Map();
    const totals = { receipts: 0, payments: 0 };

    days.forEach((day) => {
      totals.receipts += day.receiptsTotal || 0;
      totals.payments += day.paymentsTotal || 0;

      day.methods.forEach((method) => {
        addGroupedValue(methodMap, method.name, method.value, "receipt");
        method.details.forEach((detail) => {
          addGroupedValue(receiptDetailMap, `${method.name} / ${detail.name}`, detail.value, "receipt", method.name);
        });
      });

      day.paymentDetails.forEach((payment) => {
        addGroupedValue(paymentMap, payment.name, payment.value, "payment");
        addGroupedValue(paymentDetailMap, payment.name, payment.value, "payment", "Pagamentos");
      });
    });

    const receiptItems = Array.from(methodMap.values()).sort((a, b) => b.value - a.value);
    const paymentItems = Array.from(paymentMap.values()).sort((a, b) => b.value - a.value);
    const receiptDetailItems = Array.from(receiptDetailMap.values()).sort((a, b) => b.value - a.value);
    const paymentDetailItems = Array.from(paymentDetailMap.values()).sort((a, b) => b.value - a.value);

    return {
      totals,
      receiptItems,
      paymentItems,
      receiptDetailItems,
      paymentDetailItems
    };
  }

  function percentage(value, total) {
    if (!total) {
      return "0,0%";
    }
    return new Intl.NumberFormat("pt-BR", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value / total);
  }

  function paymentTooltip(item, total) {
    const group = item.kind === "payment" ? "Pagamentos" : "Recebimentos";
    return `${group}: ${formatMoney(item.value)}<br>Participação: ${percentage(item.value, total)}<br>Período: ${currentPaymentPeriodLabel()}`;
  }

  function currentPaymentPeriodLabel() {
    if (!state.analysis) {
      return "Todos";
    }
    const days = paymentDaily().filter(periodMatches);
    if (!days.length) {
      return "Sem registros";
    }
    const first = days[0];
    const last = days[days.length - 1];
    const start = first.dateStart ? formatDatePtBr(first.dateStart) : first.label;
    const end = last.dateEnd ? formatDatePtBr(last.dateEnd) : last.label;
    return start === end ? start : `${start} até ${end}`;
  }

  function paymentDaily() {
    return Array.isArray(state.analysis?.paymentFlow?.daily) ? state.analysis.paymentFlow.daily : [];
  }

  function updateMetrics(summary, recordCount) {
    els.metrics.entries.textContent = formatMoney(summary.entries);
    els.metrics.exits.textContent = formatMoney(summary.exits);
    els.metrics.balance.textContent = formatMoney(summary.balance);
    els.metrics.positiveDays.textContent = String(summary.positiveDays);
    els.metrics.negativeDays.textContent = String(summary.negativeDays);
    els.metrics.best.textContent = summary.best ? `${formatMoney(summary.best.balance)} (${summary.best.label})` : "R$ 0,00";
    els.metrics.worst.textContent = summary.worst ? `${formatMoney(summary.worst.balance)} (${summary.worst.label})` : "R$ 0,00";
    els.metrics.recordCount.textContent = String(recordCount);
    els.balanceCard.classList.toggle("positive", summary.balance >= 0);
    els.balanceCard.classList.toggle("negative", summary.balance < 0);
  }

  function updateDetails(summary, records) {
    const count = records.length || 1;
    els.details.selectedPeriod.textContent = formatPeriodName(records);
    els.details.avgEntries.textContent = formatMoney(summary.entries / count);
    els.details.avgExits.textContent = formatMoney(summary.exits / count);
    els.details.avgBalance.textContent = formatMoney(summary.balance / count);
    els.details.topEntry.textContent = formatMetricWithLabel(summary.topEntry, "entries");
    els.details.topExit.textContent = formatMetricWithLabel(summary.topExit, "exits");
    els.details.best.textContent = formatMetricWithLabel(summary.best, "balance");
    els.details.worst.textContent = formatMetricWithLabel(summary.worst, "balance");
  }

  function updatePayments() {
    const daily = paymentDaily();
    const days = daily.filter(periodMatches);
    const aggregate = aggregatePaymentFlow(days);
    const topMethod = aggregate.receiptItems[0];
    const topPayment = aggregate.paymentItems[0];
    const isDetail = state.paymentView === "detail";
    const receiptRows = isDetail ? aggregate.receiptDetailItems : aggregate.receiptItems;
    const payoutRows = isDetail ? aggregate.paymentDetailItems : aggregate.paymentItems;

    els.payments.receipts.textContent = formatMoney(aggregate.totals.receipts);
    els.payments.payments.textContent = formatMoney(aggregate.totals.payments);
    els.payments.topMethod.textContent = topMethod ? `${formatMoney(topMethod.value)} (${topMethod.label})` : "R$ 0,00";
    els.payments.topPayment.textContent = topPayment ? `${formatMoney(topPayment.value)} (${topPayment.label})` : "R$ 0,00";
    els.receiptLabelHeader.textContent = isDetail ? "Forma / filial" : "Forma";
    els.payoutLabelHeader.textContent = isDetail ? "Origem detalhada" : "Origem";

    if (!daily.length) {
      els.receiptBody.innerHTML = '<tr><td colspan="3">Esta análise publicada não trouxe os dados de formas de pagamento. Gere uma nova análise para atualizar os gráficos compartilhados.</td></tr>';
      els.payoutBody.innerHTML = '<tr><td colspan="3">Esta análise publicada não trouxe os dados de formas de pagamento. Gere uma nova análise para atualizar os gráficos compartilhados.</td></tr>';
      receiptChart.draw([]);
      payoutChart.draw([]);
      return;
    }

    renderPaymentGroup({
      rows: receiptRows,
      total: aggregate.totals.receipts,
      chart: receiptChart,
      body: els.receiptBody,
      empty: "Nenhum recebimento encontrado no período selecionado.",
      valueClass: "positive-value"
    });
    renderPaymentGroup({
      rows: payoutRows,
      total: aggregate.totals.payments,
      chart: payoutChart,
      body: els.payoutBody,
      empty: "Nenhum pagamento encontrado no período selecionado.",
      valueClass: "negative-value"
    });
  }

  function renderPaymentGroup(config) {
    if (!config.rows.length) {
      config.body.innerHTML = `<tr><td colspan="3">${config.empty}</td></tr>`;
      config.chart.draw([]);
      return;
    }

    const chartItems = config.rows.slice(0, 10).map((item) => ({
      ...item,
      tooltip: paymentTooltip(item, config.total)
    }));

    config.chart.draw(chartItems);
    config.body.innerHTML = config.rows.slice(0, 26).map((item) => `
      <tr>
        <td title="${item.label}">${item.label}</td>
        <td class="num ${config.valueClass}">${formatMoney(item.value)}</td>
        <td class="num">${percentage(item.value, config.total)}</td>
      </tr>
    `).join("");
  }

  function updateValidation(analysis, records) {
    const messages = [];
    const isFiltered = records.length !== analysis.records.length || els.periodMode.value === "custom";
    const mode = analysis.validation.status === "ok" && (!analysis.summary.totalCheck || analysis.summary.totalCheck.matches) ? "ok" : "warn";

    if (isFiltered) {
      messages.push(`Filtro aplicado: ${records.length} de ${analysis.records.length} registro(s).`);
    } else if (analysis.fluxoSource?.message) {
      messages.push(analysis.fluxoSource.message);
    }

    if (!isFiltered && analysis.summary.totalCheck) {
      messages.push(
        analysis.summary.totalCheck.matches
          ? `Totais conferidos com a linha ${analysis.summary.totalCheck.row} da aba Fluxo.`
          : `Totais calculados divergem da linha ${analysis.summary.totalCheck.row} da aba Fluxo.`
      );
    }
    messages.push(analysis.validation.message);

    els.validation.textContent = messages.join(" ");
    els.validation.classList.remove("ok", "warn", "error");
    els.validation.classList.add(mode);
  }

  function updateTable(records) {
    if (!records.length) {
      els.recordsBody.innerHTML = '<tr><td colspan="4">Nenhum registro encontrado no período selecionado.</td></tr>';
      return;
    }

    const recent = records.slice(-18).reverse();
    els.recordsBody.innerHTML = recent.map((record) => `
      <tr>
        <td title="${record.label}">${record.label}</td>
        <td class="num">${formatMoney(record.entries)}</td>
        <td class="num negative-value">${formatMoney(record.exits)}</td>
        <td class="num ${record.balance < 0 ? "negative-value" : "positive-value"}">${formatMoney(record.balance)}</td>
      </tr>
    `).join("");
  }

  function setView(view) {
    state.view = view;
    const isDetail = view === "detail";
    els.summaryView.hidden = isDetail;
    els.detailView.hidden = !isDetail;
    els.summaryViewBtn.classList.toggle("active", !isDetail);
    els.detailViewBtn.classList.toggle("active", isDetail);
    els.summaryTitle.textContent = isDetail ? "Detalhamento do período" : "Resumo do período";
  }

  function setPaymentView(view) {
    state.paymentView = view;
    const isDetail = view === "detail";
    els.paymentSummaryBtn.classList.toggle("active", !isDetail);
    els.paymentDetailBtn.classList.toggle("active", isDetail);
    updatePayments();
  }

  function renderAnalysis() {
    if (!state.analysis) {
      return;
    }

    configurePeriodControls(state.analysis.records);
    const records = filteredRecords();
    const summary = summarizeRecords(records);
    state.visibleRecords = records;

    updateMetrics(summary, records.length);
    updateDetails(summary, records);
    updateValidation(state.analysis, records);
    updatePayments();
    updateTable(records);
    lineChart.draw(records);
    barChart.draw(records);
    ensureRenderedCharts();

    els.saveImage.disabled = !records.length;
    els.print.disabled = !records.length;

    if (!records.length) {
      els.validation.textContent = "Nenhum registro encontrado no período selecionado.";
      els.validation.classList.remove("ok", "warn", "error");
      els.validation.classList.add("warn");
      setStatus("Filtro sem registros.", "warn");
      return;
    }

    setStatus(`Análise exibindo ${records.length} registro(s).`, "ok");
  }

  function applyLatestAnalysis(payload, sourceLabel) {
    const normalized = normalizeLatestPayload(payload);
    if (!normalized || !normalized.analysis || !Array.isArray(normalized.analysis.records)) {
      setSyncStatus("Nenhuma análise financeira publicada.", "warn");
      return false;
    }
    state.analysis = normalized.analysis;
    state.latestAppliedTs = normalized.ts || null;
    state.file = null;
    els.file.value = "";
    els.fileName.textContent = normalized.fileName ? `Última análise: ${normalized.fileName}` : "Última análise publicada";
    els.analyze.disabled = true;
    els.periodMode.value = normalized.periodMode || "all";
    setDateValue(els.dateFrom, normalized.dateFrom || "");
    setDateValue(els.dateTo, normalized.dateTo || "");
    setView("summary");
    renderAnalysis();
    redrawChartsSoon();
    ensureRenderedCharts();
    const meta = latestMetaText(normalized);
    setStatus(`Última análise carregada${sourceLabel ? ` (${sourceLabel})` : ""}.`, "ok");
    setSyncStatus(meta || "Última análise carregada.", "ok");
    return true;
  }

  async function loadLatestAnalysis(auto) {
    if (!canUseFinanceSync()) {
      return;
    }
    const available = restoreCachedLatest();
    setSyncStatus("Verificando última análise publicada...", null);
    try {
      const resp = await fetch(latestAnalysisUrl(), { cache: "no-store" });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const payload = normalizeLatestPayload(await resp.json());
      if (!payload || !Array.isArray(payload.analysis?.records)) {
        if (available) {
          setSyncStatus(latestMetaText(available), "ok");
        } else {
          rememberLatest(null);
          setSyncStatus("Nenhuma análise financeira publicada ainda.", "warn");
        }
        return;
      }
      const shouldAutoApply = auto && payload.ts && payload.ts !== state.latestAppliedTs && (!state.analysis || !state.file);
      rememberLatest(payload);
      setSyncStatus(latestMetaText(payload), "ok");
      if (!auto || shouldAutoApply) {
        applyLatestAnalysis(payload, "Firebase");
      }
    } catch (error) {
      const cached = normalizeLatestPayload(cachedLatest()) || available;
      if (cached && cached.analysis) {
        rememberLatest(cached);
        if (!auto) {
          applyLatestAnalysis(cached, "cache local");
        } else if (!state.file && (!state.analysis || cached.ts !== state.latestAppliedTs)) {
          applyLatestAnalysis(cached, "cache local");
        } else {
          setSyncStatus("Firebase indisponível. Última análise em cache disponível.", "warn");
        }
      } else {
        rememberLatest(null);
        setSyncStatus("Offline. Não foi possível buscar a última análise.", "error");
      }
    }
  }

  async function publishLatestAnalysis() {
    if (!canUseFinanceSync() || !state.analysis) {
      return;
    }
    const user = currentUser() || {};
    const now = Date.now();
    const payload = {
      schemaVersion: 2,
      ts: now,
      publishedAt: new Date(now).toISOString(),
      publishedBy: user.name || "FINANCEIRO",
      fileName: state.file ? state.file.name : "",
      periodMode: els.periodMode.value || "all",
      dateFrom: dateValue(els.dateFrom),
      dateTo: dateValue(els.dateTo),
      analysis: JSON.parse(JSON.stringify(state.analysis)),
      uiSnapshot: createUiSnapshot(state.analysis)
    };
    payload.analysis.paymentFlow = payload.uiSnapshot.paymentFlow;
    rememberLatest(payload);
    state.latestAppliedTs = payload.ts;
    setSyncStatus("Publicando última análise...", null);
    try {
      const resp = await fetch(latestAnalysisUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      setSyncStatus(`Publicado no Firebase por ${payload.publishedBy}.`, "ok");
    } catch (error) {
      setSyncStatus("Salvo local / Firebase indisponível.", "warn");
    }
  }

  function resetAnalysis() {
    state.analysis = null;
    state.visibleRecords = [];
    els.periodMode.value = "all";
    els.periodMode.disabled = true;
    setDateValue(els.dateFrom, "");
    setDateValue(els.dateTo, "");
    els.dateFrom.disabled = true;
    els.dateTo.disabled = true;
    updateMetrics({
      entries: 0,
      exits: 0,
      balance: 0,
      positiveDays: 0,
      negativeDays: 0,
      best: null,
      worst: null,
      topEntry: null,
      topExit: null
    }, 0);
    updateDetails({
      entries: 0,
      exits: 0,
      balance: 0,
      best: null,
      worst: null,
      topEntry: null,
      topExit: null
    }, []);
    els.recordsBody.innerHTML = '<tr><td colspan="4">Nenhuma análise gerada.</td></tr>';
    els.validation.textContent = "Importe uma planilha para iniciar.";
    els.validation.classList.remove("ok", "warn", "error");
    lineChart.draw([]);
    barChart.draw([]);
    receiptChart.draw([]);
    payoutChart.draw([]);
    els.receiptBody.innerHTML = '<tr><td colspan="3">Nenhuma análise gerada.</td></tr>';
    els.payoutBody.innerHTML = '<tr><td colspan="3">Nenhuma análise gerada.</td></tr>';
    els.payments.receipts.textContent = "R$ 0,00";
    els.payments.payments.textContent = "R$ 0,00";
    els.payments.topMethod.textContent = "R$ 0,00";
    els.payments.topPayment.textContent = "R$ 0,00";
    els.saveImage.disabled = true;
    els.print.disabled = true;
  }

  async function analyze() {
    if (!state.file) {
      return;
    }

    els.analyze.disabled = true;
    setStatus("Lendo planilha...", null);
    els.validation.textContent = "Processando a aba Fluxo.";
    els.validation.classList.remove("ok", "warn", "error");

    try {
      const analysis = await window.FinanceXlsx.parseWorkbook(state.file);
      state.analysis = analysis;
      els.periodMode.value = "all";
      setDateValue(els.dateFrom, "");
      setDateValue(els.dateTo, "");
      renderAnalysis();
      await publishLatestAnalysis();
    } catch (error) {
      resetAnalysis();
      els.validation.textContent = error.message || "Nao foi possivel analisar a planilha.";
      els.validation.classList.add("error");
      setStatus("Erro na análise.", "error");
    } finally {
      els.analyze.disabled = !state.file;
    }
  }

  function drawText(ctx, text, x, y, options = {}) {
    ctx.fillStyle = options.color || "#000";
    ctx.font = options.font || "bold 18px Arial";
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = "top";
    ctx.fillText(text, x, y);
  }

  function drawMetric(ctx, title, value, x, y, w, color) {
    ctx.fillStyle = "#fff4d6";
    ctx.strokeStyle = "#c09000";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, 62);
    ctx.strokeRect(x, y, w, 62);
    drawText(ctx, title, x + 8, y + 8, { font: "bold 13px Arial", color: "#4f3100" });
    drawText(ctx, value, x + 8, y + 28, { font: "bold 18px Arial", color });
  }

  function saveImage() {
    if (!state.analysis || !state.visibleRecords.length) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    canvas.height = 1420;
    const ctx = canvas.getContext("2d");
    const summary = summarizeRecords(state.visibleRecords);

    ctx.fillStyle = "#f5edd8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#143b63";
    ctx.fillRect(20, 20, 1460, 44);
    drawText(ctx, "PAINEL FINANCEIRO - ENTRADAS, SAIDAS E SALDO", 750, 30, {
      font: "bold 26px Arial",
      color: "#fff",
      align: "center"
    });

    drawMetric(ctx, "TOTAL DE ENTRADAS", formatMoney(summary.entries), 40, 86, 330, "#103d5f");
    drawMetric(ctx, "TOTAL DE SAIDAS", formatMoney(summary.exits), 400, 86, 330, "#cc0000");
    drawMetric(ctx, "SALDO DO PERIODO", formatMoney(summary.balance), 760, 86, 330, summary.balance < 0 ? "#cc0000" : "#006b35");
    drawMetric(ctx, "REGISTROS", String(state.visibleRecords.length), 1120, 86, 330, "#103d5f");

    drawText(ctx, "FORMAS DE PAGAMENTO", 40, 174, { font: "bold 18px Arial", color: "#143b63" });
    ctx.drawImage(document.getElementById("receiptChart"), 40, 205, 700, 330);
    ctx.drawImage(document.getElementById("payoutChart"), 760, 205, 700, 330);
    drawText(ctx, "ENTRADAS X SAIDAS", 40, 560, { font: "bold 18px Arial", color: "#143b63" });
    ctx.drawImage(document.getElementById("flowChart"), 40, 590, 1420, 360);
    drawText(ctx, "RESULTADO DIARIO", 40, 975, { font: "bold 18px Arial", color: "#143b63" });
    ctx.drawImage(document.getElementById("resultChart"), 40, 1005, 1420, 360);

    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    link.download = `controle-saldos-cheques-${stamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  els.file.addEventListener("change", () => {
    state.file = els.file.files[0] || null;
    els.fileName.textContent = state.file ? state.file.name : "Nenhum arquivo selecionado";
    els.analyze.disabled = !state.file;
    resetAnalysis();
    setStatus(state.file ? "Arquivo selecionado. Clique em Gerar análise." : "Aguardando arquivo Excel.");
  });

  els.analyze.addEventListener("click", analyze);
  els.openLatest.addEventListener("click", () => loadLatestAnalysis(false));
  els.periodMode.addEventListener("change", () => {
    const custom = els.periodMode.value === "custom";
    els.dateFrom.disabled = !custom || !state.analysis;
    els.dateTo.disabled = !custom || !state.analysis;
    closeDatePicker();
    renderAnalysis();
  });
  els.dateFrom.addEventListener("change", () => {
    const from = dateValue(els.dateFrom);
    const to = dateValue(els.dateTo);
    if (to && from > to) {
      setDateValue(els.dateTo, from);
    }
    renderAnalysis();
  });
  els.dateTo.addEventListener("change", () => {
    const from = dateValue(els.dateFrom);
    const to = dateValue(els.dateTo);
    if (from && to < from) {
      setDateValue(els.dateFrom, to);
    }
    renderAnalysis();
  });
  [els.dateFrom, els.dateTo].forEach((input) => {
    input.addEventListener("click", (event) => openDatePicker(input, event));
    input.addEventListener("focus", (event) => openDatePicker(input, event));
  });
  els.datePop.addEventListener("click", (event) => {
    const move = event.target.closest("[data-cal-move]");
    if (move) {
      moveDatePicker(Number(move.getAttribute("data-cal-move")), event);
      return;
    }
    const pick = event.target.closest("[data-cal-pick]");
    if (pick) {
      const parts = pick.getAttribute("data-cal-pick").split("-").map(Number);
      pickDate(parts[0], parts[1], parts[2], event);
      return;
    }
    const today = event.target.closest("[data-cal-today]");
    if (today) {
      const parts = today.getAttribute("data-cal-today").split("-").map(Number);
      pickDate(parts[0], parts[1], parts[2], event);
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#financeDatePop") || event.target.classList.contains("vs-date-input")) {
      return;
    }
    closeDatePicker();
  });
  els.summaryViewBtn.addEventListener("click", () => setView("summary"));
  els.detailViewBtn.addEventListener("click", () => setView("detail"));
  els.paymentSummaryBtn.addEventListener("click", () => setPaymentView("summary"));
  els.paymentDetailBtn.addEventListener("click", () => setPaymentView("detail"));
  els.saveImage.addEventListener("click", saveImage);
  els.print.addEventListener("click", () => window.print());
  els.clear.addEventListener("click", () => {
    els.file.value = "";
    state.file = null;
    els.fileName.textContent = "Nenhum arquivo selecionado";
    els.analyze.disabled = true;
    state.latestAppliedTs = null;
    resetAnalysis();
    setStatus("Aguardando arquivo Excel.");
    showLatestAvailabilityStatus();
  });
  els.help.addEventListener("click", () => {
    if (typeof els.helpDialog.showModal === "function") {
      els.helpDialog.showModal();
    } else {
      alert("1. Selecione a planilha.\n2. Clique em Gerar analise.\n3. Confira os graficos.\n4. Salve imagem ou imprima.");
    }
  });

  window.FinanceSaldosCheques = {
    version: FINANCE_MODULE_VERSION,
    openLatest: () => loadLatestAnalysis(false),
    refreshLatest: () => loadLatestAnalysis(true),
    redraw: () => {
      redrawChartsSoon();
      ensureRenderedCharts();
    }
  };

  function startFinanceSyncWhenAuthorized() {
    if (state.syncStarted) {
      return;
    }
    if (!canUseFinanceSync()) {
      window.setTimeout(startFinanceSyncWhenAuthorized, 700);
      return;
    }
    state.syncStarted = true;
    loadLatestAnalysis(true);
    state.syncTimer = window.setInterval(() => loadLatestAnalysis(true), 20000);
  }

  resetAnalysis();
  restoreCachedLatest();
  console.info(`Financeiro Saldos e Cheques v${FINANCE_MODULE_VERSION} carregado.`);
  startFinanceSyncWhenAuthorized();
}());
