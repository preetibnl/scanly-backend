import express from "express";
import { getPublicPlanConfig } from "../controllers/subscriptionPlanConfigController.js";

const router = express.Router();

router.get("/config", getPublicPlanConfig);

export default router;
