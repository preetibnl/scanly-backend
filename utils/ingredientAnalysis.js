const allergyKeywordMap = {
  milk: ["milk", "whey", "casein", "lactose", "milk solids", "milk powder"],
  dairy: ["milk", "whey", "casein", "lactose", "milk solids", "butterfat"],
  soy: ["soy", "soya", "soy lecithin", "soy protein", "textured soy protein"],
  soya: ["soy", "soya", "soy lecithin", "soy protein", "textured soy protein"],
  peanut: ["peanut", "peanuts", "groundnut", "groundnuts", "peanut butter"],
  peanuts: ["peanut", "peanuts", "groundnut", "groundnuts", "peanut butter"],
  nuts: [
    "peanut",
    "peanuts",
    "groundnut",
    "groundnuts",
    "peanut butter",
    "almond",
    "cashew",
    "walnut",
    "hazelnut",
    "pistachio",
    "macadamia",
    "pecan",
    "brazil nut",
    "tree nut",
    "tree nuts",
  ],
  "tree nuts": [
    "peanut",
    "peanuts",
    "groundnut",
    "groundnuts",
    "peanut butter",
    "almond",
    "cashew",
    "walnut",
    "hazelnut",
    "pistachio",
    "macadamia",
    "pecan",
    "brazil nut",
    "tree nut",
    "tree nuts",
  ],
  gluten: ["wheat", "barley", "rye", "malt", "gluten", "semolina"],
  egg: ["egg", "eggs", "albumin", "egg white", "egg yolk"],
  eggs: ["egg", "eggs", "albumin", "egg white", "egg yolk"],
};

const defaultAllergyProfile = [
  "milk",
  "nuts",
  "gluten",
  "soy",
  "eggs",
  "peanut",
  "tree nuts",
];

const normalizeSearchText = (value = "") =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsKeyword = (normalizedText = "", keyword = "") => {
  if (!keyword) {
    return false;
  }
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return false;
  }

  const keywordVariants = new Set([normalizedKeyword]);
  if (!normalizedKeyword.endsWith("s")) {
    keywordVariants.add(`${normalizedKeyword}s`);
  } else if (normalizedKeyword.length > 3) {
    keywordVariants.add(normalizedKeyword.slice(0, -1));
  }

  for (const variant of keywordVariants) {
    if (variant.includes(" ")) {
      if (normalizedText.includes(variant)) {
        return true;
      }
      continue;
    }
    const regex = new RegExp(`\\b${variant}\\b`, "i");
    if (regex.test(normalizedText)) {
      return true;
    }
  }

  return false;
};

const findKeywordMatches = (allergies = [], ingredientsText = "") => {
  const normalizedText = normalizeSearchText(ingredientsText);

  return allergies.flatMap((allergyRaw) => {
    const allergy = String(allergyRaw).trim();
    if (!allergy) {
      return [];
    }

    const normalizedAllergy = allergy.toLowerCase();
    const keywords = allergyKeywordMap[normalizedAllergy] || [normalizedAllergy];
    const matchedKeyword = keywords.find((keyword) =>
      containsKeyword(normalizedText, keyword),
    );

    if (!matchedKeyword) {
      return [];
    }

    return [
      {
        allergy,
        ingredient: matchedKeyword,
        riskLevel: "high",
      },
    ];
  });
};

const sanitizeAiOutput = (aiData, activeAllergies = [], ingredientsText = "") => {
  const fallbackMatches = findKeywordMatches(activeAllergies, ingredientsText);
  const fallbackStatus = fallbackMatches.length > 0 ? "unsafe" : "safe";
  const fallbackSummary =
    fallbackStatus === "unsafe"
      ? "Contains ingredients matching your allergies."
      : "No matching allergens found for your profile.";

  if (!aiData || typeof aiData !== "object") {
    return {
      status: fallbackStatus,
      summary: fallbackSummary,
      matchedAllergens: fallbackMatches,
      source: "rules",
    };
  }

  const rawStatus = String(aiData.status || "").toLowerCase().trim();
  const status = ["safe", "risk", "unsafe"].includes(rawStatus)
    ? rawStatus
    : fallbackStatus;
  const summary = String(aiData.summary || "").trim() || fallbackSummary;
  const matchedAllergens = Array.isArray(aiData.matchedAllergens)
    ? aiData.matchedAllergens
        .map((item) => ({
          allergy: String(item?.allergy || "").trim(),
          ingredient: String(item?.ingredient || "").trim(),
          riskLevel: String(item?.riskLevel || "medium").toLowerCase().trim(),
        }))
        .filter((item) => item.allergy && item.ingredient)
    : fallbackMatches;

  const normalizedOutput = {
    status,
    summary,
    matchedAllergens: matchedAllergens.length > 0 ? matchedAllergens : fallbackMatches,
    source: "openai",
  };

  console.log(
    `[AI] Parsed response status=${normalizedOutput.status} matches=${normalizedOutput.matchedAllergens.length}`,
  );

  return normalizedOutput;
};

