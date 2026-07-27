'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IMPORT_IMAGE_VALIDATOR_FLAG = '--localminidrama-import-image-validator';
const IMAGE_CATEGORIES = Object.freeze(['characters', 'scenes', 'props', 'images', 'references']);
const IMAGE_FORMATS = Object.freeze({
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
});
const IMAGE_MIME_TYPES = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
});

function rejectValidation(code, mediaPath, reason, details = {}) {
  const error = new Error(reason);
  error.code = code;
  error.mediaPath = mediaPath;
  error.details = details;
  throw error;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    rejectValidation('MEDIA_VALIDATION_UNAVAILABLE', null, `${label} must be a positive integer`);
  }
  return parsed;
}

async function validateImage(sharp, absolutePath, mediaPath, expectedFormat, limits) {
  let image;
  let metadata;
  try {
    image = sharp(absolutePath, {
      animated: true,
      failOn: 'error',
      limitInputPixels: limits.maxPixels,
      sequentialRead: true,
    });
    metadata = await image.metadata();
  } catch (error) {
    const limitFailure = /pixel limit/i.test(String(error && error.message));
    rejectValidation(
      limitFailure ? 'IMPORT_IMAGE_LIMIT_EXCEEDED' : 'INVALID_MEDIA_CONTENT',
      mediaPath,
      limitFailure ? 'image pixel limit exceeded' : 'Sharp could not decode image metadata'
    );
  }

  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    rejectValidation('INVALID_MEDIA_CONTENT', mediaPath, 'image content does not match its extension');
  }

  const frames = metadata.pages == null ? 1 : Number(metadata.pages);
  const frameHeight = Number(metadata.pageHeight || metadata.height);
  const pixels = Number(metadata.width) * frameHeight * frames;
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > limits.maxFrames) {
    rejectValidation('IMPORT_IMAGE_LIMIT_EXCEEDED', mediaPath, 'image frame limit exceeded', {
      actual: frames,
      limit: limits.maxFrames,
      kind: 'frames',
    });
  }
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > limits.maxPixels) {
    rejectValidation('IMPORT_IMAGE_LIMIT_EXCEEDED', mediaPath, 'image pixel limit exceeded', {
      actual: Number.isSafeInteger(pixels) ? pixels : 'overflow',
      limit: limits.maxPixels,
      kind: 'pixels',
    });
  }

  try {
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    if (!decoded || !Buffer.isBuffer(decoded.data) || decoded.data.length === 0) {
      rejectValidation('INVALID_MEDIA_CONTENT', mediaPath, 'Sharp produced no decoded pixels');
    }
  } catch (error) {
    if (error && error.mediaPath) throw error;
    rejectValidation('INVALID_MEDIA_CONTENT', mediaPath, 'Sharp could not fully decode image');
  }
  return {
    format: metadata.format,
    mimeType: IMAGE_MIME_TYPES[metadata.format],
    width: Number(metadata.width),
    height: frameHeight,
  };
}

async function validateImportImages({ projectRoot, maxPixels, maxFrames, sharp = require('sharp') }) {
  let count = 0;
  const media = [];
  for (const category of IMAGE_CATEGORIES) {
    const directory = path.join(projectRoot, category);
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const mediaPath = `${category}/${entry.name}`;
      if (!entry.isFile()) {
        rejectValidation('INVALID_MEDIA_CONTENT', mediaPath, 'image staging entry is not a regular file');
      }
      const expectedFormat = IMAGE_FORMATS[path.extname(entry.name).toLowerCase()];
      if (!expectedFormat) {
        rejectValidation('INVALID_MEDIA_CONTENT', mediaPath, 'image extension is not allowed');
      }
      const metadata = await validateImage(
        sharp,
        path.join(directory, entry.name),
        mediaPath,
        expectedFormat,
        { maxPixels, maxFrames }
      );
      media.push({ mediaPath, ...metadata });
      count += 1;
    }
  }
  return { ok: true, count, media };
}

function validationFailure(error) {
  return {
    ok: false,
    code: error && error.code ? error.code : 'MEDIA_VALIDATION_UNAVAILABLE',
    mediaPath: error && error.mediaPath ? error.mediaPath : null,
    reason: error && error.message ? error.message : 'image validation failed',
    details: error && error.details ? error.details : null,
  };
}

function writeJson(stream, value) {
  return new Promise((resolve, reject) => {
    stream.write(JSON.stringify(value), (error) => (error ? reject(error) : resolve()));
  });
}

async function runImportImageValidatorCli(args = process.argv.slice(2), stdout = process.stdout) {
  let payload;
  let exitCode = 0;
  try {
    if (!Array.isArray(args) || args.length !== 3) {
      throw new Error('image validator requires project root, pixel limit, and frame limit');
    }
    payload = await validateImportImages({
      projectRoot: args[0],
      maxPixels: parsePositiveInteger(args[1], 'pixel limit'),
      maxFrames: parsePositiveInteger(args[2], 'frame limit'),
    });
  } catch (error) {
    payload = validationFailure(error);
    exitCode = 1;
  }
  await writeJson(stdout, payload);
  return exitCode;
}

if (require.main === module) {
  runImportImageValidatorCli().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  IMPORT_IMAGE_VALIDATOR_FLAG,
  runImportImageValidatorCli,
  validateImportImages,
};
