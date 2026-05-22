import express from "express";
import {
  deleteUser,
  forgotPassword,
  getAdminUserDetails,
  getAdminOverview,
  getAdminScans,
  getCurrentUserMe,
  getUsers,
  getUserProfile,
  handleUserProfilePhotoUpload,
  loginUser,
  removeUserProfilePhoto,
  uploadUserProfilePhoto,
  resetPassword,
  signupUser,
  updateUserAllergies,
  verifyResetOtp,
} from "../controllers/userController.js";
import {
  authenticateAdmin,
  authenticateUser,
  requireSelfUserId,
} from "../middleware/auth.js";

const router = express.Router();

// Public auth
router.post("/signup", signupUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", resetPassword);

// Authenticated user
router.get("/me", authenticateUser, getCurrentUserMe);
router.put("/:id/allergies", authenticateUser, requireSelfUserId("id"), updateUserAllergies);
router.get("/:id/profile", authenticateUser, requireSelfUserId("id"), getUserProfile);
router.post(
  "/:id/profile/photo",
  authenticateUser,
  requireSelfUserId("id"),
  handleUserProfilePhotoUpload,
  uploadUserProfilePhoto,
);
router.delete(
  "/:id/profile/photo",
  authenticateUser,
  requireSelfUserId("id"),
  removeUserProfilePhoto,
);
router.delete("/:id", authenticateUser, requireSelfUserId("id"), deleteUser);

// Admin only (same paths as before for scanly-web compatibility)
router.get("/admin/overview", authenticateAdmin, getAdminOverview);
router.get("/admin/scans", authenticateAdmin, getAdminScans);
router.get("/:id/admin-details", authenticateAdmin, getAdminUserDetails);
router.get("/", authenticateAdmin, getUsers);

export default router;
