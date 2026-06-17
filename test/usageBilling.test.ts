import test from 'node:test';
import assert from 'node:assert/strict';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { UsageBillingService, type BillingConfig } from '../src/billing/usageBilling.js';

test('Stripe Checkout sessions allow promotion codes', async () => {
  const stripe = new Stripe('sk_test_mock');
  const originalCreate = stripe.checkout.sessions.create;
  const originalRetrieve = stripe.customers.retrieve;
  let captured: Stripe.Checkout.SessionCreateParams | undefined;
  stripe.checkout.sessions.create = (async params => {
    captured = params;
    return {
      id: 'cs_test_mock',
      object: 'checkout.session',
      url: 'https://checkout.stripe.com/mock'
    } as Stripe.Checkout.Session;
  }) as typeof stripe.checkout.sessions.create;
  stripe.customers.retrieve = (async id => ({
    id: String(id),
    object: 'customer'
  }) as Stripe.Customer) as typeof stripe.customers.retrieve;

  try {
    const db = new FakeFirestore();
    db.docs.set('users/uid_test', { stripeCustomerId: 'cus_test' });
    const service = new TestUsageBillingService(testBillingConfig(), db as unknown as Firestore, stripe);

    await service.createCheckoutSession(
      { uid: 'uid_test', email: 'ronitervo.rt@gmail.com' } as DecodedIdToken,
      1000
    );

    assert.equal(captured?.allow_promotion_codes, true);
    assert.equal(captured?.line_items?.[0]?.price_data?.product, 'prod_test_ariadne');
  } finally {
    stripe.checkout.sessions.create = originalCreate;
    stripe.customers.retrieve = originalRetrieve;
  }
});

test('fully discounted checkout completion grants credits from session metadata', async () => {
  const db = new FakeFirestore();
  const service = new UsageBillingService(testBillingConfig(), db as unknown as Firestore);
  const payload = JSON.stringify({
    id: 'evt_checkout_free',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_free',
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        amount_subtotal: 1000,
        amount_total: 0,
        currency: 'usd',
        payment_intent: null,
        total_details: { amount_discount: 1000, amount_shipping: 0, amount_tax: 0 },
        metadata: {
          firebaseUid: 'uid_free',
          ariadneCreditMicros: '10000000',
          product: 'ariadne_usage_credits'
        }
      }
    }
  });

  await service.handleStripeWebhook(Buffer.from(payload), signedHeader(payload));

  const eventWrite = db.writes.find(write => write.path === 'users/uid_free/billingAccounts/default/billingEvents/stripe:checkout:cs_test_free');
  assert.equal(eventWrite?.data.uid, 'uid_free');
  assert.equal(eventWrite?.data.creditMicros, 10_000_000);
  assert.deepEqual(eventWrite?.data.source, {
    checkoutSessionId: 'cs_test_free',
    amount: 0,
    amountSubtotal: 1000,
    amountDiscount: 1000,
    currency: 'usd',
    discountFullyCovered: true
  });

  const entitlementWrite = db.writes.find(write => write.path === 'users/uid_free/billingAccounts/default');
  assert.ok(entitlementWrite?.data.paidCreditMicros);
});

test('checkout completion with a payment intent waits for payment_intent.succeeded', async () => {
  const db = new FakeFirestore();
  const service = new UsageBillingService(testBillingConfig(), db as unknown as Firestore);
  const payload = JSON.stringify({
    id: 'evt_checkout_paid',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_paid',
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        amount_subtotal: 1000,
        amount_total: 900,
        currency: 'usd',
        payment_intent: 'pi_test_paid',
        metadata: {
          firebaseUid: 'uid_paid',
          ariadneCreditMicros: '10000000',
          product: 'ariadne_usage_credits'
        }
      }
    }
  });

  await service.handleStripeWebhook(Buffer.from(payload), signedHeader(payload));

  assert.equal(db.writes.some(write => write.path.includes('/billingAccounts/default/billingEvents/') || write.path.startsWith('billingEventIndex/')), false);
});

class TestUsageBillingService extends UsageBillingService {
  constructor(config: BillingConfig, db: Firestore, private readonly stripe: Stripe) {
    super(config, db);
  }

  protected override requireStripe(): Stripe {
    return this.stripe;
  }
}

class FakeFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly writes: Array<{ path: string; data: Record<string, unknown>; options?: unknown }> = [];

  collection(path: string): FakeCollectionRef {
    return new FakeCollectionRef(this, path);
  }

  async runTransaction<T>(run: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return await run(new FakeTransaction(this));
  }
}

class FakeCollectionRef {
  constructor(private readonly db: FakeFirestore, private readonly path: string) {}

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.db, `${this.path}/${id}`);
  }
}

class FakeDocRef {
  constructor(private readonly db: FakeFirestore, readonly path: string) {}

  collection(id: string): FakeCollectionRef {
    return new FakeCollectionRef(this.db, `${this.path}/${id}`);
  }

  async get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> {
    const data = this.db.docs.get(this.path);
    return {
      exists: data !== undefined,
      data: () => data
    };
  }

  async set(data: Record<string, unknown>, options?: unknown): Promise<void> {
    this.db.writes.push({ path: this.path, data, options });
    this.db.docs.set(this.path, { ...(this.db.docs.get(this.path) ?? {}), ...data });
  }
}

class FakeTransaction {
  constructor(private readonly db: FakeFirestore) {}

  async get(ref: FakeDocRef): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> {
    const data = this.db.docs.get(ref.path);
    return {
      exists: data !== undefined,
      data: () => data
    };
  }

  set(ref: FakeDocRef, data: Record<string, unknown>, options?: unknown): void {
    this.db.writes.push({ path: ref.path, data, options });
    this.db.docs.set(ref.path, { ...(this.db.docs.get(ref.path) ?? {}), ...data });
  }
}

function testBillingConfig(): BillingConfig {
  return {
    enabled: true,
    currency: 'usd',
    appUrl: 'https://ariadne.example',
    stripeSecretKey: 'sk_test_mock',
    stripeWebhookSecret: 'whsec_test',
    stripeProductId: 'prod_test_ariadne',
    minCheckoutAmountCents: 500,
    defaultCheckoutAmountCents: 1000,
    liveSessionTtlSeconds: 75
  };
}

function signedHeader(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_test'
  });
}
