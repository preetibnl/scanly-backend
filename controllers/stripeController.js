import Stripe from "stripe";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import { getSubscriptionPlanSettings } from "./subscriptionPlanConfigController.js";

let stripeSingleton = null;

const getStripe = () => {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
};

const publicApiBase = () =>
  (process.env.PUBLIC_API_BASE_URL || "").trim().replace(/\/$/, "");

const isLocalLoopbackHost = (hostname) => {
  const h = (hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
};

/**
 * Hosts the mobile app may send when PUBLIC_API_BASE_URL is unset (avoids open redirects).
 * Allows RFC1918 LAN + common dev tunnels only.
 */
const isClientTrustedReturnHost = (hostname) => {
  const h = (hostname || "").toLowerCase();
  if (!h || isLocalLoopbackHost(h)) return false;
  if (
    h.endsWith(".ngrok-free.app") ||
    h.endsWith(".ngrok.io") ||
    h.endsWith(".ngrok.app") ||
    h.endsWith(".trycloudflare.com")
  ) {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = [1, 2, 3, 4].map((i) => Number(m[i]));
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

const normalizeReturnBase = (raw) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { error: "Return base URL is empty." };
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return { error: "Return base URL is not a valid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "Return base URL must use http or https." };
  }
  const host = u.host;
  if (!host) return { error: "Return base URL is missing a host." };
  const base = `${u.protocol}//${host}`;
  return { base, hostname: u.hostname, host };
};

/** Host the client used to reach this API (reverse-proxy aware). */
const getIncomingApiHost = (req) =>
  String(req.get?.("x-forwarded-host") || req.get?.("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

/** Allow returnBaseUrl when it matches the request Host (production public API). */
const clientReturnMatchesIncomingHost = (norm, req) => {
  const incoming = getIncomingApiHost(req);
  if (!incoming || !norm?.host) return false;
  return norm.host.toLowerCase() === incoming;
};

/**
 * Env-based public URL (production or explicit dev). Any non-loopback host allowed.
 */
const resolveReturnBaseFromEnv = () => {
  const raw = publicApiBase();
  if (!raw) return { kind: "unset" };
  const norm = normalizeReturnBase(raw);
  if (norm.error) return { kind: "error", error: norm.error };
  if (isLocalLoopbackHost(norm.hostname)) {
    return {
      kind: "error",
      error:
        "PUBLIC_API_BASE_URL cannot be localhost or 127.0.0.1. Use your PC LAN IP (http://192.168.x.x:PORT), ngrok https, or omit PUBLIC_API_BASE_URL and send returnBaseUrl from the app.",
    };
  }
  return { kind: "ok", base: norm.base, source: "env" };
};

/**
 * App sends the API origin (JSON body and/or X-Return-Base-Url header) when PUBLIC_API_BASE_URL is unset or invalid.
 */
const resolveReturnBaseFromClient = (req) => {
  const body = req.body || {};
  const headerRaw =
    (typeof req.get === "function" &&
      (req.get("x-return-base-url") || req.get("x-api-base-url"))) ||
    "";
  const raw =
    body.returnBaseUrl ||
    body.clientApiBaseUrl ||
    body.apiBaseUrl ||
    headerRaw ||
    "";
  const norm = normalizeReturnBase(raw);
  if (norm.error) {
    if (norm.error === "Return base URL is empty.") return { kind: "empty" };
    return { kind: "error", error: norm.error };
  }
  if (clientReturnMatchesIncomingHost(norm, req)) {
    return { kind: "ok", base: norm.base, source: "client-host" };
  }
  if (!isClientTrustedReturnHost(norm.hostname)) {
    return {
      kind: "error",
      error:
        "returnBaseUrl must be a LAN IP (192.168.x.x, 10.x, 172.16–31.x) or an ngrok / trycloudflare host. Or set PUBLIC_API_BASE_URL on the server.",
    };
  }
  return { kind: "ok", base: norm.base, source: "client" };
};

/**
 * Stripe success/cancel URLs must reach your Node server (not phone-local localhost).
 * If PUBLIC_API_BASE_URL is wrong (e.g. localhost), we still accept a trusted client URL.
 * @returns {{ base: string, source?: string } | { error: string }}
 */
const resolveCheckoutReturnBase = (req) => {
  const env = resolveReturnBaseFromEnv();
  if (env.kind === "ok") return { base: env.base, source: env.source };

  const client = resolveReturnBaseFromClient(req);
  if (client.kind === "ok") {
    if (env.kind === "error") {
      console.warn(
        `[Stripe] Using client return base (${client.base}); fix or clear PUBLIC_API_BASE_URL — was: ${env.error}`,
      );
    }
    return { base: client.base, source: client.source };
  }

  if (env.kind === "error") {
    if (client.kind === "empty") {
      return {
        error: `${env.error} Also send returnBaseUrl in the JSON body or X-Return-Base-Url header (e.g. http://192.168.1.20:5005). Reload the app after updating.`,
      };
    }
    return { error: client.error || env.error };
  }

  if (client.kind === "empty") {
    return {
      error:
        "Missing return URL: set PUBLIC_API_BASE_URL on the server, or send returnBaseUrl + X-Return-Base-Url from the app (same as EXPO_PUBLIC_API_BASE_URL). Clear Metro cache (npx expo start -c) if you already updated the app.",
    };
  }
  return { error: client.error };
};


const logKeyHint = () => {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.log("[Stripe] STRIPE_SECRET_KEY is not set — billing endpoints will return 503.");
    return;
  }
  const mode = key.startsWith("sk_test_")
    ? "test"
    : key.startsWith("sk_live_")
      ? "live"
      : "unknown";
  const last4 = key.slice(-4);
  console.log(
    `[Stripe] Secret key loaded (mode=${mode}, suffix …${last4}). Full key is never logged.`,
  );
};

/**
 * Call once on server startup to verify the secret key can reach Stripe’s API.
 */
export const logStripeStartupProbe = async () => {
  logKeyHint();
  const stripe = getStripe();
  if (!stripe) return;

  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    console.warn(
      "[Stripe] STRIPE_WEBHOOK_SECRET is not set — webhooks will be disabled until you add the signing secret from Stripe Dashboard → Developers → Webhooks.",
    );
  }

  const envBase = resolveReturnBaseFromEnv();
  if (envBase.kind === "ok") {
    console.log(`[Stripe] PUBLIC_API_BASE_URL OK for redirects: ${envBase.base}`);
  } else if (envBase.kind === "unset") {
    console.warn(
      "[Stripe] PUBLIC_API_BASE_URL is not set — Checkout/Portal use returnBaseUrl from the app (same as EXPO_PUBLIC_API_BASE_URL) when provided.",
    );
  } else {
    console.warn(`[Stripe] ${envBase.error}`);
  }
  console.log(
    "[Stripe] Test secret key only: GET /api/stripe/verify — or tap “Test Stripe keys” in the app.",
  );

  try {
    const balance = await stripe.balance.retrieve();
    const currencies = (balance.available || [])
      .map((b) => `${b.amount / 100} ${b.currency}`)
      .join(", ");
    console.log(
      `[Stripe] Startup probe OK: balance.retrieve succeeded. Available: ${currencies || "(none)"}`,
    );
  } catch (err) {
    console.error(
      "[Stripe] Startup probe FAILED — check STRIPE_SECRET_KEY and network:",
      err?.message || err,
    );
  }
};

/**
 * Lightweight check that the secret key can call Stripe (no Checkout, no PUBLIC_API_BASE_URL).
 */
export const verifyStripeConnection = async (req, res) => {
  console.log("[Stripe] verifyStripeConnection: GET /api/stripe/verify");
  const stripe = getStripe();
  if (!stripe) {
    console.error("[Stripe] verifyStripeConnection: STRIPE_SECRET_KEY missing");
    return res.status(503).json({
      ok: false,
      message: "STRIPE_SECRET_KEY is not set on the server.",
    });
  }

  const secret = process.env.STRIPE_SECRET_KEY?.trim() || "";
  const keyMode = secret.startsWith("sk_test_")
    ? "test"
    : secret.startsWith("sk_live_")
      ? "live"
      : "unknown";

  try {
    const balance = await stripe.balance.retrieve();
    const available = (balance.available || []).map((b) => ({
      amount: b.amount / 100,
      currency: b.currency,
    }));
    const pk = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
    const publishableKeyConfigured = Boolean(
      pk && (pk.startsWith("pk_test_") || pk.startsWith("pk_live_")),
    );

    console.log(
      `[Stripe] verifyStripeConnection OK (mode=${keyMode}, balances=${JSON.stringify(available)})`,
    );

    return res.status(200).json({
      ok: true,
      message:
        "Secret key works: Stripe accepted balance.retrieve. This does not run Checkout (no card needed).",
      mode: keyMode,
      publishableKeyConfigured,
      availableBalances: available,
    });
  } catch (err) {
    console.error("[Stripe] verifyStripeConnection FAILED:", err?.message || err);
    return res.status(502).json({
      ok: false,
      message: "Stripe rejected the request — check STRIPE_SECRET_KEY and network.",
      error: err.message,
    });
  }
};

const premiumStatuses = new Set(["active", "trialing", "past_due"]);

const isFreeStatus = (status) => {
  const s = String(status || "").toLowerCase();
  return !s || s === "canceled" || s === "cancelled" || s === "incomplete_expired" || s === "unpaid";
};

/** After checkout or sync: keep renewal on and attach card for the next AutoPay charge. */
const ensureSubscriptionAutoPayOn = async (stripe, subscription) => {
  if (!stripe || !subscription?.id) return subscription;

  let sub = subscription;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  if (premiumStatuses.has(sub.status) && sub.cancel_at_period_end) {
    sub = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: false,
    });
    console.log(`[Stripe] AutoPay: cleared cancel_at_period_end on ${sub.id}`);
  }

  const paymentMethodId =
    typeof sub.default_payment_method === "string"
      ? sub.default_payment_method
      : sub.default_payment_method?.id;

  if (customerId && paymentMethodId) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  return sub;
};

