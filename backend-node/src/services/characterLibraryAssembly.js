/**
 * 角色库行装配：把数据库行转成接口对象，并补齐图片 URL。
 * 路由仍通过 characterLibraryService 调用，本模块不改变公开 API。
 */

/** local_path -> image_url 兜底：避免旧库 NOT NULL 约束报错 */
function resolveImageUrl(imageUrl, localPath) {
  if (imageUrl && !imageUrl.startsWith('data:')) return imageUrl;
  if (localPath) return `/static/${localPath}`;
  return imageUrl || null;
}

function rowToItem(row) {
  return {
    id: row.id,
    drama_id: row.drama_id ?? null,
    name: row.name,
    category: row.category,
    image_url: row.image_url,
    local_path: row.local_path,
    description: row.description,
    tags: row.tags,
    source_type: row.source_type || 'generated',
    source_id: row.source_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  resolveImageUrl,
  rowToItem,
};