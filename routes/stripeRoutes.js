import express from "express";
import {
  confirmCheckoutSession,
  createCheckoutSession,
  createPortalSession,
  getBillingSummary,
  renderPortalReturn,
  renderReturnCancel,
  renderReturnSuccess,
  verifyStripeConnection,
} from "../controllers/stripeController.js";
import { authenticateUser, requireSelfUserId } from "../middleware/auth.js";

const router = express.Router();

router.get("/verify", verifyStripeConnection);

router.get("/return/success", renderReturnSuccess);
router.get("/return/cancel", renderReturnCancel);
router.get("/return/portal", renderPortalReturn);

router.post("/create-checkout-session", authenticateUser, createCheckoutSession);
router.post("/confirm-checkout", authenticateUser, confirmCheckoutSession);
router.post("/create-portal-session", authenticateUser, createPortalSession);
router.get(
  "/billing-summary/:userId",
  authenticateUser,
  requireSelfUserId("userId"),
  getBillingSummary,
);

export default router;