const syncUserFromSubscription = async (
  subscription,
  fallbackUserId,
  options = {},
) => {
  const userId = fallbackUserId || subscription.metadata?.userId;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    console.warn("[Stripe] syncUserFromSubscription: missing or invalid userId", {
      subscriptionId: subscription.id,
    });
    return;
  }

  const stripe = getStripe();
  let sub = subscription;
  if (
    stripe &&
    options.enableAutoPayAfterPurchase &&
    premiumStatuses.has(subscription.status)
  ) {
    sub = await ensureSubscriptionAutoPayOn(stripe, subscription);
  }

  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const isPremium = premiumStatuses.has(sub.status);
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  await User.findByIdAndUpdate(userId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    subscriptionCurrentPeriodEnd: periodEnd,
    subscriptionCancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    plan: isPremium ? "premium" : "free",
  });

  console.log(
    `[Stripe] User ${userId} synced from subscription ${sub.id}: plan=${
      isPremium ? "premium" : "free"
    } status=${sub.status} autoPay=${isPremium && !sub.cancel_at_period_end}`,
  );
};

const checkoutLineItems = async (billingInterval = "month") => {
  const interval = billingInterval === "year" ? "year" : "month";
  const settings = await getSubscriptionPlanSettings();
  const monthlyPriceId =
    settings.stripePriceIdMonthly?.trim() ||
    process.env.STRIPE_PRICE_ID_MONTHLY?.trim() ||
    "";
  const yearlyPriceId =
    settings.stripePriceIdYearly?.trim() ||
    process.env.STRIPE_PRICE_ID_YEARLY?.trim() ||
    "";
  const legacySinglePriceId = process.env.STRIPE_PRICE_ID?.trim();
  const priceId =
    interval === "year"
      ? yearlyPriceId || null
      : monthlyPriceId || legacySinglePriceId || null;

  if (priceId) {
    console.log(`[Stripe] Using Stripe Price ID for ${interval} checkout.`);
    return [{ price: priceId, quantity: 1 }];
  }

  const unitAmount =
    interval === "year" ? settings.yearlyPriceCents : settings.monthlyPriceCents;
  const currency = settings.currency || "usd";
  console.log(
    `[Stripe] Using admin plan price for ${interval}: $${(unitAmount / 100).toFixed(2)}/${interval}.`,
  );
  return [
    {
      price_data: {
        currency,
        product_data: {
          name: interval === "year" ? "Premium Plan (Yearly)" : "Premium Plan (Monthly)",
          description:
            "Subscription — unlimited label scans and premium safety features",
        },
        unit_amount: unitAmount,
        recurring: { interval },
      },
      quantity: 1,
    },
  ];
};

