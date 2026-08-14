/**
 * 面板 UI 渲染与事件编排：浮窗、弹窗、表格、页签与面包屑
 */

import { state } from './state.js';
import { ICONS, DEFAULT_CHANGELOG_DATA } from './constants.js';
import { escapeHtml, fetchJsonData, log } from './utils.js';
import { fetchFileList } from './api.js';
import { recalculateNewNames, updateConfigFromUI } from './rename.js';
import { exportCsvMapping, importCsvMapping } from './csv.js';
import { openHistoryModal } from './history.js';
import { runSingleRename, runBatchRename, runBatchDelete, promptCreateDirectory } from './actions.js';
import { customConfirm, customAlert } from './dialogs.js';

export function createFloatButton() {
  if (document.getElementById('quark-rename-float-btn')) return;
  const btn = document.createElement('div');
  btn.id = 'quark-rename-float-btn';
  btn.innerHTML = `${ICONS.zap} 夸克全能工具`;
  btn.addEventListener('click', () => openModal());
  document.body.appendChild(btn);
}

export function parseUrlAndSyncState() {
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

export function createModalUI() {
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

export function bindCustomSelects() {
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

export function buildCustomSelectHTML(id, options, defaultVal, extraStyle = '') {
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

export function renderMainViewComponent() {
  const mainViewEl = document.getElementById('viewMain');
  if (!mainViewEl) return;

  const targetRangeSelectHtml = buildCustomSelectHTML(
    'qrTargetRange',
    [
      { value: 'name', label: '仅主文件名' },
      { value: 'ext', label: '仅扩展名' },
      { value: 'all', label: '完整文件名' }
    ],
    'name'
  );

  const caseChangeSelectHtml = buildCustomSelectHTML(
    'qrCaseChange',
    [
      { value: 'none', label: '保持原样' },
      { value: 'lower', label: '转换为小写 (lowercase)' },
      { value: 'upper', label: '转换为大写 (UPPERCASE)' }
    ],
    'none'
  );

  const sortBySelectHtml = buildCustomSelectHTML(
    'qrSortBySelect',
    [
      { value: 'natural_asc', label: '自然数字升序 (1,2,10)' },
      { value: 'natural_desc', label: '自然数字降序 (10,2,1)' },
      { value: 'name_asc', label: '文件名 A ➔ Z 升序' },
      { value: 'name_desc', label: '文件名 Z ➔ A 降序' },
      { value: 'size_asc', label: '文件大小升序' },
      { value: 'size_desc', label: '文件大小降序' }
    ],
    'natural_asc',
    'min-width: 155px;'
  );

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

export function renderCsvViewComponent() {
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
}

export async function loadAndRenderChangelogComponent() {
  const containerEl = document.getElementById('viewChangelog');
  if (!containerEl) return;

  let data = await fetchJsonData('data/changelog.json');
  if (!data || !Array.isArray(data) || data.length === 0) {
    data = DEFAULT_CHANGELOG_DATA;
  }

  const itemsHtml = data
    .map(
      (item) => `
      <div class="qr-timeline-item">
        <div class="qr-timeline-header" style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="qr-version-badge">${ICONS.log} ${escapeHtml(item.version)}</span>
            <span class="qr-tag-badge">${escapeHtml(item.tag)}</span>
            <span class="qr-timeline-date">${escapeHtml(item.date)}</span>
          </div>
          <a href="https://github.com/LZ7TOP/quark-drive-master-extension/releases/tag/${escapeHtml(item.version)}" target="_blank" class="qr-btn-tool qr-btn-blue" style="height: 24px; padding: 0 10px; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; border-radius: 4px;" title="在 GitHub 下载 ${escapeHtml(item.version)} 官方 Release 发布包">
            ${ICONS.file} 下载此版本
          </a>
        </div>
        <ul class="qr-timeline-list">
          ${item.changes.map((c) => `<li><svg class="qr-change-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> <span>${c}</span></li>`).join('')}
        </ul>
      </div>
    `
    )
    .join('');

  containerEl.innerHTML = `
    <div class="qr-page-container">
      <div class="qr-timeline">
        ${itemsHtml}
      </div>
    </div>
  `;
}

export async function loadAndRenderAboutComponent() {
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

export function switchPageView(pageId) {
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

export function renderBreadcrumbs() {
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

export function renderTable() {
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

export function updateStatText() {
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

export function openModal() {
  parseUrlAndSyncState();
  const overlay = document.getElementById('qrModalOverlay');
  overlay.classList.add('active');
  fetchFileList();
}

export function closeModal() {
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

export function fetchWebPageSelectedFiles() {
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

export function bindEvents() {
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
    'qrSearchInput',
    'qrReplaceInput',
    'qrIsRegex',
    'qrIgnoreCase',
    'qrPrefixInput',
    'qrSuffixInput',
    'qrNumTemplate',
    'qrNumStart',
    'qrNumPad',
    'qrNewExtInput',
    'qrKeywordInput',
    'qrCleanUrl',
    'qrCleanBracket',
    'qrCleanTrad'
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
