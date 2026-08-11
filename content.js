/**
 * 夸克网盘全能管理工具 - Content Script (v3.0.0 整合全能版)
 * 包含批量重命名、行内快捷保存、文件删除、新建文件夹、CSV 协同与历史撤销
 */

(function () {
  if (window.__QUARK_RENAME_ASSISTANT_LOADED__) return;
  window.__QUARK_RENAME_ASSISTANT_LOADED__ = true;

  const ICONS = {
    zap: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>`,
    log: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`,
    info: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
    check: `<svg class="qr-icon" viewBox="0 0 24 24" style="fill:#3b82f6;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    edit: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    refresh: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    target: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
    history: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>`,
    csv: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm1 10h-2.5v2.5L11 14.5V12H8.5V9.5L10 9.5V12h2.5v-2.5l1.5 0V12zm-3-7V3.5L17.5 9H12z"/></svg>`,
    folder: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
    trash: '<svg class="qr-icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    file: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
    clock: `<svg class="qr-icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
    arrowRight: `<svg class="qr-icon" style="fill: #60a5fa;" viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>`
  };

  const TRAD_SIMP_MAP = {
    '戀': '恋', '愛': '爱', '視': '视', '頻': '频', '劇': '剧', '集': '集', '動': '动', '畫': '画',
    '漫': '漫', '國': '国', '語': '语', '華': '华', '電': '电', '影': '影', '驚': '惊', '悚': '悚',
    '懸': '悬', '疑': '疑', '喜': '喜', '科': '科', '幻': '幻', '錄': '录', '像': '像', '廣': '广',
    '東': '东', '話': '话', '關': '关', '開': '开', '發': '发', '轉': '转', '換': '换', '線': '线',
    '組': '组', '無': '无', '網': '网', '盤': '盘', '劃': '划', '報': '报'
  };

  const state = {
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

  async function fetchJsonData(relativePath) {
    try {
      const url = chrome.runtime.getURL(relativePath);
      const resp = await fetch(url);
      return await resp.json();
    } catch (e) {
      console.warn('[Quark Rename] 读取 JSON 数据失败:', relativePath, e);
      return null;
    }
  }

  function init() {
    createFloatButton();
    createModalUI();
    bindEvents();
    parseUrlAndSyncState();

    window.addEventListener('hashchange', () => {
      parseUrlAndSyncState();
      const modal = document.getElementById('qrModalOverlay');
      if (modal && modal.classList.contains('active')) {
        fetchFileList();
      }
    });
  }

  function createFloatButton() {
    if (document.getElementById('quark-rename-float-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'quark-rename-float-btn';
    btn.innerHTML = `${ICONS.zap} 夸克全能工具`;
    btn.addEventListener('click', () => openModal());
    document.body.appendChild(btn);
  }

  function parseUrlAndSyncState() {
    try {
      const fullUrl = window.location.href;
      const crumbs = [{ fid: '0', name: '全部文件' }];
      let targetFid = '0';

      const hashStr = window.location.hash || window.location.pathname;
      const segments = hashStr.split('/');

      segments.forEach((seg) => {
        if (!seg) return;
        const match = seg.match(/^([a-f0-9]{32})(?:-(.*))?$/i);
        if (match) {
          const fid = match[1];
          let name = '文件夹';
          if (match[2]) {
            try {
              name = decodeURIComponent(match[2]);
            } catch (e) {
              name = match[2];
            }
          }
          crumbs.push({ fid, name });
          targetFid = fid;
        }
      });

      const urlObj = new URL(fullUrl);
      const searchFid = urlObj.searchParams.get('pdir_fid') || urlObj.searchParams.get('fid');
      if (searchFid && targetFid === '0') {
        targetFid = searchFid;
        crumbs.push({ fid: searchFid, name: '当前目录' });
      }

      state.pdir_fid = targetFid;
      state.breadcrumbs = crumbs;

      const fidInput = document.getElementById('qrFidInput');
      if (fidInput) fidInput.value = state.pdir_fid;

      renderBreadcrumbs();
    } catch (e) {
      console.warn('[Quark Rename] 解析 URL 异常:', e);
    }
  }

  function createModalUI() {
    if (document.getElementById('qrModalOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'qrModalOverlay';
    overlay.className = 'qr-modal-overlay';

    overlay.innerHTML = `
      <div class="qr-modal-card">
        <input type="file" id="qrCsvFileInput" accept=".csv" style="display: none;">

        <div class="qr-header">
          <!-- 第一排：LOGO 名称 + FID + 工具控制按键 + 关闭按键 -->
          <div class="qr-header-top">
            <div class="qr-brand">
              <h2>${ICONS.edit} 夸克网盘全能管理工具</h2>
            </div>
            <div class="qr-header-actions">
              <div class="qr-fid-box">
                <span>FID:</span>
                <input type="text" id="qrFidInput" class="qr-fid-input" placeholder="目录 FID">
              </div>
              <button id="qrMkdirBtn" class="qr-btn-tool qr-btn-blue" title="在当前目录下新建文件夹">${ICONS.folder} 新建文件夹</button>
              <button id="qrHistoryBtn" class="qr-btn-tool qr-btn-purple" title="历史记录与一键撤销">${ICONS.history} 撤销历史</button>
              <button id="qrRefreshBtn" class="qr-btn-tool qr-btn-blue">${ICONS.refresh} 加载目录</button>
              <button id="qrCloseBtn" class="qr-close-btn">&times;</button>
            </div>
          </div>

          <!-- 第二排：Tab 导航页签组 -->
          <div class="qr-header-bottom">
            <div class="qr-page-nav">
              <button class="qr-nav-item active" data-view="main">${ICONS.zap} 重命名主页</button>
              <button class="qr-nav-item" data-view="csv">${ICONS.csv} CSV 工具</button>
              <button class="qr-nav-item" data-view="changelog">${ICONS.log} 更新日志</button>
              <button class="qr-nav-item" data-view="about">${ICONS.info} 关于项目</button>
            </div>
          </div>
        </div>

        <div class="qr-body">
          <div id="viewMain" class="qr-page-view"></div>
          <div id="viewCsv" class="qr-page-view hidden"></div>
          <div id="viewChangelog" class="qr-page-view hidden"></div>
          <div id="viewAbout" class="qr-page-view hidden"></div>
        </div>

        <div class="qr-footer">
          <div id="qrProgressBarWrap" class="qr-progress-bar-wrap">
            <div id="qrProgressBarInner" class="qr-progress-bar-inner"></div>
          </div>
          <div id="qrLogBox" class="qr-log-box"></div>
          <div class="qr-footer-actions">
            <div class="qr-delay-setting">
              <label>请求间隔(ms):</label>
              <input type="number" id="qrDelayInput" class="qr-input" value="500" min="100" max="3000" style="width: 75px; padding: 3px 6px;">
              <span style="font-size: 11px; color: #71717a;">(推荐500ms)</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span id="qrStatText" style="font-size: 12px; color: #a1a1aa;">共 0 项文件</span>
              <button id="qrDeleteBtn" class="qr-btn-primary qr-btn-red">${ICONS.trash} 批量删除选中</button>
              <button id="qrStartBtn" class="qr-btn-primary">${ICONS.zap} 开始批量重命名</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    renderMainViewComponent();
    renderCsvViewComponent();
    loadAndRenderChangelogComponent();
    loadAndRenderAboutComponent();
  }

  function bindCustomSelects() {
    document.querySelectorAll('.qr-custom-select-wrap').forEach((wrap) => {
      const trigger = wrap.querySelector('.qr-custom-select-trigger');
      const dropdown = wrap.querySelector('.qr-custom-dropdown');
      const valSpan = wrap.querySelector('.qr-custom-val');

      if (!trigger || !dropdown) return;

      trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.qr-custom-select-wrap').forEach((w) => {
          if (w !== wrap) w.classList.remove('active');
        });
        wrap.classList.toggle('active');
      };

      dropdown.querySelectorAll('.qr-dropdown-option').forEach((option) => {
        option.onclick = (e) => {
          e.stopPropagation();
          const val = option.dataset.value;
          const label = option.textContent;

          wrap.dataset.value = val;
          if (valSpan) valSpan.textContent = label;

          dropdown.querySelectorAll('.qr-dropdown-option').forEach((o) => o.classList.remove('selected'));
          option.classList.add('selected');
          wrap.classList.remove('active');

          updateConfigFromUI();
        };
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.qr-custom-select-wrap').forEach((w) => w.classList.remove('active'));
    });
  }

  function buildCustomSelectHTML(id, options, defaultVal, extraStyle = '') {
    const selectedOpt = options.find((o) => o.value === defaultVal) || options[0];
    const optionsHtml = options
      .map(
        (o) => `
      <div class="qr-dropdown-option ${o.value === selectedOpt.value ? 'selected' : ''}" data-value="${o.value}">${escapeHtml(o.label)}</div>
    `
      )
      .join('');

    return `
      <div class="qr-custom-select-wrap" id="${id}" data-value="${selectedOpt.value}" style="${extraStyle}">
        <div class="qr-custom-select-trigger">
          <span class="qr-custom-val">${escapeHtml(selectedOpt.label)}</span>
          <svg class="qr-arrow" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
        </div>
        <div class="qr-custom-dropdown">
          ${optionsHtml}
        </div>
      </div>
    `;
  }

  function renderMainViewComponent() {
    const mainViewEl = document.getElementById('viewMain');
    if (!mainViewEl) return;

    const targetRangeSelectHtml = buildCustomSelectHTML('qrTargetRange', [
      { value: 'name', label: '仅主文件名' },
      { value: 'ext', label: '仅扩展名' },
      { value: 'all', label: '完整文件名' }
    ], 'name');

    const caseChangeSelectHtml = buildCustomSelectHTML('qrCaseChange', [
      { value: 'none', label: '保持原样' },
      { value: 'lower', label: '转换为小写 (lowercase)' },
      { value: 'upper', label: '转换为大写 (UPPERCASE)' }
    ], 'none');

    const sortBySelectHtml = buildCustomSelectHTML('qrSortBySelect', [
      { value: 'natural_asc', label: '自然数字升序 (1,2,10)' },
      { value: 'natural_desc', label: '自然数字降序 (10,2,1)' },
      { value: 'name_asc', label: '文件名 A ➔ Z 升序' },
      { value: 'name_desc', label: '文件名 Z ➔ A 降序' },
      { value: 'size_asc', label: '文件大小升序' },
      { value: 'size_desc', label: '文件大小降序' }
    ], 'natural_asc', 'min-width: 155px;');

    mainViewEl.innerHTML = `
      <div id="qrBreadcrumbsBar" class="qr-breadcrumbs-bar"></div>

      <div class="qr-controls-header">
        <div class="qr-tabs">
          <button class="qr-tab-btn active" data-tab="replace">查找与替换</button>
          <button class="qr-tab-btn" data-tab="prefix">添加前后缀</button>
          <button class="qr-tab-btn" data-tab="numbering">智能序号</button>
          <button class="qr-tab-btn" data-tab="extension">扩展名与大小写</button>
          <button class="qr-tab-btn" data-tab="clean">一键净化清洗</button>
        </div>
      </div>

      <div id="qrConfigPanel" class="qr-config-panel">
        <div id="panelReplace" class="qr-panel-content">
          <div class="qr-input-row">
            <div class="qr-input-group" style="flex: 2;">
              <label>查找:</label>
              <input type="text" id="qrSearchInput" class="qr-input" placeholder="查找的文本或正则表达式">
            </div>
            <div class="qr-input-group" style="flex: 2;">
              <label>替换为:</label>
              <input type="text" id="qrReplaceInput" class="qr-input" placeholder="替换文本 (正则支持 $1, $2)">
            </div>
            <div class="qr-input-group" style="flex: 1.2; min-width: 150px;">
              <label>作用范围:</label>
              ${targetRangeSelectHtml}
            </div>
          </div>
          <div class="qr-input-row" style="margin-top: 6px;">
            <label class="qr-checkbox-label">
              <input type="checkbox" id="qrIsRegex"> 正则表达式
            </label>
            <label class="qr-checkbox-label" style="margin-left: 12px;">
              <input type="checkbox" id="qrIgnoreCase" checked> 忽略大小写
            </label>
          </div>
        </div>

        <div id="panelPrefix" class="qr-panel-content" style="display: none;">
          <div class="qr-input-row">
            <div class="qr-input-group">
              <label>添加前缀:</label>
              <input type="text" id="qrPrefixInput" class="qr-input" placeholder="最前面加入的文本">
            </div>
            <div class="qr-input-group">
              <label>添加后缀:</label>
              <input type="text" id="qrSuffixInput" class="qr-input" placeholder="扩展名前面加入的文本">
            </div>
          </div>
        </div>

        <div id="panelNumbering" class="qr-panel-content" style="display: none;">
          <div class="qr-input-row">
            <div class="qr-input-group" style="flex: 2;">
              <label>命名模板:</label>
              <input type="text" id="qrNumTemplate" class="qr-input" value="文件_{n}" placeholder="使用 {n} 递增数字">
            </div>
            <div class="qr-input-group">
              <label>起始数字:</label>
              <input type="number" id="qrNumStart" class="qr-input" value="1" min="0" style="width: 75px;">
            </div>
            <div class="qr-input-group">
              <label>位数补零:</label>
              <input type="number" id="qrNumPad" class="qr-input" value="2" min="1" max="6" style="width: 75px;">
            </div>
          </div>
        </div>

        <div id="panelExtension" class="qr-panel-content" style="display: none;">
          <div class="qr-input-row">
            <div class="qr-input-group">
              <label>修改后缀:</label>
              <input type="text" id="qrNewExtInput" class="qr-input" placeholder="如 mkv (留空保持原后缀)">
            </div>
            <div class="qr-input-group">
              <label>字母大小写:</label>
              ${caseChangeSelectHtml}
            </div>
          </div>
        </div>

        <div id="panelClean" class="qr-panel-content" style="display: none;">
          <div class="qr-input-row">
            <label class="qr-checkbox-label">
              <input type="checkbox" id="qrCleanUrl" checked> 清理广告网址域名 (如 www.xxx.com)
            </label>
            <label class="qr-checkbox-label" style="margin-left: 12px;">
              <input type="checkbox" id="qrCleanBracket" checked> 移除中括号/宣发后缀 (如 [最新发布])
            </label>
            <label class="qr-checkbox-label" style="margin-left: 12px;">
              <input type="checkbox" id="qrCleanTrad" checked> 繁体中文转简体中文 (如 戀愛 ➔ 恋爱)
            </label>
          </div>
        </div>
      </div>

      <div class="qr-filter-bar">
        <div class="qr-type-filters">
          <span class="qr-chip active" data-type="all">全部</span>
          <span class="qr-chip" data-type="video">视频</span>
          <span class="qr-chip" data-type="audio">音频</span>
          <span class="qr-chip" data-type="image">图片</span>
          <span class="qr-chip" data-type="doc">文档</span>
          <span class="qr-chip" data-type="dir">文件夹</span>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button id="qrFetchSelectedBtn" class="qr-btn-tool qr-btn-green" style="height: 26px; padding: 0 8px;" title="抓取夸克网页中选中的文件">${ICONS.target} 抓取选中</button>
          <div style="display: flex; align-items: center; gap: 4px;">
            <label style="font-size: 11px; color: #a1a1aa; white-space: nowrap;">排序:</label>
            ${sortBySelectHtml}
          </div>

          <label class="qr-checkbox-label" style="color: #a1a1aa; font-weight: 500;" title="深度递归获取当前目录下所有子文件夹里面的文件">
            <input type="checkbox" id="qrIncludeSubDirs"> 递归所有子目录
          </label>
          <input type="text" id="qrKeywordInput" class="qr-input" placeholder="搜索过滤..." style="padding: 2px 6px; font-size: 11px; width: 100px; height: 26px;">
        </div>
      </div>

      <div class="qr-table-wrap">
        <table class="qr-table">
          <thead>
            <tr>
              <th style="width: 36px; text-align: center;"><input type="checkbox" id="qrSelectAll" checked></th>
              <th style="width: 38%;">原文件名 (点击文件夹进入)</th>
              <th style="width: 42%;">修改后名称 (可直接编辑)</th>
              <th style="width: 20%;">状态</th>
            </tr>
          </thead>
          <tbody id="qrTableBody">
            <tr>
              <td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">点击“加载目录”开始读取...</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function renderCsvViewComponent() {
    const csvViewEl = document.getElementById('viewCsv');
    if (!csvViewEl) return;

    const sampleRowsHtml = [
      { old: '01.狂飙.1080p.mp4', new: '狂飙.EP01.1080p.mp4', fid: '660c84cabb4240afb1ec96fa134c3334' },
      { old: '02.狂飙.1080p.mp4', new: '狂飙.EP02.1080p.mp4', fid: '67b1755c9b3e407e84eec16e544dff83' },
      { old: '广告宣发图片.jpg', new: '封面图.jpg', fid: '67b290ac71c210abef912093102ef101' }
    ]
      .map(
        (r) => `
      <tr>
        <td style="color: #a1a1aa;">${escapeHtml(r.old)}</td>
        <td style="color: #22c55e; font-weight: 500;">${escapeHtml(r.new)}</td>
        <td style="color: #60a5fa; font-family: monospace; font-size: 11px;">${escapeHtml(r.fid)}</td>
      </tr>
    `
      )
      .join('');

    csvViewEl.innerHTML = `
      <div class="qr-page-container" style="display: flex; flex-direction: column; gap: 14px;">
        <div style="background: #18181b; padding: 14px; border-radius: 8px; border: 1px solid #27272a;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h3 style="margin: 0; font-size: 14px; color: #fbbf24; display: flex; align-items: center; gap: 6px;">
              ${ICONS.csv} 规范 CSV 格式结构标准 (Standard Specification)
            </h3>
            <div style="display: flex; gap: 8px;">
              <button id="qrExportCsvBtnPage" class="qr-btn-tool qr-btn-amber">
                ${ICONS.csv} 导出当前目录 CSV 清单
              </button>
              <button id="qrImportCsvBtnPage" class="qr-btn-tool qr-btn-amber">
                ${ICONS.csv} 导入 CSV 映射表并覆盖
              </button>
            </div>
          </div>
          <p style="margin: 0; font-size: 12px; color: #a1a1aa; line-height: 1.5;">
            您可以直接导出 CSV 文件在 <b>Excel / WPS / 文本编辑器</b> 中批量处理，处理完成后导入回插件即可秒级生效！
          </p>
        </div>

        <div style="background: #18181b; padding: 12px; border-radius: 8px; border: 1px solid #27272a;">
          <div style="font-size: 12px; font-weight: 600; color: #ffffff; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 3px; height: 12px; background: #fbbf24; border-radius: 2px;"></span>
            标准 CSV 列名规范与示范数据
          </div>
          <table class="qr-table" style="font-size: 12px;">
            <thead>
              <tr style="background: #09090b;">
                <th style="width: 35%;">列1: 原文件名 (file_name)</th>
                <th style="width: 35%;">列2: 修改后名称 (new_name)</th>
                <th style="width: 30%;">列3: 文件FID (fid)</th>
              </tr>
            </thead>
            <tbody>
              ${sampleRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    setTimeout(() => {
      const exportBtn = document.getElementById('qrExportCsvBtnPage');
      const importBtn = document.getElementById('qrImportCsvBtnPage');
      const fileInput = document.getElementById('qrCsvFileInput');

      if (exportBtn) exportBtn.onclick = exportCsvMapping;
      if (importBtn && fileInput) importBtn.onclick = () => fileInput.click();
    }, 50);
  }

  const DEFAULT_CHANGELOG_DATA = [
    {
      version: "v1.5.3",
      date: "2026-08-10",
      tag: "溢出滚动与布局修复",
      changes: [
        "<b>修复更新日志溢出隐藏</b>：重构 `.qr-page-view` 的 flex 继承与独立 overflow-y 滚动规则，解决由于容器高度缺乏导致的日志卡片全部消失空白问题。",
        "<b>极速渲染与即时加载</b>：增强更新日志数据渲染速度，保障导航切换与弹窗打开时 100% 秒开。"
      ]
    },
    {
      version: "v1.5.2",
      date: "2026-08-10",
      tag: "布局与转义双修复",
      changes: [
        "<b>更新日志 HTML 标签转义</b>：彻底修复日志数据中 select 被浏览器误渲染为真实输入框的显示错误。",
        "<b>Header 顶栏单行强防挤压</b>：修复因 FID 较长导致右侧关闭按钮 (×) 被挤压折行落到第二行的布局问题。"
      ]
    },
    {
      version: "v1.5.1",
      date: "2026-08-10",
      tag: "精美图标与日志修复版",
      changes: [
        "<b>更新日志实时展示与双重兜底</b>：解决特定视图下日志无法显示的异常，并增加即时渲染引擎。",
        "<b>图标全量矢量化</b>：全量淘汰 Emoji 表情符号，采用标准的纯矢量 SVG 图标提升UI精致度。"
      ]
    },
    {
      version: "v1.5.0",
      date: "2026-08-10",
      tag: "架构与UI重磅更新",
      changes: [
        "<b>新增 content_scripts 自动注入规则</b>：进入夸克网盘任意页面，右下角将 100% 自动悬挂主按钮。",
        "<b>纯手写 CustomSelect 替换</b>：彻底移除了原生 select 标签，全量渲染为纯手写扁平悬浮组件。"
      ]
    },
    {
      version: "v1.4.3",
      date: "2026-08-10",
      tag: "视觉与体验优化",
      changes: [
        "<b>更新日志排版美化</b>：全新卡片式时间线重构，提升视觉层次、卡片边框与标签对比度。",
        "<b>官方团队与链接关联</b>：关于页面与工作室品牌全量植入官方 GitHub 地址。"
      ]
    }
  ];

  async function loadAndRenderChangelogComponent() {
    const containerEl = document.getElementById('viewChangelog');
    if (!containerEl) return;

    let data = await fetchJsonData('data/changelog.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
      data = DEFAULT_CHANGELOG_DATA;
    }

    const itemsHtml = data
      .map((item) => `
        <div class="qr-timeline-item">
          <div class="qr-timeline-header">
            <span class="qr-version-badge">${ICONS.log} ${escapeHtml(item.version)}</span>
            <span class="qr-tag-badge">${escapeHtml(item.tag)}</span>
            <span class="qr-timeline-date">${escapeHtml(item.date)}</span>
          </div>
          <ul class="qr-timeline-list">
            ${item.changes.map((c) => `<li><svg class="qr-change-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> <span>${c}</span></li>`).join('')}
          </ul>
        </div>
      `)
      .join('');

    containerEl.innerHTML = `
      <div class="qr-page-container">
        <div class="qr-timeline">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  async function loadAndRenderAboutComponent() {
    const containerEl = document.getElementById('viewAbout');
    if (!containerEl) return;

    const data = await fetchJsonData('data/about.json');
    if (!data) {
      containerEl.innerHTML = `<div class="qr-page-container" style="color:#ef4444;">加载关于数据失败</div>`;
      return;
    }

    const featuresHtml = data.features
      .map((f) => {
        let iconSvg = ICONS.zap;
        if (f.icon === 'folder') iconSvg = ICONS.folder;
        if (f.icon === 'history') iconSvg = ICONS.history;
        if (f.icon === 'trash') iconSvg = ICONS.trash;
        if (f.icon === 'table') iconSvg = ICONS.csv;

        return `
        <div class="qr-feature-card">
          <h4 style="display: flex; align-items: center; gap: 6px;">${iconSvg} ${escapeHtml(f.title)}</h4>
          <p>${escapeHtml(f.desc)}</p>
        </div>
      `;
      })
      .join('');

    const githubUrl = data.project.url || 'https://github.com/LZ7TOP';

    containerEl.innerHTML = `
      <div class="qr-page-container">
        <div class="qr-about-hero">
          <img src="${chrome.runtime.getURL('icons/icon-48.png')}" alt="Logo" style="width: 48px; height: 48px;">
          <div>
            <h3>${escapeHtml(data.project.name)} v${escapeHtml(data.project.version)}</h3>
            <p>
              Developed with ❤️ by
              <a href="${escapeHtml(githubUrl)}" target="_blank" class="qr-author-link">${escapeHtml(data.project.author)}</a>
              · Chrome Extension (${escapeHtml(data.project.license)})
            </p>
            <p style="margin-top: 4px; font-size: 11px;">
              官方地址: <a href="${escapeHtml(githubUrl)}" target="_blank" class="qr-author-link">${escapeHtml(githubUrl)}</a>
            </p>
          </div>
        </div>

        <div class="qr-feature-grid">
          ${featuresHtml}
        </div>
      </div>
    `;
  }

  function switchPageView(pageId) {
    state.currentView = pageId;

    document.querySelectorAll('.qr-nav-item[data-view]').forEach((btn) => {
      if (btn.dataset.view === pageId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.getElementById('viewMain').classList.toggle('hidden', pageId !== 'main');
    document.getElementById('viewCsv').classList.toggle('hidden', pageId !== 'csv');
    document.getElementById('viewChangelog').classList.toggle('hidden', pageId !== 'changelog');
    document.getElementById('viewAbout').classList.toggle('hidden', pageId !== 'about');

    if (pageId === 'changelog') {
      loadAndRenderChangelogComponent();
    } else if (pageId === 'about') {
      loadAndRenderAboutComponent();
    }
  }

  function renderBreadcrumbs() {
    const bar = document.getElementById('qrBreadcrumbsBar');
    if (!bar) return;

    if (state.breadcrumbs.length === 0) {
      state.breadcrumbs = [{ fid: state.pdir_fid, name: '当前目录' }];
    }

    bar.innerHTML = state.breadcrumbs
      .map((crumb, idx) => {
        const isLast = idx === state.breadcrumbs.length - 1;
        if (isLast) {
          return `<span class="qr-crumb-item current">${escapeHtml(crumb.name)}</span>`;
        }
        return `
        <span class="qr-crumb-item" data-fid="${crumb.fid}" data-idx="${idx}">${escapeHtml(crumb.name)}</span>
        <span class="qr-crumb-sep">/</span>
      `;
      })
      .join('');

    bar.querySelectorAll('.qr-crumb-item[data-fid]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const targetFid = e.currentTarget.dataset.fid;
        const targetIdx = parseInt(e.currentTarget.dataset.idx);

        state.pdir_fid = targetFid;
        state.breadcrumbs = state.breadcrumbs.slice(0, targetIdx + 1);

        const fidInput = document.getElementById('qrFidInput');
        if (fidInput) fidInput.value = state.pdir_fid;

        renderBreadcrumbs();
        fetchFileList();
      });
    });
  }

  function bindEvents() {
    const overlay = document.getElementById('qrModalOverlay');
    const closeBtn = document.getElementById('qrCloseBtn');
    const refreshBtn = document.getElementById('qrRefreshBtn');
    const fetchSelectedBtn = document.getElementById('qrFetchSelectedBtn');
    const historyBtn = document.getElementById('qrHistoryBtn');
    const exportCsvBtnPage = document.getElementById('qrExportCsvBtnPage');
    const importCsvBtnPage = document.getElementById('qrImportCsvBtnPage');
    const csvFileInput = document.getElementById('qrCsvFileInput');
    const fidInput = document.getElementById('qrFidInput');
    const includeSubDirsCb = document.getElementById('qrIncludeSubDirs');
    const sortBySelect = document.getElementById('qrSortBySelect');
    const selectAllCb = document.getElementById('qrSelectAll');
    const startBtn = document.getElementById('qrStartBtn');

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.querySelectorAll('.qr-nav-item[data-view]').forEach((navBtn) => {
      navBtn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        switchPageView(view);
      });
    });

    historyBtn.addEventListener('click', openHistoryModal);

    exportCsvBtnPage.addEventListener('click', exportCsvMapping);
    importCsvBtnPage.addEventListener('click', () => csvFileInput.click());

    csvFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importCsvMapping(e.target.files[0]);
        e.target.value = '';
      }
    });

    fidInput.addEventListener('change', (e) => {
      state.pdir_fid = e.target.value.trim();
      state.breadcrumbs = [{ fid: state.pdir_fid, name: `FID:${state.pdir_fid}` }];
      renderBreadcrumbs();
    });

    includeSubDirsCb.addEventListener('change', (e) => {
      state.includeSubDirs = e.target.checked;
    });

    sortBySelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      sortFileList();
      recalculateNewNames();
    });

    refreshBtn.addEventListener('click', () => {
      state.pdir_fid = fidInput.value.trim() || '0';
      fetchFileList();
    });

    const mkdirBtn = document.getElementById('qrMkdirBtn');
    if (mkdirBtn) mkdirBtn.onclick = promptCreateDirectory;

    fetchSelectedBtn.addEventListener('click', () => {
      fetchWebPageSelectedFiles();
    });

    document.querySelectorAll('.qr-tab-btn[data-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', (e) => {
        document.querySelectorAll('.qr-tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.activeTab = e.currentTarget.dataset.tab;

        document.getElementById('panelReplace').style.display = state.activeTab === 'replace' ? 'block' : 'none';
        document.getElementById('panelPrefix').style.display = state.activeTab === 'prefix' ? 'block' : 'none';
        document.getElementById('panelNumbering').style.display = state.activeTab === 'numbering' ? 'block' : 'none';
        document.getElementById('panelExtension').style.display = state.activeTab === 'extension' ? 'block' : 'none';
        document.getElementById('panelClean').style.display = state.activeTab === 'clean' ? 'block' : 'none';

        recalculateNewNames();
      });
    });

    const configInputIds = [
      'qrSearchInput', 'qrReplaceInput', 'qrIsRegex', 'qrIgnoreCase',
      'qrPrefixInput', 'qrSuffixInput',
      'qrNumTemplate', 'qrNumStart', 'qrNumPad',
      'qrNewExtInput', 'qrKeywordInput',
      'qrCleanUrl', 'qrCleanBracket', 'qrCleanTrad'
    ];

    configInputIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => updateConfigFromUI());
      el.addEventListener('change', () => updateConfigFromUI());
    });

    // 初始化手写自定义 Select 下拉框组件
    bindCustomSelects();

    document.querySelectorAll('.qr-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.qr-chip').forEach((c) => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.filterType = e.currentTarget.dataset.type;
        recalculateNewNames();
      });
    });

    selectAllCb.addEventListener('change', (e) => {
      const checked = e.target.checked;
      state.fileList.forEach((file) => {
        if (file.visible) file.selected = checked;
      });
      renderTable();
    });

    startBtn.addEventListener('click', runBatchRename);

    const deleteBtn = document.getElementById('qrDeleteBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', runBatchDelete);
    }

    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === 'TOGGLE_RENAME_PANEL') {
        openModal();
        sendResponse({ success: true });
      }
    });
  }

  function exportCsvMapping() {
    if (state.fileList.length === 0) {
      customAlert('提示', '当前列表中没有可导出的文件项目。');
      return;
    }

    let csvContent = '\uFEFF' + '原文件名,修改后名称,文件FID\n';
    state.fileList.forEach((file) => {
      const oldName = `"${file.file_name.replace(/"/g, '""')}"`;
      const newName = `"${file.new_name.replace(/"/g, '""')}"`;
      csvContent += `${oldName},${newName},${file.fid}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quark_rename_export_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    log(`导出 CSV 文件重命名清单成功`);
  }

  function importCsvMapping(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);
        let matchCount = 0;

        lines.forEach((line) => {
          if (!line.trim() || line.startsWith('原文件名')) return;
          const parts = line.split(',');
          if (parts.length >= 2) {
            const oldName = parts[0].replace(/^"|"$/g, '').trim();
            const newName = parts[1].replace(/^"|"$/g, '').trim();

            const targetFile = state.fileList.find((f) => f.file_name === oldName || (parts[2] && f.fid === parts[2].trim()));
            if (targetFile && newName) {
              targetFile.new_name = newName;
              targetFile.selected = true;
              matchCount++;
            }
          }
        });

        switchPageView('main');
        renderTable();
        customAlert('导入成功', `已从 CSV 表格中读取并匹配了 ${matchCount} 个文件的修改映射！`);
        log(`导入 CSV 表格匹配成功: ${matchCount} 项`);
      } catch (err) {
        customAlert('解析错误', 'CSV 文件格式解析异常。');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function updateConfigFromUI() {
    state.config.replaceSearch = document.getElementById('qrSearchInput').value;
    state.config.replaceTarget = document.getElementById('qrReplaceInput').value;
    state.config.isRegex = document.getElementById('qrIsRegex').checked;
    state.config.ignoreCase = document.getElementById('qrIgnoreCase').checked;

    const targetRangeEl = document.getElementById('qrTargetRange');
    state.config.targetRange = targetRangeEl ? (targetRangeEl.dataset.value || 'name') : 'name';

    state.config.prefix = document.getElementById('qrPrefixInput').value;
    state.config.suffix = document.getElementById('qrSuffixInput').value;

    state.config.numberTemplate = document.getElementById('qrNumTemplate').value;
    state.config.numberStart = parseInt(document.getElementById('qrNumStart').value) || 1;
    state.config.numberPad = parseInt(document.getElementById('qrNumPad').value) || 2;

    state.config.newExt = document.getElementById('qrNewExtInput').value.trim();

    const caseChangeEl = document.getElementById('qrCaseChange');
    state.config.caseChange = caseChangeEl ? (caseChangeEl.dataset.value || 'none') : 'none';

    const sortByEl = document.getElementById('qrSortBySelect');
    if (sortByEl && sortByEl.dataset.value) {
      state.sortBy = sortByEl.dataset.value;
      sortFileList();
    }

    state.config.cleanUrl = document.getElementById('qrCleanUrl').checked;
    state.config.cleanBracket = document.getElementById('qrCleanBracket').checked;
    state.config.cleanTrad = document.getElementById('qrCleanTrad').checked;

    state.searchKeyword = document.getElementById('qrKeywordInput').value.trim().toLowerCase();

    recalculateNewNames();
  }

  function openModal() {
    parseUrlAndSyncState();
    const overlay = document.getElementById('qrModalOverlay');
    overlay.classList.add('active');
    fetchFileList();
  }

  function closeModal() {
    if (state.isRunning) {
      customConfirm('确认强行关闭？', '批量重命名任务正在进行中，关闭后可能中断未完成的任务。', (ok) => {
        if (ok) {
          const overlay = document.getElementById('qrModalOverlay');
          overlay.classList.remove('active');
        }
      });
      return;
    }
    const overlay = document.getElementById('qrModalOverlay');
    overlay.classList.remove('active');
  }

  function fetchWebPageSelectedFiles() {
    const selectedElements = document.querySelectorAll('.grid-item-selected, .file-item-selected, tr.ant-table-row-selected');
    log(`扫描网页选中节点，找到 ${selectedElements.length} 项...`);

    if (selectedElements.length === 0) {
      customAlert('提示', '未在夸克网页找到已选中的文件，请先在页面勾选文件后再试。');
      return;
    }

    const selectedFids = new Set();
    selectedElements.forEach((el) => {
      const fid = el.getAttribute('data-fid') || el.dataset.fid || el.getAttribute('fid');
      if (fid) selectedFids.add(fid);
    });

    if (selectedFids.size > 0 && state.fileList.length > 0) {
      state.fileList.forEach((f) => {
        f.selected = selectedFids.has(f.fid);
      });
      renderTable();
      log(`匹配抓取网页选中的 ${selectedFids.size} 个文件`);
    } else {
      log('提示: 已完成选中提取');
    }
  }

  async function fetchFileList() {
    const tableBody = document.getElementById('qrTableBody');
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">正在获取文件数据 (FID: ${state.pdir_fid})...</td></tr>`;
    state.fileList = [];

    try {
      await loadDirectoryFiles(state.pdir_fid, '');
      sortFileList();
      recalculateNewNames();
      if (state.fileList.length === 0) {
        log(`当前目录 FID:${state.pdir_fid} 为空文件夹 (0 项)`);
      } else {
        log(`加载成功: 当前层级文件 ${state.fileList.length} 项`);
      }
    } catch (err) {
      console.warn('接口加载异常，自动启动 DOM 降级抓取:', err);
      captureFilesFromDom();
      sortFileList();
      recalculateNewNames();
      if (state.fileList.length > 0) {
        log(`DOM 自动捕获成功: 抓取网页文件 ${state.fileList.length} 项`);
      } else {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 30px;">加载失败: ${err.message || '网络问题'}</td></tr>`;
      }
    }
  }

  // 从夸克网盘网页 DOM 节点中精准智能捕获文件与 FID (带严密噪音过滤)
  function captureFilesFromDom() {
    const domElements = document.querySelectorAll('.grid-item, .file-item, [class*="file-item-box"]');
    domElements.forEach((el, idx) => {
      const fid = el.getAttribute('data-fid') || el.dataset.fid || el.getAttribute('fid') || `dom_${idx}`;
      const nameEl = el.querySelector('.file-name, .name, [class*="file-name-title"], [class*="filename"]') || el;
      let name = nameEl ? nameEl.textContent.trim() : '';

      if (name.includes('\n')) name = name.split('\n')[0].trim();

      const isDateOrTime = /^\d{4}[-\/\.]\d{2}[-\/\.]\d{2}/.test(name) || /^\d{2}:\d{2}/.test(name);
      const isSymbolOnly = /^[-_\s\.\/]+$/.test(name);
      const isSystemUiText = ['文件名', '大小', '修改时间', '更新时间', '操作', '全选', '类型', '文件大小'].includes(name);

      if (name && !isDateOrTime && !isSymbolOnly && !isSystemUiText && !state.fileList.some((f) => f.file_name === name)) {
        const isDir = el.querySelector('[class*="folder"]') || name.includes('文件夹') || !name.includes('.');
        state.fileList.push({
          fid: fid,
          pdir_fid: state.pdir_fid,
          file_name: name,
          is_dir: !!isDir,
          file_type: isDir ? 'dir' : 'file',
          size: 0,
          selected: true,
          visible: true,
          new_name: name
        });
      }
    });
  }

  function sortFileList() {
    state.fileList.sort((a, b) => {
      if (a.is_dir !== b.is_dir) {
        return a.is_dir ? -1 : 1;
      }

      if (state.sortBy === 'natural_asc') {
        return a.file_name.localeCompare(b.file_name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (state.sortBy === 'natural_desc') {
        return b.file_name.localeCompare(a.file_name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (state.sortBy === 'name_asc') {
        return a.file_name.localeCompare(b.file_name);
      } else if (state.sortBy === 'name_desc') {
        return b.file_name.localeCompare(a.file_name);
      } else if (state.sortBy === 'size_asc') {
        return a.size - b.size;
      } else if (state.sortBy === 'size_desc') {
        return b.size - a.size;
      }
      return 0;
    });
  }

  // 完美安全代理后台 Fetch，彻底解决跨域 CORS TypeError: Failed to fetch
  async function loadDirectoryFiles(pdirFid, currentPath, depth = 0) {
    if (depth > 5) return;

    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'API_FETCH_DIRECTORY', pdir_fid: pdirFid }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          resolve({ success: false, error: chrome.runtime.lastError?.message || '通讯异常' });
        } else {
          resolve(resp);
        }
      });
    });

    if (!res.success) {
      throw new Error(res.error || `请求 FID ${pdirFid} 异常`);
    }

    const data = res.data;
    if (data && (data.code === 0 || data.status === 200) && data.data && data.data.list) {
      const items = data.data.list;

      for (const item of items) {
        const relPath = currentPath ? `${currentPath}/${item.file_name}` : item.file_name;
        const isDirectory = item.dir || item.file_type === 'dir' || item.file_type === 0;

        state.fileList.push({
          fid: item.fid,
          pdir_fid: pdirFid,
          file_name: item.file_name,
          is_dir: isDirectory,
          file_type: item.file_type,
          size: item.size || 0,
          selected: true,
          visible: true,
          new_name: item.file_name
        });

        if (state.includeSubDirs && isDirectory) {
          log(`扫描子目录: ${relPath}`);
          await loadDirectoryFiles(item.fid, relPath, depth + 1);
        }
      }
    } else {
      throw new Error((data && data.message) || `获取 FID ${pdirFid} 文件列表失败`);
    }
  }

  function convertTradToSimpText(text) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      result += TRAD_SIMP_MAP[char] || char;
    }
    return result;
  }

  function recalculateNewNames() {
    let numIndex = state.config.numberStart;

    state.fileList.forEach((file) => {
      let visible = true;

      if (state.filterType === 'dir' && !file.is_dir) visible = false;
      if (state.filterType !== 'all' && state.filterType !== 'dir' && file.is_dir) visible = false;

      if (state.filterType === 'video' && !/\.(mp4|mkv|flv|avi|mov|wmv|m4v|webm)$/i.test(file.file_name)) visible = false;
      if (state.filterType === 'audio' && !/\.(mp3|flac|wav|aac|m4a|ogg)$/i.test(file.file_name)) visible = false;
      if (state.filterType === 'image' && !/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.file_name)) visible = false;
      if (state.filterType === 'doc' && !/\.(pdf|docx?|xlsx?|pptx?|txt|md)$/i.test(file.file_name)) visible = false;

      if (state.searchKeyword && !file.file_name.toLowerCase().includes(state.searchKeyword)) {
        visible = false;
      }

      file.visible = visible;
      if (!visible) return;

      let namePart = file.file_name;
      let extPart = '';
      if (!file.is_dir) {
        const lastDot = file.file_name.lastIndexOf('.');
        if (lastDot > 0) {
          namePart = file.file_name.substring(0, lastDot);
          extPart = file.file_name.substring(lastDot);
        }
      }

      let newName = file.file_name;

      if (state.activeTab === 'replace') {
        const { replaceSearch, replaceTarget, isRegex, ignoreCase, targetRange } = state.config;
        if (replaceSearch) {
          try {
            if (isRegex) {
              const flags = ignoreCase ? 'gi' : 'g';
              const regex = new RegExp(replaceSearch, flags);
              if (targetRange === 'name') {
                namePart = namePart.replace(regex, replaceTarget);
                newName = namePart + extPart;
              } else if (targetRange === 'ext') {
                extPart = extPart.replace(regex, replaceTarget);
                newName = namePart + extPart;
              } else {
                newName = file.file_name.replace(regex, replaceTarget);
              }
            } else {
              if (targetRange === 'name') {
                namePart = replaceAllText(namePart, replaceSearch, replaceTarget, ignoreCase);
                newName = namePart + extPart;
              } else if (targetRange === 'ext') {
                extPart = replaceAllText(extPart, replaceSearch, replaceTarget, ignoreCase);
                newName = namePart + extPart;
              } else {
                newName = replaceAllText(file.file_name, replaceSearch, replaceTarget, ignoreCase);
              }
            }
          } catch (e) {}
        }
      } else if (state.activeTab === 'prefix') {
        const { prefix, suffix } = state.config;
        newName = `${prefix}${namePart}${suffix}${extPart}`;
      } else if (state.activeTab === 'numbering') {
        const { numberTemplate, numberPad } = state.config;
        const padStr = String(numIndex).padStart(numberPad, '0');
        const formattedName = numberTemplate.replace('{n}', padStr);
        newName = file.is_dir ? formattedName : `${formattedName}${extPart}`;
        numIndex++;
      } else if (state.activeTab === 'extension') {
        const { newExt, caseChange } = state.config;

        let finalExt = extPart;
        if (newExt && !file.is_dir) {
          finalExt = newExt.startsWith('.') ? newExt : `.${newExt}`;
        }

        let finalName = namePart;
        if (caseChange === 'lower') {
          finalName = finalName.toLowerCase();
          finalExt = finalExt.toLowerCase();
        } else if (caseChange === 'upper') {
          finalName = finalName.toUpperCase();
          finalExt = finalExt.toUpperCase();
        }

        newName = `${finalName}${finalExt}`;
      } else if (state.activeTab === 'clean') {
        const { cleanUrl, cleanBracket, cleanTrad } = state.config;
        let cleanName = namePart;

        if (cleanUrl) {
          cleanName = cleanName.replace(/(https?:\/\/)?(www\.)?[\w-]+\.(com|cn|net|org|cc|tv)[\/\w-]*/gi, '');
        }
        if (cleanBracket) {
          cleanName = cleanName.replace(/\[.*?\]|【.*?】|\(.*?\)|（.*?）/g, '');
        }
        if (cleanTrad) {
          cleanName = convertTradToSimpText(cleanName);
        }

        cleanName = cleanName.trim().replace(/^[-_\s]+|[-_\s]+$/g, '');
        newName = file.is_dir ? cleanName : `${cleanName}${extPart}`;
      }

      file.new_name = newName;
    });

    renderTable();
  }

  function replaceAllText(str, search, replacement, ignoreCase) {
    if (!search) return str;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = ignoreCase ? 'gi' : 'g';
    return str.replace(new RegExp(escaped, flags), replacement);
  }

  function renderTable() {
    const tbody = document.getElementById('qrTableBody');
    const visibleFiles = state.fileList.filter((f) => f.visible);

    if (visibleFiles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">没有找到符合条件的文件或文件夹</td></tr>`;
      updateStatText();
      return;
    }

    tbody.innerHTML = visibleFiles
      .map((file) => {
        const isChanged = file.new_name !== file.file_name;
        const statusHtml = isChanged
          ? `<div style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
               <span class="qr-status-badge" style="color: #22c55e; background: rgba(34, 197, 94, 0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px; white-space: nowrap;">待更新</span>
               <button class="qr-btn-tool qr-btn-green qr-single-save-btn" data-fid="${file.fid}" style="height: 22px; padding: 0 6px; font-size: 11px; white-space: nowrap;" title="仅保存此文件的修改">✓ 保存</button>
             </div>`
          : `<span class="qr-status-badge" style="color: #71717a; white-space: nowrap;">未变动</span>`;

        let fileNameHtml = escapeHtml(file.file_name);
        if (file.is_dir) {
          fileNameHtml = `<span class="qr-dir-link" data-fid="${file.fid}" data-name="${escapeHtml(file.file_name)}">${ICONS.folder} ${escapeHtml(file.file_name)}</span>`;
        } else {
          fileNameHtml = `<span style="display: flex; align-items: center; gap: 6px;">${ICONS.file} ${escapeHtml(file.file_name)}</span>`;
        }

        return `
        <tr data-fid="${file.fid}">
          <td style="text-align: center;">
            <input type="checkbox" class="qr-file-cb" data-fid="${file.fid}" ${file.selected ? 'checked' : ''}>
          </td>
          <td class="qr-name-old">${fileNameHtml}</td>
          <td>
            <input type="text" class="qr-name-edit-input" data-fid="${file.fid}" value="${escapeHtml(file.new_name)}" placeholder="修改文件名...">
          </td>
          <td class="qr-status-td">${statusHtml}</td>
        </tr>
      `;
      })
      .join('');

    tbody.querySelectorAll('.qr-file-cb').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const fid = e.target.dataset.fid;
        const file = state.fileList.find((f) => f.fid === fid);
        if (file) file.selected = e.target.checked;
        updateStatText();
      });
    });

    tbody.querySelectorAll('.qr-name-edit-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const fid = e.target.dataset.fid;
        const file = state.fileList.find((f) => f.fid === fid);
        if (file) {
          file.new_name = e.target.value;
          file.selected = true;
          const row = e.target.closest('tr');
          if (row) {
            const cb = row.querySelector('.qr-file-cb');
            if (cb) cb.checked = true;

            const isChanged = file.new_name !== file.file_name;
            const statusTd = row.querySelector('.qr-status-td');
            if (statusTd) {
              statusTd.innerHTML = isChanged
                ? `<div style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                     <span class="qr-status-badge" style="color: #22c55e; background: rgba(34, 197, 94, 0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px; white-space: nowrap;">待更新</span>
                     <button class="qr-btn-tool qr-btn-green qr-single-save-btn" data-fid="${file.fid}" style="height: 22px; padding: 0 6px; font-size: 11px; white-space: nowrap;" title="仅保存此文件的修改">✓ 保存</button>
                   </div>`
                : `<span class="qr-status-badge" style="color: #71717a; white-space: nowrap;">未变动</span>`;

              const saveBtn = statusTd.querySelector('.qr-single-save-btn');
              if (saveBtn) {
                saveBtn.onclick = () => runSingleRename(file);
              }
            }
          }
          updateStatText();
        }
      });
    });

    tbody.querySelectorAll('.qr-single-save-btn').forEach((btn) => {
      btn.onclick = (e) => {
        const fid = e.currentTarget.dataset.fid;
        const file = state.fileList.find((f) => f.fid === fid);
        if (file) runSingleRename(file);
      };
    });

    tbody.querySelectorAll('.qr-dir-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        const fid = e.currentTarget.dataset.fid;
        const dirName = e.currentTarget.dataset.name;

        state.pdir_fid = fid;
        state.breadcrumbs.push({ fid, name: dirName });

        const fidInput = document.getElementById('qrFidInput');
        if (fidInput) fidInput.value = state.pdir_fid;

        renderBreadcrumbs();
        fetchFileList();
      });
    });

    updateStatText();
  }

  function updateStatText() {
    const visibleFiles = state.fileList.filter((f) => f.visible);
    const selectedFiles = visibleFiles.filter((f) => f.selected);
    const totalSelected = selectedFiles.length;
    const renameSelected = selectedFiles.filter((f) => f.new_name !== f.file_name).length;

    const statEl = document.getElementById('qrStatText');
    if (statEl) {
      statEl.textContent = `已勾选: ${totalSelected} 项 (待改名 ${renameSelected} 项)`;
    }

    const deleteBtn = document.getElementById('qrDeleteBtn');
    if (deleteBtn) {
      deleteBtn.innerHTML = `${ICONS.trash} 批量删除选中 (${totalSelected})`;
    }
  }

  async function runSingleRename(file) {
    if (!file || file.new_name === file.file_name) return;

    log(`正在修改单件: [${file.file_name}] ➔ [${file.new_name}] ...`);
    try {
      const res = await requestRename(file.fid, file.new_name);
      if (res && (res.code === 0 || res.status === 200)) {
        saveHistorySnapshot([{ fid: file.fid, old_name: file.file_name, new_name: file.new_name }]);
        log(`修改成功: [${file.file_name}] 已成功重命名为 [${file.new_name}]！`);
        const oldName = file.file_name;
        file.file_name = file.new_name;
        renderTable();
        updateStatText();
        customAlert('修改成功', `已成功将 "${oldName}" 重命名为 "${file.new_name}"！`);
      } else {
        log(`修改失败: ${res?.message || '请求受阻'}`);
        customAlert('修改失败', res?.message || '单件重命名失败');
      }
    } catch (err) {
      log(`修改捕获异常: ${err.message}`);
      customAlert('异常', err.message);
    }
  }

  async function runBatchRename() {
    if (state.isRunning) return;

    const targets = state.fileList.filter((f) => f.visible && f.selected && f.new_name !== f.file_name);

    if (targets.length === 0) {
      customAlert('提示', '没有选中的可改名文件（已选文件的新旧名称完全相同）。');
      return;
    }

    customConfirm('确认重命名', `确认要将选中的 ${targets.length} 个项目重命名吗？`, async (confirmed) => {
      if (!confirmed) return;

      state.isRunning = true;
      const startBtn = document.getElementById('qrStartBtn');
      const deleteBtn = document.getElementById('qrDeleteBtn');
      if (deleteBtn) deleteBtn.onclick = runBatchDelete;
      const delayInput = document.getElementById('qrDelayInput');
      const logBox = document.getElementById('qrLogBox');
      const progressWrap = document.getElementById('qrProgressBarWrap');
      const progressInner = document.getElementById('qrProgressBarInner');

      state.delayMs = parseInt(delayInput.value) || 500;
      startBtn.disabled = true;
      startBtn.textContent = '重命名执行中...';
      logBox.style.display = 'block';
      progressWrap.style.display = 'block';
      logBox.innerHTML = '';

      let successCount = 0;
      let failCount = 0;
      const historyItems = [];

      for (let i = 0; i < targets.length; i++) {
        const file = targets[i];
        const percent = Math.round(((i + 1) / targets.length) * 100);
        progressInner.style.width = `${percent}%`;

        log(`[${i + 1}/${targets.length}] 改名中: ${file.file_name} -> ${file.new_name}`);

        try {
          const result = await requestRename(file.fid, file.new_name);
          if (result && (result.code === 0 || result.status === 200)) {
            successCount++;
            historyItems.push({
              fid: file.fid,
              old_name: file.file_name,
              new_name: file.new_name
            });
            file.file_name = file.new_name;
            log(`  改名成功`);
          } else {
            failCount++;
            log(`  失败: ${result.message || JSON.stringify(result)}`);
          }
        } catch (err) {
          failCount++;
          log(`  异常: ${err.message}`);
        }

        if (i < targets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        }
      }

      log(`执行完成！成功: ${successCount} 个，失败: ${failCount} 个`);
      startBtn.disabled = false;
      startBtn.textContent = '开始批量重命名';
      state.isRunning = false;

      if (historyItems.length > 0) {
        saveHistorySnapshot(historyItems);
      }

      recalculateNewNames();
    });
  }

  function saveHistorySnapshot(items) {
    try {
      chrome.storage.local.get(['rename_history'], (res) => {
        const list = res.rename_history || [];
        const record = {
          id: 'hist_' + Date.now(),
          time: new Date().toLocaleString(),
          count: items.length,
          items: items
        };
        list.unshift(record);
        if (list.length > 20) list.pop();
        chrome.storage.local.set({ rename_history: list });
      });
    } catch (e) {
      console.warn('保存历史快照失败:', e);
    }
  }

  function openHistoryModal() {
    try {
      chrome.storage.local.get(['rename_history'], (res) => {
        const list = res.rename_history || [];
        let contentHtml = '';

        if (list.length === 0) {
          contentHtml = `<div class="qr-history-empty">暂无历史修改记录</div>`;
        } else {
          contentHtml = list
            .map((rec) => {
              const fileRows = (rec.items || [])
                .slice(0, 10)
                .map(
                  (item) => `
                <tr>
                  <td class="qr-hist-name-old" title="${escapeHtml(item.old_name)}">${escapeHtml(item.old_name)}</td>
                  <td class="qr-hist-arrow">${ICONS.arrowRight}</td>
                  <td class="qr-hist-name-new" title="${escapeHtml(item.new_name)}">${escapeHtml(item.new_name)}</td>
                </tr>
              `
                )
                .join('');

              const moreText = rec.items && rec.items.length > 10 ? `<div class="qr-hist-more">... 更多 ${rec.items.length - 10} 个文件</div>` : '';

              return `
              <div class="qr-history-card">
                <div class="qr-history-card-header">
                  <div class="qr-history-meta">
                    <span class="qr-history-time">${ICONS.clock} ${escapeHtml(rec.time)}</span>
                    <span class="qr-history-count">修改 ${rec.count} 项文件</span>
                  </div>
                  <button class="qr-btn-undo" data-id="${rec.id}">一键撤销此批次</button>
                </div>
                <div class="qr-history-card-body">
                  <table class="qr-history-table">
                    <tbody>
                      ${fileRows}
                    </tbody>
                  </table>
                  ${moreText}
                </div>
              </div>
            `;
            })
            .join('');
        }

        const dialog = document.createElement('div');
        dialog.className = 'qr-dialog-overlay';
        dialog.innerHTML = `
          <div class="qr-dialog-box qr-history-dialog-box">
            <div class="qr-dialog-title qr-history-dialog-title">
              <span class="qr-title-text">${ICONS.history} 历史改名快照记录与一键撤销</span>
              <button class="qr-close-btn qr-dialog-close">&times;</button>
            </div>
            <div class="qr-dialog-content qr-history-dialog-content">
              ${contentHtml}
            </div>
            <div class="qr-dialog-actions" style="display: flex; justify-content: space-between; align-items: center;">
              <button id="qrClearHistoryBtn" class="qr-btn-tool qr-btn-red" style="height: 28px; padding: 0 10px; font-size: 11px;" ${list.length === 0 ? 'disabled' : ''}>
                ${ICONS.trash} 清空全部历史记录
              </button>
              <button class="qr-btn-secondary qr-dialog-close">关闭</button>
            </div>
          </div>
        `;

        document.body.appendChild(dialog);

        dialog.querySelectorAll('.qr-dialog-close').forEach((btn) => {
          btn.addEventListener('click', () => dialog.remove());
        });

        const clearBtn = dialog.querySelector('#qrClearHistoryBtn');
        if (clearBtn && list.length > 0) {
          clearBtn.addEventListener('click', () => {
            customConfirm('清空历史', '⚠️ 确认要清空全部的历史修改快照记录吗？清空后将无法一键撤销恢复。', (confirmed) => {
              if (!confirmed) return;
              chrome.storage.local.set({ rename_history: [] }, () => {
                log('已成功清空全部历史修改记录！');
                openHistoryModal();
              });
            });
          });
        }

        dialog.querySelectorAll('.qr-btn-undo').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            const histId = e.currentTarget.dataset.id;
            const targetRec = list.find((r) => r.id === histId);
            if (targetRec) {
              dialog.remove();
              runUndoHistory(targetRec);
            }
          });
        });
      });
    } catch (e) {
      customAlert('异常', '读取历史记录失败。');
    }
  }

  async function runUndoHistory(record) {
    customConfirm('确认撤销还原', `确认要将 ${record.time} 修改的 ${record.items.length} 个文件还原为原来的文件名吗？`, async (confirmed) => {
      if (!confirmed) return;

      log(`开始一键撤销还原 ${record.items.length} 项文件...`);
      let success = 0;
      let fail = 0;

      for (let i = 0; i < record.items.length; i++) {
        const item = record.items[i];
        log(`[${i + 1}/${record.items.length}] 还原中: ${item.new_name} -> ${item.old_name}`);
        try {
          const res = await requestRename(item.fid, item.old_name);
          if (res && (res.code === 0 || res.status === 200)) {
            success++;
            log(`  还原成功`);
          } else {
            fail++;
            log(`  还原失败: ${res.message || '未知错误'}`);
          }
        } catch (err) {
          fail++;
          log(`  异常: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      customAlert('撤销完成', `成功还原 ${success} 个文件，失败 ${fail} 个。`);
      fetchFileList();
    });
  }

  // 智能重命名算法：前台同源优先（自动带有完整 Cookie / Origin / Referer 完美通过跨域），后台代理降级
  async function requestRename(fid, newFileName) {
    try {
      const url = 'https://drive-pc.quark.cn/1/clouddrive/file/rename?pr=ucpro&fr=pc&uc_param_str=';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8'
        },
        credentials: 'include',
        body: JSON.stringify({ fid: fid, file_name: newFileName })
      });
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        if (data && (data.code === 0 || data.status === 200)) {
          return data;
        }
      } catch (parseErr) {
        if (text.includes('Invalid CORS')) {
          console.warn('前台 fetch 触发 CORS 校验拦截，自动降级为 Service Worker 代理发包');
        }
      }
    } catch (e) {
      console.warn('前台同源发包网络异常，自动降级到 Service Worker 后台:', e);
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'API_RENAME_FILE', fid: fid, file_name: newFileName }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) {
          resolve({ code: -1, message: resp?.error || chrome.runtime.lastError?.message || '重命名响应异常' });
        } else {
          resolve(resp.data);
        }
      });
    });
  }

  // 夸克 API 新建文件夹函数（前台同源优先发包与后台代理降级双保险）
  async function requestCreateDirectory(pdirFid, folderName) {
    const payload = {
      pdir_fid: pdirFid || '0',
      file_name: folderName,
      dir_path: '',
      dir_init_lock: false
    };

    try {
      const url = 'https://drive-pc.quark.cn/1/clouddrive/file?pr=ucpro&fr=pc&uc_param_str=';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8'
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        if (data && (data.code === 0 || data.status === 200)) {
          return data;
        }
      } catch (parseErr) {
        console.warn('前台新建文件夹 fetch 解析非 JSON，自动降级为 Service Worker 代理');
      }
    } catch (e) {
      console.warn('前台新建文件夹网络异常，自动降级到 Service Worker 后台:', e);
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'API_CREATE_DIRECTORY', pdir_fid: pdirFid, file_name: folderName }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) {
          resolve({ code: -1, message: resp?.error || chrome.runtime.lastError?.message || '新建文件夹失败' });
        } else {
          resolve(resp.data);
        }
      });
    });
  }

  function promptCreateDirectory() {
    const defaultName = '新建文件夹';
    customPrompt('新建文件夹', defaultName, async (folderName) => {
      if (!folderName) return;

      log(`正在创建新文件夹 "${folderName}" ...`);
      try {
        const res = await requestCreateDirectory(state.pdir_fid, folderName);
        if (res && (res.code === 0 || res.status === 200)) {
          log(`文件夹 "${folderName}" 创建成功！`);
          customAlert('创建成功', `已在当前目录下成功新建文件夹 "${folderName}"。`);
          fetchFileList();
        } else {
          log(`新建文件夹失败: ${res?.message || res?.error || '受阻'}`);
          customAlert('创建失败', res?.message || res?.error || '新建文件夹失败');
        }
      } catch (err) {
        log(`创建文件夹捕获异常: ${err.message}`);
        customAlert('异常', err.message);
      }
    });
  }

  function customPrompt(title, defaultValue, callback) {
    const oldDialogs = document.querySelectorAll('.qr-dialog-overlay');
    oldDialogs.forEach((d) => d.remove());

    const dialog = document.createElement('div');
    dialog.className = 'qr-dialog-overlay';
    dialog.innerHTML = `
      <div class="qr-dialog-box">
        <div class="qr-dialog-title">${escapeHtml(title)}</div>
        <div class="qr-dialog-content">
          <input type="text" id="qrPromptInput" class="qr-input" value="${escapeHtml(defaultValue)}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 6px 10px; margin-top: 6px;">
        </div>
        <div class="qr-dialog-actions">
          <button class="qr-btn-secondary qr-dialog-cancel-btn">取消</button>
          <button class="qr-btn-primary qr-dialog-ok-btn" style="padding: 5px 16px;">确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const inputEl = dialog.querySelector('#qrPromptInput');
    if (inputEl) {
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 50);
    }

    const closeAndCall = (val, e) => {
      if (e) e.stopPropagation();
      const inputVal = inputEl ? inputEl.value.trim() : '';
      if (dialog && dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
      callback(val ? inputVal : null);
    };

    dialog.querySelector('.qr-dialog-cancel-btn').onclick = (e) => closeAndCall(false, e);
    dialog.querySelector('.qr-dialog-ok-btn').onclick = (e) => closeAndCall(true, e);
    if (inputEl) {
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') closeAndCall(true, e);
      };
    }
  }

  // 夸克 API 批量删除文件/文件夹函数
  async function requestDeleteFiles(fids) {
    if (!Array.isArray(fids)) fids = [fids];
    const payload = {
      action_type: 2,
      filelist: fids,
      exclude_fids: []
    };

    try {
      const url = 'https://drive-pc.quark.cn/1/clouddrive/file/delete?pr=ucpro&fr=pc&uc_param_str=';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8'
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        if (data && (data.code === 0 || data.status === 200)) {
          return data;
        }
      } catch (parseErr) {
        console.warn('前台删除 fetch 解析非 JSON，自动降级为 Service Worker 代理');
      }
    } catch (e) {
      console.warn('前台删除网络异常，自动降级到 Service Worker 后台:', e);
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'API_DELETE_FILES', fids: fids }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) {
          resolve({ code: -1, message: resp?.error || chrome.runtime.lastError?.message || '删除请求失败' });
        } else {
          resolve(resp.data);
        }
      });
    });
  }

  async function runBatchDelete() {
    if (state.isRunning) return;

    const selectedFiles = state.fileList.filter((f) => f.visible && f.selected);
    if (selectedFiles.length === 0) {
      customAlert('提示', '请先在表格列表中勾选需要删除的文件或文件夹。');
      return;
    }

    const fids = selectedFiles.map((f) => f.fid);
    customConfirm('确认批量删除', `⚠️ 警告：确认要将选中的 ${selectedFiles.length} 个文件/文件夹删除并放入回收站吗？`, async (confirmed) => {
      if (!confirmed) return;

      state.isRunning = true;
      const deleteBtn = document.getElementById('qrDeleteBtn');
      const startBtn = document.getElementById('qrStartBtn');

      if (deleteBtn) deleteBtn.disabled = true;
      if (startBtn) startBtn.disabled = true;

      log(`正在发起批量删除 ${selectedFiles.length} 个文件...`);

      try {
        const res = await requestDeleteFiles(fids);
        if (res && (res.code === 0 || res.status === 200)) {
          log(`批量删除成功: 共删除 ${selectedFiles.length} 项文件！`);
          customAlert('删除成功', `已成功将 ${selectedFiles.length} 个文件/文件夹移入夸克回收站。`);
          fetchFileList();
        } else {
          log(`批量删除失败: ${res?.message || res?.error || '请求受阻'}`);
          customAlert('删除失败', res?.message || res?.error || '删除请求失败');
        }
      } catch (err) {
        log(`批量删除捕获异常: ${err.message}`);
        customAlert('异常', err.message);
      } finally {
        state.isRunning = false;
        if (deleteBtn) deleteBtn.disabled = false;
        if (startBtn) startBtn.disabled = false;
      }
    });
  }

  function customAlert(title, message) {
    const oldDialogs = document.querySelectorAll('.qr-dialog-overlay');
    oldDialogs.forEach((d) => d.remove());

    const dialog = document.createElement('div');
    dialog.className = 'qr-dialog-overlay';
    dialog.innerHTML = `
      <div class="qr-dialog-box">
        <div class="qr-dialog-title">${escapeHtml(title)}</div>
        <div class="qr-dialog-content">${escapeHtml(message)}</div>
        <div class="qr-dialog-actions">
          <button class="qr-btn-primary qr-dialog-ok-btn" style="padding: 5px 16px;">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const closeHandler = (e) => {
      if (e) e.stopPropagation();
      if (dialog && dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
    };

    dialog.querySelector('.qr-dialog-ok-btn').onclick = closeHandler;
    dialog.onclick = (e) => {
      if (e.target === dialog) closeHandler(e);
    };
  }

  function customConfirm(title, message, callback) {
    const oldDialogs = document.querySelectorAll('.qr-dialog-overlay');
    oldDialogs.forEach((d) => d.remove());

    const dialog = document.createElement('div');
    dialog.className = 'qr-dialog-overlay';
    dialog.innerHTML = `
      <div class="qr-dialog-box">
        <div class="qr-dialog-title">${escapeHtml(title)}</div>
        <div class="qr-dialog-content">${escapeHtml(message)}</div>
        <div class="qr-dialog-actions">
          <button class="qr-btn-secondary qr-dialog-cancel-btn">取消</button>
          <button class="qr-btn-primary qr-dialog-ok-btn" style="padding: 5px 16px;">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const closeAndCall = (val, e) => {
      if (e) e.stopPropagation();
      if (dialog && dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
      callback(val);
    };

    dialog.querySelector('.qr-dialog-cancel-btn').onclick = (e) => closeAndCall(false, e);
    dialog.querySelector('.qr-dialog-ok-btn').onclick = (e) => closeAndCall(true, e);
    dialog.onclick = (e) => {
      if (e.target === dialog) closeAndCall(false, e);
    };
  }

  function log(msg) {
    const logBox = document.getElementById('qrLogBox');
    if (!logBox) return;
    const timeStr = new Date().toLocaleTimeString();
    logBox.innerHTML += `<div>[${timeStr}] ${escapeHtml(msg)}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
