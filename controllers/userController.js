import User from "../models/userModel.js";
import Scan from "../models/scanModel.js";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { sendResetOtpEmail } from "../utils/mail.js";
import { getIo } from "../socket.js";

const PASSWORD_SALT_ROUNDS = Number(process.env.PASSWORD_SALT_ROUNDS || 10);

export const signupUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    const user = await User.create({ name, email, password: passwordHash });
    const io = getIo();
    if (io) {
      io.emit("user:registered", {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan || "free",
        createdAt: user.createdAt,
      });
      io.emit("dashboard:updated");
    }

    return res.status(201).json({
      message: "Signup successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Signup failed", error: error.message });
  }
};

export const getUsers = async (_req, res) => {
  try {
    const users = await User.find()
      .sort({ createdAt: -1 })
      .select("name email plan createdAt")
      .lean();
    const scanCounts = await Scan.aggregate([
      {
        $group: {
          _id: "$userId",
          count: { $sum: 1 },
        },
      },
    ]);
    const scanCountMap = new Map(
      scanCounts.map((item) => [String(item._id), Number(item.count || 0)])
    );

    return res.status(200).json({
      data: users.map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan || "free",
        createdAt: user.createdAt,
        scanCount: scanCountMap.get(String(user._id)) || 0,
      })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to fetch users", error: error.message });
  }
};

export const getAdminUserDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(id)
      .select(
        "name email plan allergies stripeCustomerId stripeSubscriptionId subscriptionStatus subscriptionCurrentPeriodEnd subscriptionCancelAtPeriodEnd createdAt updatedAt"
      )
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const [scanStats, recentScans] = await Promise.all([
      Scan.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(id) } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      Scan.find({ userId: id })
        .sort({ createdAt: -1 })
        .limit(8)
        .select("status summary createdAt")
        .lean(),
    ]);

    const statsMap = {
      safe: 0,
      risk: 0,
      unsafe: 0,
    };
    scanStats.forEach((item) => {
      const key = String(item._id || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(statsMap, key)) {
        statsMap[key] = Number(item.count || 0);
      }
    });

    return res.status(200).json({
      data: {
        user: {
          ...user,
          plan: user.plan || "free",
        },
        scans: {
          total: statsMap.safe + statsMap.risk + statsMap.unsafe,
          safe: statsMap.safe,
          risk: statsMap.risk,
          unsafe: statsMap.unsafe,
          recent: recentScans,
        },
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to fetch user details", error: error.message });
  }
};

export const getAdminOverview = async (_req, res) => {
  try {
    const [totalUsers, premiumActive, totalScans, riskAlerts, recentScans, subscriptions] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({
          $or: [
            { plan: { $regex: /^premium$/i } },
            { subscriptionStatus: { $regex: /^active$/i } },
          ],
        }),
        Scan.countDocuments(),
        Scan.countDocuments({ status: { $in: ["risk", "unsafe"] } }),
        Scan.find()
          .sort({ createdAt: -1 })
          .limit(8)
          .populate("userId", "name email")
          .lean(),
        User.find({
          $or: [
            { subscriptionStatus: { $in: ["active", "past_due", "past due", "canceled", "cancelled"] } },
            { plan: { $regex: /^premium$/i } },
          ],
        })
          .sort({ updatedAt: -1 })
          .limit(12)
          .select("name email plan subscriptionStatus subscriptionCurrentPeriodEnd")
          .lean(),
      ]);

    const subscriptionSummary = {
      active: subscriptions.filter(
        (u) =>
          String(u.subscriptionStatus || "").toLowerCase() === "active" ||
          String(u.plan || "").toLowerCase() === "premium"
      ).length,
      pastDue: subscriptions.filter((u) =>
        ["past_due", "past due"].includes(String(u.subscriptionStatus || "").toLowerCase())
      ).length,
      canceled: subscriptions.filter((u) =>
        ["canceled", "cancelled"].includes(String(u.subscriptionStatus || "").toLowerCase())
      ).length,
    };

    return res.status(200).json({
      data: {
        cards: {
          totalUsers,
          premiumActive,
          totalScans,
          riskAlerts,
        },
        subscriptionSummary,
        recentScans: recentScans.map((scan) => ({
          id: scan._id,
          user: scan.userId?.name || "Unknown",
          email: scan.userId?.email || "",
          result: scan.status,
          summary: scan.summary,
          date: scan.createdAt,
        })),
        subscriptionItems: subscriptions.map((u) => ({
          id: u._id,
          user: u.name,
          plan: String(u.plan || "Free").replace(/^./, (ch) => ch.toUpperCase()),
          status:
            String(u.subscriptionStatus || "").toLowerCase() === "active"
              ? "Active"
              : String(u.subscriptionStatus || "").toLowerCase() === "past_due" ||
                  String(u.subscriptionStatus || "").toLowerCase() === "past due"
                ? "Past Due"
                : String(u.subscriptionStatus || "").toLowerCase() === "canceled" ||
                    String(u.subscriptionStatus || "").toLowerCase() === "cancelled"
                  ? "Canceled"
                  : String(u.plan || "").toLowerCase() === "premium"
                    ? "Active"
                    : "Inactive",
          renewsOn: u.subscriptionCurrentPeriodEnd || null,
        })),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to fetch dashboard overview", error: error.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let isPasswordValid = false;

    if (String(user.password || "").startsWith("$2")) {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } else {
      // Backward compatibility for legacy plaintext users.
      isPasswordValid = user.password === password;
      if (isPasswordValid) {
        user.password = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
        await user.save();
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    // Do not reveal if a user exists for this email.
    if (!user) {
      return res.status(200).json({
        message: "If this email is registered, an OTP has been sent.",
      });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.resetOtpHash = otpHash;
    user.resetOtpExpiresAt = expiresAt;
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;
    await user.save();

    await sendResetOtpEmail({
      to: user.email,
      otp,
    });

    return res.status(200).json({
      message: "If this email is registered, an OTP has been sent.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to send password reset OTP", error: error.message });
  }
};

export const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex");
    const user = await User.findOne({
      email,
      resetOtpHash: otpHash,
      resetOtpExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const resetSessionExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    user.resetPasswordTokenHash = tokenHash;
    user.resetPasswordExpiresAt = resetSessionExpiresAt;
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    await user.save();

    return res.status(200).json({
      message: "OTP verified",
      data: {
        email: user.email,
        token: resetToken,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to verify OTP", error: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email, token and new password are required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      email,
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset link" });
    }

    user.password = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Password reset failed", error: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "User id is required" });
    }

    const deletedUser = await User.findByIdAndDelete(id);
    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "User deletion failed", error: error.message });
  }
};

export const updateUserAllergies = async (req, res) => {
  try {
    const { id } = req.params;
    const { allergies } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (!Array.isArray(allergies)) {
      return res.status(400).json({ message: "allergies must be an array" });
    }

    const normalizedAllergies = allergies
      .map((item) => String(item).trim())
      .filter(Boolean);

    const user = await User.findByIdAndUpdate(
      id,
      { allergies: normalizedAllergies },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Allergies updated successfully",
      data: {
        userId: user._id,
        allergies: user.allergies,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to update allergies", error: error.message });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      data: user,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to fetch profile", error: error.message });
  }
};
