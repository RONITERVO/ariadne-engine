import { randomUUID } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { FieldValue, getFirebaseAdminDb } from '../firebase/admin.js';
import type { LiveSessionCharge, UsageCharge } from './modelCatalog.js';

export interface BillingConfig {
  enabled: boolean;
  currency: string;
  appUrl?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  minCheckoutAmountCents: number;
  defaultCheckoutAmountCents: number;
  liveSessionTtlSeconds: number;
}

export interface Entitlement {
  uid: string;
  paidCreditMicros: number;
  usedCreditMicros: number;
  reservedCreditMicros: number;
  remainingCreditMicros: number;
  activeLiveSessionId?: string;
  activeLiveSessionExpiresAtMs?: number;
}

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
  amount: number;
  currency: string;
  creditMicros: number;
}

export interface UsageReservation {
  id: string;
  uid: string;
  reservedCreditMicros: number;
  settle(charge: UsageCharge): Promise<void>;
  release(status?: string): Promise<void>;
}

export interface LiveReservation {
  id: string;
  uid: string;
  charge: LiveSessionCharge;
  settle(tokenExpiresAt?: string): Promise<void>;
  release(status?: string): Promise<void>;
}

export class BillingError extends Error {
  constructor(message: string, public readonly statusCode = 402, public readonly code = 'billing_required') {
    super(message);
    this.name = 'BillingError';
  }
}

export class UsageBillingService {
  constructor(private readonly config: BillingConfig, private readonly db: Firestore = getFirebaseAdminDb()) {}

  async getEntitlement(uid: string): Promise<Entitlement> {
    const snapshot = await this.entitlementRef(uid).get();
    return normalizeEntitlement(uid, snapshot.data());
  }

