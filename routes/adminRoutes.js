import express from "express";
import { changeAdminPassword, loginAdmin } from "../controllers/adminController.js";

const router = express.Router();

router.post("/login", loginAdmin);
router.post("/change-password", changeAdminPassword);

export default router;
