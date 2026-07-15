import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/userModel.js";

const IOS_MONTHLY_PRODUCT_ID = "monthly_subscription";
const IOS_YEARLY_PRODUCT_ID = "yearly_subscription";
/** Current App Store Connect IDs plus previous reverse-DNS IDs (migration safety). */
const SUPPORTED_PRODUCT_IDS = new Set([
  IOS_MONTHLY_PRODUCT_ID,
  IOS_YEARLY_PRODUCT_ID,
  "com.makescanly.scanlyapp.premium.monthly",
  "com.makescanly.scanlyapp.premium.yearly",
]);
const EXPECTED_BUNDLE_ID = "com.makescanly.scanlyapp";

const APPLE_PRODUCTION_VERIFY_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX_VERIFY_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

const parseDateMs = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const normalizeAppleStatus = (active) => (active ? "active" : "canceled");

const toDisplayByProductId = (productId) => {
  if (
    productId === IOS_YEARLY_PRODUCT_ID ||
    productId === "com.makescanly.scanlyapp.premium.yearly"
  ) {
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

const looksLikeJws = (value) => String(value || "").split(".").length === 3;

const decodeBase64UrlJson = (segment) => {
  const normalized = String(segment || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return JSON.parse(Buffer.from(`${normalized}${pad}`, "base64").toString("utf8"));
};

const base64UrlToBuffer = (segment) => {
  const normalized = String(segment || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

const derToPemCertificate = (derBase64) => {
  const lines = String(derBase64 || "").match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
};

/**
 * Verify StoreKit 2 transaction JWS using the embedded x5c leaf certificate.
 * Payload fields: productId, bundleId, expiresDate, transactionId, environment, etc.
 */
const verifyAndDecodeAppleJws = (jws) => {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Apple transaction token.");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeBase64UrlJson(headerB64);
  const payload = decodeBase64UrlJson(payloadB64);
  const leafCert = Array.isArray(header?.x5c) ? header.x5c[0] : null;
  if (!leafCert) {
    throw new Error("Apple transaction token is missing a certificate.");
  }

  const publicKey = crypto.createPublicKey(derToPemCertificate(leafCert));
  const signedContent = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBuffer(signatureB64);
  const algorithm = String(header?.alg || "ES256").toUpperCase();
  const hash = algorithm.includes("512")
    ? "SHA512"
    : algorithm.includes("384")
      ? "SHA384"
      : "SHA256";

  const isValid = crypto.verify(
    hash,
    signedContent,
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    signature,
  );
  if (!isValid) {
    throw new Error("Apple transaction signature verification failed.");
  }

  return payload;
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

const clearAppleSubscription = async ({ user, receiptData, environment }) => {
  user.plan = "free";
  user.subscriptionStatus = "canceled";
  user.subscriptionCurrentPeriodEnd = null;
  user.subscriptionCancelAtPeriodEnd = false;
  user.appleProductId = null;
  user.appleOriginalTransactionId = null;
  user.appleTransactionId = null;
  user.appleEnvironment = environment || null;
  user.appleAutoRenewStatus = "0";
  user.appleLatestReceiptData = receiptData || null;
  await user.save();
  return { active: false, productId: null };
};

/**
 * An Apple subscription is tied to an Apple ID, not a Scanly account.
 * When a new Scanly user restores/validates the same originalTransactionId,
 * move Premium onto that user and demote any previous Scanly account.
 */
const releaseAppleSubscriptionFromOtherUsers = async ({
  currentUserId,
  originalTransactionId,
  environment,
}) => {
  const originalId = String(originalTransactionId || "").trim();
  if (!originalId || !currentUserId) return;

  await User.updateMany(
    {
      _id: { $ne: currentUserId },
      appleOriginalTransactionId: originalId,
    },
    {
      $set: {
        plan: "free",
        subscriptionStatus: "canceled",
        subscriptionCurrentPeriodEnd: null,
        subscriptionCancelAtPeriodEnd: false,
        appleProductId: null,
        appleOriginalTransactionId: null,
        appleTransactionId: null,
        appleEnvironment: environment || null,
        appleAutoRenewStatus: "0",
      },
    },
  );
};

const syncUserFromValidatedReceipt = async ({ user, receiptData, verifyResult, environment }) => {
  const latestReceiptItem = getLatestSubscriptionReceiptItem(verifyResult);

  if (!latestReceiptItem) {
    return clearAppleSubscription({ user, receiptData, environment });
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

  if (isActive && user.appleOriginalTransactionId) {
    await releaseAppleSubscriptionFromOtherUsers({
      currentUserId: user._id,
      originalTransactionId: user.appleOriginalTransactionId,
      environment,
    });
  }

  await user.save();

  return { active: isActive, productId };
};

const syncUserFromJwsPayload = async ({ user, jws, payload }) => {
  const productId = String(payload?.productId || "").trim();
  const bundleId = String(payload?.bundleId || "").trim();
  const environment = String(payload?.environment || "Unknown");

  if (bundleId && bundleId !== EXPECTED_BUNDLE_ID) {
    throw new Error("Apple transaction bundle ID does not match this app.");
  }
  if (!SUPPORTED_PRODUCT_IDS.has(productId)) {
    return clearAppleSubscription({
      user,
      receiptData: jws,
      environment,
    });
  }

  if (payload?.revocationDate) {
    return clearAppleSubscription({
      user,
      receiptData: jws,
      environment,
    });
  }

  const expiresDateMs = parseDateMs(payload?.expiresDate);
  const nowMs = Date.now();
  // Some non-expiring shapes omit expiresDate; treat missing expiry as active when product matches.
  const isActive = expiresDateMs > 0 ? expiresDateMs > nowMs : true;
  const autoRenewStatus =
    payload?.autoRenewStatus != null
      ? String(payload.autoRenewStatus)
      : isActive
        ? "1"
        : "0";

  user.plan = isActive ? "premium" : "free";
  user.subscriptionStatus = normalizeAppleStatus(isActive);
  user.subscriptionCurrentPeriodEnd = expiresDateMs > 0 ? new Date(expiresDateMs) : null;
  user.subscriptionCancelAtPeriodEnd = isActive ? autoRenewStatus === "0" : false;
  user.appleProductId = productId || null;
  user.appleOriginalTransactionId =
    String(payload?.originalTransactionId || "") || null;
  user.appleTransactionId = String(payload?.transactionId || "") || null;
  user.appleEnvironment = environment || null;
  user.appleAutoRenewStatus = autoRenewStatus;
  user.appleLatestReceiptData = jws;

  if (isActive && user.appleOriginalTransactionId) {
    await releaseAppleSubscriptionFromOtherUsers({
      currentUserId: user._id,
      originalTransactionId: user.appleOriginalTransactionId,
      environment,
    });
  }

  await user.save();

  return { active: isActive, productId };
};

export const validateIosSubscriptionReceipt = async (req, res) => {
  try {
    // StyleSync sent `receipt`; Scanly clients send `receiptData` and/or `jws`.
    const jwsRaw = String(req.body?.jws || "").trim();
    const receiptRaw = String(
      req.body?.receiptData || req.body?.receipt || "",
    ).trim();
    const jwsToken = looksLikeJws(jwsRaw)
      ? jwsRaw
      : looksLikeJws(receiptRaw)
        ? receiptRaw
        : "";
    // Classic app receipt only (never treat a JWS string as verifyReceipt input).
    const legacyReceipt =
      receiptRaw && !looksLikeJws(receiptRaw) ? receiptRaw : "";

    if (!jwsToken && !legacyReceipt) {
      return res.status(400).json({
        message: "jws or receiptData is required",
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let syncResult;
    let jwsErrorMessage = "";

    if (jwsToken) {
      try {
        const payload = verifyAndDecodeAppleJws(jwsToken);
        syncResult = await syncUserFromJwsPayload({
          user,
          jws: jwsToken,
          payload,
        });
      } catch (error) {
        jwsErrorMessage = error instanceof Error ? error.message : String(error);
        if (!legacyReceipt) {
          return res.status(400).json({
            message: "Apple receipt validation failed",
            error: jwsErrorMessage,
          });
        }
      }
    }

    if (!syncResult && legacyReceipt) {
      const { result, environment } = await verifyAppleReceipt(legacyReceipt);
      if (Number(result?.status) !== 0) {
        return res.status(400).json({
          message: "Apple receipt validation failed",
          data: {
            appleStatus: Number(result?.status || -1),
            environment,
            ...(jwsErrorMessage ? { jwsError: jwsErrorMessage } : {}),
          },
        });
      }

      syncResult = await syncUserFromValidatedReceipt({
        user,
        receiptData: legacyReceipt,
        verifyResult: result,
        environment,
      });
    }

    if (!syncResult) {
      return res.status(400).json({
        message: "Apple receipt validation failed",
        error: jwsErrorMessage || "No valid Apple purchase proof.",
      });
    }

    return res.status(200).json({
      message: syncResult.active
        ? "Subscription validated and activated."
        : "No active subscription found in receipt.",
      data: {
        ...toSummaryPayload(user),
        provider: "apple_iap",
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
