import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    allergies: {
      type: [String],
      default: [],
    },
    plan: {
      type: String,
      default: "free",
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
