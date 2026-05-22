import { createPresignedImageUpload } from "../utils/s3Helpers.js";

export const generateUploadUrl = async (req, res) => {
  try {
    const { fileName, contentType, folder = "uploads" } = req.body;

    if (!fileName || !contentType) {
      return res
        .status(400)
        .json({ message: "fileName and contentType are required" });
    }

    const upload = await createPresignedImageUpload({
      folder: String(folder || "uploads").replace(/^\/+|\/+$/g, ""),
      fileName,
      contentType,
    });

    return res.status(200).json({
      message: "Upload URL generated successfully",
      ...upload,
    });
  } catch (error) {
    const status = error.message?.includes("Only image") ? 400 : 500;
    return res.status(status).json({
      message: status === 400 ? error.message : "Failed to generate upload URL",
      error: error.message,
    });
  }
};





