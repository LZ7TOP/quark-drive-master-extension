/**
 * 面板全局运行时状态单例
 */

export const state = {
  pdir_fid: '0',
  breadcrumbs: [{ fid: '0', name: '全部文件' }],
  mainMode: 'dir', // 'dir' 目录浏览 | 'search' 全盘搜索
  searchScope: 'local', // 'local' 当前过滤 | 'cloud' 全盘检索
  searchQuery: '',
  searchTotal: 0,
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
  account: {
    loading: false,
    loaded: false,
    loggedIn: false,
    nickname: '',
    member_type: 'NORMAL',
    use_capacity: 0,
    total_capacity: 0,
    exp_at: 0
  },
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
  },
  shares: {
    list: [],
    source: 'none',
    sourceLabel: '尚未加载分享列表',
    updatedAt: 0,
    filterStatus: 'all',
    filterPath: 'all',
    keyword: '',
    sortKey: 'created_at',
    sortDir: 'desc',
    fetchSeq: 0,
    isLoading: false,
    cacheLoaded: false
  }
};
