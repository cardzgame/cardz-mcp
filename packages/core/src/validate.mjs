const DATE_2025_PLUS = /^20(2[5-9]|[3-9][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function checkValue(value, schema, field) {
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`Invalid ${field}: must be a string.`);
    if ((schema.minLength ?? 0) > 0 && !value.trim()) throw new Error(`Invalid ${field}: must not be blank.`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`Invalid ${field}: too short.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`Invalid ${field}: too long.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`Invalid ${field}: invalid format.`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid ${field}; use ${schema.enum.join(', ')}.`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`Invalid ${field}: must be an integer.`);
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`Invalid ${field}: below minimum ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`Invalid ${field}: exceeds maximum ${schema.maximum}.`);
    return;
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${field}: must be a finite number.`);
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`Invalid ${field}: below minimum ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`Invalid ${field}: exceeds maximum ${schema.maximum}.`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`Invalid ${field}: must be an array.`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`Invalid ${field}: requires at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`Invalid ${field}: exceeds maxItems ${schema.maxItems}.`);
    if (schema.items) {
      value.forEach((item, idx) => checkObject(item, schema.items, `${field}[${idx}]`));
    }
  }
}

function checkObject(obj, schema, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${prefix || 'Arguments'} must be an object.`);
  }
  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) {
      throw new Error(`Required argument missing: ${prefix ? `${prefix}.` : ''}${key}.`);
    }
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const matched = schema.anyOf.some((branch) =>
      (branch.required ?? []).every((key) => Object.hasOwn(obj, key) && typeof obj[key] === 'string' && obj[key].trim().length > 0)
    );
    if (!matched) {
      throw new Error(`${prefix || 'Item'} must include at least one of: cardId, externalId, jlpName, name, or collectorNumber.`);
    }
  }
  for (const [key, val] of Object.entries(obj)) {
    if (schema.additionalProperties === false && !Object.hasOwn(props, key)) {
      throw new Error(`Unknown argument: ${prefix ? `${prefix}.` : ''}${key}.`);
    }
    if (Object.hasOwn(props, key)) {
      checkValue(val, props[key], prefix ? `${prefix}.${key}` : key);
    }
  }
}

export function validateToolArgs(definition, args) {
  checkObject(args, definition.inputSchema);
  if (definition.name === 'get_card_ohlcv') {
    if (args.from && !DATE_2025_PLUS.test(args.from)) throw new Error('Invalid from date; earliest is 2025-01-01.');
    if (args.to && !DATE_2025_PLUS.test(args.to)) throw new Error('Invalid to date; earliest is 2025-01-01.');
    if (args.from && args.to) {
      const spanDays = Math.round((Date.parse(args.to) - Date.parse(args.from)) / 86_400_000);
      if (spanDays < 0) throw new Error('Invalid date range: to must be >= from.');
      if (spanDays > 730) throw new Error('Invalid date range: span cannot exceed 730 days.');
    }
  }
}
