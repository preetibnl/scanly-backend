import mongoose from "mongoose";

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing. Set it in backend/.env");
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log("database connected successfully");
  } catch (error) {
    console.log("database connection failed");
    throw error;
  }
};

export default connectDB;
