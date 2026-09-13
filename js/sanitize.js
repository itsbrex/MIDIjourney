const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "pollinationstoken",
  "password",
  "secret",
  "token",
]);

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function stripSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(stripSensitiveFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, nestedValue]) => [key, stripSensitiveFields(nestedValue)]),
  );
}

exports.isSensitiveKey = isSensitiveKey;
exports.stripSensitiveFields = stripSensitiveFields;
