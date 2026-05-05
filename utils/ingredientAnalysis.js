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
    `[AI] step=sanitize_output status=${normalizedOutput.status} matches=${normalizedOutput.matchedAllergens.length} source=${normalizedOutput.source}`,
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

const maskOpenAiKey = (key) => {
  const s = String(key);
  if (s.length <= 8) {
    return "(too_short)";
  }
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
};

const getOpenAiKey = () => {
  const rawKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!rawKey) {
    console.error("[AI] step=key_check status=fail reason=OPENAI_API_KEY_missing");
    throw new Error("OPENAI_API_KEY is missing");
  }
  if (!rawKey.startsWith("sk-") || rawKey.length < 40) {
    console.error(
      `[AI] step=key_check status=fail reason=invalid_format keyPrefix=${rawKey.slice(0, 7)} length=${rawKey.length} (expect sk-… length>=40)`,
    );
    throw new Error(
      "OPENAI_API_KEY appears invalid. Paste the full secret key from OpenAI dashboard.",
    );
  }
  console.log(`[AI] step=key_check status=ok keyRef=${maskOpenAiKey(rawKey)}`);
  return rawKey;
};

const analyzeWithOpenAI = async ({ allergies, ingredientsText, profileType }) => {
  const apiKey = getOpenAiKey();
  const model = "gpt-4o-mini";
  const reqStart = Date.now();
  const ingredientsChars = String(ingredientsText).length;
  console.log(
    `[AI] step=openai_request model=${model} profileType=${profileType} allergyCount=${allergies.length} ingredientsChars=${ingredientsChars} promptIngredientPreview="${String(ingredientsText)
      .slice(0, 120)
      .replace(/\s+/g, " ")}"`,
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
    const errType = payload?.error?.type ?? "n/a";
    const errCode = payload?.error?.code ?? "n/a";
    console.error(
      `[AI] step=openai_response httpStatus=${response.status} durationMs=${Date.now() - reqStart} errorType=${errType} errorCode=${errCode} message=${details}`,
    );
    throw new Error(details);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    console.error(
      `[AI] step=openai_parse durationMs=${Date.now() - reqStart} reason=empty_choices_content id=${payload?.id ?? "n/a"}`,
    );
    throw new Error("OpenAI returned empty response");
  }

  console.log(
    `[AI] step=openai_response httpStatus=${response.status} durationMs=${Date.now() - reqStart} contentChars=${content.length} preview="${content.slice(0, 500).replace(/\s+/g, " ")}"`,
  );

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    console.error(
      `[AI] step=openai_json_parse fail durationMs=${Date.now() - reqStart} err=${parseErr.message}`,
    );
    throw new Error("OpenAI returned invalid JSON");
  }

  const sanitized = sanitizeAiOutput(parsed, allergies, ingredientsText);
  console.log(
    `[AI] step=openai_done totalMs=${Date.now() - reqStart} resultStatus=${sanitized.status} resultSource=${sanitized.source} matches=${sanitized.matchedAllergens?.length ?? 0}`,
  );
  return sanitized;
};

export const analyzeIngredientsRisk = async ({ allergies, ingredientsText }) => {
  const analyzeStart = Date.now();
  const cleanedAllergies = Array.isArray(allergies)
    ? allergies.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const profileType = cleanedAllergies.length > 0 ? "user" : "default";
  const activeAllergies =
    profileType === "user" ? cleanedAllergies : defaultAllergyProfile;
  const ingredientsChars = String(ingredientsText).length;

  console.log(
    `[AI] pipeline:start profileType=${profileType} storedAllergyCount=${cleanedAllergies.length} activeAllergyCount=${activeAllergies.length} ingredientsChars=${ingredientsChars} activeAllergies=${activeAllergies.join(", ")}`,
  );

  try {
    const aiResult = await analyzeWithOpenAI({
      allergies: activeAllergies,
      ingredientsText,
      profileType,
    });
    console.log(
      `[AI] pipeline:end source=${aiResult.source} status=${aiResult.status} matches=${aiResult.matchedAllergens?.length ?? 0} totalDurationMs=${Date.now() - analyzeStart}`,
    );
    return {
      ...aiResult,
      usedAllergies: activeAllergies,
    };
  } catch (error) {
    console.warn(
      `[AI] pipeline:fallback source=rules reason="${error.message}" failedAfterMs=${Date.now() - analyzeStart}`,
    );
    const matches = findKeywordMatches(activeAllergies, ingredientsText);
    const status = matches.length > 0 ? "unsafe" : "safe";
    console.log(
      `[AI] pipeline:end source=rules(fallback) status=${status} ruleMatches=${matches.length} totalDurationMs=${Date.now() - analyzeStart}`,
    );
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
