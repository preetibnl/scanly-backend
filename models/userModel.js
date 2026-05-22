import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    profilePhotoUrl: {
      type: String,
      default: "",
      trim: true,
    },
    allergies: {
      type: [String],
      default: [],
    },
    plan: {
      type: String,
      default: "free",
    },
    stripeCustomerId: {
      type: String,
      default: null,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
    },
    subscriptionStatus: {
      type: String,
      default: null,
    },
    subscriptionCurrentPeriodEnd: {
      type: Date,
      default: null,
    },
    subscriptionCancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    resetPasswordTokenHash: {
      type: String,
      default: null,
    },
    resetPasswordExpiresAt: {
      type: Date,
      default: null,
    },
    resetOtpHash: {
      type: String,
      default: null,
    },
    resetOtpExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
