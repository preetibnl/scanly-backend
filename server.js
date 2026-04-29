import express from "express";
import dotenv from "dotenv";
import connectDB from "./databaseConnection/database.js";
import userRoutes from "./routes/userRoutes.js";
import s3Routes from "./routes/s3Routes.js";
import scanRoutes from "./routes/scanRoutes.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use("/api/users", userRoutes);
app.use("/api/s3", s3Routes);
app.use("/api/scans", scanRoutes);

const startServer = async () => {
  try {
    await connectDB();
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

startServer();
