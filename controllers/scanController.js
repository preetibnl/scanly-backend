import mongoose from "mongoose";
import Scan from "../models/scanModel.js";
import User from "../models/userModel.js";
import { extractIngredientsFromImage } from "../utils/ocr.js";
import { analyzeIngredientsRisk } from "../utils/ingredientAnalysis.js";

export const extractIngredientsTextFromImage = async (req, res) => {
  const flowStart = Date.now();
  try {
    const imageFile = req.file;

    if (!imageFile) {
      console.warn("[OCR] POST /api/scans/ocr → 400 missing multipart image file");
      return res.status(400).json({ message: "image file is required" });
    }

    const imageBytes = imageFile.size ?? imageFile.buffer?.length ?? 0;
    console.log(
      `[OCR] POST /api/scans/ocr step=received imageBytes=${imageBytes} mimetype=${imageFile.mimetype ?? "n/a"}`,
    );

    const extraction = await extractIngredientsFromImage(imageFile.buffer);

    if (!extraction.ingredientsText) {
      console.warn(
        `[OCR] POST /api/scans/ocr step=no_usable_text provider=${extraction.provider ?? "n/a"} rawChars=${(extraction.rawText || "").length} durationMs=${Date.now() - flowStart}`,
      );
      return res.status(422).json({
        message: "Unable to extract readable text from image",
      });
    }

    console.log(
      `[OCR] POST /api/scans/ocr step=response_ok provider=${extraction.provider} rawChars=${(extraction.rawText || "").length} ingredientsChars=${extraction.ingredientsText.length} durationMs=${Date.now() - flowStart}`,
    );
    return res.status(200).json({
      data: {
        ingredientsText: extraction.ingredientsText,
        rawText: extraction.rawText,
        provider: extraction.provider,
      },
    });
  } catch (error) {
    console.error(
      `[OCR] POST /api/scans/ocr step=error durationMs=${Date.now() - flowStart} message=${error.message}`,
    );
    if (error.stack) {
      console.error(error.stack);
    }
    return res.status(500).json({
      message: "Failed to extract text from image",
      error: error.message,
    });
  }
};

export const analyzeScan = async (req, res) => {
  const flowStart = Date.now();
  try {
    const { userId, imageUrl = "", ingredientsText = "" } = req.body;

    if (!userId) {
      console.warn("[AI] POST /api/scans/analyze → 400 userId missing");
      return res.status(400).json({ message: "userId is required" });
    }

    if (!imageUrl && !ingredientsText) {
      console.warn(
        `[AI] POST /api/scans/analyze → 400 userId=${userId} missing both imageUrl and ingredientsText`,
      );
      return res.status(400).json({
        message: "Either imageUrl or ingredientsText is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.warn(`[AI] POST /api/scans/analyze → 400 invalid userId format`);
      return res.status(400).json({ message: "Invalid user id" });
    }

    const hasImage = Boolean(String(imageUrl).trim());
    const ingredientsChars = String(ingredientsText).length;
    console.log(
      `[AI] POST /api/scans/analyze step=received userId=${userId} hasImageUrl=${hasImage} imageUrlChars=${String(imageUrl).length} ingredientsChars=${ingredientsChars}`,
    );

    const user = await User.findById(userId).select("allergies");
    if (!user) {
      console.warn(`[AI] POST /api/scans/analyze → 404 user not found userId=${userId}`);
      return res.status(404).json({ message: "User not found" });
    }

    console.log(
      `[AI] POST /api/scans/analyze step=user_loaded storedAllergyCount=${user.allergies?.length ?? 0}`,
    );

    const analyzeT0 = Date.now();
    const analysis = await analyzeIngredientsRisk({
      allergies: user.allergies,
      ingredientsText,
    });
    const riskEngineMs = Date.now() - analyzeT0;

    console.log(
      `[AI] POST /api/scans/analyze step=analysis_done source=${analysis.source} status=${analysis.status} matchedCount=${analysis.matchedAllergens?.length ?? 0} fallbackReason=${analysis.fallbackReason ?? "n/a"} riskEngineMs=${riskEngineMs}`,
    );

    const scan = await Scan.create({
      userId,
      imageUrl,
      ingredientsText,
      status: analysis.status,
      summary: analysis.summary,
      matchedAllergens: analysis.matchedAllergens,
    });

    console.log(
      `[AI] POST /api/scans/analyze step=persisted scanId=${scan._id} totalDurationMs=${Date.now() - flowStart}`,
    );

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
    console.error(
      `[AI] POST /api/scans/analyze step=error durationMs=${Date.now() - flowStart} message=${error.message}`,
    );
    if (error.stack) {
      console.error(error.stack);
    }
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




