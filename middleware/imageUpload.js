import multer from "multer";

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const createImageUpload = (fieldName = "photo") =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIME_TYPES.has(String(file.mimetype || "").toLowerCase())) {
        cb(null, true);
        return;
      }
      cb(new Error("Only image files are allowed (JPEG, PNG, WebP, or GIF)."));
    },
  }).single(fieldName);

export const handleImageUpload =
  (uploadMiddleware) => (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          message: err.message || "Invalid image upload",
        });
      }
      return next();
    });
  };
