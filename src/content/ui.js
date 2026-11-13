/**
 * 面板 UI 渲染与事件编排：浮窗、弹窗、表格、页签与面包屑
 */

import { state } from './state.js';
import { ICONS, DEFAULT_CHANGELOG_DATA, RENAME_TEMPLATES } from './constants.js';
import { escapeHtml, fetchJsonData, formatSize, log } from './utils.js';
import { fetchFileList, loadMoreCurrentDirectory, requestAccountQuota, searchDriveFiles } from './api.js';
import { recalculateNewNames, updateConfigFromUI } from './rename.js';
import { exportCsvMapping, importCsvMapping } from './csv.js';
import { openHistoryModal } from './history.js';
import {
  promptCreateDirectory,
  runBatchDelete,
  runBatchMove,
  runBatchRename,
  runExtractDownloadLinks,
  runSingleRename
} from './actions.js';
import { customConfirm, customAlert, toast } from './dialogs.js';
import { renderToolsViewComponent, bindToolsEvents, refreshToolsView } from './tools.js';
import { bindSharesEvents, fetchAllMyShares, onEnterSharesView, prependCreatedShares, renderSharesViewComponent } from './shares.js';
import { openCreateShareModal } from './share-actions.js';
import { bindGlobalEvents, onEnterGlobalView, openGlobalSearchWithKeyword, renderGlobalViewComponent } from './global-rename.js';

const USER_PREFS_KEY = 'quark_user_prefs_v1';
let docSelectBound = false;
let globalKeyBound = false;

export function persistUserPrefs() {
  try {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set(
      {
        [USER_PREFS_KEY]: {
          delayMs: Math.max(100, Math.min(3000, Number(state.delayMs) || 500))
        }
      },
      () => {
        if (chrome.runtime?.lastError) {
          console.warn('[Quark Assistant] 保存偏好失败:', chrome.runtime.lastError.message);
        }
      }
    );
  } catch (err) {
    console.warn('[Quark Assistant] 保存偏好异常:', err);
  }
}

function loadUserPrefs() {
  try {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get([USER_PREFS_KEY], (res) => {
      if (chrome.runtime?.lastError) {
        console.warn('[Quark Assistant] 读取偏好失败:', chrome.runtime.lastError.message);
        return;
      }
      const prefs = res && res[USER_PREFS_KEY];
      if (prefs && prefs.delayMs !== undefined) {
        const val = Math.max(100, Math.min(3000, parseInt(prefs.delayMs, 10) || 500));
        state.delayMs = val;
        const mainDelay = document.getElementById('qrDelayInput');
        if (mainDelay) mainDelay.value = String(val);
        const globalDelay = document.getElementById('qrGlobalDelayInput');
        if (globalDelay) globalDelay.value = String(val);
      }
    });
  } catch (err) {
    console.warn('[Quark Assistant] 读取偏好异常:', err);
  }
}

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

