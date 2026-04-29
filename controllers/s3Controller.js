import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, getS3Config } from "../config/s3Client.js";

const sanitizeFileName = (fileName) => fileName.replace(/\s+/g, "-");

export const generateUploadUrl = async (req, res) => {
  try {
    const { fileName, contentType, folder = "uploads" } = req.body;

    if (!fileName || !contentType) {
      return res
        .status(400)
        .json({ message: "fileName and contentType are required" });
    }

    const { bucketName } = getS3Config();
    const s3Client = getS3Client();
    const timestamp = Date.now();
    const key = `${folder}/${timestamp}-${sanitizeFileName(fileName)}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    const fileUrl = `https://${bucketName}.s3.amazonaws.com/${key}`;

    return res.status(200).json({
      message: "Upload URL generated successfully",
      key,
      uploadUrl,
      fileUrl,
      expiresIn: 300,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to generate upload URL", error: error.message });
  }
};





