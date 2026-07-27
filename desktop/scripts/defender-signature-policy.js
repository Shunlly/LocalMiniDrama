'use strict';

const assert = require('node:assert/strict');

const DEFENDER_SIGNATURE_MAX_AGE_HOURS = 72;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function currentTime(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  assert.ok(Number.isFinite(now.getTime()), 'Defender freshness reference time is invalid');
  return now;
}

function normalizeDefenderSignatureDetails(value, options = {}) {
  assert.ok(value != null && String(value).trim(), 'Defender AntivirusSignatureLastUpdated is required');
  const raw = String(value).trim();
  assert.match(raw, UTC_TIMESTAMP, 'Defender AntivirusSignatureLastUpdated must be a valid UTC timestamp');
  const updatedAt = new Date(raw);
  assert.ok(Number.isFinite(updatedAt.getTime()), 'Defender AntivirusSignatureLastUpdated must be a valid UTC timestamp');

  const now = currentTime(options);
  const ageMs = now.getTime() - updatedAt.getTime();
  assert.ok(ageMs >= 0, 'Defender AntivirusSignatureLastUpdated cannot be in the future');
  assert.ok(
    ageMs <= DEFENDER_SIGNATURE_MAX_AGE_HOURS * 60 * 60 * 1000,
    `Defender AntivirusSignatureLastUpdated is older than ${DEFENDER_SIGNATURE_MAX_AGE_HOURS} hours`
  );
  return {
    antivirus_signature_last_updated: updatedAt.toISOString(),
    maximum_age_hours: DEFENDER_SIGNATURE_MAX_AGE_HOURS,
  };
}

function validateDefenderSignatureDetails(details, options = {}) {
  assert.equal(
    details?.maximum_age_hours,
    DEFENDER_SIGNATURE_MAX_AGE_HOURS,
    `Defender maximum age must be ${DEFENDER_SIGNATURE_MAX_AGE_HOURS} hours`
  );
  return normalizeDefenderSignatureDetails(details?.antivirus_signature_last_updated, options);
}

module.exports = {
  DEFENDER_SIGNATURE_MAX_AGE_HOURS,
  normalizeDefenderSignatureDetails,
  validateDefenderSignatureDetails,
};
