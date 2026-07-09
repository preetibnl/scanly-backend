import mongoose from "mongoose";
import User from "../models/userModel.js";

const IOS_MONTHLY_PRODUCT_ID = "com.makescanly.scanlyapp.premium.monthly";
const IOS_YEARLY_PRODUCT_ID = "com.makescanly.scanlyapp.premium.yearly";
const SUPPORTED_PRODUCT_IDS = new Set([
  IOS_MONTHLY_PRODUCT_ID,
  IOS_YEARLY_PRODUCT_ID,
]);

const APPLE_PRODUCTION_VERIFY_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX_VERIFY_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

const parseDateMs = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const normalizeAppleStatus = (active) => (active ? "active" : "canceled");

const toBillingInterval = (productId) =>
  productId === IOS_YEARLY_PRODUCT_ID ? "year" : "month";

const toDisplayByProductId = (productId) => {
  if (productId === IOS_YEARLY_PRODUCT_ID) {
    return {
      amountDisplay: "$49.99",
      intervalLabel: "per year",
      planTitle: "Premium yearly",
      billingInterval: "year",
    };
  }
  return {
    amountDisplay: "$4.99",
    intervalLabel: "per month",
    planTitle: "Premium monthly",
    billingInterval: "month",
  };
};

const postVerifyReceipt = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Apple verifyReceipt failed with status ${response.status}`);
  }
  return response.json();
};

const verifyAppleReceipt = async (receiptData) => {
  const sharedSecret = String(process.env.APPLE_SHARED_SECRET || "").trim();
  if (!sharedSecret) {
    throw new Error("APPLE_SHARED_SECRET is missing on the server.");
  }

  const payload = {
    "receipt-data": receiptData,
    password: sharedSecret,
    "exclude-old-transactions": false,
  };

  const productionResult = await postVerifyReceipt(APPLE_PRODUCTION_VERIFY_URL, payload);
  if (productionResult?.status === 21007) {
    const sandboxResult = await postVerifyReceipt(APPLE_SANDBOX_VERIFY_URL, payload);
    return { result: sandboxResult, environment: "Sandbox" };
  }

  return {
    result: productionResult,
    environment: productionResult?.environment || "Production",
  };
};

const getLatestSubscriptionReceiptItem = (verifyResult) => {
  const latestInfo = Array.isArray(verifyResult?.latest_receipt_info)
    ? verifyResult.latest_receipt_info
    : [];
  const fallbackInfo = Array.isArray(verifyResult?.receipt?.in_app)
    ? verifyResult.receipt.in_app
    : [];
  const allItems = [...latestInfo, ...fallbackInfo].filter((item) =>
    SUPPORTED_PRODUCT_IDS.has(String(item?.product_id || "")),
  );

  if (allItems.length === 0) {
    return null;
  }

  allItems.sort((a, b) => parseDateMs(b?.expires_date_ms) - parseDateMs(a?.expires_date_ms));
  return allItems[0];
};

const getAutoRenewStatus = (verifyResult, originalTransactionId) => {
  const pendingRenewalInfo = Array.isArray(verifyResult?.pending_renewal_info)
    ? verifyResult.pending_renewal_info
    : [];

  const matched = pendingRenewalInfo.find((entry) => {
    const productId = String(entry?.product_id || "");
    if (!SUPPORTED_PRODUCT_IDS.has(productId)) return false;
    if (!originalTransactionId) return true;
    return String(entry?.original_transaction_id || "") === originalTransactionId;
  });

  return String(matched?.auto_renew_status || "0");
};

const toSummaryPayload = (user) => {
  const productId = String(user.appleProductId || "");
  const hasApple = Boolean(productId);
  const isPremium =
    String(user.plan || "free").toLowerCase() === "premium" &&
    String(user.subscriptionStatus || "").toLowerCase() === "active";

  const display = toDisplayByProductId(productId);
  return {
    provider: hasApple ? "apple_iap" : "none",
    hasStripeCustomer: Boolean(user.stripeCustomerId),
    hasAppleSubscription: hasApple,
    plan: isPremium ? "premium" : "free",
    subscriptionStatus: normalizeAppleStatus(isPremium),
    subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd || null,
    subscriptionCancelAtPeriodEnd: hasApple
      ? user.appleAutoRenewStatus === "0"
      : Boolean(user.subscriptionCancelAtPeriodEnd),
    paymentMethodLabel: hasApple ? "Managed by Apple App Store" : null,
    latestInvoiceLabel: hasApple ? "Available in Apple subscription history" : null,
    amountDisplay: isPremium ? display.amountDisplay : null,
    intervalLabel: isPremium ? display.intervalLabel : null,
    planTitle: isPremium ? display.planTitle : null,
    billingInterval: isPremium ? display.billingInterval : "month",
    autoPayEnabled: hasApple ? user.appleAutoRenewStatus === "1" : false,
  };
};

const syncUserFromValidatedReceipt = async ({ user, receiptData, verifyResult, environment }) => {
  const latestReceiptItem = getLatestSubscriptionReceiptItem(verifyResult);

  if (!latestReceiptItem) {
    user.plan = "free";
    user.subscriptionStatus = "canceled";
    user.subscriptionCurrentPeriodEnd = null;
    user.subscriptionCancelAtPeriodEnd = false;
    user.appleProductId = null;
    user.appleOriginalTransactionId = null;
    user.appleTransactionId = null;
    user.appleEnvironment = environment || null;
    user.appleAutoRenewStatus = "0";
    user.appleLatestReceiptData = receiptData;
    await user.save();
    return { active: false, productId: null };
  }

  const productId = String(latestReceiptItem.product_id || "");
  const expiresDateMs = parseDateMs(latestReceiptItem.expires_date_ms);
  const nowMs = Date.now();
  const isActive = expiresDateMs > nowMs;
  const autoRenewStatus = getAutoRenewStatus(
    verifyResult,
    String(latestReceiptItem.original_transaction_id || ""),
  );

  user.plan = isActive ? "premium" : "free";
  user.subscriptionStatus = normalizeAppleStatus(isActive);
  user.subscriptionCurrentPeriodEnd = expiresDateMs > 0 ? new Date(expiresDateMs) : null;
  user.subscriptionCancelAtPeriodEnd = isActive ? autoRenewStatus === "0" : false;
  user.appleProductId = productId || null;
  user.appleOriginalTransactionId =
    String(latestReceiptItem.original_transaction_id || "") || null;
  user.appleTransactionId = String(latestReceiptItem.transaction_id || "") || null;
  user.appleEnvironment = environment || null;
  user.appleAutoRenewStatus = autoRenewStatus;
  user.appleLatestReceiptData = receiptData;
  await user.save();

  return { active: isActive, productId };
};

export const validateIosSubscriptionReceipt = async (req, res) => {
  try {
    const receiptData = String(req.body?.receiptData || "").trim();
    if (!receiptData) {
      return res.status(400).json({ message: "receiptData is required" });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { result, environment } = await verifyAppleReceipt(receiptData);
    if (Number(result?.status) !== 0) {
      return res.status(400).json({
        message: "Apple receipt validation failed",
        data: {
          appleStatus: Number(result?.status || -1),
          environment,
        },
      });
    }

    const syncResult = await syncUserFromValidatedReceipt({
      user,
      receiptData,
      verifyResult: result,
      environment,
    });

    return res.status(200).json({
      message: syncResult.active
        ? "Subscription validated and activated."
        : "No active subscription found in receipt.",
      data: {
        ...toSummaryPayload(user),
        provider: "apple_iap",
        environment,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not validate Apple receipt",
      error: error.message,
    });
  }
};

export const restoreIosSubscription = async (req, res) => {
  return validateIosSubscriptionReceipt(req, res);
};

export const getIosBillingSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(userId).select(
      "plan subscriptionStatus subscriptionCurrentPeriodEnd subscriptionCancelAtPeriodEnd stripeCustomerId appleProductId appleOriginalTransactionId appleTransactionId appleEnvironment appleAutoRenewStatus",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      data: toSummaryPayload(user),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not load Apple billing summary",
      error: error.message,
    });
  }
};
