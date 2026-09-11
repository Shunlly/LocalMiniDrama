/**
 * 图片生成管线：输出尺寸对齐（目标 size 缩放与像素 letterbox 校正）。
 * 由 imageServicePipeline.js 再导出，不改变公开 API。
 */

const path = require('path');
const fs = require('fs');
const uploadService = require('./uploadService');
const { parseTargetPixelsFromSizeString } = require('./imageServiceAssembly');

/**
 * 将已落盘的生成图缩放到与 Step3 目标尺寸一致（contain + 黑底留边，不裁切主体），避免模型实际输出像素漂移导致分镜/视频参考不一致。
 * Windows：经路径打开含中文/非 ASCII 目录时 libvips 常失败，改由 Node 读入 Buffer 再交给 sharp。
 */
async function normalizeLocalImageToTargetSize(absPath, sizeStr, log, meta) {
  const dim = parseTargetPixelsFromSizeString(sizeStr);
  if (!dim || !absPath || !fs.existsSync(absPath)) return;
  let sharpLib;
  try {
    sharpLib = require('sharp');
  } catch (_) {
    log.warn('[图生] sharp 不可用，跳过尺寸对齐', meta || {});
    return;
  }
  try {
    const inputBuf = fs.readFileSync(absPath);
    const metaIn = await sharpLib(inputBuf).metadata();
    if (metaIn.width === dim.w && metaIn.height === dim.h) {
      log.info('[图生] 输出尺寸已与目标一致', { ...meta, size: `${dim.w}x${dim.h}` });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const containBg = { r: 0, g: 0, b: 0, alpha: 1 };
    const pipeline = sharpLib(inputBuf).resize(dim.w, dim.h, {
      fit: 'contain',
      position: 'centre',
      background: containBg,
    });
    let buf;
    if (ext === '.png') {
      buf = await pipeline.png({ compressionLevel: 6 }).toBuffer();
    } else if (ext === '.webp') {
      buf = await pipeline.webp({ quality: 90 }).toBuffer();
    } else {
      buf = await pipeline.jpeg({ quality: 92 }).toBuffer();
    }
    uploadService.writeFileAtomically(absPath, (stagedPath) => {
      fs.writeFileSync(stagedPath, buf, { flag: 'wx' });
    });
    log.info('[图生] 已对齐输出尺寸', {
      ...meta,
      target: `${dim.w}x${dim.h}`,
      before: `${metaIn.width}x${metaIn.height}`,
    });
  } catch (e) {
    log.warn('[图生] 尺寸对齐失败（保留原图）', { ...meta, error: e.message });
  }
}

/**
 * Gemini/部分中转返回的像素与请求的 size 不一致时，二次 letterbox（容差内跳过）；在 normalizeLocalImageToTargetSize 之后调用。
 */
async function normalizeSavedImageToTargetPixels(absPath, sizeStr, log, ctx) {
  const dim = parseTargetPixelsFromSizeString(sizeStr);
  if (!dim) return;
  let sharpLib;
  try { sharpLib = require('sharp'); } catch { return; }
  if (!absPath || !fs.existsSync(absPath)) return;
  const tw = dim.w;
  const th = dim.h;
  const tmp = absPath + '.__norm_tmp__';
  try {
    const meta = await sharpLib(absPath).metadata();
    const ow = meta.width;
    const oh = meta.height;
    if (!ow || !oh) return;
    const targetR = tw / th;
    const outR = ow / oh;
    const ratioClose = Math.abs(outR - targetR) / Math.max(targetR, outR, 0.01) <= 0.02;
    const pixelClose = Math.abs(ow - tw) / tw <= 0.06 && Math.abs(oh - th) / th <= 0.06;
    if (ratioClose && pixelClose) {
      log.info('[图生] 输出像素已匹配目标（跳过校正）', { ...ctx, px: `${ow}x${oh}`, target: `${tw}x${th}` });
      return;
    }
    log.info('[图生] 输出像素与目标不一致，letterbox 校正', {
      ...ctx,
      before: `${ow}x${oh}`,
      target: `${tw}x${th}`,
    });
    const fmt = (meta.format || '').toLowerCase();
    let pipeline = sharpLib(absPath).rotate().resize(tw, th, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    });
    if (fmt === 'png') {
      await pipeline.png({ compressionLevel: 6 }).toFile(tmp);
    } else if (fmt === 'webp') {
      await pipeline.webp({ quality: 90 }).toFile(tmp);
    } else {
      await pipeline.jpeg({ quality: 92, mozjpeg: true }).toFile(tmp);
    }
    const publication = uploadService.publishStagedFile(tmp, absPath);
    publication.commit();
    log.info('[图生] letterbox 校正完成', { ...ctx });
  } catch (e) {
    log.warn('[图生] 输出尺寸校正失败（保留原图）', { ...ctx, error: e.message });
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

module.exports = {
  normalizeLocalImageToTargetSize,
  normalizeSavedImageToTargetPixels,
};
