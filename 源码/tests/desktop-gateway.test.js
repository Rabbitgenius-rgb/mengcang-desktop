'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { VaultGateway } = require('../desktop/gateway.cjs');
let fixtureRoot; let certificate; let key; let otherCertificate; let authority; let leafCertificate; let leafKey; let rotatedLeafCertificate; let rotatedLeafKey; let expiredLeafCertificate; let expiredAuthority; let expiredAuthorityLeaf; let sameKeyRotatedLeaf;
test.before(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-gateway-cert-'));
  function generate(name, days = '1') {
    const config = path.join(fixtureRoot, `${name}.cnf`);
    fs.writeFileSync(config, '[req]\ndistinguished_name = dn\nx509_extensions = v3\nprompt = no\n[dn]\nCN = localhost\n[v3]\nsubjectAltName = DNS:localhost,IP:127.0.0.1\nbasicConstraints = critical,CA:true\nkeyUsage = critical,digitalSignature,keyEncipherment,keyCertSign\n');
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', days, '-config', config, '-keyout', path.join(fixtureRoot, `${name}.key`), '-out', path.join(fixtureRoot, `${name}.crt`)], { stdio: 'ignore' });
    return fs.readFileSync(path.join(fixtureRoot, `${name}.crt`), 'utf8');
  }
  certificate = generate('server'); key = fs.readFileSync(path.join(fixtureRoot, 'server.key')); otherCertificate = generate('other');
  const caConfig = path.join(fixtureRoot, 'authority.cnf');
  fs.writeFileSync(caConfig, '[req]\ndistinguished_name = dn\nx509_extensions = ca\nprompt = no\n[dn]\nCN = Local REST API Test Authority\n[ca]\nbasicConstraints = critical,CA:true\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\nnameConstraints = critical,permitted;DNS:localhost,permitted;IP:127.0.0.1/255.255.255.255\n');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', caConfig, '-keyout', path.join(fixtureRoot, 'authority.key'), '-out', path.join(fixtureRoot, 'authority.crt')], { stdio: 'ignore' });
  authority = fs.readFileSync(path.join(fixtureRoot, 'authority.crt'), 'utf8');
  function signedLeaf(name, { caName = 'authority', days = '1', reuseKey } = {}) {
    const extensions = path.join(fixtureRoot, `${name}-extensions.cnf`);
    fs.writeFileSync(extensions, 'basicConstraints = critical,CA:false\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = DNS:localhost,IP:127.0.0.1\n');
    if (reuseKey) fs.copyFileSync(path.join(fixtureRoot, `${reuseKey}.key`), path.join(fixtureRoot, `${name}.key`));
    execFileSync('/usr/bin/openssl', ['req', '-new', ...(reuseKey ? ['-key', path.join(fixtureRoot, `${name}.key`)] : ['-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(fixtureRoot, `${name}.key`)]), '-subj', '/CN=Local REST API Server', '-out', path.join(fixtureRoot, `${name}.csr`)], { stdio: 'ignore' });
    execFileSync('/usr/bin/openssl', ['x509', '-req', '-in', path.join(fixtureRoot, `${name}.csr`), '-CA', path.join(fixtureRoot, `${caName}.crt`), '-CAkey', path.join(fixtureRoot, `${caName}.key`), '-CAcreateserial', '-days', days, '-extfile', extensions, '-out', path.join(fixtureRoot, `${name}.crt`)], { stdio: 'ignore' });
    return { cert: fs.readFileSync(path.join(fixtureRoot, `${name}.crt`), 'utf8'), key: fs.readFileSync(path.join(fixtureRoot, `${name}.key`)) };
  }
  const firstLeaf = signedLeaf('leaf'); leafCertificate = firstLeaf.cert; leafKey = firstLeaf.key;
  const rotatedLeaf = signedLeaf('rotated'); rotatedLeafCertificate = rotatedLeaf.cert; rotatedLeafKey = rotatedLeaf.key;
  // LibreSSL rejects negative -days. Re-sign synthetic DER with fixed past
  // dates so expiration checks use real, correctly signed expired certificates.
  function expired(pem, issuerKey) {
    const { X509Certificate, sign } = require('node:crypto'); const der = Buffer.from(new X509Certificate(pem).raw);
    function item(offset) { const start=offset++;let length=der[offset++];if(length&128){const count=length&127;length=0;for(let i=0;i<count;i++)length=length*256+der[offset++];}return {start,content:offset,end:offset+length}; }
    function children(parent) { const result=[];for(let offset=parent.content;offset<parent.end;){const child=item(offset);result.push(child);offset=child.end;}return result; }
    const [tbs,,signature]=children(item(0));const validity=children(tbs)[4];const times=children(validity);
    for(const [index,text] of ['000101000000Z','010101000000Z'].entries()){assert.equal(times[index].end-times[index].content,text.length);der.write(text,times[index].content,'ascii');}
    const signed=sign('sha256',der.subarray(tbs.start,tbs.end),fs.readFileSync(issuerKey));assert.equal(signature.end-signature.content-1,signed.length);signed.copy(der,signature.content+1);
    return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  }
  expiredLeafCertificate = expired(leafCertificate,path.join(fixtureRoot,'authority.key'));
  expiredAuthority = expired(authority,path.join(fixtureRoot,'authority.key'));
  expiredAuthorityLeaf = leafCertificate;
  sameKeyRotatedLeaf = signedLeaf('same-key-rotated', { reuseKey: 'leaf' }).cert;
});
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-gateway-vault-'));
  const note = { path: '01_sources/cards/text/月亮.md', id: 'note-001', title: '月亮', hash: 'a'.repeat(64), body: '用户正文', fields: {}, kind: 'entry' };
  const identity = { id: 'mc-vault-fixture-001', name: path.basename(root), path: root, appVersion: '1.13.7', pluginVersion: '0.5.0', protocolVersion: 1, ...options.identity };
  const snapshot = { identity, entries: [note], materials: [], books: [], projects: [], errors: [], revision: 1 };
  const credentials = { port: 0, token: 'local-test-token-only', ca: options.ca || certificate, ...(options.serverCert ? { serverCert: options.serverCert } : {}) };
  const requests = []; const streams = new Set(); const gateways = [];
  let handler = options.handler;
  const server = https.createServer(options.tls || { key, cert: certificate }, async (request, response) => {
    let body = ''; request.on('data', chunk => body += chunk); await once(request, 'end');
    requests.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : undefined });
    if (request.headers.authorization !== `Bearer ${credentials.token}`) { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end('{}'); return; }
    if (handler && await handler(request, response, body)) return;
    if (request.url.endsWith('/events')) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('event: ready\ndata: {"revision":1}\n\n'); streams.add(response); response.on('close', () => streams.delete(response)); return; }
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/identity')) response.end(JSON.stringify(identity));
    else if (request.url.endsWith('/snapshot')) response.end(JSON.stringify(snapshot));
    else if (request.url.includes('/note?')) response.end(JSON.stringify(note));
    else if (request.url.includes('/related?')) response.end(JSON.stringify({ candidates: [], confirmed: [], sourceHash: note.hash }));
    else if (request.url.includes('/attachment?')) { response.setHeader('Content-Type', 'image/png'); response.end(Buffer.from([1, 2, 3])); }
    else if (request.url.includes('/original?')) response.end(JSON.stringify({ kind: 'url', url: 'https://example.com/' }));
    else response.end(JSON.stringify({ ok: true, note }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); credentials.port = server.address().port;
  const gateway = new VaultGateway({ expectedVaultPath: root, credentials, cachePath: path.join(root, 'cache.json'), requestTimeoutMs: 1000, reconnectDelayMs: 10000 }); gateways.push(gateway);
  t.after(async () => { gateways.forEach(gateway => gateway.dispose()); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  return { gateway, root, identity, credentials, requests, streams, server, snapshot, note, gateways, setHandler: value => handler = value };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('connect verifies local HTTPS certificate, Vault identity and version; duplicate status is suppressed', async t => {
  const { gateway, identity } = await fixture(t); let statuses = 0; gateway.on('status', () => statuses++);
  assert.deepEqual(await gateway.connect(), { ...identity, path: fs.realpathSync(identity.path) }); const first = statuses; await gateway.connect(); assert.equal(statuses, first);
  assert.equal(gateway.status().connected, true); assert.equal(gateway.status().paired, true); assert.equal(gateway.getPairedCredentials().vaultId, identity.id);
});
test('wrong physical Vault, wrong name, changed id and old runtime cannot connect', async t => {
  const f = await fixture(t); const original = { ...f.identity };
  f.identity.path = '/private/tmp/wrong-vault'; await assert.rejects(f.gateway.connect(), error => error.code === 'WRONG_VAULT');
  Object.assign(f.identity, original, { name: 'wrong-name' }); await assert.rejects(f.gateway.connect(), error => error.code === 'WRONG_VAULT');
  Object.assign(f.identity, original, { appVersion: '1.12.9' }); await assert.rejects(f.gateway.connect(), error => error.code === 'OBSIDIAN_VERSION');
  Object.assign(f.identity, original); await f.gateway.connect(); f.identity.id = 'mc-vault-different-001'; await assert.rejects(f.gateway.connect(), error => error.code === 'VAULT_ID_CHANGED');
  assert.equal(f.gateway.status().connected, false);
});
test('untrusted server certificate fails TLS without any verification bypass', async t => {
  const { gateway, credentials } = await fixture(t); gateway.configure({ ...credentials, ca: otherCertificate });
  await assert.rejects(gateway.connect(), error => error.code === 'TLS_ERROR'); assert.equal(gateway.status().connected, false);
});
test('authentication and HTTP errors stay explicit and secrets are not exposed', async t => {
  const { gateway, credentials, setHandler } = await fixture(t);
  gateway.configure({ ...credentials, token: 'wrong-local-test-token' }); await assert.rejects(gateway.connect(), error => error.code === 'AUTH_FAILED' && !error.message.includes('wrong-local-test-token'));
  gateway.configure(credentials); await gateway.connect();
  setHandler((request, response) => { if (!request.url.includes('/note?')) return false; response.writeHead(409, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'CONFLICT', message: `Do not expose ${credentials.token}` } })); return true; });
  await assert.rejects(gateway.readNote('01_sources/cards/text/月亮.md'), error => error.code === 'CONFLICT' && !error.message.includes(credentials.token));
  assert.equal(gateway.status().connected, true);
});
test('save uses verified Vault id, stable operation id and sends exactly one write on timeout', async t => {
  const f = await fixture(t); await f.gateway.connect(); const input = { path: f.note.path, expectedHash: f.note.hash, operationId: 'save-operation-001', kind: 'fields', fields: { caption: '月亮配文' }, vaultId: 'renderer-spoof' };
  await f.gateway.save(input); const saved = f.requests.find(request => request.path.endsWith('/mutate')); assert.equal(saved.body.vaultId, f.identity.id); assert.equal(saved.body.operationId, input.operationId);
  f.gateway.requestTimeoutMs = 40; f.setHandler((request, response) => { if (!request.url.endsWith('/mutate')) return false; return true; });
  await assert.rejects(f.gateway.save({ ...input, operationId: 'save-operation-002' }), error => error.code === 'TIMEOUT');
  await delay(80); assert.equal(f.requests.filter(request => request.path.endsWith('/mutate')).length, 2); assert.equal(f.gateway.status().connected, false);
  await assert.rejects(f.gateway.save(input), error => error.code === 'OFFLINE');
});
test('snapshot persists only private cache, offline browse works after restart, wrong identity cache is refused', async t => {
  const f = await fixture(t); await f.gateway.connect(); await f.gateway.snapshot(); await f.gateway.related(f.note.path);
  const cachePath = path.join(f.root, 'cache.json'); assert.equal(fs.statSync(cachePath).mode & 0o777, 0o600); assert.equal(fs.readFileSync(cachePath, 'utf8').includes(f.credentials.token), false);
  const paired = f.gateway.getPairedCredentials(); f.gateway.pause();
  const restarted = new VaultGateway({ expectedVaultPath: f.root, credentials: paired, cachePath }); f.gateways.push(restarted);
  assert.equal((await restarted.snapshot()).offline, true); assert.equal((await restarted.readNote(f.note.path)).title, '月亮'); assert.equal((await restarted.related(f.note.path)).offline, true);
  restarted.configure({ ...paired, vaultId: 'mc-vault-another-001' }); await assert.rejects(restarted.snapshot(), error => error.code === 'OFFLINE_NO_CACHE');
});
test('SSE handles fragmented CRLF frames, emits bounded changes and stops on pause', async t => {
  const f = await fixture(t); await f.gateway.connect(); for (let i = 0; i < 20 && !f.streams.size; i++) await delay(5);
  const changed = once(f.gateway, 'change'); for (const stream of f.streams) { stream.write('event: change\r\nda'); stream.write('ta: {"revision":2}\r\n'); stream.write('\r\n'); }
  assert.deepEqual((await changed)[0], { revision: 2 });
  f.gateway.pause(); await delay(20); assert.equal(f.streams.size, 0); assert.equal(f.gateway.status().code, 'PAUSED');
  await f.gateway.resume(); assert.equal(f.gateway.status().connected, true);
});
test('SSE permits 135 seconds of idle time while request deadlines and reconnect remain bounded', async t => {
  const f = await fixture(t); let idleTimeout, onIdleTimeout;
  const gateway = new VaultGateway({ expectedVaultPath: f.root, credentials: f.credentials, transport: { request(options, callback) {
    const request = https.request(options, callback); const setTimeout = request.setTimeout.bind(request);
    request.setTimeout = (milliseconds, handler) => { if (options.path.endsWith('/events')) { idleTimeout = milliseconds; onIdleTimeout = handler; } return setTimeout(milliseconds, handler); };
    return request;
  } } });
  f.gateways.push(gateway); await gateway.connect();
  assert.equal(idleTimeout, 135000); assert.equal(gateway.requestTimeoutMs, 8000); assert.equal(gateway.snapshotTimeoutMs, 30000); assert.equal(gateway.reconnectDelayMs, 15000);
  onIdleTimeout(); assert.equal(gateway.status().connected, false); assert.equal(gateway.status().code, 'TIMEOUT'); assert.ok(gateway._retryTimer);
});
test('binary attachment is not JSON-decoded and redirect is never followed', async t => {
  const f = await fixture(t); await f.gateway.connect(); const attachment = await f.gateway.attachment('01_sources/_originals/image.png'); assert.deepEqual([...attachment.data], [1, 2, 3]); assert.equal(attachment.contentType, 'image/png');
  f.setHandler((request, response) => { if (!request.url.includes('/original?')) return false; response.writeHead(302, { Location: 'https://example.com/' }); response.end(); return true; });
  await assert.rejects(f.gateway.original(f.note.path), error => error.code === 'REDIRECT_REFUSED');
  await assert.rejects(f.gateway.attachment('../.obsidian/data.json'), error => error.code === 'INVALID_PATH');
});
test('SSE disconnect marks offline and reconnect reconciles identity without replaying writes', async t => {
  const f = await fixture(t); f.gateway.reconnectDelayMs = 30; await f.gateway.connect(); await f.gateway.snapshot();
  for (let i = 0; i < 20 && !f.streams.size; i++) await delay(5);
  for (const stream of f.streams) stream.end(); await delay(15); assert.equal(f.gateway.status().connected, false);
  for (let i = 0; i < 30 && !f.gateway.status().connected; i++) await delay(10);
  assert.equal(f.gateway.status().connected, true); assert.equal(f.requests.some(request => request.method === 'POST'), false);
});
test('reconfiguration cancels an in-flight connection and never binds its stale result', async t => {
  const f = await fixture(t); let deferredResponse;
  f.setHandler((request, response) => { if (!request.url.endsWith('/identity')) return false; deferredResponse = response; return true; });
  const connecting = f.gateway.connect(); const rejected = assert.rejects(connecting, error => error.code === 'RECONFIGURED');
  for (let i = 0; i < 20 && !deferredResponse; i++) await delay(5);
  f.gateway.configure({ ...f.credentials, vaultId: 'mc-vault-bound-other-001' });
  await rejected; assert.equal(f.gateway.status().connected, false); assert.equal(f.gateway.getPairedCredentials().vaultId, 'mc-vault-bound-other-001');
  deferredResponse?.end(JSON.stringify(f.identity));
});
test('Local REST API 5.2-style CA without SAN trusts its separately signed local leaf', async t => {
  const { X509Certificate } = require('node:crypto'); assert.equal(new X509Certificate(authority).subjectAltName, undefined);
  const f = await fixture(t, { ca: authority, serverCert: leafCertificate, tls: { key: leafKey, cert: leafCertificate } });
  await f.gateway.connect(); assert.equal(f.gateway.status().connected, true); assert.equal(f.gateway.getPairedCredentials().serverCert, leafCertificate);
  assert.equal((await f.gateway.snapshot()).entries[0].title, '月亮');
});
test('legacy credentials without a saved leaf retain CA validation and fail closed on unsupported constraints', async t => {
  const f = await fixture(t, { ca: authority, tls: { key: leafKey, cert: leafCertificate } });
  assert.equal(f.gateway._options('GET', '/identity').ca, authority);
  assert.equal(f.gateway._options('GET', '/identity').allowPartialTrustChain, undefined);
  if (process.versions.electron) await assert.rejects(f.gateway.connect(), error => error.code === 'TLS_ERROR');
  else { await f.gateway.connect(); assert.equal(f.gateway.status().connected, true); }
});
test('provided leaf must be issued by paired CA and actual server must match the paired leaf', async t => {
  const f = await fixture(t, { ca: authority, serverCert: leafCertificate, tls: { key: rotatedLeafKey, cert: rotatedLeafCertificate } });
  await assert.rejects(f.gateway.connect(), error => error.code === 'TLS_ERROR');
  assert.throws(() => f.gateway.configure({ ...f.credentials, ca: otherCertificate }), error => error.code === 'INVALID_CERTIFICATE');
});
test('exact paired leaf trust retains TLS verification, hostname checks and fingerprint pinning', async t => {
  const f = await fixture(t, { ca: authority, serverCert: leafCertificate, tls: { key: leafKey, cert: leafCertificate } });
  const options = f.gateway._options('GET', '/identity');
  assert.equal(options.ca, leafCertificate); assert.equal(options.allowPartialTrustChain, true); assert.equal(options.rejectUnauthorized, true);
  await f.gateway.connect();
  const wrongHost = new VaultGateway({ expectedVaultPath: f.root, credentials: f.credentials, transport: { request: (options, callback) => https.request({ ...options, servername: 'unpaired.example' }, callback) } });
  f.gateways.push(wrongHost); await assert.rejects(wrongHost.connect(), error => error.code === 'TLS_ERROR');
});
test('renewed certificate with the same CA and public key still requires explicit re-pairing', async t => {
  const f = await fixture(t, { ca: authority, serverCert: leafCertificate, tls: { key: leafKey, cert: sameKeyRotatedLeaf } });
  await assert.rejects(f.gateway.connect(), error => error.code === 'TLS_ERROR');
});
test('expired CA, expired leaf and not-yet-valid certificates cannot become trust anchors', () => {
  const gateway = new VaultGateway();
  const credentials = { port: 27124, token: 'synthetic-test-only', ca: authority, serverCert: leafCertificate };
  assert.throws(() => gateway.configure({ ...credentials, serverCert: expiredLeafCertificate }), error => error.code === 'INVALID_CERTIFICATE');
  assert.throws(() => gateway.configure({ ...credentials, ca: expiredAuthority, serverCert: expiredAuthorityLeaf }), error => error.code === 'INVALID_CERTIFICATE');
  assert.throws(() => gateway.configure({ ...credentials, ca: leafCertificate }), error => error.code === 'INVALID_CERTIFICATE');
  gateway.dispose();
});
test('certificate validity is rechecked for later requests after a successful pairing', t => {
  const { X509Certificate } = require('node:crypto');
  const gateway = new VaultGateway({ credentials: { port: 27124, token: 'synthetic-test-only', ca: authority, serverCert: leafCertificate } });
  t.after(() => gateway.dispose());
  t.mock.method(Date, 'now', () => Date.parse(new X509Certificate(authority).validFrom) - 1000);
  assert.throws(() => gateway.configure(gateway.getPairedCredentials()), error => error.code === 'INVALID_CERTIFICATE');
  assert.throws(() => gateway._options('GET', '/identity'), error => error.code === 'TLS_ERROR');
  Date.now.mock.mockImplementation(() => Date.parse(new X509Certificate(authority).validTo) + 1000);
  assert.throws(() => gateway._options('GET', '/identity'), error => error.code === 'TLS_ERROR');
});
test('BoringSSL name-constraint failure is reported as a safe TLS error', () => {
  const gateway = new VaultGateway();
  const error = gateway._networkError({ code: 'UNSPECIFIED', message: 'unsupported name constraint type: synthetic-private-data' });
  assert.equal(error.code, 'TLS_ERROR'); assert.equal(error.message.includes('synthetic-private-data'), false);
  gateway.dispose();
});

test('attachment capture requires an advertised capability before sending any original bytes',async t=>{
 const f=await fixture(t);f.snapshot.capabilities={capture:true};await f.gateway.connect();await f.gateway.snapshot();
 const bytes=Buffer.from('%PDF-1.4\nsynthetic original'),attachment={name:'fixture.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')};
 await assert.rejects(f.gateway.capture({operationId:'00000000-0000-4000-8000-000000000001',title:'File',body:'',attachment}),error=>error.code==='CAPTURE_ATTACHMENT_UNAVAILABLE');
 assert.equal(f.requests.filter(request=>request.path.endsWith('/capture')).length,0);
});
test('verified capture accepts bounded originals above the ordinary RPC limit without expanding other writes',async t=>{
 const f=await fixture(t);f.snapshot.capabilities={capture:true,captureAttachment:true};await f.gateway.connect();await f.gateway.snapshot();
 const bytes=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(2*1024*1024,32)]),attachment={name:'large.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')};
 const input={operationId:'00000000-0000-4000-8000-000000000001',title:'Large original',body:'',attachment};
 await f.gateway.capture(input);const sent=f.requests.find(request=>request.path.endsWith('/capture'));assert.deepEqual(sent.body.attachment,attachment);assert.equal(sent.body.vaultId,f.identity.id);
 await assert.rejects(f.gateway.save({path:f.note.path,kind:'exploration',text:'x'.repeat(2*1024*1024),operationId:'synthetic-long-write'}),error=>error.code==='REQUEST_TOO_LARGE');
 assert.equal(f.requests.filter(request=>request.path.endsWith('/mutate')).length,0);
});
