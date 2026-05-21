import mongoose from "mongoose";

const subscriptionPlanConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default",
    },
    monthlyPriceCents: {
      type: Number,
      default: 499,
      min: 50,
    },
    yearlyPriceCents: {
      type: Number,
      default: 4999,
      min: 50,
    },
    currency: {
      type: String,
      default: "usd",
      lowercase: true,
      trim: true,
    },
    monthlyFeatures: {
      type: [String],
      default: [],
    },
    yearlyFeatures: {
      type: [String],
      default: [],
    },
    stripePriceIdMonthly: {
      type: String,
      default: "",
      trim: true,
    },
    stripePriceIdYearly: {
      type: String,
      default: "",
      trim: true,
    },
    updatedByAdminEmail: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

const SubscriptionPlanConfig = mongoose.model(
  "SubscriptionPlanConfig",
  subscriptionPlanConfigSchema,
);

export default SubscriptionPlanConfig;
