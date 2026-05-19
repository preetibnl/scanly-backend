import express from "express";
import { generateUploadUrl } from "../controllers/s3Controller.js";
import { authenticateUser } from "../middleware/auth.js";

const router = express.Router();

router.post("/upload-url", authenticateUser, generateUploadUrl);

export default router;
