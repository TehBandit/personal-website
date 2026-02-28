/**
 * guardrails.js
 * Shared input validation and security guardrails for all GenAI API endpoints.
 * Covers: prompt injection detection, profanity filtering, input sanitization, and length limits.
 */

// ---------------------------------------------------------------------------
// Prompt injection patterns
// ---------------------------------------------------------------------------
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|constraints?)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|constraints?|context)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|constraints?)/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(if\s+you\s+are\s+|a\s+|an\s+)?(?!a\s+chef|an?\s+(expert|assistant|recipe))/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /roleplay\s+as\s+/i,
  /\[system\]/i,
  /^system\s*:/im,
  /^assistant\s*:/im,
  /\bDAN\b/,               // "Do Anything Now" jailbreak
  /jailbreak/i,
  /override\s+(your\s+)?(previous\s+)?(instructions?|system\s+prompt)/i,
  /new\s+instructions?\s*:/i,
  /<<SYS>>/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,      // ChatML injection
  /prompt\s+injection/i,
];

// ---------------------------------------------------------------------------
// Profanity list (common English profanities — kept concise)
// ---------------------------------------------------------------------------
const PROFANITY_LIST = [
  "fuck", "shit", "cunt", "nigger", "nigga", "faggot", "fag",
  "bitch", "bastard", "asshole", "arsehole", "cock", "dick",
  "pussy", "whore", "slut", "piss", "crap", "twat",
  "motherfucker", "motherfucking", "bullshit",
];

// Build a regex that matches whole-word profanities (handles common letter substitutions minimally)
const PROFANITY_REGEX = new RegExp(
  `\\b(${PROFANITY_LIST.join("|")})\\b`,
  "i"
);

// ---------------------------------------------------------------------------
// Control-character / null-byte cleaner
// ---------------------------------------------------------------------------
function stripControlChars(str) {
  // Remove null bytes and non-printable ASCII control characters (except tab/newline/CR)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a free-text string: trim, strip control chars, enforce max length.
 * Returns the cleaned string (does NOT throw — callers use validateUserInput for full checks).
 */
export function sanitizeText(str, maxLength = 300) {
  if (typeof str !== "string") return "";
  const cleaned = stripControlChars(str.trim());
  return cleaned.slice(0, maxLength);
}

/**
 * Returns true if the string contains a detected prompt-injection pattern.
 */
export function hasPromptInjection(str) {
  if (!str) return false;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(str));
}

/**
 * Returns true if the string contains profanity.
 */
export function hasProfanity(str) {
  if (!str) return false;
  return PROFANITY_REGEX.test(str);
}

// Generic message returned for ALL guardrail failures.
// Deliberately vague — does not reveal which field failed, which check
// triggered, or that a profanity/injection filter exists at all.
const GENERIC_INPUT_ERROR = "One or more inputs could not be processed. Please review your entries and try again.";

/**
 * Full validation of a single user-supplied free-text field.
 * @param {string} value        - Raw input value
 * @param {string} fieldName    - Human-readable field name (used in server logs only, never sent to client)
 * @param {number} maxLength    - Maximum allowed character count (post-trim)
 * @returns {{ ok: boolean, error?: string, value?: string }}
 */
export function validateTextField(value, fieldName, maxLength = 300) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "" };
  }

  if (typeof value !== "string") {
    // Server log is specific; client message is generic
    console.warn(`[guardrails] ${fieldName}: expected string, got ${typeof value}`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  const cleaned = stripControlChars(value.trim());

  if (cleaned.length > maxLength) {
    console.warn(`[guardrails] ${fieldName}: exceeded max length (${cleaned.length} > ${maxLength})`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  if (hasPromptInjection(cleaned)) {
    console.warn(`[guardrails] ${fieldName}: prompt injection pattern detected`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  if (hasProfanity(cleaned)) {
    console.warn(`[guardrails] ${fieldName}: profanity detected`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  return { ok: true, value: cleaned };
}

/**
 * Validate a meal object { title, description } coming from the client.
 * (Used in battle-grocery and recipe-reroll where AI-generated meal data is
 *  echoed back and re-inserted into a prompt — still needs to be validated.)
 */
export function validateMeal(meal, label = "meal") {
  if (!meal || typeof meal !== "object") {
    console.warn(`[guardrails] ${label}: expected object`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  const titleResult = validateTextField(meal.title, `${label}.title`, 120);
  if (!titleResult.ok) return titleResult;

  const descResult = validateTextField(meal.description, `${label}.description`, 600);
  if (!descResult.ok) return descResult;

  return { ok: true };
}

/**
 * Validate a pre-assembled preferences string (passed around between endpoints).
 */
export function validatePreferencesString(value) {
  return validateTextField(value, "preferences", 1500);
}

/**
 * Validate an array of strings (used for dietaryRestrictions, flavor arrays, etc.)
 * Each element is checked individually.
 * @param {string[]} arr
 * @param {string}   fieldName
 * @param {number}   maxItemLength
 * @param {number}   maxItems
 */
export function validateStringArray(arr, fieldName, maxItemLength = 60, maxItems = 20) {
  if (!arr) return { ok: true, value: [] };

  if (!Array.isArray(arr)) {
    console.warn(`[guardrails] ${fieldName}: expected array`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  if (arr.length > maxItems) {
    console.warn(`[guardrails] ${fieldName}: too many items (${arr.length} > ${maxItems})`);
    return { ok: false, error: GENERIC_INPUT_ERROR };
  }

  const cleaned = [];
  for (const item of arr) {
    const result = validateTextField(item, `${fieldName} item`, maxItemLength);
    if (!result.ok) return result;
    cleaned.push(result.value);
  }

  return { ok: true, value: cleaned };
}
