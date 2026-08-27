const response = require('../response');

function list(db, log) {
  return (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM ai_model_map ORDER BY key').all();
      response.success(res, rows);
    } catch (err) {
      log.error('List scene model map failed', { error: err.message });
      response.internalError(res, '获取场景模型映射失败');
    }
  };
}

function get(db, log) {
  return (req, res) => {
    const { key } = req.params;
    try {
      const row = db.prepare('SELECT * FROM ai_model_map WHERE key = ?').get(key);
      if (!row) {
        return response.notFound(res, '场景模型映射不存在');
      }
      response.success(res, row);
    } catch (err) {
      log.error('Get scene model map failed', { error: err.message, key });
      response.internalError(res, '获取场景模型映射失败');
    }
  };
}

function bindingValidationError(message, details) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'INVALID_SCENE_MODEL_MAPPING';
  error.details = details;
  return error;
}

function validateModelBinding(db, serviceType, configId, modelOverride) {
  const normalizedServiceType = String(serviceType || 'text').trim() || 'text';
  const normalizedOverride = modelOverride == null ? '' : String(modelOverride).trim();
  let selectedConfig = null;
  if (configId != null && configId !== '') {
    const numericId = Number(configId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw bindingValidationError('AI 配置 ID 无效', { field: 'config_id', issue: 'invalid' });
    }
    selectedConfig = db.prepare(
      'SELECT id, service_type, is_active, model, default_model FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL'
    ).get(numericId);
    if (!selectedConfig) {
      throw bindingValidationError('指定的 AI 配置不存在', { field: 'config_id', issue: 'not_found' });
    }
    if (String(selectedConfig.service_type) !== normalizedServiceType) {
      throw bindingValidationError('AI 配置与场景服务类型不一致', {
        field: 'config_id',
        issue: 'service_type_mismatch',
      });
    }
    if (!selectedConfig.is_active) {
      throw bindingValidationError('指定的 AI 配置未启用', { field: 'config_id', issue: 'inactive' });
    }
    if (normalizedOverride) {
      const models = require('../services/aiConfigService').normalizeConfigModels({
        model: selectedConfig.model,
        default_model: selectedConfig.default_model,
      }).model;
      if (!models.includes(normalizedOverride)) {
        throw bindingValidationError('模型不属于所选 AI 配置', {
          field: 'model_override',
          issue: 'not_in_config_model_list',
        });
      }
    }
  } else if (normalizedOverride) {
    const aiConfigService = require('../services/aiConfigService');
    const matches = aiConfigService.listConfigs(db, normalizedServiceType)
      .filter((config) => config.is_active)
      .filter((config) => aiConfigService.normalizeConfigModels(config).model.includes(normalizedOverride));
    if (matches.length === 0) {
      throw bindingValidationError('模型不属于当前服务类型的启用配置', {
        field: 'model_override',
        issue: 'not_found',
      });
    }
    if (matches.length > 1) {
      throw bindingValidationError('该模型对应多个厂商，请先选择具体 AI 配置', {
        field: 'config_id',
        issue: 'ambiguous_model_provider',
      });
    }
    selectedConfig = matches[0];
  }
  return {
    serviceType: normalizedServiceType,
    configId: selectedConfig ? Number(selectedConfig.id) : null,
    modelOverride: normalizedOverride || null,
  };
}

function create(db, log) {
  return (req, res) => {
    const body = req.body || {};
    const { key, service_type = 'text', config_id, model_override, description } = body;
    
    if (!key) {
      return response.badRequest(res, '缺少必填字段: key');
    }
    
    const now = new Date().toISOString();
    try {
      const binding = validateModelBinding(db, service_type, config_id, model_override);
      // 检查 key 是否已存在
      const existing = db.prepare('SELECT id FROM ai_model_map WHERE key = ?').get(key);
      if (existing) {
        return response.badRequest(res, '场景键已存在');
      }
      
      const result = db.prepare(`
        INSERT INTO ai_model_map (key, service_type, config_id, model_override, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(key, binding.serviceType, binding.configId, binding.modelOverride, description || '', now, now);
      
      const row = db.prepare('SELECT * FROM ai_model_map WHERE id = ?').get(result.lastInsertRowid);
      response.created(res, row);
    } catch (err) {
      log.error('Create scene model map failed', { error: err.message, key });
      if (err.status === 400) return response.error(res, 400, err.code, err.message, err.details);
      response.internalError(res, '创建场景模型映射失败');
    }
  };
}

function update(db, log) {
  return (req, res) => {
    const { key } = req.params;
    const body = req.body || {};
    const { service_type, config_id, model_override, description } = body;
    
    const now = new Date().toISOString();
    try {
      const existing = db.prepare('SELECT id, service_type, config_id, model_override FROM ai_model_map WHERE key = ?').get(key);
      if (!existing) {
        return response.notFound(res, '场景模型映射不存在');
      }

      const binding = validateModelBinding(
        db,
        service_type !== undefined ? service_type : existing.service_type,
        config_id !== undefined ? config_id : existing.config_id,
        model_override !== undefined ? model_override : existing.model_override,
      );
      
      db.prepare(`
        UPDATE ai_model_map 
        SET service_type = ?, config_id = ?, model_override = ?, description = ?, updated_at = ?
        WHERE key = ?
      `).run(
        binding.serviceType,
        binding.configId,
        binding.modelOverride,
        description !== undefined ? description : '',
        now,
        key
      );
      
      const row = db.prepare('SELECT * FROM ai_model_map WHERE key = ?').get(key);
      response.success(res, row);
    } catch (err) {
      log.error('Update scene model map failed', { error: err.message, key });
      if (err.status === 400) return response.error(res, 400, err.code, err.message, err.details);
      response.internalError(res, '更新场景模型映射失败');
    }
  };
}

function remove(db, log) {
  return (req, res) => {
    const { key } = req.params;
    try {
      const existing = db.prepare('SELECT id FROM ai_model_map WHERE key = ?').get(key);
      if (!existing) {
        return response.notFound(res, '场景模型映射不存在');
      }
      
      db.prepare('DELETE FROM ai_model_map WHERE key = ?').run(key);
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('Delete scene model map failed', { error: err.message, key });
      response.internalError(res, '删除场景模型映射失败');
    }
  };
}

module.exports = function sceneModelMapRoutes(db, log) {
  return {
    list: list(db, log),
    get: get(db, log),
    create: create(db, log),
    update: update(db, log),
    delete: remove(db, log)
  };
};
