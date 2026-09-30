(function () {
  "use strict";

  const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  const MONEY_TOLERANCE = 0.02;
  const RECEIPT_METHOD_ROWS = [
    { row: 2, name: "Cartões", endRow: 9 },
    { row: 10, name: "Tesouraria", endRow: 18 },
    { row: 19, name: "Cheques", endRow: 19 },
    { row: 20, name: "Boletos CD", endRow: 20 },
    { row: 21, name: "Boletos Loja", endRow: 21 },
    { row: 22, name: "Conta CEF", endRow: 22 },
    { row: 23, name: "Conta SAFRA", endRow: 23 },
    { row: 24, name: "PIX Transf + TED + SISPAG", endRow: 31 },
    { row: 32, name: "PIX QRs", endRow: 40 }
  ];

  const PAYMENT_TOTAL_ROWS = [
    { row: 43, name: "Matriz" },
    { row: 44, name: "Conta Boletos" },
    { row: 45, name: "Guamá" },
    { row: 46, name: "Ceasa" },
    { row: 47, name: "C. Nova" },
    { row: 48, name: "Pedreira" },
    { row: 49, name: "Centro" },
    { row: 50, name: "Jurunas" },
    { row: 51, name: "Nuvem" },
    { row: 52, name: "D. Franco" },
    { row: 53, name: "Conta Garantia" }
  ];

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  function columnToNumber(ref) {
    let total = 0;
    for (const char of ref) {
      total = total * 26 + char.charCodeAt(0) - 64;
    }
    return total;
  }

  function splitCellRef(ref) {
    const match = /^([A-Z]+)(\d+)$/i.exec(ref);
    if (!match) {
      return null;
    }
    return { col: columnToNumber(match[1].toUpperCase()), row: Number(match[2]) };
  }

  function excelSerialToDate(serial) {
    const days = Math.floor(serial);
    const ms = Math.round((serial - days) * 86400000);
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + days * 86400000 + ms);
  }

  function formatDateKey(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function makeUtcDate(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
  }

  function expandYear(value, fallbackYear) {
    if (value === undefined || value === null || value === "") {
      return fallbackYear || new Date().getFullYear();
    }
    const year = Number(value);
    return year < 100 ? 2000 + year : year;
  }

  function parseDateToken(token, fallbackYear, fallbackMonth) {
    const clean = String(token || "").trim().replace(/[.-]/g, "/");
    const compact = /^\d{4}$/.test(clean) ? `${clean.slice(0, 2)}/${clean.slice(2)}` : clean;
    const parts = compact.split("/").filter(Boolean).map((part) => Number(part));
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
      return null;
    }
    const day = parts[0];
    const month = parts[1] || fallbackMonth;
    const year = expandYear(parts[2], fallbackYear);
    if (!day || !month || day > 31 || month > 12) {
      return null;
    }
    return makeUtcDate(year, month, day);
  }

  function extractDateTokens(text) {
    return String(text || "")
      .replace(/(\d)([aA])(\d)/g, "$1 $2 $3")
      .match(/\d{1,2}(?:[\/.-]\d{1,2})?(?:[\/.-]\d{2,4})?|\b\d{4}\b/g) || [];
  }

  function labelKey(value) {
    if (value instanceof Date) {
      return formatDateKey(value);
    }
    return normalizeText(value).replace(/\s+/g, "");
  }

  function formatLabel(value) {
    if (value instanceof Date) {
      const day = String(value.getUTCDate()).padStart(2, "0");
      const month = String(value.getUTCMonth() + 1).padStart(2, "0");
      return `${day}/${month}/${value.getUTCFullYear()}`;
    }
    return String(value || "").trim();
  }

  function shortDateLabel(value) {
    if (value instanceof Date) {
      const day = String(value.getUTCDate()).padStart(2, "0");
      const month = String(value.getUTCMonth() + 1).padStart(2, "0");
      return `${day}/${month}`;
    }
    return String(value || "").trim();
  }

  function parseLabelPeriod(value, fallbackYear) {
    if (value instanceof Date) {
      const key = formatDateKey(value);
      return { start: key, end: key, year: value.getUTCFullYear() };
    }

    const text = String(value || "").trim();
    const tokens = extractDateTokens(text);
    if (tokens.length) {
      const endDate = parseDateToken(tokens[tokens.length - 1], fallbackYear, null);
      const startDate = parseDateToken(
        tokens[0],
        endDate ? endDate.getUTCFullYear() : fallbackYear,
        endDate ? endDate.getUTCMonth() + 1 : null
      );
      if (startDate && endDate) {
        const start = startDate <= endDate ? startDate : endDate;
        const end = startDate <= endDate ? endDate : startDate;
        return {
          start: formatDateKey(start),
          end: formatDateKey(end),
          year: end.getUTCFullYear()
        };
      }
    }

    return { start: null, end: null, year: fallbackYear || null };
  }

  function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== "string") {
      return 0;
    }
    const cleaned = value
      .replace(/[R$\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseXml(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const error = xml.querySelector("parsererror");
    if (error) {
      throw new Error("Nao foi possivel ler a estrutura XML da planilha.");
    }
    return xml;
  }

  async function loadXml(zip, path) {
    const file = zip.file(path);
    if (!file) {
      return null;
    }
    return parseXml(await file.async("text"));
  }

  function getRelationshipMap(relsXml) {
    const rels = new Map();
    if (!relsXml) {
      return rels;
    }
    relsXml.querySelectorAll("Relationship").forEach((rel) => {
      rels.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
    });
    return rels;
  }

  function resolveWorkbookTarget(target) {
    const clean = target.replace(/^\/+/, "");
    return clean.startsWith("xl/") ? clean : `xl/${clean}`;
  }

  function readSharedStrings(xml) {
    if (!xml) {
      return [];
    }
    return Array.from(xml.querySelectorAll("si")).map((item) => (
      Array.from(item.querySelectorAll("t")).map((t) => t.textContent || "").join("")
    ));
  }

  function readStyles(xml) {
    const styleFormats = [];
    const customFormats = new Map();
    if (!xml) {
      return styleFormats;
    }

    xml.querySelectorAll("numFmts numFmt").forEach((fmt) => {
      customFormats.set(Number(fmt.getAttribute("numFmtId")), fmt.getAttribute("formatCode") || "");
    });

    xml.querySelectorAll("cellXfs xf").forEach((xf) => {
      const id = Number(xf.getAttribute("numFmtId") || 0);
      const custom = customFormats.get(id) || "";
      const isDate = DATE_FORMAT_IDS.has(id) || /[dmyhs]/i.test(custom.replace(/\[[^\]]+\]/g, ""));
      styleFormats.push({ id, isDate });
    });

    return styleFormats;
  }

  function cellText(cell) {
    const inline = cell.querySelector("is");
    if (inline) {
      return Array.from(inline.querySelectorAll("t")).map((t) => t.textContent || "").join("");
    }
    const value = cell.querySelector("v");
    return value ? value.textContent : "";
  }

  function readCellValue(cell, sharedStrings, styles) {
    const type = cell.getAttribute("t");
    const raw = cellText(cell);
    if (type === "s") {
      return sharedStrings[Number(raw)] || "";
    }
    if (type === "inlineStr" || type === "str") {
      return raw;
    }
    if (type === "b") {
      return raw === "1";
    }
    if (raw === "") {
      return "";
    }

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return raw;
    }

    const styleIndex = Number(cell.getAttribute("s") || 0);
    if (styles[styleIndex] && styles[styleIndex].isDate && numeric > 1) {
      return excelSerialToDate(numeric);
    }

    return numeric;
  }

  function parseSheet(xml, sharedStrings, styles) {
    const rows = new Map();
    let maxRow = 0;
    let maxCol = 0;

    xml.querySelectorAll("sheetData row").forEach((rowNode) => {
      const rowIndex = Number(rowNode.getAttribute("r"));
      const values = new Map();
      rowNode.querySelectorAll("c").forEach((cell) => {
        const ref = splitCellRef(cell.getAttribute("r"));
        if (!ref) {
          return;
        }
        values.set(ref.col, readCellValue(cell, sharedStrings, styles));
        maxRow = Math.max(maxRow, ref.row);
        maxCol = Math.max(maxCol, ref.col);
      });
      rows.set(rowIndex, values);
    });

    return {
      rows,
      maxRow,
      maxCol,
      get(row, col) {
        return rows.get(row)?.get(col);
      }
    };
  }

  function findWorkbookSheets(workbookXml, relsXml) {
    const rels = getRelationshipMap(relsXml);
    return Array.from(workbookXml.querySelectorAll("sheets sheet")).map((sheet) => ({
      name: sheet.getAttribute("name"),
      path: resolveWorkbookTarget(rels.get(sheet.getAttribute("r:id")) || "")
    }));
  }

  function findFluxoHeader(sheet) {
    for (let row = 1; row <= sheet.maxRow; row += 1) {
      const a = normalizeText(sheet.get(row, 1));
      const b = normalizeText(sheet.get(row, 2));
      const c = normalizeText(sheet.get(row, 3));
      const d = normalizeText(sheet.get(row, 4));
      if (a === "DATA" && b === "ENTRADAS" && c === "SAIDAS" && d === "SALDO") {
        return row;
      }
    }
    throw new Error("A aba Fluxo nao possui a tabela DATA, ENTRADAS, SAIDAS e SALDO.");
  }

  function findTotalRow(sheet, headerRow) {
    let candidate = null;
    for (let row = headerRow + 1; row <= sheet.maxRow; row += 1) {
      const label = sheet.get(row, 1);
      const entries = numberValue(sheet.get(row, 2));
      const exits = numberValue(sheet.get(row, 3));
      const balance = numberValue(sheet.get(row, 4));
      if ((label === undefined || label === "") && (entries || exits || balance)) {
        candidate = { row, entries, exits: Math.abs(exits), balance };
      }
    }
    return candidate;
  }

  function createFluxoRecord(label, entriesValue, exitsValue, balanceValue, location, activeYear) {
    const entries = numberValue(entriesValue);
    const exits = Math.abs(numberValue(exitsValue));
    const balance = balanceValue === undefined || balanceValue === "" || balanceValue === null
      ? entries - exits
      : numberValue(balanceValue);

    if (!entries && !exits && !balance) {
      return { record: null, year: activeYear };
    }

    const period = parseLabelPeriod(label, activeYear);
    const nextYear = period.year || activeYear;

    return {
      year: nextYear,
      record: {
        ...location,
        label: formatLabel(label),
        shortLabel: shortDateLabel(label),
        key: labelKey(label),
        rawLabel: label,
        dateStart: period.start,
        dateEnd: period.end,
        entries,
        exits,
        balance
      }
    };
  }

  function latestRecordDate(records) {
    return records.reduce((latest, record) => (
      record.dateEnd && (!latest || record.dateEnd > latest) ? record.dateEnd : latest
    ), null);
  }

  function extractFluxoVerticalRecords(sheet, headerRow) {
    const records = [];
    let activeYear = null;

    for (let row = headerRow + 1; row <= sheet.maxRow; row += 1) {
      const label = sheet.get(row, 1);
      if (label === undefined || label === "" || label === null) {
        continue;
      }
      if (normalizeText(label) === "DATA") {
        continue;
      }

      const created = createFluxoRecord(label, sheet.get(row, 2), sheet.get(row, 3), sheet.get(row, 4), {
        row,
        source: "vertical"
      }, activeYear);
      activeYear = created.year;
      if (created.record) {
        records.push(created.record);
      }
    }

    return records;
  }

  function extractFluxoHorizontalRecords(sheet) {
    const records = [];
    let activeYear = null;

    for (let col = 2; col <= sheet.maxCol; col += 1) {
      const label = sheet.get(1, col);
      if (label === undefined || label === "" || label === null || normalizeText(label) === "DATA") {
        continue;
      }

      const created = createFluxoRecord(label, sheet.get(2, col), sheet.get(3, col), sheet.get(4, col), {
        col,
        source: "horizontal"
      }, activeYear);
      activeYear = created.year;
      if (created.record && created.record.dateStart && created.record.dateEnd) {
        records.push(created.record);
      }
    }

    return records;
  }

  function chooseFluxoRecords(verticalRecords, horizontalRecords) {
    const verticalLatest = latestRecordDate(verticalRecords);
    const horizontalLatest = latestRecordDate(horizontalRecords);

    if (
      horizontalRecords.length &&
      (!verticalRecords.length ||
        (horizontalLatest && (!verticalLatest || horizontalLatest > verticalLatest)) ||
        horizontalRecords.length > verticalRecords.length)
    ) {
      return {
        records: horizontalRecords,
        source: "horizontal",
        message: `Fonte atual: tabela horizontal da aba Fluxo ate ${formatLabel(horizontalRecords[horizontalRecords.length - 1].rawLabel)}.`
      };
    }

    return {
      records: verticalRecords,
      source: "vertical",
      message: verticalLatest
        ? `Fonte atual: tabela vertical da aba Fluxo ate ${formatLabel(verticalRecords[verticalRecords.length - 1].rawLabel)}.`
        : "Fonte atual: tabela vertical da aba Fluxo."
    };
  }

  function extractFluxoRecords(sheet) {
    const headerRow = findFluxoHeader(sheet);
    const totalRow = findTotalRow(sheet, headerRow);
    const verticalRecords = extractFluxoVerticalRecords(sheet, headerRow);
    const horizontalRecords = extractFluxoHorizontalRecords(sheet);
    const selected = chooseFluxoRecords(verticalRecords, horizontalRecords);

    if (!selected.records.length) {
      throw new Error("Nenhum registro valido foi encontrado na aba Fluxo.");
    }

    return {
      headerRow,
      records: selected.records,
      totalRow,
      source: selected.source,
      sourceMessage: selected.message,
      sourceStats: {
        verticalCount: verticalRecords.length,
        verticalLatest: latestRecordDate(verticalRecords),
        horizontalCount: horizontalRecords.length,
        horizontalLatest: latestRecordDate(horizontalRecords)
      }
    };
  }

  function findLabelRow(sheet, label) {
    const wanted = normalizeText(label);
    for (let row = 1; row <= sheet.maxRow; row += 1) {
      for (let col = 1; col <= Math.min(sheet.maxCol, 8); col += 1) {
        if (normalizeText(sheet.get(row, col)) === wanted) {
          return row;
        }
      }
    }
    return null;
  }

  function validateFluxoDiario(sheet, records) {
    if (!sheet) {
      return { status: "warn", message: "A aba fluxo diario nao foi encontrada para conferencia." };
    }

    const entriesRow = findLabelRow(sheet, "RECEBIMENTOS");
    const exitsRow = findLabelRow(sheet, "PAGAMENTOS");
    if (!entriesRow || !exitsRow) {
      return { status: "warn", message: "Nao foi possivel localizar RECEBIMENTOS e PAGAMENTOS na aba fluxo diario." };
    }

    const source = new Map();
    for (let col = 1; col <= sheet.maxCol; col += 1) {
      const label = sheet.get(1, col);
      const key = labelKey(label);
      if (!key) {
        continue;
      }
      const entries = numberValue(sheet.get(entriesRow, col));
      const exits = Math.abs(numberValue(sheet.get(exitsRow, col)));
      if (entries || exits) {
        source.set(key, { entries, exits });
      }
    }

    let checked = 0;
    let divergences = 0;
    for (const record of records) {
      const match = source.get(record.key);
      if (!match) {
        continue;
      }
      checked += 1;
      if (
        Math.abs(match.entries - record.entries) > MONEY_TOLERANCE ||
        Math.abs(match.exits - record.exits) > MONEY_TOLERANCE
      ) {
        divergences += 1;
      }
    }

    if (!checked) {
      return { status: "warn", message: "A conferencia com fluxo diario nao encontrou datas equivalentes." };
    }

    if (divergences) {
      return { status: "warn", message: `${divergences} registro(s) divergem da aba fluxo diario em ${checked} conferido(s).` };
    }

    return { status: "ok", message: `Conferencia concluida: ${checked} registro(s) batem com fluxo diario.` };
  }

  function rowLabel(sheet, row, fallback) {
    return String(sheet.get(row, 1) || sheet.get(row, 2) || fallback || "").trim();
  }

  function detailRowsForSection(sheet, section) {
    const rows = [];
    for (let row = section.row + 1; row <= section.endRow; row += 1) {
      const name = rowLabel(sheet, row, "");
      if (name) {
        rows.push({ row, name });
      }
    }
    return rows;
  }

  function extractFluxoDiario(sheet) {
    if (!sheet) {
      return null;
    }

    const columns = [];
    let activeYear = null;
    for (let col = 3; col <= sheet.maxCol; col += 1) {
      const rawLabel = sheet.get(1, col);
      if (rawLabel === undefined || rawLabel === null || rawLabel === "") {
        continue;
      }
      const period = parseLabelPeriod(rawLabel, activeYear);
      activeYear = period.year || activeYear;
      if (!period.start || !period.end) {
        continue;
      }
      columns.push({
        col,
        label: formatLabel(rawLabel),
        shortLabel: shortDateLabel(rawLabel),
        dateStart: period.start,
        dateEnd: period.end
      });
    }

    const receiptSections = RECEIPT_METHOD_ROWS.map((section) => ({
      ...section,
      details: detailRowsForSection(sheet, section)
    }));

    const daily = columns.map((column) => {
      const methods = receiptSections.map((section) => ({
        name: section.name,
        value: Math.abs(numberValue(sheet.get(section.row, column.col))),
        details: section.details.map((detail) => ({
          name: detail.name,
          value: Math.abs(numberValue(sheet.get(detail.row, column.col)))
        })).filter((detail) => detail.value)
      })).filter((method) => method.value || method.details.length);

      return {
        ...column,
        methods,
        receiptsTotal: Math.abs(numberValue(sheet.get(41, column.col))),
        paymentsTotal: Math.abs(numberValue(sheet.get(42, column.col))),
        paymentDetails: PAYMENT_TOTAL_ROWS.map((row) => ({
          name: row.name,
          value: Math.abs(numberValue(sheet.get(row.row, column.col)))
        })).filter((item) => item.value)
      };
    });

    return { daily };
  }

  function summarize(records, totalRow) {
    const totals = records.reduce((acc, record) => {
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
      return acc;
    }, {
      entries: 0,
      exits: 0,
      balance: 0,
      positiveDays: 0,
      negativeDays: 0,
      best: null,
      worst: null
    });

    let totalCheck = null;
    if (totalRow) {
      totalCheck = {
        row: totalRow.row,
        entriesDiff: totals.entries - totalRow.entries,
        exitsDiff: totals.exits - totalRow.exits,
        balanceDiff: totals.balance - totalRow.balance,
        matches: Math.abs(totals.entries - totalRow.entries) <= MONEY_TOLERANCE &&
          Math.abs(totals.exits - totalRow.exits) <= MONEY_TOLERANCE &&
          Math.abs(totals.balance - totalRow.balance) <= MONEY_TOLERANCE
      };
    }

    return { ...totals, totalCheck };
  }

  async function parseWorkbook(file) {
    if (!window.JSZip) {
      throw new Error("Biblioteca local JSZip nao foi carregada.");
    }

    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const workbookXml = await loadXml(zip, "xl/workbook.xml");
    const relsXml = await loadXml(zip, "xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relsXml) {
      throw new Error("Arquivo Excel invalido ou incompleto.");
    }

    const sharedStrings = readSharedStrings(await loadXml(zip, "xl/sharedStrings.xml"));
    const styles = readStyles(await loadXml(zip, "xl/styles.xml"));
    const sheets = findWorkbookSheets(workbookXml, relsXml);
    const parsedSheets = new Map();

    for (const sheet of sheets) {
      if (!sheet.path) {
        continue;
      }
      const xml = await loadXml(zip, sheet.path);
      if (xml) {
        parsedSheets.set(normalizeText(sheet.name), parseSheet(xml, sharedStrings, styles));
      }
    }

    const fluxo = parsedSheets.get("FLUXO");
    if (!fluxo) {
      throw new Error("A planilha precisa conter a aba Fluxo.");
    }

    const fluxoResult = extractFluxoRecords(fluxo);
    const { records, totalRow, source, sourceMessage, sourceStats } = fluxoResult;
    const summary = summarize(records, source === "vertical" ? totalRow : null);
    const fluxoDiario = parsedSheets.get("FLUXO DIARIO");
    const validation = validateFluxoDiario(fluxoDiario, records);
    const paymentFlow = extractFluxoDiario(fluxoDiario);

    return {
      records,
      summary,
      fluxoSource: {
        source,
        message: sourceMessage,
        stats: sourceStats
      },
      paymentFlow,
      validation,
      sheets: sheets.map((sheet) => sheet.name)
    };
  }

  window.FinanceXlsx = {
    parseWorkbook,
    formatLabel,
    labelKey,
    numberValue
  };
}());
