const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  inspectUploadedFile,
  extractUploadedSource,
  MAX_SOURCE_UPLOAD_BYTES,
} = require('../src/services/sourceMediaExtractionService');

const SERVICE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/services/sourceMediaExtractionService.js'),
  'utf8'
);

describe('sourceMediaExtraction user-visible messages', () => {
  it('keeps leftover English extraction errors out of the service source', () => {
    const leftover = [
      "A source file is required.",
      "The uploaded source file is empty.",
      "Source Intake uploads are limited to 20MB. Split or compress the source and try again.",
      "The source filename extension does not match the file signature.",
      "The source MIME type does not match the file signature.",
      "Unsupported or invalid source file. Use text, PDF, PNG/JPEG/WebP/GIF, or a supported audio/video container.",
      "The uploaded text file contains binary data.",
      "The uploaded text file must be valid UTF-8.",
      "The uploaded text file is empty.",
      "No readable text was extracted from the source.",
      "Extracted source text exceeds the 2MB limit. Split the source and try again.",
      "The configured model name is invalid.",
      "The configured service endpoint path is invalid.",
      "Service endpoints must be relative to the configured base URL.",
      "The configured service endpoint path cannot traverse directories.",
      "The configured service base URL is invalid.",
      "The configured service base URL must be an HTTP(S) URL without credentials, query, or fragment.",
      "The configured service endpoint must remain on the configured origin.",
      "The configured API key is invalid.",
      "The extraction service response is too large.",
      "could not be reached. Check the active AI configuration.",
      "The OCR service returned invalid JSON.",
      "The OCR service returned no readable text.",
      "Could not create a safe temporary extraction directory.",
      "Temporary extraction path validation failed.",
      "Temporary extraction files could not be removed.",
      "produced too much output.",
      "produced too much diagnostic output.",
      "failed with exit code",
      "Tesseract OCR returned no readable text.",
      "No OCR service is configured and Tesseract is unavailable.",
      "OCR failed. Check service_type=ocr or the local Tesseract installation.",
      "The normalized OCR image exceeds the 10MB limit.",
      "The uploaded image is invalid or exceeds the 40-megapixel decode limit.",
      "The PDF contains an invalid page size.",
      "The PDF page cannot be rendered safely.",
      "The PDF page exceeds the OCR render pixel limit.",
      "The PDF is invalid, truncated, encrypted, or unsupported.",
      "Split the PDF and try again.",
      "Extracted PDF text exceeds the 2MB limit. Split the PDF and try again.",
      "The PDF contains no extractable text or OCR-readable pages.",
      "The transcription service returned no text.",
      "The transcription service returned invalid JSON.",
      "No transcription service is configured.",
      "Audio sent for transcription exceeds the 20MB limit. Shorten or compress the source.",
      "FFprobe returned invalid media metadata.",
      "The uploaded video has no audio track to transcribe.",
      "The uploaded video duration could not be determined safely.",
      "FFmpeg did not produce a usable audio track.",
      "The extracted video audio exceeds the 20MB transcription limit.",
      "Unsupported Source Intake file type.",
      "configuration has no model.",
      "configuration has no valid base_url.",
      "timed out after",
      "is unavailable.",
      "Check the active AI configuration.",
    ];
    for (const phrase of leftover) {
      assert.equal(SERVICE_SOURCE.includes(phrase), false, phrase);
    }
    assert.match(SERVICE_SOURCE, /Tesseract/);
    assert.match(SERVICE_SOURCE, /service_type=ocr/);
    assert.match(SERVICE_SOURCE, /请上传源文件后再试/);
  });

  it('returns Chinese actionable errors from inspectUploadedFile without OCR', () => {
    assert.throws(
      () => inspectUploadedFile(null),
      (error) => {
        assert.equal(error.code, 'BAD_REQUEST');
        assert.match(error.message, /请上传源文件/);
        return true;
      }
    );
    assert.throws(
      () => inspectUploadedFile({ originalname: 'empty.txt', mimetype: 'text/plain', buffer: Buffer.alloc(0) }),
      /源文件为空/
    );
    assert.throws(
      () => inspectUploadedFile({
        originalname: 'too-big.txt',
        mimetype: 'text/plain',
        size: MAX_SOURCE_UPLOAD_BYTES + 1,
        buffer: Buffer.from('ok'),
      }),
      /20MB/
    );
    assert.throws(
      () => inspectUploadedFile({
        originalname: 'spoof.png',
        mimetype: 'image/png',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      }),
      /扩展名.*文件签名/
    );
    assert.throws(
      () => inspectUploadedFile({
        originalname: 'spoof.jpg',
        mimetype: 'image/png',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      }),
      /MIME 类型.*文件签名/
    );
    assert.throws(
      () => inspectUploadedFile({
        originalname: 'unknown.bin',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from('not-a-supported-container'),
      }),
      /不支持或无效的源文件/
    );
  });

  it('returns Chinese actionable errors for unreadable text without OCR', async () => {
    await assert.rejects(
      () => extractUploadedSource({}, {
        originalname: 'blank.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('   \n'),
      }),
      /文本文件为空/
    );
    await assert.rejects(
      () => extractUploadedSource({}, {
        originalname: 'binary.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('hello\0world'),
      }),
      /二进制数据/
    );
    await assert.rejects(
      () => extractUploadedSource({}, {
        originalname: 'bad-utf8.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from([0x48, 0x69, 0xff]),
      }),
      /UTF-8/
    );
  });
});
