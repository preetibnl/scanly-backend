import express from "express";
import multer from "multer";
import {
  analyzeScan,
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

router.post("/analyze", analyzeScan);
router.post("/ocr", upload.single("image"), extractIngredientsTextFromImage);
router.get("/history", getScanHistory);

export default router;