const isStripeProductActive = async (stripe, productRef) => {
  if (!productRef) return false;
  try {
    const product =
      typeof productRef === "string"
        ? await stripe.products.retrieve(productRef)
        : productRef;
    return Boolean(product?.active);
  } catch {
    return false;
  }
};

const isStripePriceUsable = async (stripe, priceId) => {
  if (!priceId) return false;
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    if (!price.active) return false;
    return isStripeProductActive(stripe, price.product);
  } catch {
    return false;
  }
};

const createRecurringPriceOnProduct = async (stripe, billingInterval, productId) => {
  const settings = await getSubscriptionPlanSettings();
  const unitAmount =
    billingInterval === "year" ? settings.yearlyPriceCents : settings.monthlyPriceCents;
  const interval = billingInterval === "year" ? "year" : "month";
  const created = await stripe.prices.create({
    currency: settings.currency || "usd",
    unit_amount: unitAmount,
    recurring: { interval },
    product: productId,
    nickname:
      billingInterval === "year" ? "Premium Plan (Yearly)" : "Premium Plan (Monthly)",
  });
  return created.id;
};

const getOrCreateActivePremiumProduct = async (stripe) => {
  const listed = await stripe.products.list({ active: true, limit: 20 });
  const existing = listed.data.find((p) =>
    /scanly|premium/i.test(String(p.name || "")),
  );
  if (existing?.id) {
    return existing.id;
  }

  const created = await stripe.products.create({
    name: "Scanly Premium",
    description: "Premium subscription — unlimited scans and safety features",
    active: true,
  });
  console.log(`[Stripe] Created active product ${created.id} for plan switching`);
  return created.id;
};

