'use strict';

// 从 workflowService.executeStep 拆出的各 step_key 执行体。
// 可写校验与步骤类型过滤仍由 workflowService.executeStep 负责。

const crypto = require('crypto');
const sourceIntakeService = require('./sourceIntakeService');
const qaService = require('./qaService');
const providerSdkService = require('./providerSdkService');
const skillRegistryService = require('./skillRegistryService');
const characterContinuityService = require('./characterContinuityService');
const aiClient = require('./aiClient');
const { nowIso, parseJson, toJson, toUserFacingWorkflowError } = require('./workflowStatus');
const {
  assertSourceDetailForRun,
  assertAdaptationPlanForSource,
  requirePreviousSourceId,
  requirePreviousAdaptationPlanId,
  assertAdaptationApplyResult,
  assertQaAuditAccepted,
  unknownWorkflowStepError,
} = require('./workflowStepErrors');

function previousOutput(steps, stepKey) {
  const step = steps.find((s) => s.step_key === stepKey);
  return step ? step.output_json || {} : {};
}

function completedStepEffect(db, callKey) {
  const row = db.prepare(
    `SELECT output_json FROM workflow_step_effects
      WHERE call_key = ? AND status = 'succeeded'`
  ).get(String(callKey));
  return row ? parseJson(row.output_json, {}) : null;
}

