import bcrypt from "bcryptjs";
import Admin from "../models/adminModel.js";
import { signAdminToken } from "../utils/jwt.js";

const PASSWORD_SALT_ROUNDS = Number(process.env.PASSWORD_SALT_ROUNDS || 10);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

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
      data: { email: admin.email },
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
