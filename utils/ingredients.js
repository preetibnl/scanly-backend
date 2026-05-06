const normalizeWhitespace = (value = "") =>
  String(value).replace(/\s+/g, " ").trim();

const stripBulletPrefix = (value = "") =>
  String(value).replace(/^[\-\*\u2022]\s+/, "").trim();

const cleanItem = (value = "") => {
  const trimmed = stripBulletPrefix(normalizeWhitespace(value));
  if (!trimmed) {
    return "";
  }
  if (trimmed.length > 80) {
    return trimmed.slice(0, 80).trim();
  }
  return trimmed;
};

export const extractIngredientItems = (ingredientsText = "") => {
  const text = normalizeWhitespace(ingredientsText);
  if (!text) {
    return [];
  }

  const rawParts = text
    .split(/[,;•\n]/g)
    .map((part) => cleanItem(part))
    .filter(Boolean);

  const seen = new Set();
  const items = [];
  for (const part of rawParts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(part);
    if (items.length >= 60) {
      break;
    }
  }

  return items;
};
