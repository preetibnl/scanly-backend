const defaultAllergyProfile = [
  "milk",
  "eggs",
  "peanuts",
  "tree nuts",
  "gluten",
  "soy",
  "fish",
  "shellfish",
  "sesame",
];

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
    console.error("[ASSISTANT] step=key_check status=fail reason=OPENAI_API_KEY_missing");
    throw new Error("OPENAI_API_KEY is missing");
  }
  if (!rawKey.startsWith("sk-") || rawKey.length < 40) {
    console.error(
      `[ASSISTANT] step=key_check status=fail reason=invalid_format keyPrefix=${rawKey.slice(0, 7)} length=${rawKey.length}`,
    );
    throw new Error("OPENAI_API_KEY appears invalid.");
  }
  console.log(
    `[ASSISTANT] step=key_check status=ok keyRef=${maskOpenAiKey(rawKey)}`,
  );
  return rawKey;
};

export const askIngredientAssistant = async ({
  question,
  allergies = defaultAllergyProfile,
  history = [],
}) => {
  const apiKey = getOpenAiKey();
  const model = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const startedAt = Date.now();

  const normalizedQuestion = String(question || "").trim();
  if (!normalizedQuestion) {
    throw new Error("Question is required");
  }

  console.log(
    `[ASSISTANT] step=request model=${model} chars=${normalizedQuestion.length} allergies=${allergies.join(", ")} questionPreview="${normalizedQuestion
      .slice(0, 160)
      .replace(/\s+/g, " ")}"`,
  );

  const systemPrompt =
    "You are an informational allergy ingredient assistant for a food scanner app. " +
    "Provide concise, educational answers about ingredients, allergen labeling, and cross-contact. " +
    "Never provide medical diagnosis, treatment advice, or definitive safety verdicts. " +
    "Do not tell users a product is definitely safe or unsafe. " +
    "Use cautious language such as 'may be relevant', 'check the package label', and 'consult a qualified healthcare professional'. " +
    "When referencing allergen facts, base guidance on public resources such as the WHO, CDC, NIH, MedlinePlus, FDA, FALCPA labeling rules, NHS, or Mayo Clinic.";

  const userPrompt = [
    `User allergy context: ${JSON.stringify(allergies)}`,
    "Conversation context (oldest to latest):",
    ...history.map((item) => `${item.role}: ${item.content}`),
    `Latest user question: ${normalizedQuestion}`,
    "Respond in 2-6 short sentences with clear practical guidance.",
    "End with one sentence reminding the user this is informational only and to consult a healthcare professional for medical decisions.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.error?.message || "OpenAI request failed";
    console.error(
      `[ASSISTANT] step=response status=${response.status} durationMs=${Date.now() - startedAt} error="${details}"`,
    );
    throw new Error(details);
  }

  const answer = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!answer) {
    console.error(
      `[ASSISTANT] step=parse status=fail durationMs=${Date.now() - startedAt} reason=empty_answer`,
    );
    throw new Error("Assistant returned empty response");
  }

  console.log(
    `[ASSISTANT] step=response status=200 durationMs=${Date.now() - startedAt} answerChars=${answer.length} preview="${answer
      .slice(0, 200)
      .replace(/\s+/g, " ")}"`,
  );

  return {
    answer,
    source: "openai",
  };
};
