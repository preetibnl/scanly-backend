import bcrypt from "bcryptjs";
import multer from "multer";
import Admin from "../models/adminModel.js";
import { signAdminToken } from "../utils/jwt.js";
import {
  createPresignedImageUpload,
  deleteS3ObjectByUrl,
  isAllowedProfilePhotoUrl,
  normalizeStoredPhotoUrl,
  resolveProfilePhotoDisplayUrl,
  uploadImageBuffer,
} from "../utils/s3Helpers.js";

const ADMIN_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const adminProfilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ADMIN_PHOTO_MIME_TYPES.has(String(file.mimetype || "").toLowerCase())) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed (JPEG, PNG, WebP, or GIF)."));
  },
}).single("photo");

const PASSWORD_SALT_ROUNDS = Number(process.env.PASSWORD_SALT_ROUNDS || 10);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const adminEmailSlug = (email) =>
  normalizeEmail(email).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "admin";

export const formatAdminProfileResponse = async (admin) => {
  const storedPhoto = String(admin?.profilePhotoUrl || "").trim();
  return {
    email: admin?.email || "",
    displayName: String(admin?.displayName || "").trim(),
    profilePhotoUrl: storedPhoto ? await resolveProfilePhotoDisplayUrl(storedPhoto) : "",
  };
};

const findAdminBySession = async (req) => {
  const email = normalizeEmail(req.adminEmail);
  if (!email) return null;
  return Admin.findOne({ email });
};

const comparePassword = async (plain, hash) => {
  if (plain == null || hash == null || typeof hash !== "string" || hash.length < 10) {
    return false;
  }
  try {
    return await bcrypt.compare(String(plain), hash);
  } catch (err) {
    console.error("[Admin] bcrypt.compare failed:", err?.message || err);
    return false;
  }
};

export const ensureAdminAccount = async () => {
  const email = normalizeEmail(process.env.ADMIN_EMAIL || "adminscanly@yopmail.com");
  const initialPlain =
    process.env.ADMIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "scanly@123";

  const existing = await Admin.findOne({ email });
  if (existing) return;

  try {
    const passwordHash = await bcrypt.hash(initialPlain, PASSWORD_SALT_ROUNDS);
    await Admin.create({ email, passwordHash });
    console.log(`[Admin] Created default admin account for ${email}`);
  } catch (error) {
    if (error?.code === 11000) return;
    throw error;
  }
};

export const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email: normalizeEmail(email) });
    if (!admin || !admin.passwordHash) {
      return res.status(401).json({ message: "Invalid admin credentials. Please check email and password." });
    }

    const isValid = await comparePassword(password, admin.passwordHash);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid admin credentials. Please check email and password." });
    }

    const token = signAdminToken(admin);

    return res.status(200).json({
      message: "Authenticated",
      token,
      data: await formatAdminProfileResponse(admin),
    });
  } catch (error) {
    console.error("[Admin] loginAdmin:", error);
    return res.status(500).json({ message: "Admin login failed", error: error.message });
  }
};

export const changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const email = normalizeEmail(req.adminEmail || req.body?.email);

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ message: "Email, current password, and new password are required" });
    }

    const trimmedNew = String(newPassword).trim();
    if (trimmedNew.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    const admin = await Admin.findOne({ email });
    if (!admin || !admin.passwordHash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const currentOk = await comparePassword(currentPassword, admin.passwordHash);
    if (!currentOk) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }

    if (String(currentPassword) === trimmedNew) {
      return res.status(400).json({ message: "Choose a password different from your current one." });
    }

    admin.passwordHash = await bcrypt.hash(trimmedNew, PASSWORD_SALT_ROUNDS);
    await admin.save();

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("[Admin] changeAdminPassword:", error);
    return res.status(500).json({ message: "Failed to update password", error: error.message });
  }
};

export const getAdminProfile = async (req, res) => {
  try {
    const admin = await findAdminBySession(req);
    if (!admin) {
      return res.status(404).json({ message: "Admin account not found" });
    }
    return res.status(200).json({
      message: "Admin profile loaded",
      data: await formatAdminProfileResponse(admin),
    });
  } catch (error) {
    console.error("[Admin] getAdminProfile:", error);
    return res.status(500).json({ message: "Failed to load admin profile", error: error.message });
  }
};

export const updateAdminProfile = async (req, res) => {
  try {
    const admin = await findAdminBySession(req);
    if (!admin) {
      return res.status(404).json({ message: "Admin account not found" });
    }

    const { displayName, profilePhotoUrl, removeProfilePhoto } = req.body || {};
    const previousPhotoUrl = admin.profilePhotoUrl;

    if (displayName !== undefined) {
      admin.displayName = String(displayName || "").trim().slice(0, 80);
    }

    if (removeProfilePhoto === true) {
      admin.profilePhotoUrl = "";
    } else if (profilePhotoUrl !== undefined) {
      const nextUrl = normalizeStoredPhotoUrl(profilePhotoUrl);
      if (profilePhotoUrl && !nextUrl) {
        return res.status(400).json({
          message: "Profile photo URL must be a file uploaded to your Scanly S3 bucket.",
        });
      }
      admin.profilePhotoUrl = nextUrl;
    }

    await admin.save();

    if (previousPhotoUrl && previousPhotoUrl !== admin.profilePhotoUrl) {
      try {
        await deleteS3ObjectByUrl(previousPhotoUrl);
      } catch (deleteErr) {
        console.warn("[Admin] Could not delete previous profile photo:", deleteErr?.message || deleteErr);
      }
    }

    return res.status(200).json({
      message: "Profile updated successfully",
      data: await formatAdminProfileResponse(admin),
    });
  } catch (error) {
    console.error("[Admin] updateAdminProfile:", error);
    return res.status(500).json({ message: "Failed to update admin profile", error: error.message });
  }
};

export const uploadAdminProfilePhoto = async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: "Photo file is required" });
    }

    const email = normalizeEmail(req.adminEmail);
    if (!email) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    const { fileUrl } = await uploadImageBuffer({
      folder: `admin-profiles/${adminEmailSlug(email)}`,
      fileName: req.file.originalname || "avatar.jpg",
      contentType: req.file.mimetype,
      buffer: req.file.buffer,
    });

    const displayUrl = await resolveProfilePhotoDisplayUrl(fileUrl);

    return res.status(200).json({
      message: "Photo uploaded successfully",
      fileUrl,
      profilePhotoUrl: displayUrl,
    });
  } catch (error) {
    const status = error.message?.includes("Only image") ? 400 : 500;
    console.error("[Admin] uploadAdminProfilePhoto:", error);
    return res.status(status).json({
      message: status === 400 ? error.message : "Failed to upload profile photo",
      error: error.message,
    });
  }
};

export const generateAdminProfileUploadUrl = async (req, res) => {
  try {
    const email = normalizeEmail(req.adminEmail);
    if (!email) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    const { fileName, contentType } = req.body || {};
    if (!fileName || !contentType) {
      return res.status(400).json({ message: "fileName and contentType are required" });
    }

    const upload = await createPresignedImageUpload({
      folder: `admin-profiles/${adminEmailSlug(email)}`,
      fileName,
      contentType,
    });

    return res.status(200).json({
      message: "Profile upload URL generated",
      ...upload,
    });
  } catch (error) {
    const status = error.message?.includes("Only image") ? 400 : 500;
    console.error("[Admin] generateAdminProfileUploadUrl:", error);
    return res.status(status).json({
      message: status === 400 ? error.message : "Failed to generate profile upload URL",
      error: error.message,
    });
  }
};
