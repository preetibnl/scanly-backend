import mongoose from "mongoose";
import Scan from "../models/scanModel.js";
import User from "../models/userModel.js";

const allergyKeywordMap = {
  milk: ["milk", "whey", "casein", "lactose", "milk solids"],
  soy: ["soy", "soya", "soy lecithin", "soy protein"],
  peanuts: ["peanut", "groundnut"],
  nuts: ["almond", "cashew", "walnut", "hazelnut", "pistachio", "nut"],
  gluten: ["wheat", "barley", "rye", "malt", "gluten"],
  egg: ["egg", "albumin"],
};

const findAllergyMatches = (allergies = [], ingredientsText = "") => {
  const text = ingredientsText.toLowerCase();

  return allergies.flatMap((allergyRaw) => {
    const allergy = String(allergyRaw).trim();
    if (!allergy) {
      return [];
    }

    const normalizedAllergy = allergy.toLowerCase();
    const keywords = allergyKeywordMap[normalizedAllergy] || [normalizedAllergy];
    const matchedKeyword = keywords.find((keyword) => text.includes(keyword));

    if (!matchedKeyword) {
      return [];
    }

    return [
      {
        allergy,
        ingredient: matchedKeyword,
        riskLevel: "high",
      },
    ];
  });
};

export const analyzeScan = async (req, res) => {
  try {
    const { userId, imageUrl = "", ingredientsText = "" } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    if (!imageUrl && !ingredientsText) {
      return res.status(400).json({
        message: "Either imageUrl or ingredientsText is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(userId).select("allergies");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const matches = findAllergyMatches(user.allergies, ingredientsText);
    const status = matches.length > 0 ? "unsafe" : "safe";
    const summary =
      status === "unsafe"
        ? "Contains ingredients matching your allergies."
        : "No matching allergens found for your profile.";

    const scan = await Scan.create({
      userId,
      imageUrl,
      ingredientsText,
      status,
      summary,
      matchedAllergens: matches,
    });

    return res.status(200).json({
      data: {
        scanId: scan._id,
        status: scan.status,
        summary: scan.summary,
        matchedAllergens: scan.matchedAllergens,
        createdAt: scan.createdAt,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to analyze scan", error: error.message });
  }
};

export const getScanHistory = async (req, res) => {
  try {
    const { userId, page = 1, limit = 10 } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const parsedPage = Math.max(Number(page) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const skip = (parsedPage - 1) * parsedLimit;

    const [history, total] = await Promise.all([
      Scan.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit),
      Scan.countDocuments({ userId }),
    ]);

    const items = history.map((scan) => ({
      scanId: scan._id,
      status: scan.status,
      matchedCount: scan.matchedAllergens.length,
      createdAt: scan.createdAt,
      thumbnailUrl: scan.imageUrl,
    }));

    return res.status(200).json({
      data: {
        items,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total,
          hasNext: skip + items.length < total,
        },
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to fetch scan history", error: error.message });
  }
};
