(function () {
  "use strict";

  const els = {
    file: document.getElementById("excelFile"),
    fileName: document.getElementById("fileName"),
    analyze: document.getElementById("analyzeBtn"),
    saveImage: document.getElementById("saveImageBtn"),
    print: document.getElementById("printBtn"),
    clear: document.getElementById("clearBtn"),
    help: document.getElementById("helpBtn"),
    periodMode: document.getElementById("periodMode"),
    dateFrom: document.getElementById("dateFrom"),
    dateTo: document.getElementById("dateTo"),
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
    visibleRecords: [],
    view: "summary",
    paymentView: "summary"
  };

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
      els.dateFrom.value = "";
      els.dateTo.value = "";
      return;
    }

    els.dateFrom.min = first.dateStart;
    els.dateFrom.max = last.dateEnd;
    els.dateTo.min = first.dateStart;
    els.dateTo.max = last.dateEnd;

    if (!els.dateFrom.value) {
      els.dateFrom.value = first.dateStart;
    }
    if (!els.dateTo.value) {
      els.dateTo.value = last.dateEnd;
    }
  }

  function filteredRecords() {
    if (!state.analysis) {
      return [];
    }
    if (els.periodMode.value !== "custom") {
      return state.analysis.records;
    }

    const from = els.dateFrom.value;
    const to = els.dateTo.value;
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
    const from = els.dateFrom.value;
    const to = els.dateTo.value;
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
    const days = (state.analysis.paymentFlow?.daily || []).filter(periodMatches);
    if (!days.length) {
      return "Sem registros";
    }
    const first = days[0];
    const last = days[days.length - 1];
    const start = first.dateStart ? formatDatePtBr(first.dateStart) : first.label;
    const end = last.dateEnd ? formatDatePtBr(last.dateEnd) : last.label;
    return start === end ? start : `${start} até ${end}`;
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
    const daily = state.analysis?.paymentFlow?.daily || [];
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
      els.receiptBody.innerHTML = '<tr><td colspan="3">A aba fluxo diario não foi encontrada para esta análise.</td></tr>';
      els.payoutBody.innerHTML = '<tr><td colspan="3">A aba fluxo diario não foi encontrada para esta análise.</td></tr>';
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

  function resetAnalysis() {
    state.analysis = null;
    state.visibleRecords = [];
    els.periodMode.value = "all";
    els.periodMode.disabled = true;
    els.dateFrom.value = "";
    els.dateTo.value = "";
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
      els.dateFrom.value = "";
      els.dateTo.value = "";
      renderAnalysis();
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
  els.periodMode.addEventListener("change", () => {
    const custom = els.periodMode.value === "custom";
    els.dateFrom.disabled = !custom || !state.analysis;
    els.dateTo.disabled = !custom || !state.analysis;
    renderAnalysis();
  });
  els.dateFrom.addEventListener("change", () => {
    if (els.dateTo.value && els.dateFrom.value > els.dateTo.value) {
      els.dateTo.value = els.dateFrom.value;
    }
    renderAnalysis();
  });
  els.dateTo.addEventListener("change", () => {
    if (els.dateFrom.value && els.dateTo.value < els.dateFrom.value) {
      els.dateFrom.value = els.dateTo.value;
    }
    renderAnalysis();
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
    resetAnalysis();
    setStatus("Aguardando arquivo Excel.");
  });
  els.help.addEventListener("click", () => {
    if (typeof els.helpDialog.showModal === "function") {
      els.helpDialog.showModal();
    } else {
      alert("1. Selecione a planilha.\n2. Clique em Gerar analise.\n3. Confira os graficos.\n4. Salve imagem ou imprima.");
    }
  });

  resetAnalysis();
}());
