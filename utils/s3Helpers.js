import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, getS3Config } from "../config/s3Client.js";

const PROFILE_PHOTO_READ_EXPIRES_SEC = Number(
  process.env.AWS_S3_PROFILE_READ_EXPIRES_SEC || 86400,
);

export const sanitizeFileName = (fileName) =>
  String(fileName || "file")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "file";

export const buildS3ObjectUrl = (key) => {
  const { bucketName, region } = getS3Config();
  const encodedKey = String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://${bucketName}.s3.${region}.amazonaws.com/${encodedKey}`;
};

export const extractS3KeyFromUrl = (fileUrl) => {
  if (!fileUrl) return null;
  const { bucketName, region } = getS3Config();
  try {
    const url = new URL(String(fileUrl).trim());
    const regionalHost = `${bucketName}.s3.${region}.amazonaws.com`;
    const legacyHost = `${bucketName}.s3.amazonaws.com`;
    if (url.hostname !== regionalHost && url.hostname !== legacyHost) {
      return null;
    }
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
};

export const isAllowedProfilePhotoUrl = (fileUrl) => Boolean(extractS3KeyFromUrl(fileUrl));

/** Persist canonical object URL (no presigned query string). */
export const normalizeStoredPhotoUrl = (fileUrl) => {
  const key = extractS3KeyFromUrl(fileUrl);
  if (!key) return "";
  return buildS3ObjectUrl(key);
};

export const uploadImageBuffer = async ({
  folder,
  fileName,
  contentType,
  buffer,
}) => {
  const normalizedType = assertImageContentType(contentType);
  const { bucketName } = getS3Config();
  const s3Client = getS3Client();
  const timestamp = Date.now();
  const key = `${folder}/${timestamp}-${sanitizeFileName(fileName)}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: normalizedType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const fileUrl = buildS3ObjectUrl(key);
  return { key, fileUrl, contentType: normalizedType };
};

export const getPresignedReadUrl = async (storedUrl, expiresIn = PROFILE_PHOTO_READ_EXPIRES_SEC) => {
  const key = extractS3KeyFromUrl(storedUrl);
  if (!key) return String(storedUrl || "").trim();

  const { bucketName } = getS3Config();
  const s3Client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
};

export const resolveProfilePhotoDisplayUrl = async (storedUrl) => {
  const canonical = normalizeStoredPhotoUrl(storedUrl);
  if (!canonical) return "";
  try {
    return await getPresignedReadUrl(canonical);
  } catch (error) {
    console.warn("[S3] Could not sign profile photo URL:", error?.message || error);
    return canonical;
  }
};

const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const assertImageContentType = (contentType) => {
  const normalized = String(contentType || "").trim().toLowerCase();
  if (!IMAGE_CONTENT_TYPES.has(normalized)) {
    throw new Error("Only image uploads are allowed (JPEG, PNG, WebP, or GIF).");
  }
  return normalized;
};

export const createPresignedImageUpload = async ({
  folder,
  fileName,
  contentType,
  expiresIn = 300,
}) => {
  const normalizedType = assertImageContentType(contentType);
  const { bucketName } = getS3Config();
  const s3Client = getS3Client();
  const timestamp = Date.now();
  const key = `${folder}/${timestamp}-${sanitizeFileName(fileName)}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: normalizedType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });
  const fileUrl = buildS3ObjectUrl(key);

  return { key, uploadUrl, fileUrl, expiresIn, contentType: normalizedType };
};

export const deleteS3ObjectByUrl = async (fileUrl) => {
  const key = extractS3KeyFromUrl(fileUrl);
  if (!key) return false;
  const { bucketName } = getS3Config();
  const s3Client = getS3Client();
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );
  return true;
};
