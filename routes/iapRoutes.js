import express from "express";
import {
  getIosBillingSummary,
  restoreIosSubscription,
  validateIosSubscriptionReceipt,
} from "../controllers/iapController.js";
import { authenticateUser, requireSelfUserId } from "../middleware/auth.js";

const router = express.Router();

router.post("/ios/validate-receipt", authenticateUser, validateIosSubscriptionReceipt);
router.post("/ios/restore", authenticateUser, restoreIosSubscription);
router.get(
  "/ios/billing-summary/:userId",
  authenticateUser,
  requireSelfUserId("userId"),
  getIosBillingSummary,
);

export default router;
