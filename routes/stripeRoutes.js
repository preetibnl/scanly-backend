import express from "express";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingSummary,
  renderPortalReturn,
  renderReturnCancel,
  renderReturnSuccess,
  verifyStripeConnection,
} from "../controllers/stripeController.js";

const router = express.Router();

router.get("/verify", verifyStripeConnection);

router.get("/return/success", renderReturnSuccess);
router.get("/return/cancel", renderReturnCancel);
router.get("/return/portal", renderPortalReturn);

router.post("/create-checkout-session", createCheckoutSession);
router.post("/create-portal-session", createPortalSession);
router.get("/billing-summary/:userId", getBillingSummary);

export default router;
