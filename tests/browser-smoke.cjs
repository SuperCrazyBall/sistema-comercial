// Run with node tests/browser-smoke.cjs after installing Playwright.
// All Supabase requests are mocked; this test never writes production data.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const version = '2026-10-30T12:00:00.123456+00:00';
const records = new Map(Array.from({ length: 125 }, (_, i) => {
  const id = String(i).padStart(4, '0');
  return [id, { id, updated_at: version, deleted_at: null, data: {
    id, numero: id, filial: 'Filial A', gestor: 'Vendedor', data: '30/10/2026',
    savedAt: version, createdAt: version, total: '8,00', products: [
      { codigo: '10', nome: 'Produto A', status: 'sent', unidade: 'UND', qtdSolicitada: 1, qtdEnviada: 1, vlUnit: '3,00', vlTotal: '3,00' },
      { codigo: '20', nome: 'Produto B', status: 'cut', unidade: 'UND', qtdSolicitada: 1, qtdEnviada: 0, vlUnit: '5,00', vlTotal: '5,00' }
    ]
  } }];
}));
const apiCalls = [];
const supabaseStub = `window.__channels=[];window.__clients=[];window.supabase={createClient:function(){
var channels=[];var client={auth:{setSession:()=>Promise.resolve()},realtime:{setAuth:function(){}},
channel:function(){var ch={on:function(type,filter,fn){ch.callback=fn;return ch;},subscribe:function(fn){ch.status=fn;setTimeout(()=>fn('SUBSCRIBED'),0);return ch;}};channels.push(ch);window.__channels.push(ch);return ch;},
removeAllChannels:function(){channels.forEach(c=>{c.removed=true;});return Promise.resolve();}};window.__clients.push(client);return client;}};`;
const xlsxStub = `window.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(wb,ws)=>{wb.sheet=ws;}},writeFile:(wb,name)=>{window.__export={wb,name};}};`;
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  });
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('comercial_supabase_auth_v1', JSON.stringify({ access_token: 'test', userId: 'test-operator' }));
    });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname.endsWith('.supabase.co')) {
        apiCalls.push({ method: req.method(), path: url.pathname, search: url.search });
        let body = [];
        if (url.pathname.endsWith('/historico_orcamentos_resumos')) {
          body = [...records.values()].filter(r => !url.searchParams.has('updated_at') || Date.parse(r.updated_at) >= Date.parse(url.searchParams.get('updated_at').slice(4))).map(r => ({
            id: r.id, sync_key: 'transferencia', updated_at: r.updated_at, deleted_at: r.deleted_at,
            summary: { id: r.id, numero: r.data.numero, filial: r.data.filial, gestor: r.data.gestor, data: r.data.data,
              savedAt: r.data.savedAt, createdAt: r.data.createdAt, total: r.data.total,
              __counts: { total: 2, sent: 1, cut: 1, partial: 0 } }
          }));
        } else if (url.pathname.endsWith('/historico_orcamentos')) {
          if (req.method() === 'GET') body = [records.get(url.searchParams.get('id').slice(3))].filter(Boolean);
          else if (req.method() === 'POST') {
            const row = req.postDataJSON();
            row.updated_at = new Date().toISOString(); row.deleted_at = row.deleted_at || null;
            records.set(row.id, row);
            body = [{ id: row.id, updated_at: row.updated_at }];
          } else if (req.method() === 'PATCH') {
            const bodyPatch = req.postDataJSON(), id = url.searchParams.get('id');
            for (const row of records.values()) if (!id || row.id === id.slice(3)) Object.assign(row, bodyPatch, { updated_at: new Date().toISOString() });
          }
        } else if (url.pathname.endsWith('/cortes_fornecedores_memoria')) {
          body = url.searchParams.get('select') === '*' ? [{ sync_key: 'transferencia', updated_at: version, ts: 1, data: {} }] : [{ sync_key: 'transferencia', updated_at: version }];
        }
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      }
      const js = req.url().includes('supabase-js') ? supabaseStub : req.url().includes('xlsx.full') ? xlsxStub : req.url().includes('pdf.min.js') ? 'window.pdfjsLib={GlobalWorkerOptions:{}};' : '';
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: js });
    });
    const errors = [], page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.evaluate(async () => {
      ComercialDataProvider.authenticateOperator = async () => ({ ok: true, profile: { name: 'TRANSFERENCIA', role: 'admin' } });
      document.getElementById('lgi-user').value = 'TRANSFERENCIA'; _lgiPassRaw = 'test';
      await doLogin();
      switchTab('pane-hist');
    });
    await page.waitForFunction(() => getHist().length === 125);
    assert.equal(await page.locator('#hist-list .hcard').count(), 50);
    assert.equal(apiCalls.filter(r => r.path.endsWith('/historico_orcamentos')).length, 0);
    await page.evaluate(() => histPage(1)); assert.equal(await page.locator('#hist-list .hcard').count(), 50);
    await page.evaluate(() => histPage(1)); assert.equal(await page.locator('#hist-list .hcard').count(), 25);
    await page.evaluate(() => { document.getElementById('hf-busca').value = '0124'; renderHist(); });
    assert.equal(await page.locator('#hist-list .hcard').count(), 1);
    await page.evaluate(() => viewHist('0000'));
    assert.equal(await page.locator('#m-hview .mhv-row').count(), 2);
    await page.evaluate(() => viewHist('0000'));
    assert.equal(apiCalls.filter(r => r.path.endsWith('/historico_orcamentos')).length, 1);
    await context.setOffline(true);
    assert.equal(await page.evaluate(async () => (await ComercialDataProvider.ensureHistoricoDetail('0000')).products.length), 2);
    await page.evaluate(() => { document.getElementById('af-per').value = ''; return buildAna(); });
    assert.match(await page.locator('#toast').innerText(), /Conecte-se/);
    assert.equal(await page.locator('#ana-content').innerHTML(), '');
    await context.setOffline(false);
    await page.evaluate(() => buildAna());
    assert.ok((await page.locator('#ana-content').innerHTML()).length > 500);
    await page.evaluate(() => expAnaExcel());
    assert.equal(await page.evaluate(() => __export.wb.sheet.rows.filter(r => /^\d{4}$/.test(r[0])).length), 250);
    const completeDownloads = apiCalls.filter(r => r.path.endsWith('/historico_orcamentos')).length;
    await page.evaluate(() => histSyncController.request(true));
    assert.equal(apiCalls.filter(r => r.path.endsWith('/historico_orcamentos')).length, completeDownloads);
    // A second tab sees insert/update/delete via reconciliation without replacing local pending edits.
    const second = await context.newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await second.evaluate(async () => { CURRENT_USER = { name: 'GERENTE', role: 'viewer' }; await ComercialDataProvider.initializeCache(); await ComercialDataProvider.syncHistoricoSummaries(true, getHistPendingOps); });
    const changed = records.get('0000'); changed.data.numero = 'EDITADO'; changed.updated_at = '2026-10-30T23:00:00.111111+00:00';
    await Promise.all([page, second].map(p => p.evaluate(() => ComercialDataProvider.syncHistoricoSummaries(false, getHistPendingOps))));
    assert.equal(await second.evaluate(() => getHist().find(h => h.id === '0000').numero), 'EDITADO');
    await page.evaluate(() => delDirect('0001'));
    await page.waitForFunction(() => getHistPendingOps().length === 0);
    await second.evaluate(() => ComercialDataProvider.syncHistoricoSummaries(true, getHistPendingOps));
    assert.equal(await second.evaluate(() => getHist().some(h => h.id === '0001')), false);
    await page.evaluate(async () => {
      var record={id:'new-order',numero:'NOVO',filial:'Filial A',savedAt:new Date().toISOString(),products:[{codigo:'30',status:'sent',qtdSolicitada:1,qtdEnviada:1,vlTotal:'7,00'}]};
      setHist([record].concat(getHist()));syncHistRecord(record);
      await histSyncController.request(false);
    });
    await page.waitForFunction(() => getHistPendingOps().length === 0);
    await second.evaluate(() => ComercialDataProvider.syncHistoricoSummaries(true, getHistPendingOps));
    assert.equal(await second.evaluate(() => getHist().some(h => h.id === 'new-order')), true);
    await context.setOffline(true);
    assert.equal(await page.evaluate(async () => (await ComercialDataProvider.ensureHistoricoDetail('new-order')).products.length), 1);
    await page.evaluate(() => {
      var record={id:'offline-order',numero:'OFFLINE',savedAt:new Date().toISOString(),products:[]};
      setHist([record].concat(getHist()));syncHistRecord(record);
    });
    assert.equal(await page.evaluate(() => getHistPendingOps().length), 1);
    await context.setOffline(false);
    await page.evaluate(() => histSyncController.request(false));
    await page.waitForFunction(() => getHistPendingOps().length === 0);
    await page.evaluate(() => clearHist());
    await page.waitForFunction(() => getHistPendingOps().length === 0);
    await second.evaluate(() => ComercialDataProvider.syncHistoricoSummaries(true, getHistPendingOps));
    assert.equal(await second.evaluate(() => getHist().length), 0);
    await page.evaluate(() => ComercialDataProvider.signOutSupabase());
    assert.equal(await page.evaluate(() => __channels.every(c => c.removed)), true);
    assert.equal(await page.evaluate(() => CURRENT_USER), null);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', scenarios: ['login', 'pagination', 'filters', 'lazy details', 'offline report rejection', 'complete report and Excel totals', 'metadata-only reconciliation', 'two-tab insert/update/delete/clear', 'saved details offline', 'offline queue recovery', 'logout channels'], detailDownloads: completeDownloads, browserErrors: errors.length }, null, 2));
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
