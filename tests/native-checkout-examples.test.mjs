import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as requireCrypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const secret = 'local-example-test-secret';
const prefixes = ['', 'zh/', 'zh-Hant/'];
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const blocks = (doc) => [...doc.matchAll(/```javascript[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
const sign = (payload, timestamp) => 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

for (const prefix of prefixes) {
  test(`${prefix}checkout creation: use trusted identity, reserve before creation and reuse the Session`, async () => {
    const source = blocks(read(prefix + 'guides/collect-first-payment.mdx')).find((block) => block.includes("app.post('/api/buy-credits'"));
    let route;
    let posted = 0;
    const order = { id: 'purchase_1' };
    const session = { id: 'cs_1', url: 'https://example.invalid/one-time/cs_1', status: 'OPEN', amount: '9.99', currency: 'USD', expiresAt: Date.now() + 600000 };
    const context = vm.createContext({
      KYREN_API_KEY: 'local-key', KYREN_BASE_URL: 'https://example.invalid', KYREN_PRODUCT_ID: 'prod_1',
      requireUser: () => {}, express: { json: () => () => {} },
      app: { post: (...args) => { route = args.at(-1); } },
      checkoutStore: {
        async withLockedOrder(userId, productId, callback) { assert.equal(userId, 'trusted_user'); assert.equal(productId, 'prod_1'); return callback(order); },
        async markCreationPending() { order.creationPending = true; },
        async attachSession(id, value) { assert.equal(id, order.id); assert.equal(value.id, session.id); order.checkoutId = value.id; order.creationPending = false; },
      },
      axios: {
        async post(url, body) { posted++; assert.equal(order.creationPending, true); assert.equal(body.metadata.userId, 'trusted_user'); assert.equal(body.metadata.businessOrderId, order.id); return { data: { code: 0, data: session } }; },
        async get() { return { data: { code: 0, data: session } }; },
      },
    });
    vm.runInContext(source, context);
    const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } });
    const req = { user: { id: 'trusted_user', email: 'trusted@example.invalid' }, body: { userId: 'untrusted_user' } };
    const created = response();
    await route(req, created);
    assert.equal(created.value.checkoutId, session.id);
    const reused = response();
    await route(req, reused);
    assert.equal(reused.value.checkoutId, session.id);
    assert.equal(posted, 1);
    delete order.checkoutId;
    order.creationPending = true;
    const uncertain = response();
    await route(req, uncertain);
    assert.equal(uncertain.code, 503);
    assert.equal(posted, 1);
  });

  for (const page of ['guides/collect-first-payment.mdx', 'webhooks/signatures.mdx', 'quickstart.mdx']) {
    test(`${prefix}${page}: signature verification rejects malformed and stale input`, () => {
      const source = blocks(read(prefix + page)).find((block) => block.includes('function verify'));
      const routes = [];
      const context = vm.createContext({
        require: () => requireCrypto, Buffer, process: { env: { KYREN_WEBHOOK_SECRET: secret } },
        KYREN_WEBHOOK_SECRET: secret, crypto: requireCrypto,
        app: { post: (...args) => routes.push(args) }, express: { raw: () => () => {} },
      });
      vm.runInContext(source, context);
      const name = source.includes('function verifyWebhookSignature') ? 'verifyWebhookSignature' : 'verifySignature';
      const verify = (...args) => context[name](...args, secret);
      const payload = '{"data":{"amount":"9.99"},"id":"evt_1"}';
      const timestamp = String(Date.now());
      assert.equal(verify(payload, sign(payload, timestamp), timestamp), true);
      assert.equal(verify(payload + ' ', sign(payload, timestamp), timestamp), false);
      const stale = String(Date.now() - 600000);
      assert.equal(verify(payload, sign(payload, stale), stale), false);
      for (const invalid of ['', 'NaN', '123abc', '1.5', 'Infinity', '9007199254740992', undefined, ['123']]) {
        assert.equal(verify(payload, sign(payload, invalid), invalid), false);
      }
      for (const invalid of ['', undefined, ['sha256=abc'], 'sha256=abc']) {
        assert.equal(verify(payload, invalid, timestamp), false);
      }
    });
  }

  test(`${prefix}payment tutorial: acknowledge only after durable storage`, async () => {
    const source = blocks(read(prefix + 'guides/collect-first-payment.mdx')).find((block) => block.includes("app.post('/webhooks/kyren'"));
    let route;
    let saved = false;
    let failStorage = false;
    const context = vm.createContext({
      crypto: requireCrypto, Buffer, KYREN_WEBHOOK_SECRET: secret,
      app: { post: (...args) => { route = args.at(-1); } },
      express: { raw: () => () => {} },
      webhookInbox: { async insertIfAbsent() { if (failStorage) throw Error('storage unavailable'); saved = true; } },
    });
    vm.runInContext(source, context);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'order.paid', data: { order_id: 'order_1' } }));
    const timestamp = String(Date.now());
    const req = { body, headers: { 'x-kyren-signature': sign(body.toString(), timestamp), 'x-kyren-timestamp': timestamp } };
    const response = () => ({ code: 200, status(code) { this.code = code; return this; }, send() { if (this.code === 200) assert.equal(saved, true); return this; } });
    const ok = response();
    await route(req, ok);
    assert.equal(ok.code, 200);
    saved = false;
    failStorage = true;
    const failed = response();
    await route(req, failed);
    assert.equal(failed.code, 503);
    failStorage = false;
    const invalid = response();
    await route({ ...req, headers: {} }, invalid);
    assert.equal(invalid.code, 400);
    assert.equal(saved, false);
    const nonRaw = response();
    await route({ ...req, body: JSON.parse(body) }, nonRaw);
    assert.equal(nonRaw.code, 400);
    const malformedBody = Buffer.from('not-json');
    const malformed = response();
    await route({ body: malformedBody, headers: { ...req.headers, 'x-kyren-signature': sign(malformedBody.toString(), timestamp) } }, malformed);
    assert.equal(malformed.code, 400);
    assert.equal(saved, false);
  });

  test(`${prefix}payment tutorial: webhook and reconciliation use the same checked fulfillment adapter`, async () => {
    const source = blocks(read(prefix + 'guides/collect-first-payment.mdx')).find((block) => block.includes('async function processWebhook'));
    const fulfilled = [];
    let status = 'PAID';
    let businessOrderId = 'purchase_1';
    const context = vm.createContext({
      KYREN_API_KEY: 'local-key', KYREN_BASE_URL: 'https://example.invalid',
      fulfillPaidOrderIdempotently: async (input) => fulfilled.push(JSON.parse(JSON.stringify(input))),
      axios: { async get(url) { return { data: { data: url.includes('/checkouts/')
        ? { status: 'COMPLETE', orderId: 'order_1' }
        : { id: 'order_1', status, checkoutSessionId: 'cs_1', productId: 'prod_1', baseAmount: '9.99', payableAmount: '10.99', currency: 'USD', metadata: { businessOrderId } } } }; } },
    });
    vm.runInContext(source, context);
    await context.processWebhook({ type: 'order.paid', data: { order_id: 'order_1', product_id: 'prod_1', amount: '9.99', currency: 'USD', metadata: { businessOrderId } } });
    await context.reconcilePayment({ id: businessOrderId, checkoutId: 'cs_1' });
    assert.equal(fulfilled.length, 2);
    assert.deepEqual(fulfilled[0], fulfilled[1]);
    status = 'PENDING';
    await context.reconcilePayment({ id: businessOrderId, checkoutId: 'cs_1' });
    assert.equal(fulfilled.length, 2);
    status = 'PAID';
    businessOrderId = 'another_purchase';
    await assert.rejects(context.reconcilePayment({ id: 'purchase_1', checkoutId: 'cs_1' }), /association mismatch/);
    assert.equal(fulfilled.length, 2);
  });
}
