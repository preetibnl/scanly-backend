import express from "express";
import {
  adminProfilePhotoUpload,
  changeAdminPassword,
  generateAdminProfileUploadUrl,
  getAdminProfile,
  loginAdmin,
  updateAdminProfile,
  uploadAdminProfilePhoto,
} from "../controllers/adminController.js";
import {
  getAdminPlanConfig,
  updateAdminPlanConfig,
} from "../controllers/subscriptionPlanConfigController.js";
import { authenticateAdmin } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", loginAdmin);
router.get("/profile", authenticateAdmin, getAdminProfile);
router.put("/profile", authenticateAdmin, updateAdminProfile);
router.post("/profile/upload-url", authenticateAdmin, generateAdminProfileUploadUrl);
router.post(
  "/profile/photo",
  authenticateAdmin,
  (req, res, next) => {
    adminProfilePhotoUpload(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          message: err.message || "Invalid photo upload",
        });
      }
      return next();
    });
  },
  uploadAdminProfilePhoto,
);
router.post("/change-password", authenticateAdmin, changeAdminPassword);
router.get("/subscription-plans", authenticateAdmin, getAdminPlanConfig);
router.put("/subscription-plans", authenticateAdmin, updateAdminPlanConfig);

export default router;