/**
 * Pick a price for plan changes. Ignores inactive .env price IDs and falls back
 * to the subscriber's active product or a new active Premium product in Stripe.
 */
const resolveSwitchPriceId = async (stripe, billingInterval, currentPrice) => {
  const lineItems = await checkoutLineItems(billingInterval);
  const spec = lineItems[0];

  if (spec.price && (await isStripePriceUsable(stripe, spec.price))) {
    return spec.price;
  }
  if (spec.price) {
    console.warn(
      `[Stripe] Configured price ${spec.price} is inactive or archived — using fallback for ${billingInterval}`,
    );
  }

  const currentProductId =
    typeof currentPrice?.product === "string"
      ? currentPrice.product
      : currentPrice?.product?.id;

  if (await isStripeProductActive(stripe, currentPrice?.product ?? currentProductId)) {
    return createRecurringPriceOnProduct(stripe, billingInterval, currentProductId);
  }

  const activeProductId = await getOrCreateActivePremiumProduct(stripe);
  return createRecurringPriceOnProduct(stripe, billingInterval, activeProductId);
};

const friendlyStripePlanError = (err) => {
  const raw =
    typeof err?.raw?.message === "string"
      ? err.raw.message
      : typeof err?.message === "string"
        ? err.message
        : "Could not switch plan";

  if (/marked as inactive/i.test(raw)) {
    return (
      "This plan is inactive in Stripe. In Stripe Dashboard → Products, activate the Premium product " +
      "or update STRIPE_PRICE_ID_MONTHLY and STRIPE_PRICE_ID_YEARLY in the backend .env to active price IDs, then restart the server."
    );
  }
  return raw;
};

const planDisplayFromPrice = (price) => {
  const interval = price?.recurring?.interval === "year" ? "year" : "month";
  const amountDisplay =
    price?.unit_amount != null && price?.currency
      ? `$${(price.unit_amount / 100).toFixed(2)}`
      : interval === "year"
        ? "$49.99"
        : "$4.99";
  const intervalLabel = interval === "year" ? "per year" : "per month";
  const planTitle =
    price?.nickname ||
    (interval === "year" ? "Premium yearly" : "Premium monthly");
  return { amountDisplay, intervalLabel, planTitle, billingInterval: interval };
};

