import mongoose from "mongoose";
import Scan from "../models/scanModel.js";
import User from "../models/userModel.js";
import { extractIngredientsFromImage } from "../utils/ocr.js";
import { analyzeIngredientsRisk } from "../utils/ingredientAnalysis.js";

export const extractIngredientsTextFromImage = async (req, res) => {
  try {
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).json({ message: "image file is required" });
    }

    console.log(`[OCR] /api/scans/ocr imageSize=${imageFile.size ?? 0}`);
    const extraction = await extractIngredientsFromImage(imageFile.buffer);

    if (!extraction.ingredientsText) {
      return res.status(422).json({
        message: "Unable to extract readable text from image",
      });
    }

    return res.status(200).json({
      data: {
        ingredientsText: extraction.ingredientsText,
        rawText: extraction.rawText,
        provider: extraction.provider,
      },
    });
  } catch (error) {
    console.error(`[OCR] /api/scans/ocr failed: ${error.message}`);
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

    console.log(
      `[AI] /api/scans/analyze userId=${userId} userAllergies=${user.allergies.length} ingredientsLength=${ingredientsText.length}`,
    );
    const analysis = await analyzeIngredientsRisk({
      allergies: user.allergies,
      ingredientsText,
    });

    const scan = await Scan.create({
      userId,
      imageUrl,
      ingredientsText,
      status: analysis.status,
      summary: analysis.summary,
      matchedAllergens: analysis.matchedAllergens,
    });

    return res.status(200).json({
      data: {
        scanId: scan._id,
        status: scan.status,
        summary: scan.summary,
        usedAllergies: analysis.usedAllergies || user.allergies,
        matchedAllergens: scan.matchedAllergens,
        analysisSource: analysis.source,
        createdAt: scan.createdAt,
      },
    });
  } catch (error) {
    console.error(`[AI] /api/scans/analyze failed: ${error.message}`);
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




