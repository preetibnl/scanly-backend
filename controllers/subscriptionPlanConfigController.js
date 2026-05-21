import SubscriptionPlanConfig from "../models/subscriptionPlanConfigModel.js";

const DEFAULT_FEATURES = [
  "Unlimited product label scans",
  "Priority ingredient interpretation",
  "Detailed caution explanations",
  "Faster support response",
];

const DEFAULT_CONFIG = {
  key: "default",
  monthlyPriceCents: 499,
  yearlyPriceCents: 4999,
  currency: "usd",
  monthlyFeatures: DEFAULT_FEATURES,
  yearlyFeatures: DEFAULT_FEATURES,
  stripePriceIdMonthly: process.env.STRIPE_PRICE_ID_MONTHLY?.trim() || "",
  stripePriceIdYearly: process.env.STRIPE_PRICE_ID_YEARLY?.trim() || "",
};

const normalizeFeatures = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
};

const formatUsd = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

export const getSubscriptionPlanSettings = async () => {
  let doc = await SubscriptionPlanConfig.findOne({ key: "default" });
  if (!doc) {
    doc = await SubscriptionPlanConfig.create(DEFAULT_CONFIG);
  }
  return doc;
};

const toPublicPlan = (settings, interval) => {
  const isYear = interval === "year";
  const priceCents = isYear ? settings.yearlyPriceCents : settings.monthlyPriceCents;
  const features = isYear ? settings.yearlyFeatures : settings.monthlyFeatures;
  return {
    interval,
    priceCents,
    priceDisplay: formatUsd(priceCents),
    periodLabel: isYear ? "per year" : "per month",
    title: isYear ? "Premium yearly" : "Premium monthly",
    features: normalizeFeatures(features),
  };
};

export const serializePlanSettings = (settings) => ({
  monthlyPriceCents: settings.monthlyPriceCents,
  yearlyPriceCents: settings.yearlyPriceCents,
  currency: settings.currency || "usd",
  monthlyPriceDisplay: formatUsd(settings.monthlyPriceCents),
  yearlyPriceDisplay: formatUsd(settings.yearlyPriceCents),
  monthlyFeatures: normalizeFeatures(settings.monthlyFeatures),
  yearlyFeatures: normalizeFeatures(settings.yearlyFeatures),
  stripePriceIdMonthly: settings.stripePriceIdMonthly || "",
  stripePriceIdYearly: settings.stripePriceIdYearly || "",
  updatedAt: settings.updatedAt,
  updatedByAdminEmail: settings.updatedByAdminEmail || null,
});

export const getPublicPlanConfig = async (_req, res) => {
  try {
    const settings = await getSubscriptionPlanSettings();
    return res.status(200).json({
      data: {
        monthly: toPublicPlan(settings, "month"),
        yearly: toPublicPlan(settings, "year"),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not load plan configuration",
      error: error.message,
    });
  }
};

export const getAdminPlanConfig = async (_req, res) => {
  try {
    const settings = await getSubscriptionPlanSettings();
    return res.status(200).json({ data: serializePlanSettings(settings) });
  } catch (error) {
    return res.status(500).json({
      message: "Could not load subscription plan settings",
      error: error.message,
    });
  }
};

export const updateAdminPlanConfig = async (req, res) => {
  try {
    const monthlyPriceRaw = Number(req.body?.monthlyPrice ?? req.body?.monthlyPriceDollars);
    const yearlyPriceRaw = Number(req.body?.yearlyPrice ?? req.body?.yearlyPriceDollars);
    const monthlyPriceCents = Number.isFinite(monthlyPriceRaw)
      ? Math.round(monthlyPriceRaw * 100)
      : null;
    const yearlyPriceCents = Number.isFinite(yearlyPriceRaw)
      ? Math.round(yearlyPriceRaw * 100)
      : null;

    if (
      (monthlyPriceCents != null && monthlyPriceCents < 50) ||
      (yearlyPriceCents != null && yearlyPriceCents < 50)
    ) {
      return res.status(400).json({
        message: "Prices must be at least $0.50.",
      });
    }

    let settings = await SubscriptionPlanConfig.findOne({ key: "default" });
    if (!settings) {
      settings = new SubscriptionPlanConfig({ ...DEFAULT_CONFIG });
    }

    if (monthlyPriceCents != null) settings.monthlyPriceCents = monthlyPriceCents;
    if (yearlyPriceCents != null) settings.yearlyPriceCents = yearlyPriceCents;
    if (Array.isArray(req.body?.monthlyFeatures)) {
      settings.monthlyFeatures = normalizeFeatures(req.body.monthlyFeatures);
    }
    if (Array.isArray(req.body?.yearlyFeatures)) {
      settings.yearlyFeatures = normalizeFeatures(req.body.yearlyFeatures);
    }
    if (typeof req.body?.stripePriceIdMonthly === "string") {
      settings.stripePriceIdMonthly = req.body.stripePriceIdMonthly.trim();
    }
    if (typeof req.body?.stripePriceIdYearly === "string") {
      settings.stripePriceIdYearly = req.body.stripePriceIdYearly.trim();
    }
    settings.updatedByAdminEmail = req.adminEmail || null;

    await settings.save();

    return res.status(200).json({
      message: "Subscription plan settings saved.",
      data: serializePlanSettings(settings),
    });
  } catch (error) {
    console.error("[PlanConfig] updateAdminPlanConfig error:", error?.message || error);
    return res.status(500).json({
      message: "Could not save subscription plan settings",
      error: error.message,
    });
  }
};