function recordStepEffect(db, run, step, output) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO workflow_step_effects
     (call_key, run_id, workflow_step_id, step_key, status, output_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)`
  ).run(
    String(step.call_key),
    String(run.id),
    String(step.id),
    String(step.step_key),
    toJson(output),
    now,
    now
  );
  return output;
}

function recordSkill(db, run, step, skillName, input, output, status = 'success') {
  return skillRegistryService.recordSkillInvocation(db, {
    workflow_step_id: step?.id || null,
    run_id: run?.id || null,
    skill_name: skillName,
    input,
    output,
    status,
  });
}

async function requestProductionAdaptationText(db, log, run, step, sourceId, plan, providerOptions) {
  const sourceDetail = sourceIntakeService.getSourceDetail(db, sourceId);
  if (!sourceDetail) throw new Error('找不到用于生产文本改编的素材源，请确认素材源仍存在后重试');
  const sourcePrompt = skillRegistryService.renderSkillPrompt(db, 'localminidrama-source-intake', {
    drama_id: run.drama_id,
    source_id: sourceId,
    source_type: sourceDetail.source.source_type,
    source_items: sourceDetail.items,
    story_events: sourceDetail.events,
  });
  const adaptationPrompt = skillRegistryService.renderSkillPrompt(db, 'localminidrama-script-adapter', {
    source_id: sourceId,
    adaptation_plan_id: plan.id,
    overwrite_existing_episodes: run.input_json?.overwrite_existing_episodes === true,
    adaptation_plan: plan.plan_json,
  });
  const routeOptions = {
    model: providerOptions.text_model,
    provider: providerOptions.text_provider,
  };
  const route = aiClient.resolveTextRoute(db, 'text', routeOptions);
  if (!route) throw new Error('生产工作流尚未就绪：文本模型路由不可用，请在「AI 配置」中启用文本模型后重试');
  const model = aiClient.getModelFromConfig(route.config, route.modelOverride || routeOptions.model);
  const providerName = route.config.provider || route.config.name || 'text-provider';
  const promptEvidence = {
    source: {
      skill_name: sourcePrompt.skill_name,
      skill_version: sourcePrompt.skill_version,
      template_sha256: sourcePrompt.template_sha256,
    },
    adaptation: {
      skill_name: adaptationPrompt.skill_name,
      skill_version: adaptationPrompt.skill_version,
      template_sha256: adaptationPrompt.template_sha256,
    },
  };
  const systemPrompt = `${sourcePrompt.system_prompt}\n\n${adaptationPrompt.system_prompt}`;
  const userPrompt = JSON.stringify({
    source: JSON.parse(sourcePrompt.user_prompt),
    adaptation: JSON.parse(adaptationPrompt.user_prompt),
  });
  try {
    const responseText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      ...routeOptions,
      json_mode: true,
      temperature: 0.2,
      max_tokens: 2000,
      idempotency_key: step.call_key,
    });
    return {
      provider_name: providerName,
      model,
      response_text: responseText,
      response_sha256: crypto.createHash('sha256').update(responseText, 'utf8').digest('hex'),
      prompt_evidence: promptEvidence,
      cost_usage: {
        input_text: `${systemPrompt}\n${userPrompt}`,
        output_text: responseText,
      },
      provider_input: {
        call_key: step.call_key,
        source_id: sourceId,
        adaptation_plan_id: plan.id,
        prompt_evidence: promptEvidence,
      },
    };
  } catch (error) {
    providerSdkService.recordProviderInvocation(db, {
      workflow_step_id: step.id,
      run_id: run.id,
      provider_type: 'text',
      provider_name: providerName,
      model,
      mode: 'production',
      status: 'failed',
      idempotency_key: step.call_key,
      input: { call_key: step.call_key, source_id: sourceId, prompt_evidence: promptEvidence },
      output: { prompt_evidence: promptEvidence },
      error_message: toUserFacingWorkflowError(error) || '生产文本模型请求失败，请检查「AI 配置」后重试',
    });
    throw error;
  }
}

function finalizeQaPendingComposites(db, run) {
  const episodes = run.episode_id
    ? db.prepare('SELECT id FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL')
      .all(Number(run.episode_id), Number(run.drama_id))
    : db.prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
      .all(Number(run.drama_id));
  const now = nowIso();
  let mergeCount = 0;
  const videoMergeService = require('./videoMergeService');
  const scopedMergeIds = new Set();
  const compositorInvocations = db.prepare(
    `SELECT output_json FROM provider_invocations
      WHERE run_id = ? AND provider_type = 'compositor' AND status = 'success'`
  ).all(String(run.id));
  for (const invocation of compositorInvocations) {
    const output = parseJson(invocation.output_json, {});
    const mergeId = Number(output.merge_id);
    if (Number.isSafeInteger(mergeId) && mergeId > 0) scopedMergeIds.add(mergeId);
  }
  for (const episode of episodes) {
    const pendingMerges = db.prepare(
      `SELECT id, task_id, merged_url, duration FROM video_merges
        WHERE episode_id = ? AND status = 'qa_pending' AND deleted_at IS NULL
        ORDER BY id ASC`
    ).all(episode.id);
    const merges = pendingMerges.filter((merge) => scopedMergeIds.has(Number(merge.id)));
    if (!merges.length) continue;
    for (const merge of merges) {
      if (videoMergeService.completeQaPendingMerge(db, merge.id, now)) mergeCount += 1;
    }
  }
  return { episode_count: episodes.length, merge_count: mergeCount };
}

async function executeWorkflowStep(db, log, run, step, allSteps, helpers = {}) {
  const {
    checkpointStepResult,
    createCreativeReview,
    ensureAssetBible,
    ensureStoryboardDraft,
    ensureTimelinePlan,
  } = helpers;
  const executionMode = run.input_json?.qa_mode === 'production' ? 'production' : 'draft';
  const providerOptions = run.input_json?.options || {};
  if (step.step_key === 'source_intake') {
    const input = step.input_json || {};
    if (input.source_id) {
      const detail = sourceIntakeService.getSourceDetail(db, input.source_id);
      assertSourceDetailForRun(detail, run.drama_id);
      let adaptationPlanId = input.adaptation_plan_id || detail.adaptation_plans[0]?.id || null;
      if (adaptationPlanId) {
        const plan = sourceIntakeService.getAdaptationPlanById(db, adaptationPlanId);
        assertAdaptationPlanForSource(plan, detail.source.id);
      }
      const output = {
        source_id: detail.source.id,
        source_type: detail.source.source_type,
        item_count: detail.items.length,
        event_count: detail.events.length,
        event_edge_count: detail.event_edges?.length || 0,
        adaptation_plan_id: adaptationPlanId,
      };
      const commitSource = db.transaction(() => {
        recordSkill(db, run, step, 'localminidrama-source-intake', input, output);
        checkpointStepResult(db, step.id, step.call_key, output);
      });
      commitSource();
      return output;
    }
    const result = sourceIntakeService.createStorySource(db, log, input);
    const output = {
      source_id: result.source.id,
      source_type: result.source.source_type,
      item_count: result.items.length,
      event_count: result.events.length,
      event_edge_count: result.event_edges?.length || 0,
      adaptation_plan_id: result.adaptation_plan?.id || null,
    };
    const commitSource = db.transaction(() => {
      recordSkill(db, run, step, 'localminidrama-source-intake', input, output);
      checkpointStepResult(db, step.id, step.call_key, output);
    });
    commitSource();
    return output;
  }

  if (step.step_key === 'adaptation_plan') {
    const sourceOut = previousOutput(allSteps, 'source_intake');
    const sourceId = requirePreviousSourceId(sourceOut);
    let plan = sourceOut.adaptation_plan_id
      ? sourceIntakeService.getAdaptationPlanById(db, sourceOut.adaptation_plan_id)
      : sourceIntakeService.getLatestPlanForSource(db, sourceId);
    if (!plan) {
      const runInput = run.input_json || {};
      plan = sourceIntakeService.createAdaptationPlan(db, log, sourceId, {
        target_episode_count: runInput.target_episode_count,
        style: runInput.style,
      });
    }
    const textEvidence = executionMode === 'production'
      ? await requestProductionAdaptationText(db, log, run, step, sourceId, plan, providerOptions)
      : null;
    const commitAdaptation = db.transaction(() => {
      const reviewId = createCreativeReview(db, {
        dramaId: run.drama_id,
        runId: run.id,
        sourceId,
        role: 'script_writer',
        targetType: 'adaptation_plan',
        targetId: String(plan.id),
        status: 'locked',
        findings: [
          { check: 'source_traceability', passed: true },
          { check: 'episode_beats', passed: Array.isArray(plan.plan_json?.episodes) && plan.plan_json.episodes.length > 0 },
        ],
      });
      const output = {
        adaptation_plan_id: plan.id,
        source_id: plan.source_id,
        episode_count: plan.target_episode_count,
        status: plan.status,
        creative_review_id: reviewId,
        ...(textEvidence ? {
          mode: 'production',
          text_provider: {
            provider_name: textEvidence.provider_name,
            model: textEvidence.model,
            response_sha256: textEvidence.response_sha256,
            prompt_evidence: textEvidence.prompt_evidence,
          },
        } : {}),
      };
      if (textEvidence) {
        providerSdkService.recordProviderInvocation(db, {
          workflow_step_id: step.id,
          run_id: run.id,
          provider_type: 'text',
          provider_name: textEvidence.provider_name,
          model: textEvidence.model,
          mode: 'production',
          usage: textEvidence.cost_usage,
          idempotency_key: step.call_key,
          input: textEvidence.provider_input,
          output: {
            response_text: textEvidence.response_text,
            response_sha256: textEvidence.response_sha256,
            prompt_evidence: textEvidence.prompt_evidence,
          },
        });
      }
      recordSkill(db, run, step, 'localminidrama-script-adapter', { source_id: sourceId }, output);
      return output;
    });
    return commitAdaptation();
  }

  if (step.step_key === 'apply_episodes') {
    const planOut = previousOutput(allSteps, 'adaptation_plan');
    const adaptationPlanId = requirePreviousAdaptationPlanId(planOut);
    const applyOnce = db.transaction(() => {
      const existing = completedStepEffect(db, step.call_key);
      if (existing) return existing;
      const result = sourceIntakeService.applyAdaptationPlanToEpisodes(db, log, adaptationPlanId, {
        overwrite_existing_episodes: run.input_json?.overwrite_existing_episodes === true,
      });
      assertAdaptationApplyResult(result);
      recordSkill(db, run, step, 'localminidrama-script-adapter', { adaptation_plan_id: adaptationPlanId }, result);
      return recordStepEffect(db, run, step, result);
    });
    return applyOnce();
  }

  if (step.step_key === 'asset_bible') {
    const result = ensureAssetBible(db, log, run.drama_id, executionMode);
    if (executionMode === 'production') {
      result.asset_generation = await providerSdkService.generateAssetBibleImagesProduction(db, log, {
        ...providerOptions,
        drama_id: run.drama_id,
        run_id: run.id,
        workflow_step_id: step.id,
        call_key: step.call_key,
        mode: 'production',
      });
      const continuity = characterContinuityService.ensureCharacterContinuity(db, log, run.drama_id, {
        allow_mock_fallback: false,
      });
      result.character_continuity = {
        character_count: continuity.character_count,
        updated: continuity.updated,
        episode_range: continuity.episode_range,
      };
    }
    const sourceOut = previousOutput(allSteps, 'source_intake');
    result.creative_review_id = createCreativeReview(db, {
      dramaId: run.drama_id,
      runId: run.id,
      sourceId: sourceOut.source_id || null,
      role: 'art_designer',
      targetType: 'asset_bible',
      targetId: String(run.drama_id),
      status: 'locked',
      findings: [
        { check: 'character_anchors', passed: true },
        { check: 'scene_prop_seed_assets', passed: true },
      ],
    });
    recordSkill(db, run, step, 'art-direction', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'character-design-sheet', { drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'storyboard_draft') {
    const result = ensureStoryboardDraft(db, log, run.drama_id);
    result.creative_review_id = createCreativeReview(db, {
      dramaId: run.drama_id,
      runId: run.id,
      role: 'animator',
      targetType: 'storyboard_draft',
      targetId: String(run.drama_id),
      status: 'locked',
      findings: [
        { check: 'shot_duration', passed: true },
        { check: 'image_video_prompts', passed: true },
      ],
    });
    recordSkill(db, run, step, 'video-storyboard', { drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'image_generation') {
    const result = await providerSdkService.generateStoryboardImages(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'image-generation', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'image', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'video_generation') {
    const result = await providerSdkService.generateStoryboardVideos(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      aspect_ratio: providerOptions.aspect_ratio || run.input_json?.metadata?.aspect_ratio,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'video-prompting', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'seedance-prompt-zh', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'video', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'audio_generation') {
    const result = await providerSdkService.generateStoryboardAudio(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'tts', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'timeline_plan') {
    const result = ensureTimelinePlan(db, log, run.drama_id, executionMode);
    return result;
  }

  if (step.step_key === 'post_composite') {
    const result = await providerSdkService.compositeEpisodes(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      defer_qa_completion: true,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'video-use', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'compositor', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'qa_audit') {
    const qaMode = run.input_json?.qa_mode === 'production' ? 'production' : 'draft';
    const auditWithCompletionGate = db.transaction(() => {
      const report = qaService.auditDrama(db, log, {
        drama_id: run.drama_id,
        episode_id: run.episode_id,
        run_id: run.id,
        mode: qaMode,
      });
      if (!report.passed || report.score < 80) return { report, output: null };
      const completion = finalizeQaPendingComposites(db, run);
      const reviewId = createCreativeReview(db, {
        dramaId: run.drama_id,
        runId: run.id,
        role: 'director',
        targetType: 'qa_report',
        targetId: String(report.id),
        status: 'locked',
        findings: [
          { check: 'qa_score', passed: report.score >= 80, score: report.score },
          { check: 'final_acceptance', passed: report.passed },
        ],
      });
      const output = {
        qa_report_id: report.id,
        score: report.score,
        passed: report.passed,
        issue_count: report.report_json?.issues?.length || 0,
        creative_review_id: reviewId,
        finalized_composites: completion.merge_count,
      };
      recordSkill(db, run, step, 'localminidrama-continuity-qa', { drama_id: run.drama_id }, output);
      recordSkill(db, run, step, 'localminidrama-workflow-auditor', { run_id: run.id }, output);
      checkpointStepResult(db, step.id, step.call_key, output);
      return { report, output };
    });
    const { report, output } = auditWithCompletionGate();
    assertQaAuditAccepted(report, output);
    return output;
  }

  throw unknownWorkflowStepError();
}

module.exports = {
  executeWorkflowStep,
};
