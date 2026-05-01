import mongoose from "mongoose";
import Tesseract from "tesseract.js";
import Scan from "../models/scanModel.js";
import User from "../models/userModel.js";

const allergyKeywordMap = {
  milk: ["milk", "whey", "casein", "lactose", "milk solids", "milk powder"],
  dairy: ["milk", "whey", "casein", "lactose", "milk solids", "butterfat"],
  soy: ["soy", "soya", "soy lecithin", "soy protein", "textured soy protein"],
  soya: ["soy", "soya", "soy lecithin", "soy protein", "textured soy protein"],
  peanut: ["peanut", "peanuts", "groundnut", "groundnuts", "peanut butter"],
  peanuts: ["peanut", "peanuts", "groundnut", "groundnuts", "peanut butter"],
  nuts: [
    "peanut",
    "peanuts",
    "groundnut",
    "groundnuts",
    "peanut butter",
    "almond",
    "cashew",
    "walnut",
    "hazelnut",
    "pistachio",
    "macadamia",
    "pecan",
    "brazil nut",
    "tree nut",
    "tree nuts",
  ],
  "tree nuts": [
    "peanut",
    "peanuts",
    "groundnut",
    "groundnuts",
    "peanut butter",
    "almond",
    "cashew",
    "walnut",
    "hazelnut",
    "pistachio",
    "macadamia",
    "pecan",
    "brazil nut",
    "tree nut",
    "tree nuts",
  ],
  gluten: ["wheat", "barley", "rye", "malt", "gluten", "semolina"],
  egg: ["egg", "eggs", "albumin", "egg white", "egg yolk"],
  eggs: ["egg", "eggs", "albumin", "egg white", "egg yolk"],
};

const normalizeSearchText = (value = "") =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsKeyword = (normalizedText = "", keyword = "") => {
  if (!keyword) {
    return false;
  }
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return false;
  }
  const keywordVariants = new Set([normalizedKeyword]);
  if (!normalizedKeyword.endsWith("s")) {
    keywordVariants.add(`${normalizedKeyword}s`);
  } else if (normalizedKeyword.length > 3) {
    keywordVariants.add(normalizedKeyword.slice(0, -1));
  }

  for (const variant of keywordVariants) {
    if (variant.includes(" ")) {
      if (normalizedText.includes(variant)) {
        return true;
      }
      continue;
    }
    const regex = new RegExp(`\\b${variant}\\b`, "i");
    if (regex.test(normalizedText)) {
      return true;
    }
  }

  return false;
};

const findAllergyMatches = (allergies = [], ingredientsText = "") => {
  const normalizedText = normalizeSearchText(ingredientsText);

  return allergies.flatMap((allergyRaw) => {
    const allergy = String(allergyRaw).trim();
    if (!allergy) {
      return [];
    }

    const normalizedAllergy = allergy.toLowerCase();
    const keywords = allergyKeywordMap[normalizedAllergy] || [normalizedAllergy];
    const matchedKeyword = keywords.find((keyword) =>
      containsKeyword(normalizedText, keyword),
    );

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

const normalizeExtractedText = (rawText = "") => {
  const cleanedText = rawText
    .replace(/\s+/g, " ")
    .replace(/[|]/g, " ")
    .trim();

  const ingredientsCapture = cleanedText.match(
    /ingredients?\s*[:\-]\s*([\s\S]*?)(nutrition|nutritional|allergen|contains|storage|manufactured|net\s*qty|mrp|best before|$)/i,
  );

  if (ingredientsCapture?.[1]) {
    return ingredientsCapture[1].trim();
  }

  return cleanedText.replace(/\bINGREDIENTS?\b[:\-]?/gi, "").trim();
};

export const extractIngredientsTextFromImage = async (req, res) => {
  try {
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).json({ message: "image file is required" });
    }

    const {
      data: { text },
    } = await Tesseract.recognize(imageFile.buffer, "eng");

    const normalizedText = normalizeExtractedText(text);

    if (!normalizedText) {
      return res.status(422).json({
        message: "Unable to extract readable text from image",
      });
    }

    return res.status(200).json({
      data: {
        ingredientsText: normalizedText,
        rawText: text,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to extract text from image",
      error: error.message,
    });
  }
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
        usedAllergies: user.allergies,
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
      summary: scan.summary,
      ingredientsText: scan.ingredientsText,
      matchedAllergens: scan.matchedAllergens,
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




