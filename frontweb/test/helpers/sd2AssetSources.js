/**
 * 认证资产管理拆分后的源文件，源码扫描测试应按整组读取。
 */
import { readFileSync } from 'node:fs'

const here = import.meta.url
const read = (rel) => readFileSync(new URL(rel, here), 'utf8').replace(/\r\n?/g, '\n')

export function readSd2AssetSources() {
  const parent = read('../../src/components/Sd2AssetManagement.vue')
  const groupList = read('../../src/components/sd2/Sd2AssetGroupList.vue')
  const assetList = read('../../src/components/sd2/Sd2AssetList.vue')
  const filter = read('../../src/components/sd2/Sd2AssetFilter.vue')
  const dialogs = read('../../src/components/sd2/Sd2AssetDialogs.vue')
  const intro = read('../../src/components/sd2/Sd2AssetIntro.vue')
  const connectionForm = read('../../src/components/sd2/Sd2AssetConnectionForm.vue')
  const lastResponse = read('../../src/components/sd2/Sd2AssetLastResponse.vue')
  return {
    parent,
    groupList,
    assetList,
    filter,
    dialogs,
    intro,
    connectionForm,
    lastResponse,
    combined: [parent, groupList, assetList, filter, dialogs, intro, connectionForm, lastResponse].join('\n'),
  }
}
