'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_USER_DATA_DIRECTORY = 'LocalMiniDrama';

function planLegacyUserDataMigration(options) {
  const source = path.resolve(
    options.legacyUserDataDir || path.join(options.appDataDir, LEGACY_USER_DATA_DIRECTORY)
  );
  const destination = path.resolve(options.userDataDir);

  if (source === destination) {
    return { source, destination, shouldMigrate: false, reason: 'same-directory' };
  }
  if (!options.legacyExists) {
    return { source, destination, shouldMigrate: false, reason: 'legacy-missing' };
  }
  if (options.destinationExists) {
    return { source, destination, shouldMigrate: false, reason: 'destination-exists' };
  }
  return { source, destination, shouldMigrate: true, reason: 'ready' };
}

function migrateLegacyUserData(options) {
  const fileSystem = options.fileSystem || fs;
  const preliminary = planLegacyUserDataMigration({
    ...options,
    legacyExists: false,
    destinationExists: false,
  });
  const plan = planLegacyUserDataMigration({
    ...options,
    legacyUserDataDir: preliminary.source,
    legacyExists: fileSystem.existsSync(preliminary.source),
    destinationExists: fileSystem.existsSync(preliminary.destination),
  });

  if (!plan.shouldMigrate) return { ...plan, migrated: false };

  try {
    fileSystem.renameSync(plan.source, plan.destination);
    return { ...plan, migrated: true, reason: 'migrated' };
  } catch (error) {
    return { ...plan, migrated: false, reason: 'rename-failed', error };
  }
}

module.exports = {
  LEGACY_USER_DATA_DIRECTORY,
  migrateLegacyUserData,
  planLegacyUserDataMigration,
};