export async function refreshAccountQuotaUI(forceFetch = false) {
  const pill = document.getElementById('qrAccountPill');
  if (!pill) return;

  if (forceFetch) {
    pill.innerHTML = `<span class="qr-account-name">${ICONS.user} 读取容量中...</span>`;
    await requestAccountQuota();
  }

  const acc = state.account;
  if (!acc || !acc.loaded) {
    pill.innerHTML = `<span class="qr-account-name">${ICONS.user} 检测账号...</span>`;
    return;
  }

  if (!acc.loggedIn) {
    pill.innerHTML = `<span class="qr-account-name" style="color:#fbbf24;">${ICONS.user} 未登录账号</span>`;
    return;
  }

  const tier = String(acc.member_type || 'NORMAL').toUpperCase();
  const tierBadge = tier.includes('SVIP')
    ? `<span class="qr-member-badge qr-member-svip">SVIP</span>`
    : tier.includes('VIP')
      ? `<span class="qr-member-badge qr-member-vip">VIP</span>`
      : '';

  const hasCap = acc.total_capacity > 0;
  const pct = hasCap ? Math.min(100, Math.round((acc.use_capacity / acc.total_capacity) * 100)) : 0;
  const barCls = pct >= 95 ? 'is-danger' : pct >= 85 ? 'is-warn' : '';
  const capText = hasCap ? `${formatSize(acc.use_capacity)} / ${formatSize(acc.total_capacity)}` : '容量未知';

  pill.innerHTML = `
    <span class="qr-account-user" title="${escapeHtml(acc.nickname)}">
      ${ICONS.user}
      <span class="qr-account-name">${escapeHtml(acc.nickname || '夸克用户')}</span>
      ${tierBadge}
    </span>
    <span class="qr-account-sep">|</span>
    <span class="qr-quota-mini" title="已用 ${pct}%（点击刷新账号配额）">
      <span class="qr-quota-mini-text">${capText}</span>
      ${hasCap ? `<span class="qr-quota-mini-bar"><span class="qr-quota-mini-fill ${barCls}" style="width:${pct}%"></span></span>` : ''}
    </span>
  `;
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

        <!-- 第二排：Tab 导航页签组 + 账号与容量胶囊 -->
        <div class="qr-header-bottom">
          <div class="qr-page-nav">
            <button class="qr-nav-item active" data-view="main">${ICONS.zap} 重命名主页</button>
            <button class="qr-nav-item" data-view="global">${ICONS.globe} 全局搜改</button>
            <button class="qr-nav-item" data-view="shares">${ICONS.share} 我的分享</button>
            <button class="qr-nav-item" data-view="csv">${ICONS.csv} CSV 工具</button>
            <button class="qr-nav-item" data-view="tools">${ICONS.toolbox} 工具箱</button>
            <button class="qr-nav-item" data-view="changelog">${ICONS.log} 更新日志</button>
            <button class="qr-nav-item" data-view="about">${ICONS.info} 关于项目</button>
          </div>
          <div id="qrAccountPill" class="qr-account-pill" role="button" tabindex="0" title="当前账号与剩余容量（点击刷新）">
            <span class="qr-account-name">${ICONS.user} 读取账号中...</span>
          </div>
        </div>
      </div>

      <div class="qr-body">
        <div id="viewMain" class="qr-page-view"></div>
        <div id="viewGlobal" class="qr-page-view hidden"></div>
        <div id="viewShares" class="qr-page-view hidden"></div>
        <div id="viewCsv" class="qr-page-view hidden"></div>
        <div id="viewTools" class="qr-page-view hidden"></div>
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
            <input type="number" id="qrDelayInput" class="qr-input" value="500" min="100" max="3000" style="width: 68px; padding: 3px 6px;">
            <span style="font-size: 11px; color: #71717a;">(推荐500)</span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span id="qrStatText" style="font-size: 11px; color: #a1a1aa;">共 0 项文件</span>
            <button id="qrMoveBtn" class="qr-btn-primary qr-btn-blue-solid">${ICONS.move} 批量移动 (0)</button>
            <button id="qrDeleteBtn" class="qr-btn-primary qr-btn-red">${ICONS.trash} 批量删除 (0)</button>
            <button id="qrStartBtn" class="qr-btn-primary">${ICONS.zap} 开始批量重命名</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  renderMainViewComponent();
  renderGlobalViewComponent();
  renderSharesViewComponent();
  renderCsvViewComponent();
  renderToolsViewComponent();
  loadAndRenderChangelogComponent();
  loadAndRenderAboutComponent();
  loadUserPrefs();
}

