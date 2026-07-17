const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { safeParseAIJSON } = require('../src/utils/safeJson');

test('malformed AI JSON never exposes source text through errors, logger, or console', () => {
  const sourceMarker = 'do-not-log-this-source-marker';
  const malformed = `{"value":"${sourceMarker}","items":[}`;
  const warnings = [];
  const consoleWarnings = [];
  const logger = {
    warn(message, fields) {
      warnings.push({ message, fields });
    },
  };
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => consoleWarnings.push(args);

  try {
    assert.throws(
      () => safeParseAIJSON(malformed, null, logger),
      (error) => {
        assert.equal(error.code, 'AI_JSON_PARSE_FAILED');
        assert.doesNotMatch(error.message, new RegExp(sourceMarker));
        return true;
      }
    );
    assert.doesNotMatch(JSON.stringify(warnings), new RegExp(sourceMarker));

    assert.throws(() => safeParseAIJSON(malformed, null));
    assert.deepEqual(consoleWarnings, []);
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('legacy two-argument logger calls do not copy parsed fields into the logger', () => {
  const logger = {
    info() {},
    error() {},
  };

  const parsed = safeParseAIJSON('{"location":"studio","count":2}', logger);

  assert.deepEqual(parsed, { location: 'studio', count: 2 });
  assert.equal(logger.location, undefined);
  assert.equal(logger.count, undefined);
});

test('frame prompt parse failures log metadata without an AI response excerpt', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'framePromptService.js'),
    'utf8'
  );
  assert.match(source, /response_chars/);
  assert.doesNotMatch(source, /response_head|aiResponse[^\n]*\.slice\(/);
});
