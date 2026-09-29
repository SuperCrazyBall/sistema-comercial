(function () {
  var MEMORY_KEY = 'cf_supplier_memory_v2';

  var REQUIRED_HEADERS = [
    { key: 'codigo', label: 'CODIGO' },
    { key: 'descricao', label: 'DESCRICAO' },
    { key: 'sugestao', label: 'SUGESTAO' }
  ];

  var HEADER_ALIASES = {
    codigo: ['CODIGO', 'CODIGO PRODUTO', 'CODIGO_PRODUTO', 'EAN'],
    descricao: ['DESCRICAO', 'DESCRIÇÃO', 'PRODUTO', 'NOME PRODUTO'],
    classe: ['CLASSE', 'CLASSE GERAL', 'CLASSE FILIAL'],
    umMes: ['1 MES ATRAS', '1 MÊS ATRÁS', '1 MÊS ATRAS'],
    doisMeses: ['2 MESES ATRAS', '2 MESES ATRÁS'],
    tresMeses: ['3 MESES ATRAS', '3 MESES ATRÁS'],
    mediaDia: ['MEDIA DIA', 'MÉDIA DIA', 'MEDIA_DIA'],
    estoque: ['ESTOQUE'],
    disponivel: ['DISPONIVEL', 'DISPONÍVEL'],
    estoqueMinimo: ['ESTOQUE MINIMO', 'ESTOQUE MÍNIMO'],
    cobertura: ['COBERTURA'],
    sugestao: ['SUGESTAO', 'SUGESTÃO'],
    previsto: ['PREVISTO'],
    numero: ['N', 'Nº', 'NO', 'NUMERO', 'NÚMERO']
  };

  var STOP_WORDS = {
    A: 1, O: 1, AS: 1, OS: 1, DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, PARA: 1, P: 1, USO: 1, COM: 1,
    C: 1, CX: 1, FD: 1, PT: 1, PC: 1, UND: 1, UNID: 1, UN: 1, KG: 1, G: 1, GR: 1, ML: 1, L: 1, LT: 1,
    ROLO: 1, POTE: 1, SACO: 1, SACOLA: 1, EMB: 1, TPA: 1, TAMPA: 1, BASE: 1, DESC: 1, DESCARTAVEL: 1,
    DESCARTAVEIS: 1, PLASTICO: 1, PLASTICA: 1, COLOR: 1, BR: 1, TRANS: 1, PET: 1, MIL: 1, CAIXA: 1,
    N: 1, No: 1, NUM: 1, TAM: 1, TAMANHO: 1, PE: 1
  };

  var state = {
    currentUser: null,
    canAccess: false,
    excel: {
      fileName: '',
      headers: [],
      rows: [],
      items: [],
      suggestions: [],
      valid: false,
      message: 'Aguardando Excel do BI.'
    },
    pdf: {
      fileName: '',
      lines: [],
      items: [],
      codes: {},
      meta: {},
      valid: false,
      message: 'Aguardando PDF da solicitação.'
    },
    analysis: {
      ready: false,
      cuts: [],
      suppliers: []
    },
    supplierOverrides: {},
    selectedItems: {},
    memory: loadMemory()
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeHeader(value) {
    return normalizeText(value)
      .replace(/[_\r\n\t]+/g, ' ')
      .replace(/[ºª°]/g, '')
      .trim()
      .toUpperCase();
  }

  function code(value) {
    return String(value == null ? '' : value)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[^\d]/g, '');
  }

  function codeNoZeros(value) {
    var clean = code(value);
    return clean.replace(/^0+/, '') || clean;
  }

  function numberValue(value) {
    var text;
    var negative;

    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    negative = /^\(.*\)$/.test(text) || /^-/.test(text);
    text = text.replace(/[R$\s%]/g, '').replace(/[()]/g, '').replace(/^[+-]/, '');
    if (text.indexOf(',') >= 0) text = text.replace(/\./g, '').replace(',', '.');
    value = Number(text);
    if (!Number.isFinite(value)) return 0;
    return negative ? -value : value;
  }

  function fmtNumber(value, decimals) {
    return (Number(value) || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals == null ? 2 : decimals
    });
  }

  function fmtQty(value) {
    return fmtNumber(value, 2).replace(/,00$/, '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch];
    });
  }

  function standardSupplier(value) {
    return normalizeText(value).toUpperCase() || 'FORNECEDOR NAO IDENTIFICADO';
  }

  function loadMemory() {
    var raw;
    var memory;

    try {
      raw = window.localStorage ? window.localStorage.getItem(MEMORY_KEY) : '';
      memory = raw ? JSON.parse(raw) : {};
    } catch (err) {
      memory = {};
    }

    return {
      suppliers: Array.isArray(memory.suppliers) ? memory.suppliers.map(standardSupplier).filter(Boolean) : [],
      codeRules: memory.codeRules || {},
      aliasRules: memory.aliasRules || {},
      tokenRules: memory.tokenRules || {},
      ignoredWarnings: memory.ignoredWarnings || {}
    };
  }

  function saveMemory() {
    try {
      if (window.localStorage) window.localStorage.setItem(MEMORY_KEY, JSON.stringify(state.memory));
    } catch (err) {
      setStatus('Não foi possível salvar a memória de fornecedores neste navegador.', 'error');
    }
  }

  function rememberSupplier(name) {
    name = standardSupplier(name);
    if (state.memory.suppliers.indexOf(name) < 0) {
      state.memory.suppliers.push(name);
      state.memory.suppliers.sort();
    }
    return name;
  }

  function removeSupplierFromMemory(name) {
    name = standardSupplier(name);
    state.memory.suppliers = state.memory.suppliers.filter(function (supplier) {
      return supplier !== name;
    });
    delete state.memory.aliasRules[name];
    delete state.memory.ignoredWarnings[name];
  }

  function itemTokenKey(item) {
    var tokens = supplierTokens(item && item.descricao);
    var last = tokens[tokens.length - 1] || '';
    return last && last.length >= 3 ? last : '';
  }

  function rememberItemSupplier(item, supplier) {
    var token;

    if (!item) return;
    supplier = rememberSupplier(supplier);
    state.memory.codeRules[item.codigo] = supplier;
    state.memory.codeRules[item.codigoSemZeros] = supplier;
    if (item.supplierAuto && item.supplierAuto !== supplier) {
      state.memory.aliasRules[item.supplierAuto] = supplier;
    }
    token = itemTokenKey(item);
    if (token && !STOP_WORDS[token]) {
      state.memory.tokenRules[token] = supplier;
    }
  }

  function resolveSupplier(item) {
    var token = itemTokenKey(item);
    var supplier;

    supplier = state.memory.codeRules[item.codigo] || state.memory.codeRules[item.codigoSemZeros];
    if (supplier) return { supplier: supplier, source: 'memoria-produto' };

    supplier = state.memory.aliasRules[item.supplierAuto];
    if (supplier) return { supplier: supplier, source: 'memoria-apelido' };

    supplier = token ? state.memory.tokenRules[token] : '';
    if (supplier) return { supplier: supplier, source: 'memoria-palavra' };

    return { supplier: item.supplierAuto || 'FORNECEDOR NAO IDENTIFICADO', source: 'automatico' };
  }

  function setStatus(message, stateName) {
    var status = byId('cortes-status');
    if (!status) return;
    status.textContent = message;
    status.setAttribute('data-state', stateName || 'info');
  }

  function setSummary(kind, className, lines, message) {
    var summary = byId(kind === 'excel' ? 'cf-excel-summary' : 'cf-pdf-summary');
    var lineEl = byId(kind === 'excel' ? 'cf-excel-lines' : 'cf-pdf-lines');
    var stateEl = byId(kind === 'excel' ? 'cf-excel-state' : 'cf-pdf-state');

    if (summary) summary.className = 'import-summary ' + className;
    if (lineEl) lineEl.textContent = (kind === 'excel' ? 'Linhas lidas: ' : 'Itens lidos: ') + lines;
    if (stateEl) stateEl.textContent = message;
  }

  function setDisabled(id, disabled) {
    var el = byId(id);
    if (el) el.disabled = !!disabled;
  }

  function getCurrentUser() {
    var operatorName;

    try {
      if (window.parent && window.parent !== window && window.parent.CURRENT_USER) {
        return window.parent.CURRENT_USER;
      }
    } catch (err) {
      return null;
    }

    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        operatorName = getParentOperatorName(window.parent.document);
        if (operatorName) {
          return {
            name: operatorName,
            role: operatorName === 'GERENTE' ? 'viewer' : (operatorName === 'COMPRAS' ? 'compras' : 'admin')
          };
        }
      }
    } catch (err2) {
      return null;
    }

    return null;
  }

  function getParentOperatorName(parentDocument) {
    var userEl = parentDocument.getElementById('seg-user');
    var topEl = parentDocument.getElementById('tb-op');
    var segOp = parentDocument.getElementById('seg-op');
    var value = '';

    if (userEl) value = userEl.textContent || '';
    if (!value && topEl) value = topEl.textContent || '';
    if (!value && segOp) value = (segOp.textContent || '').replace(/^Operador\s*:\s*/i, '');

    value = String(value || '').trim().toUpperCase();
    if (!value || value === 'JHONNY' || value === '-') return '';
    return value;
  }

  function renderAccess() {
    var app = byId('cortes-app');
    var denied = byId('cortes-denied');

    state.currentUser = getCurrentUser();
    state.canAccess = !!(state.currentUser && state.currentUser.name === 'TRANSFERENCIA');

    if (app) app.classList.toggle('is-hidden', !state.canAccess);
    if (denied) denied.classList.toggle('is-hidden', state.canAccess);
  }

  function watchAccess() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      renderAccess();
      if (state.canAccess || tries >= 120) clearInterval(timer);
    }, 500);

    window.addEventListener('focus', renderAccess);
    document.addEventListener('visibilitychange', renderAccess);
  }

  function getXLSX() {
    try {
      if (window.parent && window.parent.XLSX) return window.parent.XLSX;
    } catch (err) {
      return null;
    }
    return window.XLSX || null;
  }

  function getPDFJS() {
    var pdfjs = null;
    try {
      if (window.parent && window.parent.pdfjsLib) pdfjs = window.parent.pdfjsLib;
    } catch (err) {
      pdfjs = null;
    }
    if (!pdfjs && window.pdfjsLib) pdfjs = window.pdfjsLib;
    if (pdfjs && pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return pdfjs;
  }

  function pickSheetName(workbook) {
    var sheets = workbook && workbook.SheetNames ? workbook.SheetNames : [];
    var exportSheet = sheets.find(function (name) {
      return normalizeHeader(name) === 'EXPORT';
    });
    return exportSheet || sheets[0] || '';
  }

  function workbookRows(XLSX, workbook) {
    var sheetName = pickSheetName(workbook);
    var rows;

    if (!sheetName) return null;
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    return rows.filter(function (row) {
      return row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; });
    });
  }

  function headerMap(headers) {
    var map = {};
    headers.forEach(function (name, idx) {
      map[normalizeHeader(name)] = idx;
    });
    return map;
  }

  function headerIndex(map, key) {
    var aliases = HEADER_ALIASES[key] || [key];
    var i;
    var idx;

    for (i = 0; i < aliases.length; i += 1) {
      idx = map[normalizeHeader(aliases[i])];
      if (idx !== undefined) return idx;
    }
    return undefined;
  }

  function findHeaderRow(rows) {
    var i;
    var map;

    for (i = 0; i < rows.length; i += 1) {
      map = headerMap(rows[i]);
      if (headerIndex(map, 'codigo') !== undefined && headerIndex(map, 'descricao') !== undefined) return i;
    }
    return 0;
  }

  function cell(row, map, key) {
    var idx = headerIndex(map, key);
    return idx === undefined ? '' : row[idx];
  }

  function validateHeaders(headers) {
    var map = headerMap(headers);
    var missing = REQUIRED_HEADERS.filter(function (item) {
      return headerIndex(map, item.key) === undefined;
    }).map(function (item) {
      return item.label;
    });
    return {
      valid: missing.length === 0,
      missing: missing
    };
  }

  function parseExcelItems(rows) {
    var headerRow = findHeaderRow(rows);
    var headers = rows[headerRow] || [];
    var validation = validateHeaders(headers);
    var map = headerMap(headers);
    var items = [];

    if (!validation.valid) {
      return {
        valid: false,
        headers: headers,
        rows: [],
        items: [],
        message: 'Cabeçalhos ausentes: ' + validation.missing.join(', ') + '.'
      };
    }

    rows.slice(headerRow + 1).forEach(function (row, offset) {
      var codigo = code(cell(row, map, 'codigo'));
      var descricao = String(cell(row, map, 'descricao') || '').trim();
      var sugestao = numberValue(cell(row, map, 'sugestao'));
      var item;

      if (!codigo || !descricao) return;
      item = {
        codigo: codigo,
        codigoSemZeros: codeNoZeros(codigo),
        descricao: descricao,
        classe: String(cell(row, map, 'classe') || '').trim(),
        mediaDia: numberValue(cell(row, map, 'mediaDia')),
        estoque: numberValue(cell(row, map, 'estoque')),
        disponivel: numberValue(cell(row, map, 'disponivel')),
        estoqueMinimo: numberValue(cell(row, map, 'estoqueMinimo')),
        cobertura: numberValue(cell(row, map, 'cobertura')),
        sugestao: sugestao,
        previsto: numberValue(cell(row, map, 'previsto')),
        numero: String(cell(row, map, 'numero') || '').trim(),
        rowNumber: headerRow + offset + 2
      };
      item.supplierAuto = guessSupplier(item.descricao);
      item.supplier = item.supplierAuto;
      items.push(item);
    });

    return {
      valid: items.length > 0,
      headers: headers,
      rows: rows.slice(headerRow + 1),
      items: items,
      message: items.length ? 'Excel validado. ' + items.length + ' itens lidos.' : 'Nenhum item com código e descrição foi encontrado.'
    };
  }

  function readExcelFile(file) {
    var XLSX = getXLSX();
    var reader;

    if (!file) {
      state.excel = resetExcelState();
      renderAll();
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      setExcelError(file.name, 'Selecione um arquivo .xlsx válido.');
      return;
    }
    if (!XLSX) {
      setExcelError(file.name, 'Biblioteca XLSX não encontrada.');
      return;
    }

    setStatus('Lendo Excel do BI...', 'busy');
    state.excel.fileName = file.name;
    byId('cf-excel-file').textContent = file.name;
    setSummary('excel', 'import-empty', 0, 'Lendo arquivo...');
    reader = new FileReader();
    reader.onload = function (event) {
      var workbook;
      var rows;
      var parsed;

      try {
        workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        rows = workbookRows(XLSX, workbook) || [];
        parsed = parseExcelItems(rows);
        state.excel.fileName = file.name;
        state.excel.headers = parsed.headers;
        state.excel.rows = parsed.rows;
        state.excel.items = parsed.items;
        state.excel.suggestions = parsed.items.filter(function (item) { return item.sugestao > 0; });
        state.excel.valid = parsed.valid;
        state.excel.message = parsed.message;
        state.analysis.ready = false;
        state.analysis.cuts = [];
        state.analysis.suppliers = [];
        state.supplierOverrides = {};
        renderAll();
        setStatus(parsed.valid ? 'Excel carregado. Importe o PDF para continuar.' : parsed.message, parsed.valid ? 'ok' : 'error');
      } catch (err) {
        setExcelError(file.name, 'Não foi possível ler o Excel: ' + err.message);
      }
    };
    reader.onerror = function () {
      setExcelError(file.name, 'Falha ao ler o arquivo Excel.');
    };
    reader.readAsArrayBuffer(file);
  }

  function setExcelError(fileName, message) {
    state.excel = resetExcelState();
    state.excel.fileName = fileName || '';
    state.excel.message = message;
    byId('cf-excel-file').textContent = fileName || 'Nenhum arquivo selecionado';
    setSummary('excel', 'import-error', 0, message);
    setStatus(message, 'error');
    renderActions();
    renderKpis();
  }

  function resetExcelState() {
    return {
      fileName: '',
      headers: [],
      rows: [],
      items: [],
      suggestions: [],
      valid: false,
      message: 'Aguardando Excel do BI.'
    };
  }

  function pdfLinesFromContent(content) {
    var items = (content.items || []).map(function (item) {
      var transform = item.transform || [0, 0, 0, 0, 0, 0];
      return {
        text: String(item.str || '').trim(),
        x: transform[4] || 0,
        y: transform[5] || 0
      };
    }).filter(function (item) {
      return item.text;
    });
    var lines = [];
    var current = null;

    items.sort(function (a, b) {
      if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
      return a.x - b.x;
    });

    items.forEach(function (item) {
      if (!current || Math.abs(current.y - item.y) > 2) {
        current = { y: item.y, parts: [item.text] };
        lines.push(current);
      } else {
        current.parts.push(item.text);
      }
    });

    return lines.map(function (line) {
      return line.parts.join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  function readPdfLines(pdfjs, data) {
    return pdfjs.getDocument({ data: data }).promise.then(function (pdf) {
      var allLines = [];
      var sequence = Promise.resolve();
      var pageNumber;

      for (pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        (function (num) {
          sequence = sequence.then(function () {
            return pdf.getPage(num).then(function (page) {
              return page.getTextContent().then(function (content) {
                allLines = allLines.concat(pdfLinesFromContent(content));
              });
            });
          });
        })(pageNumber);
      }
      return sequence.then(function () {
        return allLines;
      });
    });
  }

  function parsePdfMeta(lines) {
    var text = lines.join(' ');
    var meta = {};
    var match;

    match = text.match(/Numero\s*:?\s*(\d+)/i);
    if (match) meta.numero = match[1];
    match = text.match(/Status\s*:?\s*(.+?)\s*Filial destino\s*:/i);
    if (match) meta.status = match[1].trim();
    match = text.match(/Filial destino\s*:?\s*(.+?)\s*CNPJ\s*:/i);
    if (match) meta.filial = match[1].trim();
    match = text.match(/CNPJ\s*:?\s*(\d{8,})/i);
    if (match) meta.cnpj = match[1];
    match = text.match(/Data solicitacao\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (match) meta.data = match[1];
    match = text.match(/Validade\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (match) meta.validade = match[1];

    return meta;
  }

  function isPdfNoise(line) {
    return /^(SOLICITACAO|RESUMO|SOLICITADA|CODIGO|STATUS|FILTROS|VISUAL SISTEMAS|PAGINA)\b/i.test(line);
  }

  function parsePdfItems(lines) {
    var items = [];
    var seen = {};

    lines.forEach(function (line, idx) {
      var clean = String(line || '').replace(/\s+/g, ' ').trim();
      var match;
      var codigo;
      var after;
      var impIndex;
      var numbersText;
      var numbers;
      var item;

      if (!clean || isPdfNoise(clean)) return;
      match = clean.match(/^(\d{1,14})\s+(.+)$/);
      if (!match) return;
      codigo = code(match[1]);
      if (!codigo) return;

      after = match[2];
      impIndex = after.search(/\bImp\b/i);
      if (impIndex < 0) return;
      numbersText = after.slice(impIndex + 3);
      numbers = numbersText.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d+)?/g) || [];
      item = {
        codigo: codigo,
        codigoSemZeros: codeNoZeros(codigo),
        descricao: after.slice(0, impIndex).trim(),
        origem: 'Imp',
        solicitada: numberValue(numbers[0]),
        importada: numberValue(numbers[1]),
        emPedidos: numberValue(numbers[2]),
        atendida: numberValue(numbers[3]),
        comErro: numberValue(numbers[4]),
        valorPendente: numberValue(numbers[5]),
        valorAtendido: numberValue(numbers[6]),
        status: lines[idx + 1] && !/^\d{1,14}\s+/.test(lines[idx + 1]) ? String(lines[idx + 1]).trim() : ''
      };

      if (!seen[item.codigoSemZeros]) {
        seen[item.codigoSemZeros] = item;
        items.push(item);
      }
    });

    return items;
  }

  function readPdfFile(file) {
    var pdfjs = getPDFJS();
    var reader;

    if (!file) {
      state.pdf = resetPdfState();
      renderAll();
      return;
    }
    if (!/\.pdf$/i.test(file.name)) {
      setPdfError(file.name, 'Selecione um arquivo .pdf válido.');
      return;
    }
    if (!pdfjs) {
      setPdfError(file.name, 'Biblioteca PDF.js não encontrada.');
      return;
    }

    setStatus('Lendo PDF da solicitação...', 'busy');
    state.pdf.fileName = file.name;
    byId('cf-pdf-file').textContent = file.name;
    setSummary('pdf', 'import-empty', 0, 'Lendo arquivo...');
    reader = new FileReader();
    reader.onload = function (event) {
      readPdfLines(pdfjs, new Uint8Array(event.target.result)).then(function (lines) {
        var items = parsePdfItems(lines);
        var codes = {};

        items.forEach(function (item) {
          codes[item.codigo] = true;
          codes[item.codigoSemZeros] = true;
        });
        state.pdf.fileName = file.name;
        state.pdf.lines = lines;
        state.pdf.items = items;
        state.pdf.codes = codes;
        state.pdf.meta = parsePdfMeta(lines);
        state.pdf.valid = items.length > 0;
        state.pdf.message = items.length ? 'PDF validado. ' + items.length + ' itens lidos.' : 'Nenhum item da solicitação foi encontrado no PDF.';
        state.analysis.ready = false;
        state.analysis.cuts = [];
        state.analysis.suppliers = [];
        renderAll();
        setStatus(state.pdf.valid ? 'PDF carregado. Clique em Analisar Cortes.' : state.pdf.message, state.pdf.valid ? 'ok' : 'error');
      }).catch(function (err) {
        setPdfError(file.name, 'Não foi possível ler o PDF: ' + err.message);
      });
    };
    reader.onerror = function () {
      setPdfError(file.name, 'Falha ao ler o arquivo PDF.');
    };
    reader.readAsArrayBuffer(file);
  }

  function setPdfError(fileName, message) {
    state.pdf = resetPdfState();
    state.pdf.fileName = fileName || '';
    state.pdf.message = message;
    byId('cf-pdf-file').textContent = fileName || 'Nenhum PDF selecionado';
    setSummary('pdf', 'import-error', 0, message);
    setStatus(message, 'error');
    renderActions();
    renderKpis();
    renderMeta();
  }

  function resetPdfState() {
    return {
      fileName: '',
      lines: [],
      items: [],
      codes: {},
      meta: {},
      valid: false,
      message: 'Aguardando PDF da solicitação.'
    };
  }

  function supplierTokens(description) {
    return normalizeText(description)
      .toUpperCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^A-Z0-9 /-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(function (token) {
        if (!token) return false;
        if (STOP_WORDS[token]) return false;
        if (/^C\/?\d+/i.test(token)) return false;
        if (/^\d/.test(token)) return false;
        if (/^\d+(ML|G|KG|L|CM|MM|MT)$/i.test(token)) return false;
        return token.length > 1;
      });
  }

  function guessSupplier(description) {
    var tokens = supplierTokens(description);
    var last = tokens[tokens.length - 1] || '';
    var previous = tokens[tokens.length - 2] || '';

    if (!last) return 'FORNECEDOR NAO IDENTIFICADO';
    if (previous && previous.length > 2 && last.length > 2 && !/^(SABOR|TIPO|MODELO)$/i.test(previous)) {
      if (['DO', 'DA', 'DE', 'DOS', 'DAS'].indexOf(previous) >= 0) return last;
      if ((previous + ' ' + last).length <= 26 && shouldUseTwoTokenSupplier(previous, last)) {
        return previous + ' ' + last;
      }
    }
    return last;
  }

  function shouldUseTwoTokenSupplier(previous, last) {
    var joined = previous + ' ' + last;
    if (/^(REI DAVI|LUZ NOBRE|DA SO|DO BRASIL|COMERCIAL NORTE|COMERCIAL DO)$/i.test(joined)) return true;
    return previous.length <= 4 && last.length >= 4;
  }

  function runAnalysis() {
    var cuts;

    if (!state.excel.valid || !state.pdf.valid) {
      setStatus('Importe um Excel e um PDF válidos antes de analisar.', 'error');
      return;
    }

    cuts = state.excel.suggestions.filter(function (item) {
      return !state.pdf.codes[item.codigo] && !state.pdf.codes[item.codigoSemZeros];
    }).map(function (item) {
      var resolved;
      var copy = Object.assign({}, item);
      resolved = resolveSupplier(copy);
      copy.supplier = resolved.supplier;
      copy.supplierSource = resolved.source;
      return copy;
    });

    state.analysis.ready = true;
    state.analysis.cuts = cuts;
    state.analysis.suppliers = groupSuppliers(cuts);
    state.selectedItems = {};
    renderAll();
    setStatus(cuts.length + ' item(ns) cortado(s) encontrados em ' + state.analysis.suppliers.length + ' fornecedor(es).', 'ok');
  }

  function groupSuppliers(cuts) {
    var map = {};
    var suppliers;

    cuts.forEach(function (item) {
      var supplier = item.supplier || item.supplierAuto || 'FORNECEDOR NAO IDENTIFICADO';
      if (!map[supplier]) {
        map[supplier] = {
          supplier: supplier,
          items: [],
          totalSugestao: 0,
          totalEstoque: 0,
          learned: 0,
          automatic: 0,
          warning: null
        };
      }
      map[supplier].items.push(item);
      map[supplier].totalSugestao += Number(item.sugestao) || 0;
      map[supplier].totalEstoque += Number(item.estoque) || 0;
      if (String(item.supplierSource || '').indexOf('memoria') === 0) map[supplier].learned += 1;
      else map[supplier].automatic += 1;
    });

    suppliers = Object.keys(map).map(function (key) {
      return map[key];
    });
    suppliers.sort(function (a, b) {
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      if (b.totalSugestao !== a.totalSugestao) return b.totalSugestao - a.totalSugestao;
      return a.supplier.localeCompare(b.supplier);
    });
    suppliers.forEach(function (supplier) {
      supplier.items.sort(function (a, b) {
        return String(a.descricao).localeCompare(String(b.descricao));
      });
      supplier.warning = supplierWarning(supplier);
    });
    return suppliers;
  }

  function updateSupplier(oldName, newName) {
    oldName = standardSupplier(oldName);
    newName = rememberSupplier(newName);
    state.analysis.cuts.forEach(function (item) {
      var current = standardSupplier(item.supplier || item.supplierAuto);
      if (current === oldName) {
        rememberItemSupplier(item, newName);
        item.supplier = newName;
        item.supplierSource = 'memoria-produto';
      }
    });
    if (oldName !== newName) state.memory.aliasRules[oldName] = newName;
    saveMemory();
    state.analysis.suppliers = groupSuppliers(state.analysis.cuts);
    renderSupplierOptions();
    renderResults();
    renderKpis();
    setStatus('Fornecedor revisado: ' + oldName + ' → ' + newName + '.', 'ok');
  }

  function supplierWarning(supplier) {
    var name = supplier.supplier;
    var suspiciousWords = /(^| )(SUCO|PEQ|PEQUENO|GRANDE|MED|MEDIA|BASE|TAMPA|TPA|POTE|SACO|SACOLA|EMB|TRANS|COLOR|BR|PET|MIL|KG|ML|UND|UN)( |$)/;

    if (state.memory.ignoredWarnings[name]) return null;
    if (name === 'FORNECEDOR NAO IDENTIFICADO') return 'Fornecedor não identificado. Vale revisar estes itens.';
    if (supplier.learned > 0 && supplier.automatic === 0) return null;
    if (supplier.items.length <= 2 && name.indexOf(' ') > 0) return 'Nome composto com poucos itens. Pode ser parte da descrição, não fornecedor.';
    if (suspiciousWords.test(name)) return 'Nome parece conter embalagem, tamanho ou título de produto.';
    if (supplier.items.length === 1 && supplier.automatic > 0) return 'Fornecedor apareceu uma única vez e ainda não foi confirmado na memória.';
    return null;
  }

  function selectedCodes() {
    return Object.keys(state.selectedItems || {}).filter(function (codigo) {
      return !!state.selectedItems[codigo];
    });
  }

  function findCutByCode(codigo) {
    return state.analysis.cuts.find(function (item) {
      return item.codigo === codigo || item.codigoSemZeros === codigo;
    });
  }

  function applySupplierToCodes(codes, supplier) {
    var changed = 0;

    supplier = rememberSupplier(supplier);
    codes.forEach(function (codigo) {
      var item = findCutByCode(codigo);
      if (!item) return;
      rememberItemSupplier(item, supplier);
      item.supplier = supplier;
      item.supplierSource = 'memoria-produto';
      changed += 1;
    });
    saveMemory();
    state.selectedItems = {};
    state.analysis.suppliers = groupSuppliers(state.analysis.cuts);
    renderAll();
    setStatus(changed + ' item(ns) movido(s) para ' + supplier + '. Vou lembrar disso nas próximas análises.', 'ok');
  }

  function applySelectedSupplier() {
    var select = byId('cf-target-supplier');
    var codes = selectedCodes();
    var supplier = select ? select.value : '';

    if (!codes.length) {
      setStatus('Selecione ao menos um item para classificar.', 'error');
      return;
    }
    if (!supplier) {
      setStatus('Escolha um fornecedor de destino.', 'error');
      return;
    }
    applySupplierToCodes(codes, supplier);
  }

  function createSupplier() {
    var input = byId('cf-new-supplier');
    var name = input ? input.value : '';

    name = standardSupplier(name);
    if (!name || name === 'FORNECEDOR NAO IDENTIFICADO') {
      setStatus('Informe um nome de fornecedor válido.', 'error');
      return;
    }
    rememberSupplier(name);
    saveMemory();
    if (input) input.value = '';
    renderSupplierOptions();
    setStatus('Fornecedor criado na memória: ' + name + '.', 'ok');
  }

  function deleteSupplierName(name) {
    var fallback = 'FORNECEDOR NAO IDENTIFICADO';
    var changed = 0;

    name = standardSupplier(name);
    if (!window.confirm('Excluir o fornecedor "' + name + '" da prévia e da memória? Os itens voltarão para "Fornecedor não identificado".')) {
      return;
    }
    removeSupplierFromMemory(name);
    state.analysis.cuts.forEach(function (item) {
      if (standardSupplier(item.supplier) === name) {
        item.supplier = fallback;
        item.supplierSource = 'automatico';
        state.memory.codeRules[item.codigo] = fallback;
        state.memory.codeRules[item.codigoSemZeros] = fallback;
        changed += 1;
      }
    });
    saveMemory();
    state.analysis.suppliers = groupSuppliers(state.analysis.cuts);
    renderAll();
    setStatus('Fornecedor excluído. ' + changed + ' item(ns) voltaram para revisão.', 'ok');
  }

  function ignoreSupplierWarning(name) {
    name = standardSupplier(name);
    state.memory.ignoredWarnings[name] = true;
    saveMemory();
    state.analysis.suppliers = groupSuppliers(state.analysis.cuts);
    renderResults();
    setStatus('Aviso dispensado para ' + name + '.', 'ok');
  }

  function renderSupplierOptions() {
    var select = byId('cf-target-supplier');
    var names = {};
    var html = '<option value="">Selecionar fornecedor...</option>';

    state.memory.suppliers.forEach(function (supplier) {
      names[supplier] = true;
    });
    state.analysis.suppliers.forEach(function (supplier) {
      names[supplier.supplier] = true;
    });
    Object.keys(names).sort().forEach(function (supplier) {
      html += '<option value="' + escapeHtml(supplier) + '">' + escapeHtml(supplier) + '</option>';
    });
    if (select) select.innerHTML = html;
  }

  function renderKpis() {
    var totalQty = state.analysis.cuts.reduce(function (sum, item) {
      return sum + (Number(item.sugestao) || 0);
    }, 0);

    byId('cf-kpi-excel').textContent = fmtNumber(state.excel.items.length);
    byId('cf-kpi-sug').textContent = fmtNumber(state.excel.suggestions.length);
    byId('cf-kpi-pdf').textContent = fmtNumber(state.pdf.items.length);
    byId('cf-kpi-cortes').textContent = fmtNumber(state.analysis.cuts.length);
    byId('cf-kpi-forn').textContent = fmtNumber(state.analysis.suppliers.length);
    byId('cf-kpi-qtd').textContent = fmtQty(totalQty);
  }

  function renderSummaries() {
    var excelClass = state.excel.valid ? 'import-ok' : (state.excel.fileName ? 'import-error' : 'import-empty');
    var pdfClass = state.pdf.valid ? 'import-ok' : (state.pdf.fileName ? 'import-error' : 'import-empty');

    byId('cf-excel-file').textContent = state.excel.fileName || 'Nenhum arquivo selecionado';
    byId('cf-pdf-file').textContent = state.pdf.fileName || 'Nenhum PDF selecionado';
    setSummary('excel', excelClass, state.excel.items.length, state.excel.message);
    setSummary('pdf', pdfClass, state.pdf.items.length, state.pdf.message);
  }

  function renderMeta() {
    var meta = state.pdf.meta || {};
    byId('cf-meta-numero').textContent = meta.numero || '-';
    byId('cf-meta-status').textContent = meta.status || '-';
    byId('cf-meta-filial').textContent = meta.filial || '-';
    byId('cf-meta-data').textContent = meta.data || '-';
    byId('cf-meta-validade').textContent = meta.validade || '-';
    byId('cf-meta-cnpj').textContent = meta.cnpj || '-';
  }

  function renderActions() {
    var canAnalyze = state.excel.valid && state.pdf.valid;
    var hasResult = state.analysis.ready;

    setDisabled('cf-btn-analisar', !canAnalyze);
    setDisabled('cf-btn-imprimir', !hasResult);
    setDisabled('cf-btn-excel', !hasResult);
    setDisabled('cf-btn-apply-selected', !hasResult || selectedCodes().length === 0);
    byId('cf-edit-summary').textContent = hasResult
      ? 'Fornecedores agrupados: ' + state.analysis.suppliers.length + ' | Itens cortados: ' + state.analysis.cuts.length
      : 'Revise o fornecedor sugerido antes de imprimir.';
  }

  function renderResults() {
    var empty = byId('cf-empty');
    var results = byId('cf-results');
    var html = '';

    if (!results || !empty) return;
    if (!state.analysis.ready) {
      empty.classList.remove('is-hidden');
      empty.textContent = 'Importe os dois arquivos e clique em Analisar Cortes.';
      results.innerHTML = '';
      return;
    }
    if (!state.analysis.cuts.length) {
      empty.classList.remove('is-hidden');
      empty.textContent = 'Nenhum corte encontrado pelo critério de itens sugeridos no BI ausentes no PDF.';
      results.innerHTML = '';
      return;
    }

    empty.classList.add('is-hidden');
    html += renderSupplierSummary();
    state.analysis.suppliers.forEach(function (supplier, idx) {
      var supplierEsc = escapeHtml(supplier.supplier);
      var warning = supplier.warning;
      html += '<article class="supplier-card">';
      html += '<div class="supplier-head">';
      html += '<label class="supplier-name"><span>Fornecedor ' + (idx + 1) + '</span>'
        + '<input type="text" data-supplier-old="' + supplierEsc + '" value="' + supplierEsc + '" title="Edite para renomear ou mesclar fornecedor"></label>';
      html += '<div class="supplier-stat">Itens<br><strong>' + fmtNumber(supplier.items.length) + '</strong></div>';
      html += '<div class="supplier-stat">Sugestão<br><strong>' + fmtQty(supplier.totalSugestao) + '</strong></div>';
      html += '<div class="supplier-stat">Estoque<br><strong>' + fmtQty(supplier.totalEstoque) + '</strong></div>';
      html += '<div class="supplier-actions">'
        + '<button class="vbtn" type="button" data-action="rename-supplier" data-supplier="' + supplierEsc + '">Salvar nome</button>'
        + '<button class="vbtn" type="button" data-action="delete-supplier" data-supplier="' + supplierEsc + '">Excluir nome</button>'
        + '</div>';
      html += '</div>';
      if (warning) {
        html += '<div class="supplier-warning"><span>Aviso: ' + escapeHtml(warning) + '</span>'
          + '<button class="vbtn" type="button" data-action="ignore-warning" data-supplier="' + supplierEsc + '">Relaxa, está certo</button></div>';
      }
      html += '<div class="table-wrap"><table><thead><tr>'
        + '<th style="width:34px">Sel.</th>'
        + '<th style="width:120px">Código</th>'
        + '<th>Descrição</th>'
        + '<th style="width:70px">Classe</th>'
        + '<th style="width:95px">Estoque</th>'
        + '<th style="width:95px">Cobertura</th>'
        + '<th style="width:95px">Sugestão</th>'
        + '<th style="width:95px">Origem</th>'
        + '<th style="width:75px">Nº BI</th>'
        + '<th style="width:80px">Linha</th>'
        + '</tr></thead><tbody>';
      supplier.items.forEach(function (item) {
        var selected = state.selectedItems[item.codigo] ? ' checked' : '';
        var sourceClass = String(item.supplierSource || '').indexOf('memoria') === 0 ? 'learned-cell' : 'auto-cell';
        var sourceText = String(item.supplierSource || '').indexOf('memoria') === 0 ? 'Memória' : 'Auto';
        html += '<tr>'
          + '<td style="text-align:center"><input class="row-check" type="checkbox" data-code="' + escapeHtml(item.codigo) + '"' + selected + '></td>'
          + '<td class="code">' + escapeHtml(item.codigo) + '</td>'
          + '<td title="' + escapeHtml(item.descricao) + '">' + escapeHtml(item.descricao) + '</td>'
          + '<td>' + escapeHtml(item.classe || '') + '</td>'
          + '<td class="num">' + fmtQty(item.estoque) + '</td>'
          + '<td class="num">' + fmtQty(item.cobertura) + '</td>'
          + '<td class="num">' + fmtQty(item.sugestao) + '</td>'
          + '<td class="' + sourceClass + '">' + sourceText + '</td>'
          + '<td class="num">' + escapeHtml(item.numero || '') + '</td>'
          + '<td class="num">' + escapeHtml(item.rowNumber) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div></article>';
    });
    results.innerHTML = html;

    results.querySelectorAll('[data-supplier-old]').forEach(function (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          updateSupplier(input.getAttribute('data-supplier-old'), input.value);
        }
      });
    });
    results.querySelectorAll('.row-check').forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.checked) state.selectedItems[input.getAttribute('data-code')] = true;
        else delete state.selectedItems[input.getAttribute('data-code')];
        renderActions();
      });
    });
    results.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.getAttribute('data-action');
        var supplier = button.getAttribute('data-supplier');
        var input;

        if (action === 'rename-supplier') {
          input = button.closest('.supplier-card').querySelector('[data-supplier-old]');
          updateSupplier(supplier, input ? input.value : supplier);
        } else if (action === 'delete-supplier') {
          deleteSupplierName(supplier);
        } else if (action === 'ignore-warning') {
          ignoreSupplierWarning(supplier);
        }
      });
    });
  }

  function renderSupplierSummary() {
    var html = '<section class="supplier-summary">'
      + '<div class="supplier-summary-title">Resumo inicial dos fornecedores cortados</div>'
      + '<div class="supplier-summary-grid">';

    state.analysis.suppliers.forEach(function (supplier) {
      html += '<div class="supplier-chip' + (supplier.warning ? ' is-warning' : '') + '">'
        + '<span>' + escapeHtml(supplier.supplier) + '</span>'
        + '<strong>' + fmtNumber(supplier.items.length) + '</strong>'
        + '</div>';
    });
    html += '</div></section>';
    return html;
  }

  function renderAll() {
    renderSummaries();
    renderMeta();
    renderKpis();
    renderActions();
    renderSupplierOptions();
    renderResults();
  }

  function reportTitle() {
    return 'RELATORIO DE CORTES DE FORNECEDORES';
  }

  function printReport() {
    var win;
    var html;
    var meta = state.pdf.meta || {};
    var generated = new Date().toLocaleString('pt-BR');
    var totalQty;

    if (!state.analysis.ready) {
      setStatus('Gere a análise antes de imprimir.', 'error');
      return;
    }

    totalQty = state.analysis.cuts.reduce(function (sum, item) {
      return sum + (Number(item.sugestao) || 0);
    }, 0);
    win = window.open('', '_blank');
    if (!win) {
      setStatus('O navegador bloqueou a janela de impressão.', 'error');
      return;
    }

    html = '<!doctype html><html><head><meta charset="utf-8"><title>' + reportTitle() + '</title><style>'
      + 'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;margin:18px 22px;}'
      + 'h1{font-size:22px;margin:0 0 10px;font-weight:bold;}'
      + '.top{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;margin-bottom:12px;font-size:11px;}'
      + '.top strong{font-weight:bold;}'
      + '.boxrow{display:grid;grid-template-columns:1.1fr 1fr;gap:10px;margin:10px 0;}'
      + '.box{border:1px solid #222;padding:6px 8px;}'
      + '.box h2{font-size:12px;margin:0 0 7px;}'
      + '.kv{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}'
      + '.kv span{display:block;font-weight:bold;}'
      + '.supplier{page-break-inside:avoid;margin-top:10px;}'
      + '.supplier h2{font-size:13px;margin:0;padding:4px 5px;background:#d9d9d9;border:1px solid #777;border-bottom:0;}'
      + 'table{width:100%;border-collapse:collapse;table-layout:fixed;}'
      + 'th{background:#d9d9d9;font-size:9px;text-align:left;border-bottom:1px solid #777;padding:4px 3px;}'
      + 'td{border-bottom:1px solid #777;padding:4px 3px;vertical-align:top;font-size:9.5px;}'
      + 'td.num,th.num{text-align:right;font-family:Courier New,monospace;}'
      + 'td.code{font-family:Courier New,monospace;color:#000080;}'
      + '.supplier-index{margin:10px 0;border:1px solid #777;}'
      + '.supplier-index h2{font-size:12px;margin:0;padding:4px 5px;background:#d9d9d9;border-bottom:1px solid #777;}'
      + '.supplier-index ol{columns:3;margin:6px 10px 8px 26px;padding:0;font-size:10px;}'
      + '.supplier-index li{break-inside:avoid;margin-bottom:3px;}'
      + '.foot{display:flex;justify-content:space-between;margin-top:18px;font-weight:bold;font-size:11px;}'
      + '@page{size:A4 landscape;margin:10mm;}'
      + '@media print{body{margin:0;} .supplier{page-break-inside:avoid;} tr{page-break-inside:avoid;}}'
      + '</style></head><body>';
    html += '<h1>SOLICITACAO DE TRANSFERENCIA - CORTES FORNECEDORES</h1>';
    html += '<div class="top">'
      + '<div><strong>Numero:</strong> ' + escapeHtml(meta.numero || '-') + '</div>'
      + '<div><strong>Status:</strong> ' + escapeHtml(meta.status || '-') + '</div>'
      + '<div><strong>Filial destino:</strong> ' + escapeHtml(meta.filial || '-') + '</div>'
      + '<div><strong>Data solicitacao:</strong> ' + escapeHtml(meta.data || '-') + '</div>'
      + '<div><strong>Validade:</strong> ' + escapeHtml(meta.validade || '-') + '</div>'
      + '<div><strong>CNPJ:</strong> ' + escapeHtml(meta.cnpj || '-') + '</div>'
      + '<div><strong>Gerado em:</strong> ' + escapeHtml(generated) + '</div>'
      + '<div><strong>Excel BI:</strong> ' + escapeHtml(state.excel.fileName || '-') + '</div>'
      + '<div><strong>PDF:</strong> ' + escapeHtml(state.pdf.fileName || '-') + '</div>'
      + '</div>';
    html += '<div class="boxrow"><div class="box"><h2>RESUMO DE QUANTIDADES</h2><div class="kv">'
      + '<div><span>Sugestoes BI</span>' + fmtNumber(state.excel.suggestions.length) + '</div>'
      + '<div><span>Itens PDF</span>' + fmtNumber(state.pdf.items.length) + '</div>'
      + '<div><span>Cortados</span>' + fmtNumber(state.analysis.cuts.length) + '</div>'
      + '<div><span>Fornecedores</span>' + fmtNumber(state.analysis.suppliers.length) + '</div>'
      + '</div></div><div class="box"><h2>RESUMO DE CORTES</h2><div class="kv">'
      + '<div><span>Qtd. cortada</span>' + fmtQty(totalQty) + '</div>'
      + '<div><span>Critério</span>Ausente no PDF</div>'
      + '<div><span>Origem</span>Power BI</div>'
      + '<div><span>Revisão</span>Fornecedor editável</div>'
      + '</div></div></div>';
    html += '<section class="supplier-index"><h2>FORNECEDORES CORTADOS</h2><ol>';
    state.analysis.suppliers.forEach(function (supplier) {
      html += '<li>' + escapeHtml(supplier.supplier) + ' (' + fmtNumber(supplier.items.length) + ')</li>';
    });
    html += '</ol></section>';

    state.analysis.suppliers.forEach(function (supplier) {
      html += '<section class="supplier"><h2>' + escapeHtml(supplier.supplier)
        + ' - ' + fmtNumber(supplier.items.length) + ' item(ns) - sugestao ' + fmtQty(supplier.totalSugestao) + '</h2>';
      html += '<table><thead><tr>'
        + '<th style="width:90px">CODIGO</th><th>DESCRICAO</th><th style="width:48px">CLASSE</th>'
        + '<th class="num" style="width:70px">ESTOQUE</th><th class="num" style="width:70px">COBERTURA</th>'
        + '<th class="num" style="width:70px">SUGESTAO</th><th class="num" style="width:50px">Nº</th>'
        + '</tr></thead><tbody>';
      supplier.items.forEach(function (item) {
        html += '<tr><td class="code">' + escapeHtml(item.codigo) + '</td>'
          + '<td>' + escapeHtml(item.descricao) + '</td>'
          + '<td>' + escapeHtml(item.classe || '') + '</td>'
          + '<td class="num">' + fmtQty(item.estoque) + '</td>'
          + '<td class="num">' + fmtQty(item.cobertura) + '</td>'
          + '<td class="num">' + fmtQty(item.sugestao) + '</td>'
          + '<td class="num">' + escapeHtml(item.numero || '') + '</td></tr>';
      });
      html += '</tbody></table></section>';
    });

    html += '<div class="foot"><span>Visual Sistemas</span><span>Relatorio de cortes de fornecedores</span></div>';
    html += '</body></html>';
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function () {
      win.print();
    }, 250);
    setStatus('Relatório de impressão aberto.', 'ok');
  }

  function exportExcel() {
    var XLSX = getXLSX();
    var rows = [];
    var wb;
    var ws;
    var fileName;

    if (!state.analysis.ready) {
      setStatus('Gere a análise antes de exportar.', 'error');
      return;
    }
    if (!XLSX) {
      setStatus('Biblioteca XLSX não encontrada para exportar.', 'error');
      return;
    }

    rows.push(['Relatorio de Cortes Fornecedores']);
    rows.push(['Excel BI', state.excel.fileName || '']);
    rows.push(['PDF Solicitação', state.pdf.fileName || '']);
    rows.push(['Numero', state.pdf.meta.numero || '']);
    rows.push(['Filial destino', state.pdf.meta.filial || '']);
    rows.push([]);
    rows.push(['Resumo de Fornecedores']);
    rows.push(['Fornecedor', 'Itens', 'Sugestão Total']);
    state.analysis.suppliers.forEach(function (supplier) {
      rows.push([supplier.supplier, supplier.items.length, supplier.totalSugestao]);
    });
    rows.push([]);
    rows.push(['Fornecedor', 'Código', 'Descrição', 'Classe', 'Estoque', 'Cobertura', 'Sugestão', 'Nº BI', 'Linha BI']);
    state.analysis.suppliers.forEach(function (supplier) {
      supplier.items.forEach(function (item) {
        rows.push([
          supplier.supplier,
          item.codigo,
          item.descricao,
          item.classe,
          item.estoque,
          item.cobertura,
          item.sugestao,
          item.numero,
          item.rowNumber
        ]);
      });
    });

    ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 24 }, { wch: 16 }, { wch: 54 }, { wch: 10 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 }
    ];
    wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cortes');
    fileName = 'Cortes_Fornecedores_' + fileDate(new Date()) + '.xlsx';
    XLSX.writeFile(wb, fileName);
    setStatus('Excel gerado: ' + fileName, 'ok');
  }

  function fileDate(date) {
    function pad(value) {
      return String(value).padStart(2, '0');
    }
    return String(date.getFullYear())
      + pad(date.getMonth() + 1)
      + pad(date.getDate())
      + '_'
      + pad(date.getHours())
      + pad(date.getMinutes());
  }

  function clearAll() {
    state.excel = resetExcelState();
    state.pdf = resetPdfState();
    state.analysis.ready = false;
    state.analysis.cuts = [];
    state.analysis.suppliers = [];
    state.supplierOverrides = {};
    state.selectedItems = {};
    if (byId('cf-excel-input')) byId('cf-excel-input').value = '';
    if (byId('cf-pdf-input')) byId('cf-pdf-input').value = '';
    renderAll();
    setStatus('Aguardando importações', 'info');
  }

  function bindEvents() {
    var excelInput = byId('cf-excel-input');
    var pdfInput = byId('cf-pdf-input');
    var analyze = byId('cf-btn-analisar');
    var print = byId('cf-btn-imprimir');
    var excel = byId('cf-btn-excel');
    var clear = byId('cf-btn-limpar');
    var create = byId('cf-btn-create-supplier');
    var apply = byId('cf-btn-apply-selected');
    var newSupplier = byId('cf-new-supplier');

    if (excelInput) {
      excelInput.addEventListener('change', function () {
        readExcelFile(excelInput.files && excelInput.files[0]);
      });
    }
    if (pdfInput) {
      pdfInput.addEventListener('change', function () {
        readPdfFile(pdfInput.files && pdfInput.files[0]);
      });
    }
    if (analyze) analyze.addEventListener('click', runAnalysis);
    if (print) print.addEventListener('click', printReport);
    if (excel) excel.addEventListener('click', exportExcel);
    if (clear) clear.addEventListener('click', clearAll);
    if (create) create.addEventListener('click', createSupplier);
    if (apply) apply.addEventListener('click', applySelectedSupplier);
    if (newSupplier) {
      newSupplier.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          createSupplier();
        }
      });
    }
  }

  bindEvents();
  renderAll();
  renderAccess();
  watchAccess();
})();
