import express from "express";
import {
  deleteUser,
  forgotPassword,
  getUserProfile,
  loginUser,
  resetPassword,
  signupUser,
  updateUserAllergies,
} from "../controllers/userController.js";

const router = express.Router();

router.post("/signup", signupUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.put("/:id/allergies", updateUserAllergies);
router.get("/:id/profile", getUserProfile);
router.delete("/:id", deleteUser);

export default router;
