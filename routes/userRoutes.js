import express from "express";
import {
  deleteUser,
  forgotPassword,
  getUsers,
  getUserProfile,
  loginUser,
  resetPassword,
  signupUser,
  updateUserAllergies,
  verifyResetOtp,
} from "../controllers/userController.js";

const router = express.Router();

router.get("/", getUsers);
router.post("/signup", signupUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", resetPassword);
router.put("/:id/allergies", updateUserAllergies);
router.get("/:id/profile", getUserProfile);
router.delete("/:id", deleteUser);

export default router;
