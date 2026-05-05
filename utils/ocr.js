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
    console.error("[OCR] step=google_vision config_error reason=GOOGLE_VISION_API_KEY_missing");
    throw new Error("GOOGLE_VISION_API_KEY is missing");
  }

  const gvStart = Date.now();
  console.log(
    `[OCR] step=google_vision_request bufferBytes=${imageBuffer?.length ?? 0} endpoint=images:annotate`,
  );

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
    console.error(
      `[OCR] step=google_vision_response httpStatus=${response.status} durationMs=${Date.now() - gvStart} error=${details}`,
    );
    throw new Error(details);
  }

  const annotation = payload?.responses?.[0];
  const extractedText =
    annotation?.fullTextAnnotation?.text || annotation?.textAnnotations?.[0]?.description || "";

  if (!extractedText.trim()) {
    console.warn(
      `[OCR] step=google_vision_empty_text httpStatus=${response.status} durationMs=${Date.now() - gvStart} hasErrorInResponse=${Boolean(annotation?.error)}`,
    );
    throw new Error("Google Vision returned empty text");
  }

  const normalized = normalizeExtractedText(extractedText);
  console.log(
    `[OCR] step=google_vision_ok httpStatus=${response.status} rawChars=${extractedText.length} ingredientsChars=${normalized.length} requestMs=${Date.now() - gvStart} preview="${extractedText
      .slice(0, 160)
      .replace(/\s+/g, " ")}"`,
  );

  return {
    provider: "google-vision",
    rawText: extractedText,
    ingredientsText: normalized,
  };
};

const extractWithTesseract = async (imageBuffer) => {
  const tsStart = Date.now();
  console.log(
    `[OCR] step=tesseract_start bufferBytes=${imageBuffer?.length ?? 0} lang=eng`,
  );
  const {
    data: { text },
  } = await Tesseract.recognize(imageBuffer, "eng");

  if (!text?.trim()) {
    console.warn(`[OCR] step=tesseract_empty durationMs=${Date.now() - tsStart}`);
    throw new Error("Tesseract returned empty text");
  }

  const normalized = normalizeExtractedText(text);
  console.log(
    `[OCR] step=tesseract_ok rawChars=${text.length} ingredientsChars=${normalized.length} durationMs=${Date.now() - tsStart} preview="${text
      .slice(0, 160)
      .replace(/\s+/g, " ")}"`,
  );

  return {
    provider: "tesseract",
    rawText: text,
    ingredientsText: normalized,
  };
};

export const extractIngredientsFromImage = async (imageBuffer) => {
  const pipelineStart = Date.now();
  const preferredProvider = (process.env.OCR_PROVIDER || "google-vision")
    .toLowerCase()
    .trim();
  const allowTesseractFallback = process.env.OCR_FALLBACK_TO_TESSERACT !== "false";

  console.log(
    `[OCR] pipeline:start preferredProvider=${preferredProvider} bufferBytes=${imageBuffer?.length ?? 0} tesseractFallback=${allowTesseractFallback}`,
  );

  if (preferredProvider === "tesseract") {
    const result = await extractWithTesseract(imageBuffer);
    console.log(
      `[OCR] pipeline:end provider=${result.provider} totalDurationMs=${Date.now() - pipelineStart}`,
    );
    return result;
  }

  try {
    const result = await extractWithGoogleVision(imageBuffer);
    console.log(
      `[OCR] pipeline:end provider=${result.provider} totalDurationMs=${Date.now() - pipelineStart}`,
    );
    return result;
  } catch (error) {
    console.warn(
      `[OCR] pipeline:primary_failed provider=google-vision message=${error.message} elapsedMs=${Date.now() - pipelineStart}`,
    );
    if (!allowTesseractFallback) {
      console.error("[OCR] pipeline:abort no_tesseract_fallback (OCR_FALLBACK_TO_TESSERACT=false)");
      throw error;
    }
    console.warn("[OCR] pipeline:fallback_start → tesseract");
    const result = await extractWithTesseract(imageBuffer);
    console.log(
      `[OCR] pipeline:end provider=${result.provider} afterFallback=true totalDurationMs=${Date.now() - pipelineStart}`,
    );
    return result;
  }
};
