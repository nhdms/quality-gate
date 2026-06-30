'use strict';

/**
 * Zero-dependency JSON-Schema-subset validator for gate.config.json.
 *
 * Deliberately does NOT pull in ajv or any npm dependency: the gate runs on
 * arbitrary (often air-gapped, self-hosted) runners and must stay portable.
 * It supports exactly the JSON Schema keywords used by gate.schema.json:
 *   type (incl. "integer"), required, properties, additionalProperties:false,
 *   enum, minimum, maximum, items.
 */

const fs = require('fs');

function jsType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean'
}

function matchesType(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number';
  if (type === 'object') return jsType(value) === 'object';
  if (type === 'array') return Array.isArray(value);
  return jsType(value) === type; // string | boolean | null
}

function validate(data, schema, pathStr, errors) {
  const at = pathStr || '/';

  if (schema.type && !matchesType(data, schema.type)) {
    errors.push(`${at}: expected type '${schema.type}', got '${jsType(data)}'`);
    return; // downstream checks are meaningless on a type mismatch
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${at}: ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${at}: ${data} is less than minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${at}: ${data} is greater than maximum ${schema.maximum}`);
    }
  }

  if (jsType(data) === 'object' && (schema.type === 'object' || schema.properties)) {
    const props = schema.properties || {};
    for (const req of schema.required || []) {
      if (!(req in data)) errors.push(`${at}${at.endsWith('/') ? '' : '/'}${req}: missing required property`);
    }
    for (const key of Object.keys(data)) {
      const childPath = `${at === '/' ? '' : at}/${key}`;
      if (props[key]) {
        validate(data[key], props[key], childPath, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPath}: unknown property (additionalProperties not allowed)`);
      }
    }
  }

  if (Array.isArray(data) && schema.items) {
    data.forEach((item, i) => validate(item, schema.items, `${at === '/' ? '' : at}/${i}`, errors));
  }
}

/**
 * @returns {string[]} array of human-readable error messages (empty = valid)
 */
function validateConfig(config, schema) {
  const errors = [];
  validate(config, schema, '/', errors);
  return errors;
}

module.exports = { validateConfig };

if (require.main === module) {
  const [, , configPath, schemaPath] = process.argv;
  if (!configPath || !schemaPath) {
    process.stderr.write('usage: validate-config.js <config.json> <schema.json>\n');
    process.exit(2);
  }

  let config;
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`quality-gate: failed to read schema '${schemaPath}': ${err.message}\n`);
    process.exit(2);
  }
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`quality-gate: config '${configPath}' is not readable/valid JSON: ${err.message}\n`);
    process.exit(1);
  }

  const errors = validateConfig(config, schema);
  if (errors.length > 0) {
    process.stderr.write(`quality-gate: '${configPath}' failed schema validation:\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(`quality-gate: '${configPath}' is valid.\n`);
}
