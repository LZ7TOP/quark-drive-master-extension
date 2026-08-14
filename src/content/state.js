/**
 * 面板全局运行时状态单例
 */

export const state = {
  pdir_fid: '0',
  breadcrumbs: [{ fid: '0', name: '全部文件' }],
  includeSubDirs: false,
  fileList: [],
  activeTab: 'replace',
  currentView: 'main',
  filterType: 'all',
  searchKeyword: '',
  sortBy: 'natural_asc',
  delayMs: 500,
  isRunning: false,
  fetchSeq: 0,
  config: {
    replaceSearch: '',
    replaceTarget: '',
    isRegex: false,
    ignoreCase: true,
    targetRange: 'name',
    prefix: '',
    suffix: '',
    numberTemplate: '文件_{n}',
    numberStart: 1,
    numberPad: 2,
    newExt: '',
    caseChange: 'none',
    cleanUrl: true,
    cleanBracket: true,
    cleanTrad: true
  }
};
