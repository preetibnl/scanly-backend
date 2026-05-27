import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import os from "os";
import connectDB from "./databaseConnection/database.js";
import { logStripeStartupProbe } from "./controllers/stripeController.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { ensureAdminAccount } from "./controllers/adminController.js";
import s3Routes from "./routes/s3Routes.js";
import scanRoutes from "./routes/scanRoutes.js";
import stripeRoutes from "./routes/stripeRoutes.js";
import stripeWebhookRoutes from "./routes/stripeWebhookRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import { initSocket } from "./socket.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app);

// So Stripe returnBaseUrl can match X-Forwarded-Host behind nginx/Caddy on production.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "X-Return-Base-Url",
      "X-API-Base-Url",
    ],
  })
);

// Stripe webhooks require the raw body for signature verification (must be before express.json).
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookRoutes
);

app.use(express.json());
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);
app.use("/api/s3", s3Routes);
app.use("/api/scans", scanRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/plans", planRoutes);

const startServer = async () => {
  try {
    await connectDB();
    await ensureAdminAccount();
    await logStripeStartupProbe();
    initSocket(server);
    server.listen(port, "0.0.0.0", () => {
      console.log(`Server is running on http://0.0.0.0:${port}`);
      const lanIps = Object.values(os.networkInterfaces())
        .flat()
        .filter((entry) => entry?.family === "IPv4" && !entry.internal)
        .map((entry) => entry.address);
      if (lanIps.length > 0) {
        console.log(
          `Phone API base (same Wi‑Fi): ${lanIps.map((ip) => `http://${ip}:${port}`).join(", ")}`,
        );
      }
    });
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

startServer();