/** Sync MongoDB user plan from a completed Checkout Session (works without webhooks). */
export const syncCheckoutSessionById = async (sessionId) => {
  const stripe = getStripe();
  const id = String(sessionId || "").trim();
  if (!stripe || !id) {
    console.warn("[Stripe] syncCheckoutSessionById: missing stripe or sessionId");
    return { synced: false, userId: null };
  }

  console.log(`[Stripe] syncCheckoutSessionById: start sessionId=${id}`);
  const session = await stripe.checkout.sessions.retrieve(id, {
    expand: ["subscription"],
  });

  const userId = session.metadata?.userId || session.client_reference_id || null;
  console.log(
    `[Stripe] syncCheckoutSessionById: mode=${session.mode} payment_status=${session.payment_status} userId=${userId}`,
  );

  if (session.mode !== "subscription") {
    return { synced: false, userId };
  }

  let subscription = session.subscription;
  if (!subscription) {
    console.warn("[Stripe] syncCheckoutSessionById: no subscription on session yet");
    return { synced: false, userId };
  }
  if (typeof subscription === "string") {
    subscription = await stripe.subscriptions.retrieve(subscription);
  }

  await syncUserFromSubscription(subscription, userId, {
    enableAutoPayAfterPurchase: true,
  });
  console.log(`[Stripe] syncCheckoutSessionById: done userId=${userId} sub=${subscription.id}`);
  return { synced: true, userId: String(userId || "") };
};

export const confirmCheckoutSession = async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    console.log(`[Stripe] confirmCheckoutSession: user=${req.userId} sessionId=${sessionId}`);
    const { synced, userId } = await syncCheckoutSessionById(sessionId);

    if (req.userId && userId && String(req.userId) !== String(userId)) {
      return res.status(403).json({ message: "Checkout session does not belong to this user" });
    }

    req.params = { userId: req.userId };
    return getBillingSummary(req, res);
  } catch (err) {
    console.error("[Stripe] confirmCheckoutSession error:", err?.message || err);
    return res.status(500).json({
      message: "Could not confirm checkout",
      error: err.message,
    });
  }
};

export const renderReturnSuccess = async (req, res) => {
  const sessionId = req.query.session_id ? String(req.query.session_id) : "";

  if (sessionId) {
    try {
      await syncCheckoutSessionById(sessionId);
    } catch (err) {
      console.error("[Stripe] renderReturnSuccess sync failed:", err?.message || err);
    }
  }

  const base =
    process.env.MOBILE_STRIPE_SUCCESS_URL?.trim() ||
    "foodalleryscanner://stripe?status=success&dest=home";
  const appUrl = sessionId
    ? `${base}${base.includes("?") ? "&" : "?"}session_id=${encodeURIComponent(sessionId)}`
    : base;
  console.log(`[Stripe] renderReturnSuccess: redirect → ${appUrl}`);
  return res.redirect(302, appUrl);
};

export const renderReturnCancel = async (req, res) => {
  const base =
    process.env.MOBILE_STRIPE_CANCEL_URL?.trim() ||
    "foodalleryscanner://stripe?status=cancel&dest=home";
  return res.redirect(302, base);
};

export const renderPortalReturn = async (req, res) => {
  const base =
    process.env.MOBILE_STRIPE_PORTAL_RETURN_URL?.trim() ||
    "foodalleryscanner://stripe?status=portal_done&dest=billing";
  return res.redirect(302, base);
};

