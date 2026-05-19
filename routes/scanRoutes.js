import express from "express";
import multer from "multer";
import {
  analyzeScan,
  askAssistant,
  extractIngredientsTextFromImage,
  getScanHistory,
} from "../controllers/scanController.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "scans" });
});

router.post("/analyze", analyzeScan);
router.post("/assistant", askAssistant);
router.post("/ocr", upload.single("image"), extractIngredientsTextFromImage);
router.get("/history", getScanHistory);

export default router;
