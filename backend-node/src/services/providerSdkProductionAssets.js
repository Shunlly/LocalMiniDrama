'use strict';

// 从 providerSdkProduction 拆出的资产生图：角色/场景/道具参考图的生产生成。
// 保持原语义，不是新增真实厂商接入。

const imageService = require('./imageService');
const imageClient = require('./imageClient');
const { firstLocalAsset } = require('./providerSdkProtocol');
const { productionAssetTypeLabel } = require('./providerSdkErrors');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');

async function generateAssetBibleImagesProduction(db, log, params) {
  const config = imageClient.getDefaultImageConfig(
    db,
    params.asset_image_model,
    params.asset_image_provider,
    'image'
  );
  if (!config) throw new Error('素材图供应商不可用，请在「AI 配置」中启用图片模型');
  const provider = config.provider || params.asset_image_provider || 'openai';
  const model = configuredModel(config, params.asset_image_model, 'image');
  const targets = [
    ...db.prepare(
      'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
    ).all(Number(params.drama_id)).map((row) => ({ type: 'character', row })),
    ...db.prepare(
      'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
    ).all(Number(params.drama_id)).map((row) => ({ type: 'scene', row })),
    ...db.prepare(
      'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
    ).all(Number(params.drama_id)).map((row) => ({ type: 'prop', row })),
  ];
  let created = 0;
  let reused = 0;
  const generatedByType = { character: 0, scene: 0, prop: 0 };

  for (const target of targets) {
    const fields = target.type === 'character'
      ? ['local_path', 'image_url', 'four_view_image_url', 'seedance2_asset']
      : ['local_path', 'image_url', 'ref_image'];
    let localPath = firstLocalAsset(target.row, fields);
    const wasReused = Boolean(localPath);
    let image = null;
    const callKey = providerCallKey(params, 'asset_image', target.type, target.row.id);
    try {
      if (localPath) {
        reused += 1;
      } else {
        const prompt = target.type === 'character'
          ? target.row.appearance || target.row.description || `${target.row.name} character reference`
          : target.type === 'scene'
            ? target.row.prompt || `${target.row.location} production environment reference`
            : target.row.prompt || target.row.description || `${target.row.name} production prop reference`;
        image = await imageService.createAndProcessImage(db, log, {
          drama_id: params.drama_id,
          scene_id: target.type === 'scene' ? target.row.id : null,
          character_id: target.type === 'character' ? target.row.id : null,
          provider,
          model,
          prompt,
          frame_type: `workflow_${target.type}_reference`,
          size: params.asset_image_size || params.image_size,
          require_local: true,
          idempotency_key: callKey,
        });
        localPath = image.local_path || image.image_url;
        const now = nowIso();
        if (target.type === 'character') {
          db.prepare('UPDATE characters SET image_url = ?, local_path = ?, updated_at = ? WHERE id = ?')
            .run(image.image_url, image.local_path, now, target.row.id);
        } else if (target.type === 'scene') {
          db.prepare("UPDATE scenes SET image_url = ?, local_path = ?, status = 'generated', updated_at = ? WHERE id = ?")
            .run(image.image_url, image.local_path, now, target.row.id);
        } else {
          db.prepare('UPDATE props SET image_url = ?, local_path = ?, updated_at = ? WHERE id = ?')
            .run(image.image_url, image.local_path, now, target.row.id);
        }
        created += 1;
        generatedByType[target.type] += 1;
      }
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'asset_image',
        provider_name: image?.provider || provider,
        model: image?.model || model,
        mode: 'production',
        billable: !wasReused,
        usage: { count: wasReused ? 0 : 1 },
        idempotency_key: callKey,
        input: { call_key: callKey, asset_type: target.type, asset_id: target.row.id },
        output: {
          asset_type: target.type,
          asset_id: target.row.id,
          ...(image?.id ? { image_generation_id: image.id } : {}),
          local_path: localPath,
        },
      });
    } catch (error) {
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'asset_image',
        provider_name: provider,
        model,
        mode: 'production',
        status: 'failed',
        idempotency_key: callKey,
        input: { call_key: callKey, asset_type: target.type, asset_id: target.row.id },
        output: {},
        error_message: toUserFacingProcessError(error, '素材图请求失败'),
      });
      throw new Error(`${productionAssetTypeLabel(target.type)} ${target.row.id} 的素材图生成失败：${toUserFacingProcessError(error, '请检查图片服务配置后重试')}`);
    }
  }
  return {
    mode: 'production',
    asset_count: targets.length,
    asset_created: created,
    asset_reused: reused,
    generated_by_type: generatedByType,
  };
}

module.exports = {
  generateAssetBibleImagesProduction,
};

const {
  configuredModel,
  providerCallKey,
  nowIso,
  recordProviderInvocation,
} = require('./providerSdkProduction');