const buildPrompt = ({ allergies, ingredientsText, profileType }) => `
You are a food-allergy ingredient risk analyzer.
Return ONLY valid JSON. Do not include markdown.

Input allergies: ${JSON.stringify(allergies)}
Allergy mode: ${
  profileType === "user"
    ? "Use these exact user allergies."
    : "No user allergies were selected. Assess against common major allergens."
}
Input ingredients text: ${JSON.stringify(ingredientsText)}

Rules:
1) Status must be one of: "safe", "risk", "unsafe".
2) Be conservative for uncertain terms like "natural flavors", "spices", "flavoring".
3) Include matched allergens with likely ingredient triggers.
4) Keep summary short and advisory (not medical diagnosis).
5) Output JSON shape exactly:
{
  "status": "safe|risk|unsafe",
  "summary": "string",
  "matchedAllergens": [
    { "allergy": "string", "ingredient": "string", "riskLevel": "low|medium|high" }
  ]
}
`.trim();

const getOpenAiKey = () => {
  const rawKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!rawKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }
  if (!rawKey.startsWith("sk-") || rawKey.length < 40) {
    throw new Error(
      "OPENAI_API_KEY appears invalid. Paste the full secret key from OpenAI dashboard.",
    );
  }
  return rawKey;
};

const analyzeWithOpenAI = async ({ allergies, ingredientsText, profileType }) => {
  const apiKey = getOpenAiKey();
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  console.log(
    `[AI] Request started model=${model} profileType=${profileType} allergies=${allergies.length}`,
  );
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You produce strict JSON for food allergy ingredient safety analysis.",
        },
        {
          role: "user",
          content: buildPrompt({ allergies, ingredientsText, profileType }),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.error?.message || "OpenAI request failed";
    throw new Error(details);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  console.log(`[AI] Raw response: ${content.slice(0, 700)}`);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }

  return sanitizeAiOutput(parsed, allergies, ingredientsText);
};

export const analyzeIngredientsRisk = async ({ allergies, ingredientsText }) => {
  const aiEnabled = (process.env.AI_PROVIDER || "openai").toLowerCase().trim();
  const cleanedAllergies = Array.isArray(allergies)
    ? allergies.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const profileType = cleanedAllergies.length > 0 ? "user" : "default";
  const activeAllergies =
    profileType === "user" ? cleanedAllergies : defaultAllergyProfile;

  console.log(
    `[AI] Analyze scan profileType=${profileType} activeAllergies=${activeAllergies.join(", ")}`,
  );

  if (aiEnabled !== "openai") {
    const matches = findKeywordMatches(activeAllergies, ingredientsText);
    const status = matches.length > 0 ? "unsafe" : "safe";
    return {
      status,
      summary:
        status === "unsafe"
          ? "Potential allergen ingredients detected. Please review before consuming."
          : "No major allergen indicators were detected in this ingredient list.",
      matchedAllergens: matches,
      source: "rules",
      usedAllergies: activeAllergies,
    };
  }

  try {
    const aiResult = await analyzeWithOpenAI({
      allergies: activeAllergies,
      ingredientsText,
      profileType,
    });
    return {
      ...aiResult,
      usedAllergies: activeAllergies,
    };
  } catch (error) {
    console.warn(`[AI] OpenAI failed, using fallback rules: ${error.message}`);
    const matches = findKeywordMatches(activeAllergies, ingredientsText);
    const status = matches.length > 0 ? "unsafe" : "safe";
    return {
      status,
      summary:
        status === "unsafe"
          ? "Potential allergen ingredients detected. Please review before consuming."
          : "No major allergen indicators were detected in this ingredient list.",
      matchedAllergens: matches,
      source: "rules",
      fallbackReason: error.message,
      usedAllergies: activeAllergies,
    };
  }
};