  async reserveStoryTurn(uid: string, reservationCreditMicros: number, metadata: Record<string, unknown>): Promise<UsageReservation> {
    if (!this.config.enabled) throw new BillingError('Paid usage is not enabled on this deployment.', 503, 'billing_disabled');
    const id = randomUUID();
    const amount = Math.max(0, Math.ceil(reservationCreditMicros));
    if (amount <= 0) return this.noopReservation(uid, id);

    const entitlementRef = this.entitlementRef(uid);
    const usageRef = this.usageRef(uid, 'storyTurns', id);

    await this.db.runTransaction(async tx => {
      const entitlement = normalizeEntitlement(uid, (await tx.get(entitlementRef)).data());
      if (entitlement.remainingCreditMicros < amount) {
        throw new BillingError('Buy Ariadne credits before running this model turn.', 402, 'ariadne_credits_required');
      }
      tx.set(entitlementRef, {
        reservedCreditMicros: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(usageRef, {
        status: 'reserved',
        reservedCreditMicros: amount,
        metadata,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return {
      id,
      uid,
      reservedCreditMicros: amount,
      settle: charge => this.settleReservation(uid, 'storyTurns', id, amount, charge),
      release: status => this.releaseReservation(uid, 'storyTurns', id, amount, status)
    };
  }

  async reserveLiveSession(uid: string, charge: LiveSessionCharge): Promise<LiveReservation> {
    if (!this.config.enabled) throw new BillingError('Paid usage is not enabled on this deployment.', 503, 'billing_disabled');
    const id = randomUUID();
    const amount = Math.max(0, Math.ceil(charge.creditMicros));
    const now = Date.now();
    const expiresAtMs = now + Math.max(1, this.config.liveSessionTtlSeconds) * 1000;
    const entitlementRef = this.entitlementRef(uid);
    const usageRef = this.usageRef(uid, 'liveSessions', id);

    await this.db.runTransaction(async tx => {
      const entitlement = normalizeEntitlement(uid, (await tx.get(entitlementRef)).data());
      if (entitlement.activeLiveSessionId && (entitlement.activeLiveSessionExpiresAtMs ?? 0) > now) {
        throw new BillingError('A Gemini Live session is already active for this account.', 429, 'live_session_active');
      }
      if (entitlement.remainingCreditMicros < amount) {
        throw new BillingError('Buy Ariadne credits before starting Gemini Live.', 402, 'ariadne_credits_required');
      }
      tx.set(entitlementRef, {
        reservedCreditMicros: FieldValue.increment(amount),
        activeLiveSessionId: id,
        activeLiveSessionExpiresAtMs: expiresAtMs,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(usageRef, {
        status: 'reserved',
        model: charge.model,
        billableSeconds: charge.billableSeconds,
        inputTokens: charge.inputTokens,
        outputTokens: charge.outputTokens,
        reservedCreditMicros: amount,
        activeExpiresAtMs: expiresAtMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return {
      id,
      uid,
      charge,
      settle: tokenExpiresAt => this.settleLiveReservation(uid, id, amount, charge, expiresAtMs, tokenExpiresAt),
      release: status => this.releaseLiveReservation(uid, id, amount, status)
    };
  }

  async endLiveSession(uid: string, sessionId: string): Promise<void> {
    const entitlementRef = this.entitlementRef(uid);
    const usageRef = this.usageRef(uid, 'liveSessions', sessionId);
    await this.db.runTransaction(async tx => {
      const entitlement = normalizeEntitlement(uid, (await tx.get(entitlementRef)).data());
      if (entitlement.activeLiveSessionId === sessionId) {
        tx.set(entitlementRef, {
          activeLiveSessionId: FieldValue.delete(),
          activeLiveSessionExpiresAtMs: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      tx.set(usageRef, {
        status: 'ended',
        endedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  async createCheckoutSession(user: DecodedIdToken, requestedAmountCents: unknown): Promise<CheckoutSessionResult> {
    if (!this.config.appUrl) throw new BillingError('APP_URL is required for Stripe Checkout.', 500, 'stripe_not_configured');
    const stripe = this.requireStripe();
    const amount = normalizeCheckoutAmount(requestedAmountCents, this.config);
    const creditMicros = centsToCreditMicros(amount);
    const customer = await this.getOrCreateStripeCustomer(user);
    const appUrl = this.config.appUrl.replace(/\/+$/, '');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      success_url: `${appUrl}/?billing=success`,
      cancel_url: `${appUrl}/?billing=cancel`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: this.config.currency,
          unit_amount: amount,
          product_data: {
            name: 'Ariadne usage credits',
            metadata: { product: 'ariadne_usage_credits' }
          }
        }
      }],
      payment_intent_data: {
        metadata: {
          firebaseUid: user.uid,
          ariadneCreditMicros: String(creditMicros),
          product: 'ariadne_usage_credits'
        }
      },
      metadata: {
        firebaseUid: user.uid,
        ariadneCreditMicros: String(creditMicros),
        product: 'ariadne_usage_credits'
      }
    });

    return { id: session.id, url: session.url, amount, currency: this.config.currency, creditMicros };
  }

  async handleStripeWebhook(rawBody: string | Buffer | undefined, signature: string | undefined): Promise<{ received: true }> {
    const stripe = this.requireStripe();
    if (!this.config.stripeWebhookSecret) {
      throw new BillingError('Stripe webhook signing secret is not configured.', 500, 'stripe_not_configured');
    }
    if (!rawBody) throw new BillingError('Stripe webhook raw body is unavailable.', 400, 'stripe_bad_request');
    if (!signature) throw new BillingError('Missing Stripe signature.', 400, 'stripe_bad_request');

    const event = stripe.webhooks.constructEvent(rawBody, signature, this.config.stripeWebhookSecret);
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const uid = String(intent.metadata?.firebaseUid || '');
      const creditMicros = Math.max(0, Math.floor(Number(intent.metadata?.ariadneCreditMicros) || centsToCreditMicros(intent.amount_received)));
      if (uid && creditMicros > 0) {
        await this.grantCredits(uid, creditMicros, `stripe:${event.id}`, {
          paymentIntentId: intent.id,
          amount: intent.amount_received,
          currency: intent.currency
        });
      }
    }
    return { received: true };
  }

  private async settleReservation(
    uid: string,
    collection: string,
    id: string,
    reservedCreditMicros: number,
    charge: UsageCharge
  ): Promise<void> {
    const usedCreditMicros = Math.max(0, Math.ceil(charge.creditMicros));
    const entitlementRef = this.entitlementRef(uid);
    const usageRef = this.usageRef(uid, collection, id);

    await this.db.runTransaction(async tx => {
      const entitlement = normalizeEntitlement(uid, (await tx.get(entitlementRef)).data());
      const extra = Math.max(0, usedCreditMicros - reservedCreditMicros);
      const unreservedRemaining = entitlement.paidCreditMicros - entitlement.usedCreditMicros - entitlement.reservedCreditMicros;
      if (extra > unreservedRemaining) {
        throw new BillingError('Buy more Ariadne credits before saving this model turn.', 402, 'ariadne_credits_required');
      }
      tx.set(entitlementRef, {
        reservedCreditMicros: FieldValue.increment(-reservedCreditMicros),
        usedCreditMicros: FieldValue.increment(usedCreditMicros),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(usageRef, {
        status: 'settled',
        reservedCreditMicros,
        usedCreditMicros,
        lineItems: charge.lineItems,
        settledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  private async releaseReservation(uid: string, collection: string, id: string, reservedCreditMicros: number, status = 'released'): Promise<void> {
    if (reservedCreditMicros <= 0) return;
    await this.db.runTransaction(async tx => {
      tx.set(this.entitlementRef(uid), {
        reservedCreditMicros: FieldValue.increment(-reservedCreditMicros),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(this.usageRef(uid, collection, id), {
        status,
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  private async settleLiveReservation(
    uid: string,
    id: string,
    reservedCreditMicros: number,
    charge: LiveSessionCharge,
    activeExpiresAtMs: number,
    tokenExpiresAt?: string
  ): Promise<void> {
    await this.db.runTransaction(async tx => {
      tx.set(this.entitlementRef(uid), {
        reservedCreditMicros: FieldValue.increment(-reservedCreditMicros),
        usedCreditMicros: FieldValue.increment(reservedCreditMicros),
        activeLiveSessionId: id,
        activeLiveSessionExpiresAtMs: activeExpiresAtMs,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(this.usageRef(uid, 'liveSessions', id), {
        status: 'active',
        usedCreditMicros: reservedCreditMicros,
        model: charge.model,
        billableSeconds: charge.billableSeconds,
        inputTokens: charge.inputTokens,
        outputTokens: charge.outputTokens,
        tokenExpiresAt: tokenExpiresAt ?? null,
        settledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  private async releaseLiveReservation(uid: string, id: string, reservedCreditMicros: number, status = 'released'): Promise<void> {
    if (reservedCreditMicros <= 0) return;
    await this.db.runTransaction(async tx => {
      const entitlement = normalizeEntitlement(uid, (await tx.get(this.entitlementRef(uid))).data());
      tx.set(this.entitlementRef(uid), {
        reservedCreditMicros: FieldValue.increment(-reservedCreditMicros),
        ...(entitlement.activeLiveSessionId === id
          ? {
              activeLiveSessionId: FieldValue.delete(),
              activeLiveSessionExpiresAtMs: FieldValue.delete()
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(this.usageRef(uid, 'liveSessions', id), {
        status,
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  private noopReservation(uid: string, id: string): UsageReservation {
    return {
      id,
      uid,
      reservedCreditMicros: 0,
      settle: async () => {},
      release: async () => {}
    };
  }

  private async grantCredits(uid: string, creditMicros: number, idempotencyKey: string, source: Record<string, unknown>): Promise<boolean> {
    const eventRef = this.db.collection('billingEvents').doc(idempotencyKey);
    const entitlementRef = this.entitlementRef(uid);
    let granted = false;

    await this.db.runTransaction(async tx => {
      const existing = await tx.get(eventRef);
      if (existing.exists) return;
      granted = true;
      tx.set(eventRef, {
        uid,
        kind: 'ariadne_credits_granted',
        creditMicros,
        source,
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(entitlementRef, {
        paidCreditMicros: FieldValue.increment(creditMicros),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return granted;
  }

  private async getOrCreateStripeCustomer(user: DecodedIdToken): Promise<string> {
    const userRef = this.db.collection('users').doc(user.uid);
    const snapshot = await userRef.get();
    const existingCustomerId = String(snapshot.data()?.stripeCustomerId || '').trim();
    const stripe = this.requireStripe();
    if (existingCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(existingCustomerId);
        if (!('deleted' in customer && customer.deleted)) return customer.id;
      } catch {
        // Fall through and replace stale customer ids.
      }
    }

    const customer = await stripe.customers.create({
      email: user.email || undefined,
      name: user.name || undefined,
      metadata: { firebaseUid: user.uid }
    });
    await userRef.set({
      email: user.email || '',
      name: user.name || '',
      picture: user.picture || '',
      stripeCustomerId: customer.id,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return customer.id;
  }

  private requireStripe(): Stripe {
    if (!this.config.stripeSecretKey) throw new BillingError('Stripe is not configured.', 500, 'stripe_not_configured');
    return new Stripe(this.config.stripeSecretKey);
  }

  private entitlementRef(uid: string) {
    return this.db.collection('entitlements').doc(uid);
  }

  private usageRef(uid: string, collection: string, id: string) {
    return this.db.collection('usage').doc(uid).collection(collection).doc(id);
  }
}

function normalizeEntitlement(uid: string, data: DocumentData | undefined): Entitlement {
  const paidCreditMicros = Math.max(0, Math.floor(Number(data?.paidCreditMicros) || 0));
  const usedCreditMicros = Math.max(0, Math.floor(Number(data?.usedCreditMicros) || 0));
  const reservedCreditMicros = Math.max(0, Math.floor(Number(data?.reservedCreditMicros) || 0));
  const activeLiveSessionExpiresAtMs = Math.max(0, Math.floor(Number(data?.activeLiveSessionExpiresAtMs) || 0)) || undefined;
  const activeLiveSessionId = data?.activeLiveSessionId ? String(data.activeLiveSessionId) : undefined;
  return {
    uid,
    paidCreditMicros,
    usedCreditMicros,
    reservedCreditMicros,
    remainingCreditMicros: Math.max(0, paidCreditMicros - usedCreditMicros - reservedCreditMicros),
    activeLiveSessionId,
    activeLiveSessionExpiresAtMs
  };
}

function normalizeCheckoutAmount(value: unknown, config: BillingConfig): number {
  const requested = Math.floor(Number(value) || config.defaultCheckoutAmountCents);
  return Math.max(config.minCheckoutAmountCents, requested);
}

function centsToCreditMicros(cents: number): number {
  return Math.max(0, Math.floor(cents)) * 10_000;
}
