import express from "express";
import { generateUploadUrl } from "../controllers/s3Controller.js";

const router = express.Router();

router.post("/upload-url", generateUploadUrl);

export default router;