export const createCheckoutSession = async (req, res) => {
  console.log("[Stripe] createCheckoutSession: request received");
  const hasBodyReturn = Boolean(req.body?.returnBaseUrl || req.body?.clientApiBaseUrl);
  const hasHeaderReturn = Boolean(
    req.get?.("x-return-base-url") || req.get?.("x-api-base-url"),
  );
  console.log(
    `[Stripe] createCheckoutSession hints: bodyKeys=${Object.keys(req.body || {}).join(",")} bodyReturn=${hasBodyReturn} headerReturn=${hasHeaderReturn}`,
  );
  const stripe = getStripe();
  const resolvedBase = resolveCheckoutReturnBase(req);
  if (!stripe) {
    console.error("[Stripe] createCheckoutSession: missing STRIPE_SECRET_KEY");
    return res.status(503).json({ message: "Stripe is not configured on the server" });
  }
  if ("error" in resolvedBase) {
    console.error("[Stripe] createCheckoutSession:", resolvedBase.error);
    return res.status(503).json({ message: resolvedBase.error });
  }
  const base = resolvedBase.base;
  console.log(`[Stripe] Checkout return URLs use base (${resolvedBase.source}): ${base}`);

  const requestedInterval = String(req.body?.billingInterval || "month").toLowerCase();
  const billingInterval = requestedInterval === "year" ? "year" : "month";
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  try {
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      console.log(`[Stripe] Creating Stripe customer for user ${userId}`);
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(user._id) },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
      console.log(`[Stripe] Stripe customer created: ${customerId}`);
    }

    const successUrl = `${base}/api/stripe/return/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/api/stripe/return/cancel`;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: await checkoutLineItems(billingInterval),
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId: String(user._id), billingInterval },
      subscription_data: {
        metadata: { userId: String(user._id), billingInterval },
        // Recurring AutoPay from first successful checkout (monthly or yearly).
        collection_method: "charge_automatically",
      },
      payment_method_collection: "always",
      client_reference_id: String(user._id),
    });

    console.log(
      `[Stripe] Checkout Session created: ${session.id} (hasUrl=${Boolean(session.url)})`,
    );
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[Stripe] createCheckoutSession error:", err?.message || err);
    return res.status(500).json({ message: "Could not start checkout", error: err.message });
  }
};

/** Turn automatic renewal on/off (Stripe cancel_at_period_end). */
export const updateAutoPay = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ message: "Stripe is not configured on the server" });
  }

  const enabled = req.body?.enabled === true || req.body?.enabled === "true";
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  if (!user.stripeSubscriptionId) {
    return res.status(400).json({
      message: "No active subscription. Subscribe from Premium first.",
    });
  }

  try {
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    if (!premiumStatuses.has(sub.status)) {
      return res.status(400).json({
        message: "Subscription is not active. Subscribe again from Premium to use AutoPay.",
      });
    }

    if (enabled) {
      const customer = await stripe.customers.retrieve(user.stripeCustomerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      const pm = customer.invoice_settings?.default_payment_method;
      if (!pm) {
        return res.status(400).json({
          message:
            "Add a payment method first (Billing → Payment method), then turn AutoPay on.",
        });
      }
    }

    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: !enabled,
    });
    await syncUserFromSubscription(updated, userId);
    console.log(`[Stripe] updateAutoPay: user ${userId} enabled=${enabled}`);

    req.params = { userId };
    return getBillingSummary(req, res);
  } catch (err) {
    console.error("[Stripe] updateAutoPay error:", err?.message || err);
    return res.status(500).json({
      message: err?.message || "Could not update AutoPay",
      error: err.message,
    });
  }
};

export const switchSubscriptionPlan = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ message: "Stripe is not configured on the server" });
  }

  const requestedInterval = String(req.body?.billingInterval || "").toLowerCase();
  const billingInterval = requestedInterval === "year" ? "year" : "month";
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  if (!user.stripeSubscriptionId) {
    return res.status(400).json({
      message: "No active subscription. Subscribe from Premium first.",
    });
  }

  try {
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
      expand: ["items.data.price"],
    });
    if (!premiumStatuses.has(sub.status)) {
      return res.status(400).json({
        message: "Subscription is not active. Renew or subscribe again from Premium.",
      });
    }

    const item = sub.items?.data?.[0];
    if (!item?.id) {
      return res.status(400).json({ message: "Subscription has no billable items" });
    }

    const currentInterval =
      item.price?.recurring?.interval === "year" ? "year" : "month";
    if (currentInterval === billingInterval) {
      return res.status(400).json({
        message:
          billingInterval === "year"
            ? "You are already on the yearly plan."
            : "You are already on the monthly plan.",
      });
    }

    const newPriceId = await resolveSwitchPriceId(stripe, billingInterval, item.price);
    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [{ id: item.id, price: newPriceId }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: {
        ...(sub.metadata || {}),
        userId: String(user._id),
        billingInterval,
      },
    });

    await syncUserFromSubscription(updated, userId);
    console.log(
      `[Stripe] switchSubscriptionPlan: user ${userId} ${currentInterval} → ${billingInterval}`,
    );

    req.params = { userId };
    return getBillingSummary(req, res);
  } catch (err) {
    console.error("[Stripe] switchSubscriptionPlan error:", err?.message || err);
    return res.status(500).json({
      message: friendlyStripePlanError(err),
      error: err.message,
    });
  }
};

