import express from "express";
import multer from "multer";
import {
  analyzeScan,
  askAssistant,
  extractIngredientsTextFromImage,
  getScanById,
  getScanHistory,
} from "../controllers/scanController.js";
import { authenticateUser } from "../middleware/auth.js";

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

router.post("/ocr", authenticateUser, upload.single("image"), extractIngredientsTextFromImage);
router.post("/analyze", authenticateUser, analyzeScan);
router.post("/assistant", authenticateUser, askAssistant);
router.get("/history", authenticateUser, getScanHistory);
router.get("/:id", authenticateUser, getScanById);

export default router;
