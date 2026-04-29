import express from "express";
import { analyzeScan, getScanHistory } from "../controllers/scanController.js";

const router = express.Router();

router.post("/analyze", analyzeScan);
router.get("/history", getScanHistory);

export default router;