export const createPortalSession = async (req, res) => {
  console.log("[Stripe] createPortalSession: request received");
  const stripe = getStripe();
  const resolvedBase = resolveCheckoutReturnBase(req);
  if (!stripe) {
    return res.status(503).json({ message: "Stripe is not configured on the server" });
  }
  if ("error" in resolvedBase) {
    console.error("[Stripe] createPortalSession:", resolvedBase.error);
    return res.status(503).json({ message: resolvedBase.error });
  }
  const base = resolvedBase.base;
  console.log(`[Stripe] Portal return URL uses base (${resolvedBase.source}): ${base}`);

  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user?.stripeCustomerId) {
    console.log(`[Stripe] createPortalSession: user ${userId} has no stripeCustomerId`);
    return res.status(400).json({
      message: "No billing account yet. Subscribe once from the Premium screen first.",
    });
  }

  try {
    const returnUrl = `${base}/api/stripe/return/portal`;
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });
    console.log(`[Stripe] Billing Portal session created for customer ${user.stripeCustomerId}`);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("[Stripe] createPortalSession error:", err?.message || err);
    return res.status(500).json({
      message:
        "Could not open billing portal. In Stripe Dashboard → Settings → Billing → Customer portal, enable the portal for test mode.",
      error: err.message,
    });
  }
};

