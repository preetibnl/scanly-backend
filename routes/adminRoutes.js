import express from "express";
import { changeAdminPassword, loginAdmin } from "../controllers/adminController.js";
import { authenticateAdmin } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", loginAdmin);
router.post("/change-password", authenticateAdmin, changeAdminPassword);

export default router;
