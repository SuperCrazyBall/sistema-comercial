'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = 9127;
const bridgeRoot = __dirname;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) reject(new Error('Payload muito grande.'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function tempName(ext) {
  return path.join(os.tmpdir(), `sistema-comercial-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
}

function runPowerShell(script) {
  const file = tempName('.ps1');
  fs.writeFileSync(file, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: false,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      fs.rm(file, { force: true }, () => {});
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function psString(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, "''")}'`;
}

function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

async function listPrinters() {
  const output = await runPowerShell(`
$printers = Get-CimInstance Win32_Printer | Sort-Object Name | ForEach-Object {
  [PSCustomObject]@{
    name = $_.Name
    isDefault = [bool]$_.Default
    driver = $_.DriverName
    port = $_.PortName
  }
}
$printers | ConvertTo-Json -Depth 4
`);
  const parsed = output ? JSON.parse(output) : [];
  const printers = Array.isArray(parsed) ? parsed : [parsed];
  const defaultPrinter = (printers.find(printer => printer.isDefault) || printers[0] || {}).name || '';
  return { ok: true, printers, defaultPrinter };
}

async function openPrinterProperties(printer) {
  if (!printer) throw new Error('Impressora não informada.');
  await runPowerShell(`
$printer = ${psString(printer)}
Start-Process rundll32.exe -ArgumentList @('printui.dll,PrintUIEntry','/p','/n',$printer)
`);
  return { ok: true };
}

async function saveDialog(fileName, filter) {
  const isExcel = filter === 'xlsx';
  const defaultExt = isExcel ? 'xlsx' : 'pdf';
  const dialogFilter = 'Padrão|*.*|Documento PDF (*.pdf)|*.pdf|Planilha Excel (*.xlsx)|*.xlsx';
  const output = await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'Salvar como'
$dialog.FileName = ${psString(fileName || `Cortes_Fornecedores.${defaultExt}`)}
$dialog.Filter = ${psString(dialogFilter)}
$dialog.DefaultExt = ${psString(defaultExt)}
$dialog.FilterIndex = ${isExcel ? 3 : 2}
$dialog.OverwritePrompt = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [PSCustomObject]@{ ok = $true; path = $dialog.FileName } | ConvertTo-Json -Compress
} else {
  [PSCustomObject]@{ ok = $true; path = '' } | ConvertTo-Json -Compress
}
`);
  return JSON.parse(output);
}

function renderPdf(html, outputPath) {
  const edge = findEdge();
  const htmlPath = tempName('.html');
  const pdfPath = outputPath || tempName('.pdf');
  const userDataDir = tempName('');

  if (!edge) throw new Error('Microsoft Edge ou Google Chrome não foi encontrado para gerar PDF.');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.mkdirSync(userDataDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--user-data-dir=${userDataDir}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ];
    const child = spawn(edge, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      fs.rm(htmlPath, { force: true }, () => {});
      fs.rm(userDataDir, { force: true, recursive: true }, () => {});
      if (code !== 0 || !fs.existsSync(pdfPath)) {
        reject(new Error((stderr || `Falha ao gerar PDF pelo navegador local. Código: ${code}`).trim()));
        return;
      }
      resolve(pdfPath);
    });
  });
}

function stripHtmlText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h1|h2|h3|tr|table|section|div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function renderPdfFallback(html, outputPath) {
  const textPath = tempName('.txt');
  const pdfPath = outputPath || tempName('.pdf');
  fs.writeFileSync(textPath, stripHtmlText(html), 'utf8');
  await runPowerShell(`
Add-Type -AssemblyName System.Drawing
$text = Get-Content -LiteralPath ${psString(textPath)} -Raw
$out = ${psString(pdfPath)}
$escaped = $text.Replace('\\', '\\\\').Replace('(', '\\(').Replace(')', '\\)')
$lines = @()
foreach ($line in $escaped -split "\`r?\`n") {
  while ($line.Length -gt 150) {
    $lines += $line.Substring(0, 150)
    $line = $line.Substring(150)
  }
  $lines += $line
}
$objects = New-Object System.Collections.Generic.List[string]
$content = "BT /F1 8 Tf 34 560 Td 10 TL "
foreach ($line in $lines) {
  $content += "($line) Tj T* "
}
$content += "ET"
$objects.Add("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj")
$objects.Add("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj")
$objects.Add("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj")
$objects.Add("4 0 obj << /Length $($content.Length) >> stream\`n$content\`nendstream endobj")
$objects.Add("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj")
$bytes = New-Object System.Text.StringBuilder
[void]$bytes.Append("%PDF-1.4\`n")
$offsets = @(0)
foreach ($obj in $objects) {
  $offsets += $bytes.Length
  [void]$bytes.Append($obj).Append("\`n")
}
$xref = $bytes.Length
[void]$bytes.Append("xref\`n0 6\`n0000000000 65535 f \`n")
for ($i = 1; $i -lt $offsets.Count; $i++) {
  [void]$bytes.Append($offsets[$i].ToString("0000000000")).Append(" 00000 n \`n")
}
[void]$bytes.Append("trailer << /Size 6 /Root 1 0 R >>\`nstartxref\`n").Append($xref).Append("\`n%%EOF")
[System.IO.File]::WriteAllText($out, $bytes.ToString(), [System.Text.Encoding]::ASCII)
`);
  fs.rm(textPath, { force: true }, () => {});
  if (!fs.existsSync(pdfPath)) throw new Error('Falha ao gerar PDF de contingência.');
  return pdfPath;
}

async function renderPdfSafe(html, outputPath) {
  try {
    return await renderPdf(html, outputPath);
  } catch (err) {
    console.warn('Edge/Chrome não gerou PDF, usando fallback textual:', err.message);
    return renderPdfFallback(html, outputPath);
  }
}

async function savePdf(payload) {
  if (!payload.path) throw new Error('Caminho do PDF não informado.');
  const outputPath = path.resolve(payload.path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const pdfPath = await renderPdfSafe(payload.html || '', outputPath);
  return { ok: true, path: pdfPath };
}

async function saveFile(payload) {
  if (!payload.path) throw new Error('Caminho não informado.');
  if (!payload.base64) throw new Error('Conteúdo do arquivo não informado.');
  const outputPath = path.resolve(payload.path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(payload.base64, 'base64'));
  return { ok: true, path: outputPath };
}

async function printReport(payload) {
  const printer = payload.printer || '';
  const pdfPath = await renderPdfSafe(payload.html || '', tempName('.pdf'));
  let warning = '';

  if (!printer) {
    warning = `PDF gerado em ${pdfPath}, mas nenhuma impressora foi selecionada.`;
    return { ok: true, path: pdfPath, warning };
  }

  try {
    await runPowerShell(`
$printerName = ${psString(printer)}
$pdf = ${psString(pdfPath)}
$current = Get-WmiObject -Class Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 -ExpandProperty Name
$target = Get-WmiObject -Class Win32_Printer | Where-Object { $_.Name -eq $printerName } | Select-Object -First 1
if (-not $target) { throw 'Impressora nao encontrada: ' + $printerName }
[void]$target.SetDefaultPrinter()
Start-Process -FilePath $pdf -Verb Print -WindowStyle Hidden
Start-Sleep -Seconds 5
if ($current) {
  $old = Get-WmiObject -Class Win32_Printer | Where-Object { $_.Name -eq $current } | Select-Object -First 1
  if ($old) { [void]$old.SetDefaultPrinter() }
}
`);
  } catch (err) {
    warning = `PDF gerado em ${pdfPath}. O Windows não permitiu impressão silenciosa: ${err.message}`;
  }

  return { ok: true, path: pdfPath, warning };
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    send(res, 204, { ok: true });
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/status') {
      send(res, 200, { ok: true, name: 'Sistema Comercial Print Bridge' });
      return;
    }
    if (req.method === 'GET' && req.url === '/printers') {
      send(res, 200, await listPrinters());
      return;
    }

    const payload = req.method === 'POST' ? await readJson(req) : {};
    if (req.method === 'POST' && req.url === '/printer-properties') send(res, 200, await openPrinterProperties(payload.printer));
    else if (req.method === 'POST' && req.url === '/save-dialog') send(res, 200, await saveDialog(payload.fileName, payload.filter));
    else if (req.method === 'POST' && req.url === '/save-pdf') send(res, 200, await savePdf(payload));
    else if (req.method === 'POST' && req.url === '/save-file') send(res, 200, await saveFile(payload));
    else if (req.method === 'POST' && req.url === '/print') send(res, 200, await printReport(payload));
    else send(res, 404, { ok: false, error: 'Endpoint não encontrado.' });
  } catch (err) {
    send(res, 500, { ok: false, error: err.message });
  }
}

http.createServer(route).listen(PORT, '127.0.0.1', () => {
  console.log(`Sistema Comercial Print Bridge ativo em http://127.0.0.1:${PORT}`);
});