export const getBillingSummary = async (req, res) => {
  const { userId } = req.params;
  console.log(`[Stripe] getBillingSummary: userId=${userId}`);
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  const user = await User.findById(userId).select(
    "plan email stripeCustomerId stripeSubscriptionId subscriptionStatus subscriptionCurrentPeriodEnd subscriptionCancelAtPeriodEnd",
  );
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const stripe = getStripe();
  if (!stripe || !user.stripeCustomerId) {
    const plan = (user.plan || "free").toLowerCase() === "premium" ? "premium" : "free";
    const normalizedStatus =
      plan === "free"
        ? "active"
        : user.subscriptionStatus || null;
    return res.status(200).json({
      hasStripeCustomer: Boolean(user.stripeCustomerId),
      plan,
      subscriptionStatus: normalizedStatus,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd || null,
      paymentMethodLabel: null,
      latestInvoiceLabel: null,
      amountDisplay: null,
      intervalLabel: null,
    });
  }

  try {
    const customer = await stripe.customers.retrieve(user.stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });

    let paymentMethodLabel = null;
    const formatPmLabel = (pmObj) => {
      if (!pmObj || typeof pmObj === "string") return null;
      const card = pmObj.card;
      if (!card) return null;
      const brand = (card.brand || "Card").replace(/^./, (c) => c.toUpperCase());
      return `${brand} ending in ${card.last4}`;
    };

    const pm = customer.invoice_settings?.default_payment_method;
    paymentMethodLabel = formatPmLabel(pm);

    let latestInvoiceLabel = null;
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 1,
    });
    if (invoices.data[0]?.created) {
      latestInvoiceLabel = new Date(invoices.data[0].created * 1000).toLocaleDateString(
        "en-US",
        { year: "numeric", month: "long", day: "numeric" },
      );
    }

    let amountDisplay = "$4.99";
    let intervalLabel = "per month";
    let planTitle = "Premium monthly";
    let billingInterval = "month";
    let autoPayEnabled = false;
    let effectivePlan = (user.plan || "free").toLowerCase() === "premium" ? "premium" : "free";
    let effectiveSubscriptionStatus = user.subscriptionStatus || null;
    let effectiveCurrentPeriodEnd = user.subscriptionCurrentPeriodEnd || null;
    let effectiveCancelAtPeriodEnd = Boolean(user.subscriptionCancelAtPeriodEnd);

    const applySubscriptionToSummary = (sub) => {
      effectiveSubscriptionStatus = sub.status || null;
      effectiveCurrentPeriodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null;
      effectiveCancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      effectivePlan = premiumStatuses.has(sub.status) ? "premium" : "free";
      const price = sub.items?.data?.[0]?.price;
      const display = planDisplayFromPrice(price);
      amountDisplay = display.amountDisplay;
      intervalLabel = display.intervalLabel;
      planTitle = display.planTitle;
      billingInterval = display.billingInterval;

      const subPm = sub.default_payment_method;
      if (!paymentMethodLabel) {
        paymentMethodLabel = formatPmLabel(
          typeof subPm === "string" ? null : subPm,
        );
      }

      const chargesAutomatically =
        (sub.collection_method || "charge_automatically") === "charge_automatically";
      autoPayEnabled =
        premiumStatuses.has(sub.status) &&
        chargesAutomatically &&
        !effectiveCancelAtPeriodEnd;
    };

    let discoveredSubscriptionId = null;
    if (user.stripeSubscriptionId) {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
        expand: ["items.data.price", "default_payment_method"],
      });
      applySubscriptionToSummary(sub);
    } else {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: "all",
        limit: 1,
      });
      const latestSub = subscriptions.data?.[0];
      if (latestSub) {
        discoveredSubscriptionId = latestSub.id;
        const sub = await stripe.subscriptions.retrieve(latestSub.id, {
          expand: ["items.data.price", "default_payment_method"],
        });
        applySubscriptionToSummary(sub);
      }
    }

    if (effectivePlan === "free" && isFreeStatus(effectiveSubscriptionStatus)) {
      effectiveSubscriptionStatus = "active";
    }

    const nextSubscriptionId = user.stripeSubscriptionId || discoveredSubscriptionId || null;
    const shouldPersist =
      String(user.plan || "free") !== effectivePlan ||
      String(user.subscriptionStatus || "") !== String(effectiveSubscriptionStatus || "") ||
      String(user.stripeSubscriptionId || "") !== String(nextSubscriptionId || "") ||
      String(user.subscriptionCurrentPeriodEnd || "") !== String(effectiveCurrentPeriodEnd || "") ||
      Boolean(user.subscriptionCancelAtPeriodEnd) !== effectiveCancelAtPeriodEnd;
    if (shouldPersist) {
      await User.findByIdAndUpdate(userId, {
        plan: effectivePlan,
        stripeSubscriptionId: nextSubscriptionId,
        subscriptionStatus: effectiveSubscriptionStatus,
        subscriptionCurrentPeriodEnd: effectiveCurrentPeriodEnd,
        subscriptionCancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
      });
    }

    console.log(
      `[Stripe] getBillingSummary OK for user ${userId} (customer ${user.stripeCustomerId})`,
    );

    return res.status(200).json({
      hasStripeCustomer: true,
      plan: effectivePlan,
      subscriptionStatus: effectiveSubscriptionStatus,
      subscriptionCurrentPeriodEnd: effectiveCurrentPeriodEnd,
      subscriptionCancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
      paymentMethodLabel,
      latestInvoiceLabel,
      amountDisplay,
      intervalLabel,
      planTitle,
      billingInterval,
      autoPayEnabled,
    });
  } catch (err) {
    console.error("[Stripe] getBillingSummary error:", err?.message || err);
    return res.status(500).json({ message: "Could not load billing from Stripe", error: err.message });
  }
};

export const handleStripeWebhook = async (req, res) => {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !whSecret) {
    console.error("[Stripe] Webhook rejected: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return res.status(503).send("Webhook not configured");
  }

  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    console.error("[Stripe] Webhook signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe] Webhook received: ${event.type} id=${event.id}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;
        if (session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncUserFromSubscription(sub, userId);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await syncUserFromSubscription(sub, null);
        break;
      }
      default:
        console.log(`[Stripe] Webhook (no-op handler): ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe] Webhook handler error for ${event.type}:`, err?.message || err);
    return res.status(500).json({ received: false });
  }

  res.json({ received: true });
};
