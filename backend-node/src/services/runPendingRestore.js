const { applyPendingRestore } = require('./backupSettingsService')

const paths = {
  databasePath: process.env.LOCALMINIDRAMA_RESTORE_DATABASE_PATH,
  storagePath: process.env.LOCALMINIDRAMA_RESTORE_STORAGE_PATH,
  storySourcesPath: process.env.LOCALMINIDRAMA_RESTORE_STORY_SOURCES_PATH,
}

if (!paths.databasePath || !paths.storagePath || !paths.storySourcesPath) {
  console.error('缺少待恢复路径')
  process.exit(1)
}

applyPendingRestore(paths)
  .then((result) => {
    if (result.applied) console.log(`applied pending restore: ${result.name}`)
    process.exit(0)
  })
  .catch((error) => {
    console.error(error?.publicMessage || error?.message || error)
    process.exit(1)
  })
