// 源媒体抽取编排：文本/PDF/图片/音视频抽取。文件探测、OCR/转写校验、运行时工具与错误装配见拆出模块。

const { actionableError } = require('./sourceMediaExtractionErrors');
const {
  MAX_SOURCE_UPLOAD_BYTES,
  inspectUploadedFile,
} = require('./sourceMediaExtractionDetect');
const { decodeUtf8Text } = require('./sourceMediaExtractionValidation');
const {
  requestBounded,
  runBoundedProcess,
} = require('./sourceMediaExtractionRuntime');
const {
  normalizeImage,
  ocrImageWithFallback,
} = require('./sourceMediaExtractionOcr');
const { extractPdf } = require('./sourceMediaExtractionPdf');
const {
  extractVideoAndTranscribe,
  transcribeAudio,
} = require('./sourceMediaExtractionTranscribe');

async function extractUploadedSource(db, file, options = {}) {
  const descriptor = inspectUploadedFile(file);
  if (descriptor.kind === 'text') {
    const text = decodeUtf8Text(file.buffer);
    return {
      text,
      file: descriptor,
      metadata: {
        extraction_method: 'utf8_text',
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: text.length,
      },
    };
  }
  if (descriptor.kind === 'pdf') {
    return { ...await extractPdf(db, descriptor, file.buffer, options), file: descriptor };
  }
  if (descriptor.kind === 'image') {
    const image = await normalizeImage(file.buffer);
    const ocr = await ocrImageWithFallback(db, image, options);
    return {
      text: ocr.text,
      file: descriptor,
      metadata: {
        extraction_method: ocr.method,
        extraction_service_type: 'ocr',
        ...(ocr.config_id ? { extraction_config_id: ocr.config_id } : {}),
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: ocr.text.length,
        image_width: image.width,
        image_height: image.height,
      },
    };
  }
  if (descriptor.kind === 'audio') {
    const transcription = await transcribeAudio(db, {
      buffer: file.buffer,
      mime: descriptor.mime,
      filename: descriptor.filename,
    }, options);
    return {
      text: transcription.text,
      file: descriptor,
      metadata: {
        extraction_method: 'openai_compatible_transcription',
        extraction_service_type: 'transcription',
        extraction_config_id: transcription.config_id,
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: transcription.text.length,
      },
    };
  }
  if (descriptor.kind === 'video') {
    return { ...await extractVideoAndTranscribe(db, descriptor, file.buffer, options), file: descriptor };
  }
  throw actionableError('不支持该源文件类型。请使用文本、PDF、图片或受支持的音频/视频文件。');
}

module.exports = {
  MAX_SOURCE_UPLOAD_BYTES,
  extractUploadedSource,
  inspectUploadedFile,
  requestBounded,
  runBoundedProcess,
};
