import Tesseract from "tesseract.js";

const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";

const normalizeExtractedText = (rawText = "") => {
  const cleanedText = rawText.replace(/\s+/g, " ").replace(/[|]/g, " ").trim();

  const ingredientsCapture = cleanedText.match(
    /ingredients?\s*[:\-]\s*([\s\S]*?)(nutrition|nutritional|allergen|contains|storage|manufactured|net\s*qty|mrp|best before|$)/i,
  );

  if (ingredientsCapture?.[1]) {
    return ingredientsCapture[1].trim();
  }

  return cleanedText.replace(/\bINGREDIENTS?\b[:\-]?/gi, "").trim();
};

const extractWithGoogleVision = async (imageBuffer) => {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_VISION_API_KEY is missing");
  }

  console.log("[OCR] Calling Google Vision API...");

  const response = await fetch(`${VISION_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: imageBuffer.toString("base64"),
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: {
            languageHints: ["en"],
          },
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.error?.message || "Google Vision request failed";
    throw new Error(details);
  }

  const annotation = payload?.responses?.[0];
  const extractedText =
    annotation?.fullTextAnnotation?.text || annotation?.textAnnotations?.[0]?.description || "";

  if (!extractedText.trim()) {
    throw new Error("Google Vision returned empty text");
  }

  console.log(
    `[OCR] Google Vision success textLength=${extractedText.length} preview="${extractedText
      .slice(0, 160)
      .replace(/\s+/g, " ")}"`,
  );

  return {
    provider: "google-vision",
    rawText: extractedText,
    ingredientsText: normalizeExtractedText(extractedText),
  };
};

const extractWithTesseract = async (imageBuffer) => {
  console.log("[OCR] Using Tesseract OCR...");
  const {
    data: { text },
  } = await Tesseract.recognize(imageBuffer, "eng");

  if (!text?.trim()) {
    throw new Error("Tesseract returned empty text");
  }

  console.log(
    `[OCR] Tesseract success textLength=${text.length} preview="${text
      .slice(0, 160)
      .replace(/\s+/g, " ")}"`,
  );

  return {
    provider: "tesseract",
    rawText: text,
    ingredientsText: normalizeExtractedText(text),
  };
};

export const extractIngredientsFromImage = async (imageBuffer) => {
  const preferredProvider = (process.env.OCR_PROVIDER || "google-vision")
    .toLowerCase()
    .trim();

  console.log(`[OCR] Preferred provider=${preferredProvider}`);

  if (preferredProvider === "tesseract") {
    return extractWithTesseract(imageBuffer);
  }

  try {
    return await extractWithGoogleVision(imageBuffer);
  } catch (error) {
    console.warn(`[OCR] Google Vision failed: ${error.message}`);
    if (process.env.OCR_FALLBACK_TO_TESSERACT === "false") {
      throw error;
    }
    console.warn("[OCR] Falling back to Tesseract OCR");
    return extractWithTesseract(imageBuffer);
  }
};
