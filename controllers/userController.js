import User from "../models/userModel.js";
import mongoose from "mongoose";

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

    const user = await User.create({ name, email, password });

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

    if (user.password !== password) {
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
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email and new password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.password = newPassword;
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