export function bindCustomSelects(rootEl = document, onSelectChange = null) {
  const scope = rootEl || document;
  scope.querySelectorAll('.qr-custom-select-wrap').forEach((wrap) => {
    if (wrap.dataset.qrSelectBound === '1') return;
    wrap.dataset.qrSelectBound = '1';

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

        if (typeof onSelectChange === 'function') {
          onSelectChange();
        } else {
          updateConfigFromUI();
        }
      };
    });
  });

  if (!docSelectBound) {
    docSelectBound = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.qr-custom-select-wrap').forEach((w) => w.classList.remove('active'));
    });
  }
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
    'min-width: 142px;'
  );

  mainViewEl.innerHTML = `
    <div id="qrBreadcrumbsBar" class="qr-breadcrumbs-bar qr-breadcrumbs-bar-split">
      <div id="qrBreadcrumbsTrail" class="qr-breadcrumbs-trail"></div>
      <div class="qr-breadcrumbs-ops">
        <button type="button" id="qrFetchSelectedBtn" class="qr-btn-tool qr-btn-green" style="height: 24px; padding: 0 8px; font-size: 11px;" title="抓取夸克网页中选中的文件">${ICONS.target} 抓取选中</button>
        <button type="button" id="qrBatchShareBtn" class="qr-btn-tool qr-btn-purple" style="height: 24px; padding: 0 8px; font-size: 11px;" title="为当前勾选的文件/文件夹一键生成分享链接">${ICONS.share} 创建分享</button>
        <button type="button" id="qrDownloadLinksBtn" class="qr-btn-tool qr-btn-blue" style="height: 24px; padding: 0 8px; font-size: 11px;" title="批量提取已选文件的官方下载直链并支持导出 Aria2 任务">${ICONS.download} 提取直链</button>
      </div>
    </div>

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
        <div class="qr-input-row" style="margin-top: 8px;">
          <label style="font-size: 12px; color: #a1a1aa; flex-shrink: 0;">快捷模板:</label>
          <div class="qr-template-chips">
            ${RENAME_TEMPLATES.map((t) => `<button class="qr-template-chip" data-template="${escapeHtml(t.template)}" data-pad="${t.pad}" title="${escapeHtml(t.template)}">${escapeHtml(t.name)}</button>`).join('')}
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
      <div class="qr-filter-controls">
        <div style="display: flex; align-items: center; gap: 4px;">
          <label style="font-size: 11px; color: #a1a1aa; white-space: nowrap;">排序:</label>
          ${sortBySelectHtml}
        </div>

        <label class="qr-checkbox-label" style="color: #a1a1aa; font-weight: 500;" title="深度递归获取当前目录下所有子文件夹里面的文件">
          <input type="checkbox" id="qrIncludeSubDirs"> 递归子目录
        </label>

        <input type="text" id="qrKeywordInput" class="qr-input" placeholder="过滤当前文件名..." style="padding: 2px 8px; font-size: 11px; width: 140px; height: 26px; flex: none;">
        <button type="button" id="qrJumpGlobalBtn" class="qr-btn-tool qr-btn-blue" style="height: 26px; padding: 0 8px; font-size: 11px;" title="跳转到「全局搜改」独立页签检索全盘并跨目录重命名">${ICONS.globe} 全局搜改 ➔</button>
      </div>
    </div>

    <div id="qrDirTruncateBar" class="qr-truncate-banner hidden">
      <span id="qrDirTruncateText"></span>
      <button type="button" id="qrLoadMoreDirBtn" class="qr-btn-tool qr-btn-blue" style="height: 22px; padding: 0 8px; font-size: 11px;">${ICONS.refresh} 继续加载更多</button>
    </div>

    <div class="qr-table-wrap">
      <table class="qr-table">
        <thead>
          <tr>
            <th style="width: 38px; text-align: center;"><input type="checkbox" id="qrSelectAll" checked></th>
            <th>原文件名 (点击文件夹进入)</th>
            <th>修改后名称 (可直接编辑)</th>
            <th style="width: 158px;">状态</th>
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
    { old: '01.示例视频.1080p.mp4', new: '示例视频.EP01.1080p.mp4', fid: '00000000000000000000000000000001' },
    { old: '02.示例视频.1080p.mp4', new: '示例视频.EP02.1080p.mp4', fid: '00000000000000000000000000000002' },
    { old: '宣发海报图片.jpg', new: '封面图.jpg', fid: '00000000000000000000000000000003' }
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
      const iconSvg = ICONS[f.icon] || ICONS.zap;

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

export function navigateToDirectory(fid, crumbs) {
  state.mainMode = 'dir';
  state.pdir_fid = String(fid || '0');
  state.breadcrumbs = Array.isArray(crumbs) && crumbs.length > 0 ? crumbs : [{ fid: '0', name: '全部文件' }];

  const fidInput = document.getElementById('qrFidInput');
  if (fidInput) fidInput.value = state.pdir_fid;

  switchPageView('main', { skipAutoFetch: true });
  renderBreadcrumbs();
  fetchFileList();
}

export function switchPageView(pageId, { skipAutoFetch = false } = {}) {
  state.currentView = pageId;

  document.querySelectorAll('.qr-nav-item[data-view]').forEach((btn) => {
    if (btn.dataset.view === pageId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.getElementById('viewMain').classList.toggle('hidden', pageId !== 'main');
  document.getElementById('viewGlobal').classList.toggle('hidden', pageId !== 'global');
  document.getElementById('viewShares').classList.toggle('hidden', pageId !== 'shares');
  document.getElementById('viewCsv').classList.toggle('hidden', pageId !== 'csv');
  document.getElementById('viewTools').classList.toggle('hidden', pageId !== 'tools');
  document.getElementById('viewChangelog').classList.toggle('hidden', pageId !== 'changelog');
  document.getElementById('viewAbout').classList.toggle('hidden', pageId !== 'about');

  const footerEl = document.querySelector('#qrModalOverlay .qr-footer');
  if (footerEl) {
    footerEl.style.display = pageId === 'shares' || pageId === 'global' ? 'none' : 'flex';
  }

  if (pageId === 'global') {
    onEnterGlobalView();
  } else if (pageId === 'shares') {
    onEnterSharesView();
  } else if (pageId === 'main' && !skipAutoFetch && state.fileList.length === 0) {
    fetchFileList();
  } else if (pageId === 'tools') {
    refreshToolsView();
  } else if (pageId === 'changelog') {
    loadAndRenderChangelogComponent();
  } else if (pageId === 'about') {
    loadAndRenderAboutComponent();
  }
}

export function renderBreadcrumbs() {
  const trail = document.getElementById('qrBreadcrumbsTrail');
  if (!trail) return;

  if (state.mainMode === 'search') {
    const totalInfo =
      state.searchTotal > state.fileList.length ? `${state.fileList.length} / 共 ${state.searchTotal}` : `${state.fileList.length}`;
    trail.innerHTML = `
      <span class="qr-crumb-item current">${ICONS.search} 全盘搜索: 「${escapeHtml(state.searchQuery)}」(${totalInfo} 项)</span>
      <button type="button" id="qrExitSearchBtn" class="qr-btn-tool qr-btn-amber" style="height: 22px; padding: 0 8px; font-size: 11px; margin-left: 6px;">返回原目录</button>
    `;
    const exitBtn = document.getElementById('qrExitSearchBtn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        state.mainMode = 'dir';
        renderBreadcrumbs();
        fetchFileList();
      });
    }
    return;
  }

  if (state.breadcrumbs.length === 0) {
    state.breadcrumbs = [{ fid: state.pdir_fid, name: '当前目录' }];
  }

  trail.innerHTML = state.breadcrumbs
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

  trail.querySelectorAll('.qr-crumb-item[data-fid]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const targetFid = e.currentTarget.dataset.fid;
      const targetIdx = parseInt(e.currentTarget.dataset.idx, 10);

      state.mainMode = 'dir';
      state.pdir_fid = targetFid;
      state.breadcrumbs = state.breadcrumbs.slice(0, targetIdx + 1);

      const fidInput = document.getElementById('qrFidInput');
      if (fidInput) fidInput.value = state.pdir_fid;

      renderBreadcrumbs();
      fetchFileList();
    });
  });
}

function renderMainStatusCellHtml(file) {
  const isChanged = file.new_name !== file.file_name;
  if (file._regexError) {
    return `<span class="qr-status-badge qr-status-err" title="${escapeHtml(file._regexError)}">正则无效</span>`;
  }
  if (file._renameError) {
    return `
      <div class="qr-status-cell-stack">
        <span class="qr-status-badge qr-status-err" title="${escapeHtml(file._renameError)}">${escapeHtml(file._renameError)}</span>
        ${
          isChanged
            ? `<button type="button" class="qr-btn-tool qr-btn-green qr-single-save-btn" data-fid="${escapeHtml(file.fid)}" style="height: 22px; padding: 0 6px; font-size: 11px; white-space: nowrap;" title="重试保存此文件">✓ 重试</button>`
            : ''
        }
      </div>
    `;
  }
  if (isChanged) {
    return `<div style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
         <span class="qr-status-badge qr-status-ready">待更新</span>
         <button type="button" class="qr-btn-tool qr-btn-green qr-single-save-btn" data-fid="${escapeHtml(file.fid)}" style="height: 22px; padding: 0 6px; font-size: 11px; white-space: nowrap;" title="仅保存此文件的修改">✓ 保存</button>
       </div>`;
  }
  return `<span class="qr-status-badge qr-status-idle">未变动</span>`;
}

export function renderTable() {
  const tbody = document.getElementById('qrTableBody');
  const visibleFiles = state.fileList.filter((f) => f.visible);

  // 同步刷新工具箱的目录统计，确保数据随文件列表变化实时更新
  refreshToolsView();

  if (visibleFiles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">没有找到符合条件的文件或文件夹</td></tr>`;
    updateStatText();
    return;
  }

  tbody.innerHTML = visibleFiles
    .map((file) => {
      const statusHtml = renderMainStatusCellHtml(file);

      let fileNameHtml = escapeHtml(file.file_name);
      if (file.is_dir) {
        fileNameHtml = `<span class="qr-dir-link" data-fid="${file.fid}" data-name="${escapeHtml(file.file_name)}">${ICONS.folder} <span>${escapeHtml(file.file_name)}</span></span>`;
      } else {
        fileNameHtml = `<span class="qr-main-file-name">${ICONS.file} <span>${escapeHtml(file.file_name)}</span></span>`;
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
      if (file) {
        file.selected = e.target.checked;
        if (state.activeTab === 'numbering') {
          recalculateNewNames();
          return;
        }
      }
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
        file._renameError = '';
        file._regexError = '';
        const row = e.target.closest('tr');
        if (row) {
          const cb = row.querySelector('.qr-file-cb');
          if (cb) cb.checked = true;

          const statusTd = row.querySelector('.qr-status-td');
          if (statusTd) {
            statusTd.innerHTML = renderMainStatusCellHtml(file);
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
      const wasSearch = state.mainMode === 'search';

      state.mainMode = 'dir';
      state.pdir_fid = fid;
      if (wasSearch) {
        state.breadcrumbs = [
          { fid: '0', name: '全部文件' },
          { fid, name: dirName }
        ];
        state.searchKeyword = '';
        const kwInput = document.getElementById('qrKeywordInput');
        if (kwInput) kwInput.value = '';
      } else {
        state.breadcrumbs.push({ fid, name: dirName });
      }

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
  const filesOnlySelected = selectedFiles.filter((f) => !f.is_dir).length;
  const renameSelected = selectedFiles.filter((f) => f.new_name !== f.file_name).length;

  const statEl = document.getElementById('qrStatText');
  if (statEl) {
    statEl.textContent = `已勾选: ${totalSelected} 项 (改名 ${renameSelected})`;
  }

  const moveBtn = document.getElementById('qrMoveBtn');
  if (moveBtn) {
    moveBtn.innerHTML = `${ICONS.move} 批量移动 (${totalSelected})`;
  }

  const deleteBtn = document.getElementById('qrDeleteBtn');
  if (deleteBtn) {
    deleteBtn.innerHTML = `${ICONS.trash} 批量删除 (${totalSelected})`;
  }

  const batchShareBtn = document.getElementById('qrBatchShareBtn');
  if (batchShareBtn) {
    batchShareBtn.innerHTML = totalSelected > 0 ? `${ICONS.share} 分享 (${totalSelected})` : `${ICONS.share} 创建分享`;
  }

  const dlBtn = document.getElementById('qrDownloadLinksBtn');
  if (dlBtn) {
    dlBtn.innerHTML = filesOnlySelected > 0 ? `${ICONS.download} 直链 (${filesOnlySelected})` : `${ICONS.download} 提取直链`;
  }

  const selectAllCb = document.getElementById('qrSelectAll');
  if (selectAllCb) {
    selectAllCb.checked = visibleFiles.length > 0 && totalSelected === visibleFiles.length;
    selectAllCb.indeterminate = totalSelected > 0 && totalSelected < visibleFiles.length;
  }

  const truncBar = document.getElementById('qrDirTruncateBar');
  const truncText = document.getElementById('qrDirTruncateText');
  const loadMoreDirBtn = document.getElementById('qrLoadMoreDirBtn');
  if (truncBar) {
    const showTrunc = state.mainMode === 'dir' && (state.dirTruncated || state.dirHasMore);
    truncBar.classList.toggle('hidden', !showTrunc);
    if (showTrunc && truncText) {
      const totalInfo = state.dirTotal > state.fileList.length ? ` / 共 ${state.dirTotal} 项` : '';
      truncText.textContent = `当前目录项目较多，已加载 ${state.fileList.length} 项${totalInfo}（列表已分段保护）`;
    }
    if (loadMoreDirBtn) {
      loadMoreDirBtn.classList.toggle('hidden', !state.dirHasMore);
    }
  }
}

export function openModal() {
  parseUrlAndSyncState();
  const overlay = document.getElementById('qrModalOverlay');
  overlay.classList.add('active');
  refreshAccountQuotaUI(true);
  if ((window.location.hash || '').includes('/list/myshare')) {
    switchPageView('shares');
    if (state.shares.list.length === 0) {
      fetchAllMyShares();
    }
    return;
  }
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
  const batchShareBtn = document.getElementById('qrBatchShareBtn');
  const downloadLinksBtn = document.getElementById('qrDownloadLinksBtn');
  const historyBtn = document.getElementById('qrHistoryBtn');
  const exportCsvBtnPage = document.getElementById('qrExportCsvBtnPage');
  const importCsvBtnPage = document.getElementById('qrImportCsvBtnPage');
  const csvFileInput = document.getElementById('qrCsvFileInput');
  const fidInput = document.getElementById('qrFidInput');
  const includeSubDirsCb = document.getElementById('qrIncludeSubDirs');
  const selectAllCb = document.getElementById('qrSelectAll');
  const startBtn = document.getElementById('qrStartBtn');
  const accountPill = document.getElementById('qrAccountPill');
  const kwInput = document.getElementById('qrKeywordInput');
  const jumpGlobalBtn = document.getElementById('qrJumpGlobalBtn');
  const loadMoreDirBtn = document.getElementById('qrLoadMoreDirBtn');
  const delayInput = document.getElementById('qrDelayInput');

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  if (accountPill) {
    accountPill.addEventListener('click', async () => {
      await refreshAccountQuotaUI(true);
      if (state.account.loggedIn) {
        toast('已刷新账号与网盘容量');
      }
    });
    accountPill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        accountPill.click();
      }
    });
  }

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
    state.mainMode = 'dir';
    state.pdir_fid = e.target.value.trim() || '0';
    state.breadcrumbs = [{ fid: state.pdir_fid, name: `FID:${state.pdir_fid}` }];
    renderBreadcrumbs();
  });

  includeSubDirsCb.addEventListener('change', (e) => {
    state.includeSubDirs = e.target.checked;
  });

  refreshBtn.addEventListener('click', () => {
    state.mainMode = 'dir';
    state.pdir_fid = fidInput.value.trim() || '0';
    renderBreadcrumbs();
    fetchFileList();
  });

  const mkdirBtn = document.getElementById('qrMkdirBtn');
  if (mkdirBtn) mkdirBtn.onclick = promptCreateDirectory;

  fetchSelectedBtn.addEventListener('click', () => {
    fetchWebPageSelectedFiles();
  });

  if (batchShareBtn) {
    batchShareBtn.addEventListener('click', () => {
      const selected = state.fileList.filter((f) => f.visible && f.selected);
      openCreateShareModal(selected, { onSharesCreated: prependCreatedShares });
    });
  }

  if (downloadLinksBtn) {
    downloadLinksBtn.addEventListener('click', runExtractDownloadLinks);
  }

  if (jumpGlobalBtn) {
    jumpGlobalBtn.addEventListener('click', () => {
      openGlobalSearchWithKeyword(kwInput ? kwInput.value : '');
    });
  }

  if (loadMoreDirBtn) {
    loadMoreDirBtn.addEventListener('click', async () => {
      loadMoreDirBtn.disabled = true;
      loadMoreDirBtn.innerHTML = `${ICONS.refresh} 加载中...`;
      try {
        const added = await loadMoreCurrentDirectory();
        toast(added > 0 ? `已追加加载 ${added} 项文件` : '已全部加载完毕');
      } catch (err) {
        customAlert('加载失败', err.message || '分页加载异常');
      } finally {
        loadMoreDirBtn.disabled = false;
        loadMoreDirBtn.innerHTML = `${ICONS.refresh} 继续加载更多`;
      }
    });
  }

  if (delayInput) {
    delayInput.addEventListener('change', () => {
      const val = Math.max(100, Math.min(3000, parseInt(delayInput.value, 10) || 500));
      state.delayMs = val;
      delayInput.value = String(val);
      const gDelay = document.getElementById('qrGlobalDelayInput');
      if (gDelay) gDelay.value = String(val);
      persistUserPrefs();
    });
  }

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

  // 智能序号快捷模板：点击后填充模板并实时预览，勾选文件即可看到效果
  document.querySelectorAll('.qr-template-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      const template = e.currentTarget.dataset.template;
      const pad = parseInt(e.currentTarget.dataset.pad) || 2;

      const numTemplateInput = document.getElementById('qrNumTemplate');
      const numPadInput = document.getElementById('qrNumPad');
      if (numTemplateInput) numTemplateInput.value = template;
      if (numPadInput) numPadInput.value = pad;

      state.activeTab = 'numbering';
      document.querySelectorAll('.qr-tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'numbering'));
      document.getElementById('panelReplace').style.display = 'none';
      document.getElementById('panelPrefix').style.display = 'none';
      document.getElementById('panelNumbering').style.display = 'block';
      document.getElementById('panelExtension').style.display = 'none';
      document.getElementById('panelClean').style.display = 'none';

      updateConfigFromUI();
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
  bindCustomSelects(document.getElementById('viewMain'), updateConfigFromUI);

  document.querySelectorAll('#viewMain .qr-type-filters .qr-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('#viewMain .qr-type-filters .qr-chip').forEach((c) => c.classList.remove('active'));
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
    if (state.activeTab === 'numbering') {
      recalculateNewNames();
    } else {
      renderTable();
    }
  });

  startBtn.addEventListener('click', runBatchRename);

  const moveBtn = document.getElementById('qrMoveBtn');
  if (moveBtn) {
    moveBtn.addEventListener('click', () => runBatchMove());
  }

  const deleteBtn = document.getElementById('qrDeleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => runBatchDelete());
  }

  // 绑定工具箱、我的分享、全局搜改页签事件
  bindGlobalEvents();
  bindToolsEvents();
  bindSharesEvents();

  // 全局快捷键：Ctrl/Cmd + K 或 / 聚焦搜索框；Escape 分层关闭主面板
  if (!globalKeyBound) {
    globalKeyBound = true;
    document.addEventListener('keydown', (e) => {
      const modalOverlay = document.getElementById('qrModalOverlay');
      if (!modalOverlay || !modalOverlay.classList.contains('active')) return;

      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isEditing =
        activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const targetId =
          state.currentView === 'global' ? 'qrGlobalQueryInput' : state.currentView === 'shares' ? 'qrShareKeywordInput' : 'qrKeywordInput';
        const inputEl = document.getElementById(targetId);
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
        return;
      }

      if (e.key === '/' && !isEditing && !document.querySelector('.qr-dialog-overlay')) {
        e.preventDefault();
        const targetId =
          state.currentView === 'global' ? 'qrGlobalQueryInput' : state.currentView === 'shares' ? 'qrShareKeywordInput' : 'qrKeywordInput';
        const inputEl = document.getElementById(targetId);
        if (inputEl) inputEl.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (
          document.querySelector('.qr-system-dialog-overlay') ||
          document.querySelector('.qr-subdialog-overlay') ||
          document.querySelector('.qr-dialog-overlay')
        ) {
          return;
        }
        closeModal();
      }
    });
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'TOGGLE_RENAME_PANEL') {
      openModal();
      sendResponse({ success: true });
    }
  });

  window.addEventListener('qr-account-updated', (e) => {
    refreshAccountQuotaUI(false);
    const destFid = e?.detail?.destinationFid;
    if (destFid && state.mainMode === 'dir' && String(destFid) === String(state.pdir_fid) && state.currentView === 'main') {
      fetchFileList();
    }
  });
}
