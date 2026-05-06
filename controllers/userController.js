import User from "../models/userModel.js";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { sendResetOtpEmail } from "../utils/mail.js";

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
