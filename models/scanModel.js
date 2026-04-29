import mongoose from "mongoose";

const matchedAllergenSchema = new mongoose.Schema(
  {
    allergy: { type: String, required: true },
    ingredient: { type: String, required: true },
    riskLevel: { type: String, default: "medium" },
  },
  { _id: false }
);

const scanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    imageUrl: { type: String, default: "" },
    ingredientsText: { type: String, default: "" },
    status: {
      type: String,
      enum: ["safe", "unsafe"],
      required: true,
    },
    summary: { type: String, required: true },
    matchedAllergens: { type: [matchedAllergenSchema], default: [] },
  },
  { timestamps: true }
);

const Scan = mongoose.model("Scan", scanSchema);

export default Scan;
