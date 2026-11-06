// Deliberately small JSON Schema subset used by our checked-in schemas. Unknown
// keywords are not accepted from chat or model output; schemas are application code.
export function validateSchema(value, schema) {
  const fail = () => { throw new Error("Invalid structured triage data"); };
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail();
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) { if (schema.additionalProperties === false) fail(); }
      else validateSchema(value[key], schema.properties[key]);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail();
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail();
    for (const item of value) validateSchema(item, schema.items);
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail();
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail();
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail();
  } else if (schema.type === "boolean" && typeof value !== "boolean") fail();
  return value;
}
