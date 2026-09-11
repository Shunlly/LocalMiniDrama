// 从 sourceMediaExtractionService 拆出的 PDF 抽取：文本层解析、栅格页渲染与 OCR 回退。

const { createCanvas } = require('@napi-rs/canvas');
const { actionableError } = require('./sourceMediaExtractionErrors');
const {
  MAX_EXTRACTED_TEXT_BYTES,
  clampInteger,
  ensureTextResult,
} = require('./sourceMediaExtractionValidation');
const { selectActiveConfig } = require('./sourceMediaExtractionRuntime');
const {
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_PDF_RENDER_DIMENSION,
  normalizeImage,
  ocrImageWithFallback,
} = require('./sourceMediaExtractionOcr');

const MAX_PDF_PAGES = 100;
const MAX_PDF_OCR_PAGES = 30;
const MAX_PDF_RENDER_PIXELS = 8 * 1024 * 1024;

let pdfJsPromise;

function loadPdfJs() {
  if (!pdfJsPromise) pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfJsPromise;
}

function pageTextFromItems(items) {
  const lines = [];
  let current = '';
  let previousY = null;
  for (const item of items || []) {
    const value = String(item?.str || '');
    const y = Number(item?.transform?.[5]);
    if (current && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 2) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (value) {
      if (current && !/\s$/.test(current) && !/^\s|^[,.;:!?，。；：！？、）\]]/.test(value)) current += ' ';
      current += value;
    }
    if (item?.hasEOL) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (Number.isFinite(y)) previousY = y;
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

async function pageContainsRasterImage(page, pdfjs) {
  const operatorList = await page.getOperatorList();
  const imageOperators = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintJpegXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintSolidColorImageMask,
  ].filter(Number.isFinite));
  return operatorList.fnArray.some((operation) => imageOperators.has(operation));
}

async function renderPdfPage(page) {
  const base = page.getViewport({ scale: 1 });
  if (![base.width, base.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw actionableError('该 PDF 包含无效页面尺寸。请更换文件或拆分后再试。');
  }
  const scale = Math.min(
    2,
    MAX_PDF_RENDER_DIMENSION / Math.max(base.width, base.height),
    Math.sqrt(MAX_PDF_RENDER_PIXELS / (base.width * base.height))
  );
  if (!Number.isFinite(scale) || scale <= 0) throw actionableError('该 PDF 页面无法安全渲染。请更换文件或降低页尺寸后重试。');
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (width * height > MAX_PDF_RENDER_PIXELS) throw actionableError('该 PDF 页面超过 OCR 渲染像素上限。请拆分或缩小页面后重试。');
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
  const buffer = canvas.toBuffer('image/png');
  if (buffer.length > MAX_NORMALIZED_IMAGE_BYTES) {
    return normalizeImage(buffer);
  }
  return { buffer, mime: 'image/png', width, height };
}

async function extractPdf(db, descriptor, fileBuffer, options) {
  const pdfjs = await loadPdfJs();
  let loadingTask;
  let document;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      disableWorker: true,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    document = await loadingTask.promise;
  } catch (err) {
    await loadingTask?.destroy?.().catch(() => {});
    throw actionableError('该 PDF 无效、已截断、已加密或不被支持。请更换未加密的完整 PDF 后重试。', err);
  }

  const pageCount = document.numPages;
  const ocrConfig = selectActiveConfig(db, 'ocr');
  const pdfSettings = ocrConfig?.settings_object || {};
  const pageLimit = clampInteger(pdfSettings.max_pdf_pages, MAX_PDF_PAGES, 1, MAX_PDF_PAGES);
  const ocrPageLimit = clampInteger(pdfSettings.max_pdf_ocr_pages, MAX_PDF_OCR_PAGES, 1, MAX_PDF_OCR_PAGES);
  if (pageCount > pageLimit) {
    await document.destroy();
    throw actionableError(`该 PDF 有 ${pageCount} 页，当前上限为 ${pageLimit} 页。请拆分 PDF 后重试。`);
  }

  const pageResults = [];
  const methods = new Set();
  let ocrPageCount = 0;
  let ocrConfigId = null;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ disableNormalization: false });
        let text = pageTextFromItems(content.items);
        if (text.replace(/\s/g, '').length >= 4) {
          methods.add('pdf_text');
        } else if (await pageContainsRasterImage(page, pdfjs)) {
          ocrPageCount += 1;
          if (ocrPageCount > ocrPageLimit) {
            throw actionableError(`该 PDF 需要 OCR 的页数超过 ${ocrPageLimit} 页。请拆分 PDF 后重试。`);
          }
          const image = await renderPdfPage(page);
          const ocr = await ocrImageWithFallback(db, image, options, ocrConfig);
          text = ocr.text;
          methods.add(ocr.method);
          if (ocr.config_id) ocrConfigId = ocr.config_id;
        }
        if (text.trim()) pageResults.push(`--- Page ${pageNumber} ---\n${text.trim()}`);
        const currentBytes = Buffer.byteLength(pageResults.join('\n\n'), 'utf8');
        if (currentBytes > MAX_EXTRACTED_TEXT_BYTES) {
          throw actionableError('抽取的 PDF 文本超过 2MB 上限。请拆分 PDF 后重试。');
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.destroy();
  }

  const text = ensureTextResult(pageResults.join('\n\n'), '该 PDF 没有可抽取文本或可供 OCR 识别的页面。请更换文件或检查 OCR 配置。');
  return {
    text,
    metadata: {
      extraction_method: Array.from(methods).join('+') || 'pdf_text',
      media_kind: descriptor.kind,
      detected_format: descriptor.format,
      extracted_text_length: text.length,
      page_count: pageCount,
      ocr_page_count: ocrPageCount,
      ...(ocrConfigId ? { extraction_service_type: 'ocr', extraction_config_id: ocrConfigId } : {}),
    },
  };
}

module.exports = {
  extractPdf,
  loadPdfJs,
  pageContainsRasterImage,
  pageTextFromItems,
  renderPdfPage,
};
