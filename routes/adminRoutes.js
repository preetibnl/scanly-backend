import express from "express";
import { changeAdminPassword, loginAdmin } from "../controllers/adminController.js";
import {
  getAdminPlanConfig,
  updateAdminPlanConfig,
} from "../controllers/subscriptionPlanConfigController.js";
import { authenticateAdmin } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", loginAdmin);
router.post("/change-password", authenticateAdmin, changeAdminPassword);
router.get("/subscription-plans", authenticateAdmin, getAdminPlanConfig);
router.put("/subscription-plans", authenticateAdmin, updateAdminPlanConfig);

export default router;
