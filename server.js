import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./databaseConnection/database.js";
import { logStripeStartupProbe } from "./controllers/stripeController.js";
import userRoutes from "./routes/userRoutes.js";
import s3Routes from "./routes/s3Routes.js";
import scanRoutes from "./routes/scanRoutes.js";
import stripeRoutes from "./routes/stripeRoutes.js";
import stripeWebhookRoutes from "./routes/stripeWebhookRoutes.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Accept", "X-Return-Base-Url", "X-API-Base-Url"],
  })
);

// Stripe webhooks require the raw body for signature verification (must be before express.json).
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookRoutes
);

app.use(express.json());
app.use("/api/users", userRoutes);
app.use("/api/s3", s3Routes);
app.use("/api/scans", scanRoutes);
app.use("/api/stripe", stripeRoutes);

const startServer = async () => {
  try {
    await connectDB();
    await logStripeStartupProbe();
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

startServer();
