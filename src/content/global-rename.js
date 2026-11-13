/**
 * 独立页签「全局搜改」：全盘跨目录检索 + 分页加载 + 规则联动替换 + 跨目录批量操作
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml, formatSize, formatTimestamp, log, sortFileItems } from './utils.js';
import { customAlert, customConfirm, toast } from './dialogs.js';
import { fetchSearchDrivePageBatch } from './api.js';
import { applyRenameRulesToItems } from './rename.js';
import { executeBatchRenameTargets, runBatchDelete, runBatchMove, runExtractDownloadLinks, runSingleRename } from './actions.js';
import { openCreateShareModal } from './share-actions.js';
import { prependCreatedShares } from './shares.js';
import { bindCustomSelects, buildCustomSelectHTML, navigateToDirectory, persistUserPrefs, switchPageView } from './ui.js';

function appendGlobalLog(msg) {
  log(msg);
  const gLog = document.getElementById('qrGlobalLogBox');
  if (!gLog) return;
  const timeStr = new Date().toLocaleTimeString();
  gLog.innerHTML += `<div>[${timeStr}] ${escapeHtml(msg)}</div>`;
  gLog.scrollTop = gLog.scrollHeight;
}

function renderStatusCellHtml(file) {
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
            ? `<button type="button" class="qr-btn-tool qr-btn-green qr-global-single-save" data-fid="${escapeHtml(file.fid)}" style="height: 22px; padding: 0 6px; font-size: 11px;">✓ 重试</button>`
            : ''
        }
      </div>
    `;
  }
  if (isChanged) {
    return `
      <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
        <span class="qr-status-badge qr-status-ready">待更新</span>
        <button type="button" class="qr-btn-tool qr-btn-green qr-global-single-save" data-fid="${escapeHtml(file.fid)}" style="height: 22px; padding: 0 6px; font-size: 11px;" title="仅保存此文件的修改">✓ 保存</button>
      </div>
    `;
  }
  return `<span class="qr-status-badge qr-status-idle">未变动</span>`;
}

function getFilteredGlobalItems() {
  const gs = state.globalSearch;
  const filterKw = String(gs.localFilter || '')
    .trim()
    .toLowerCase();

  gs.items.forEach((file) => {
    let visible = true;
    if (gs.targetType === 'file' && file.is_dir) visible = false;
    if (gs.targetType === 'dir' && !file.is_dir) visible = false;
    if (filterKw && !file.file_name.toLowerCase().includes(filterKw)) visible = false;
    file.visible = visible;
  });

  return gs.items.filter((f) => f.visible);
}

export function recalculateGlobalNames() {
  const gs = state.globalSearch;
  sortFileItems(gs.items, gs.sortBy);
  getFilteredGlobalItems();

  applyRenameRulesToItems(gs.items, {
    activeTab: gs.ruleTab,
    config: gs.config,
    onlyVisible: true,
    selectedOnlyNumbering: false
  });

  renderGlobalTable();
}

export function updateGlobalConfigFromUI() {
  const gs = state.globalSearch;
  const findEl = document.getElementById('qrGlobalFindInput');
  const repEl = document.getElementById('qrGlobalReplaceInput');
  const regexEl = document.getElementById('qrGlobalIsRegex');
  const ignoreEl = document.getElementById('qrGlobalIgnoreCase');
  const rangeEl = document.getElementById('qrGlobalTargetRangeSelect');
  const prefixEl = document.getElementById('qrGlobalPrefixInput');
  const suffixEl = document.getElementById('qrGlobalSuffixInput');
  const extEl = document.getElementById('qrGlobalNewExtInput');
  const caseEl = document.getElementById('qrGlobalCaseSelect');
  const cleanUrlEl = document.getElementById('qrGlobalCleanUrl');
  const cleanBracketEl = document.getElementById('qrGlobalCleanBracket');
  const cleanTradEl = document.getElementById('qrGlobalCleanTrad');
  const localFilterEl = document.getElementById('qrGlobalLocalFilterInput');
  const sortEl = document.getElementById('qrGlobalSortSelect');

  if (findEl) gs.config.replaceSearch = findEl.value;
  if (repEl) gs.config.replaceTarget = repEl.value;
  if (regexEl) gs.config.isRegex = regexEl.checked;
  if (ignoreEl) gs.config.ignoreCase = ignoreEl.checked;
  if (rangeEl && rangeEl.dataset.value) gs.config.targetRange = rangeEl.dataset.value;

  if (prefixEl) gs.config.prefix = prefixEl.value;
  if (suffixEl) gs.config.suffix = suffixEl.value;

  if (extEl) gs.config.newExt = extEl.value.trim();
  if (caseEl && caseEl.dataset.value) gs.config.caseChange = caseEl.dataset.value;

  if (cleanUrlEl) gs.config.cleanUrl = cleanUrlEl.checked;
  if (cleanBracketEl) gs.config.cleanBracket = cleanBracketEl.checked;
  if (cleanTradEl) gs.config.cleanTrad = cleanTradEl.checked;

  if (localFilterEl) gs.localFilter = localFilterEl.value;
  if (sortEl && sortEl.dataset.value) gs.sortBy = sortEl.dataset.value;

  recalculateGlobalNames();
}

export function updateGlobalStatBar() {
  const gs = state.globalSearch;
  const visible = gs.items.filter((f) => f.visible);
  const selected = visible.filter((f) => f.selected);
  const changedAll = visible.filter((f) => f.new_name !== f.file_name);
  const changedSelected = selected.filter((f) => f.new_name !== f.file_name);
  const filesSelected = selected.filter((f) => !f.is_dir);

  const metaEl = document.getElementById('qrGlobalSearchMeta');
  if (metaEl) {
    if (!gs.keyword && gs.items.length === 0) {
      metaEl.textContent = '输入关键词搜索全盘文件/文件夹并跨目录批量改名';
    } else {
      const totalInfo = gs.total > gs.items.length ? ` / 总计 ${gs.total} 项` : '';
      metaEl.textContent = `关键词「${gs.keyword}」：已加载 ${gs.items.length} 项${totalInfo} · 当前显示 ${visible.length} 项`;
    }
  }

  const statEl = document.getElementById('qrGlobalStatText');
  if (statEl) {
    statEl.textContent = `已选 ${selected.length} 项 · 待改 ${changedSelected.length} / 命中 ${changedAll.length}`;
  }

  const selChangedBtn = document.getElementById('qrGlobalSelectChangedBtn');
  if (selChangedBtn) {
    selChangedBtn.innerHTML = `${ICONS.check} 仅勾待改项 (${changedAll.length})`;
  }

  const shareBtn = document.getElementById('qrGlobalShareBtn');
  if (shareBtn) {
    shareBtn.innerHTML = selected.length > 0 ? `${ICONS.share} 分享 (${selected.length})` : `${ICONS.share} 分享`;
  }

  const moveBtn = document.getElementById('qrGlobalMoveBtn');
  if (moveBtn) {
    moveBtn.innerHTML = `${ICONS.move} 移动 (${selected.length})`;
  }

  const delBtn = document.getElementById('qrGlobalDeleteBtn');
  if (delBtn) {
    delBtn.innerHTML = `${ICONS.trash} 删除 (${selected.length})`;
  }

  const dlBtn = document.getElementById('qrGlobalDlBtn');
  if (dlBtn) {
    dlBtn.innerHTML = filesSelected.length > 0 ? `${ICONS.download} 直链 (${filesSelected.length})` : `${ICONS.download} 直链`;
  }

  const execBtn = document.getElementById('qrGlobalExecuteBtn');
  if (execBtn) {
    const labelCount = changedSelected.length > 0 ? changedSelected.length : changedAll.length;
    execBtn.innerHTML = labelCount > 0 ? `${ICONS.zap} 执行全局重命名 (${labelCount})` : `${ICONS.zap} 执行全局重命名`;
  }

  const loadMoreBtn = document.getElementById('qrGlobalLoadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle('hidden', !gs.hasMore || gs.items.length === 0);
    loadMoreBtn.disabled = gs.isLoading;
  }

  const selectAllCb = document.getElementById('qrGlobalSelectAll');
  if (selectAllCb) {
    selectAllCb.checked = visible.length > 0 && selected.length === visible.length;
    selectAllCb.indeterminate = selected.length > 0 && selected.length < visible.length;
  }
}

export function renderGlobalTable() {
  const tbody = document.getElementById('qrGlobalTableBody');
  if (!tbody) return;

  const gs = state.globalSearch;
  const visible = gs.items.filter((f) => f.visible);

  if (gs.isLoading && gs.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#60a5fa; padding:34px;">正在全盘检索「${escapeHtml(gs.keyword)}」...</td></tr>`;
    updateGlobalStatBar();
    return;
  }

  if (gs.items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; color:#71717a; padding:36px 16px;">
          ${
            gs.keyword
              ? `全盘未搜索到包含「${escapeHtml(gs.keyword)}」的文件或文件夹`
              : '在上方输入关键词点击「搜全盘」（支持快捷键 <b>Ctrl/Cmd + K</b> 或 <b>/</b> 快速聚焦），检索全网盘文件并跨目录批量改名。'
          }
        </td>
      </tr>
    `;
    updateGlobalStatBar();
    return;
  }

  if (visible.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#71717a; padding:30px;">没有符合当前二次过滤条件的结果</td></tr>`;
    updateGlobalStatBar();
    return;
  }

  const itemMap = new Map();
  visible.forEach((f) => itemMap.set(String(f.fid), f));

  tbody.innerHTML = visible
    .map((file) => {
      const fidStr = String(file.fid);
      const pdirStr = String(file.pdir_fid || '0');
      const pdirLabel = pdirStr === '0' ? '根目录' : `${pdirStr.slice(0, 8)}...`;
      const mainTitle = file.is_dir
        ? `<span class="qr-dir-link qr-global-enter-dir" data-fid="${escapeHtml(fidStr)}" data-name="${escapeHtml(file.file_name)}" title="进入此文件夹目录">${ICONS.folder} <span>${escapeHtml(file.file_name)}</span></span>`
        : `<span class="qr-global-file-name">${ICONS.file} <span>${escapeHtml(file.file_name)}</span></span>`;

      const metaSub = `
        <div class="qr-global-meta-line">
          <span>${file.is_dir ? '文件夹' : formatSize(file.size)}</span>
          ${file.updated_at ? `<span>· ${escapeHtml(formatTimestamp(file.updated_at))}</span>` : ''}
          <button type="button" class="qr-global-jump-btn" data-pdir="${escapeHtml(pdirStr)}" title="跳转到此文件所在的目录 (FID: ${escapeHtml(pdirStr)})">
            所在目录: ${escapeHtml(pdirLabel)} ➔
          </button>
        </div>
      `;

      return `
        <tr data-fid="${escapeHtml(fidStr)}">
          <td style="text-align:center;">
            <input type="checkbox" class="qr-global-cb" data-fid="${escapeHtml(fidStr)}" ${file.selected ? 'checked' : ''}>
          </td>
          <td class="qr-name-old">
            ${mainTitle}
            ${metaSub}
          </td>
          <td>
            <input type="text" class="qr-name-edit-input qr-global-edit-input" data-fid="${escapeHtml(fidStr)}" value="${escapeHtml(file.new_name)}" placeholder="修改文件名...">
          </td>
          <td class="qr-status-td">${renderStatusCellHtml(file)}</td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.qr-global-cb').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const target = itemMap.get(String(e.target.dataset.fid));
      if (target) target.selected = e.target.checked;
      updateGlobalStatBar();
    });
  });

  tbody.querySelectorAll('.qr-global-edit-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const target = itemMap.get(String(e.target.dataset.fid));
      if (!target) return;
      target.new_name = e.target.value;
      target.selected = true;
      target._renameError = '';
      target._regexError = '';

      const row = e.target.closest('tr');
      if (row) {
        const cb = row.querySelector('.qr-global-cb');
        if (cb) cb.checked = true;
        const statusTd = row.querySelector('.qr-status-td');
        if (statusTd) {
          statusTd.innerHTML = renderStatusCellHtml(target);
          const singleBtn = statusTd.querySelector('.qr-global-single-save');
          if (singleBtn) {
            singleBtn.onclick = () =>
              runSingleRename(target, {
                sourceLabel: '全局搜改',
                siblingPool: state.globalSearch.items,
                onAfterRename: () => renderGlobalTable()
              });
          }
        }
      }
      updateGlobalStatBar();
    });
  });

  tbody.querySelectorAll('.qr-global-single-save').forEach((btn) => {
    btn.onclick = () => {
      const target = itemMap.get(String(btn.dataset.fid));
      if (!target) return;
      runSingleRename(target, {
        sourceLabel: '全局搜改',
        siblingPool: state.globalSearch.items,
        onAfterRename: () => renderGlobalTable()
      });
    };
  });

  tbody.querySelectorAll('.qr-global-enter-dir').forEach((el) => {
    el.addEventListener('click', () => {
      const fid = el.dataset.fid || '0';
      const name = el.dataset.name || '文件夹';
      navigateToDirectory(fid, [
        { fid: '0', name: '全部文件' },
        { fid, name }
      ]);
    });
  });

  tbody.querySelectorAll('.qr-global-jump-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pdir = btn.dataset.pdir || '0';
      const crumbs =
        pdir === '0'
          ? [{ fid: '0', name: '全部文件' }]
          : [
              { fid: '0', name: '全部文件' },
              { fid: pdir, name: `目录 ${pdir.slice(0, 6)}...` }
            ];
      navigateToDirectory(pdir, crumbs);
    });
  });

  updateGlobalStatBar();
}

export async function runGlobalSearch(keyword, { append = false } = {}) {
  const gs = state.globalSearch;
  const query = String(append ? gs.keyword : (keyword ?? '')).trim();
  if (!query) {
    toast('请输入要搜索的文件名或关键词', 'info');
    const qInput = document.getElementById('qrGlobalQueryInput');
    if (qInput) qInput.focus();
    return;
  }

  if (gs.isLoading) return;

  const seq = ++gs.fetchSeq;
  gs.isLoading = true;
  if (!append) {
    gs.keyword = query;
    gs.items = [];
    gs.total = 0;
    gs.loadedPages = 0;
    gs.hasMore = false;

    const qInput = document.getElementById('qrGlobalQueryInput');
    if (qInput && qInput.value.trim() !== query) qInput.value = query;

    if (gs.autoSyncKeyword) {
      gs.config.replaceSearch = query;
      const findInput = document.getElementById('qrGlobalFindInput');
      if (findInput) findInput.value = query;
    }
  }

  const searchBtn = document.getElementById('qrGlobalSearchBtn');
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = `${ICONS.refresh} 搜索中...`;
  }
  renderGlobalTable();

  try {
    const startPage = append ? gs.loadedPages + 1 : 1;
    const batch = await fetchSearchDrivePageBatch({ query: gs.keyword, startPage, pageCount: 2, size: 100 });
    if (seq !== gs.fetchSeq) return;

    const existingFids = new Set(gs.items.map((x) => String(x.fid)));
    batch.items.forEach((item) => {
      if (!existingFids.has(String(item.fid))) {
        existingFids.add(String(item.fid));
        gs.items.push(item);
      }
    });

    gs.total = batch.total;
    gs.loadedPages = batch.lastPage;
    gs.hasMore = batch.hasMore;

    gs.isLoading = false;
    recalculateGlobalNames();
    appendGlobalLog(
      `全盘搜索「${gs.keyword}」${append ? '追加' : ''}命中 ${gs.items.length} 项${gs.total > gs.items.length ? `（云端共 ${gs.total} 项）` : ''}`
    );
  } catch (err) {
    if (seq !== gs.fetchSeq) return;
    gs.isLoading = false;
    appendGlobalLog(`全盘搜索失败: ${err.message}`);
    const tbody = document.getElementById('qrGlobalTableBody');
    if (tbody && gs.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444; padding:30px;">全盘搜索失败: ${escapeHtml(err.message || '请确认登录状态')}</td></tr>`;
    } else {
      renderGlobalTable();
      customAlert('搜索失败', err.message || '全盘搜索请求异常');
    }
  } finally {
    if (seq === gs.fetchSeq) {
      gs.isLoading = false;
      if (searchBtn) {
        searchBtn.disabled = false;
        searchBtn.innerHTML = `${ICONS.search} 搜全盘`;
      }
      updateGlobalStatBar();
    }
  }
}

export function openGlobalSearchWithKeyword(keyword = '') {
  switchPageView('global');
  const q = String(keyword || '').trim();
  const qInput = document.getElementById('qrGlobalQueryInput');
  if (q && qInput) {
    qInput.value = q;
    runGlobalSearch(q, { append: false });
  } else if (qInput) {
    setTimeout(() => qInput.focus(), 40);
  }
}

export function onEnterGlobalView() {
  const delayEl = document.getElementById('qrGlobalDelayInput');
  if (delayEl) {
    delayEl.value = String(state.delayMs || 500);
  }
  updateGlobalStatBar();
}

export function renderGlobalViewComponent() {
  const globalViewEl = document.getElementById('viewGlobal');
  if (!globalViewEl) return;

  const targetRangeHtml = buildCustomSelectHTML(
    'qrGlobalTargetRangeSelect',
    [
      { value: 'name', label: '仅主文件名' },
      { value: 'ext', label: '仅扩展名' },
      { value: 'all', label: '完整文件名' }
    ],
    state.globalSearch.config.targetRange || 'name'
  );

  const caseSelectHtml = buildCustomSelectHTML(
    'qrGlobalCaseSelect',
    [
      { value: 'none', label: '保持原样' },
      { value: 'lower', label: '转换为小写 (lowercase)' },
      { value: 'upper', label: '转换为大写 (UPPERCASE)' }
    ],
    state.globalSearch.config.caseChange || 'none'
  );

  const sortSelectHtml = buildCustomSelectHTML(
    'qrGlobalSortSelect',
    [
      { value: 'natural_asc', label: '自然数字升序 (1,2,10)' },
      { value: 'natural_desc', label: '自然数字降序 (10,2,1)' },
      { value: 'name_asc', label: '文件名 A ➔ Z' },
      { value: 'name_desc', label: '文件名 Z ➔ A' },
      { value: 'size_desc', label: '文件大小降序' },
      { value: 'updated_desc', label: '最近修改降序' }
    ],
    state.globalSearch.sortBy || 'natural_asc',
    'min-width: 148px;'
  );

  globalViewEl.innerHTML = `
    <div class="qr-global-search-bar">
      <div class="qr-global-search-inputs">
        <input type="text" id="qrGlobalQueryInput" class="qr-input qr-global-query-input" placeholder="输入全盘关键词 (如：宣传、1080p、旧前缀)，回车即搜全盘...">
        <button type="button" id="qrGlobalSearchBtn" class="qr-btn-primary" style="height: 30px; padding: 0 14px;">${ICONS.search} 搜全盘</button>
        <button type="button" id="qrGlobalLoadMoreBtn" class="qr-btn-tool qr-btn-blue hidden" title="继续向下加载更多搜索结果">${ICONS.refresh} 加载更多 (+200)</button>
        <button type="button" id="qrGlobalClearBtn" class="qr-btn-secondary" style="height: 30px;">清空</button>
      </div>
      <div class="qr-global-search-sub">
        <label class="qr-checkbox-label" title="每次全盘搜索后自动将搜索关键词同步填入下方「查找」框，实现搜到即改">
          <input type="checkbox" id="qrGlobalAutoSyncCb" ${state.globalSearch.autoSyncKeyword ? 'checked' : ''}> 自动填入查找词
        </label>
        <span id="qrGlobalSearchMeta" class="qr-global-meta-text">输入关键词搜索全盘文件/文件夹并跨目录批量改名</span>
      </div>
    </div>

    <div class="qr-controls-header">
      <div class="qr-tabs" id="qrGlobalRuleTabs">
        <button type="button" class="qr-tab-btn active" data-gtab="replace">全局查找替换</button>
        <button type="button" class="qr-tab-btn" data-gtab="prefix">添加前后缀</button>
        <button type="button" class="qr-tab-btn" data-gtab="extension">扩展名与大小写</button>
        <button type="button" class="qr-tab-btn" data-gtab="clean">一键净化清洗</button>
      </div>
    </div>

    <div id="qrGlobalConfigPanel" class="qr-config-panel">
      <div id="gPanelReplace" class="qr-panel-content">
        <div class="qr-input-row">
          <div class="qr-input-group" style="flex: 2;">
            <label>查找:</label>
            <input type="text" id="qrGlobalFindInput" class="qr-input" placeholder="要替换或删除的字符/正则">
          </div>
          <div class="qr-input-group" style="flex: 2;">
            <label>替换为:</label>
            <input type="text" id="qrGlobalReplaceInput" class="qr-input" placeholder="留空表示删除查找词 (支持 $1, $2)">
          </div>
          <div class="qr-input-group" style="flex: 1.2; min-width: 150px;">
            <label>作用范围:</label>
            ${targetRangeHtml}
          </div>
        </div>
        <div class="qr-input-row" style="margin-top: 6px;">
          <label class="qr-checkbox-label"><input type="checkbox" id="qrGlobalIsRegex"> 正则表达式</label>
          <label class="qr-checkbox-label" style="margin-left: 12px;"><input type="checkbox" id="qrGlobalIgnoreCase" checked> 忽略大小写</label>
        </div>
      </div>

      <div id="gPanelPrefix" class="qr-panel-content" style="display: none;">
        <div class="qr-input-row">
          <div class="qr-input-group">
            <label>添加前缀:</label>
            <input type="text" id="qrGlobalPrefixInput" class="qr-input" placeholder="最前面加入的文本">
          </div>
          <div class="qr-input-group">
            <label>添加后缀:</label>
            <input type="text" id="qrGlobalSuffixInput" class="qr-input" placeholder="扩展名前面加入的文本">
          </div>
        </div>
      </div>

      <div id="gPanelExtension" class="qr-panel-content" style="display: none;">
        <div class="qr-input-row">
          <div class="qr-input-group">
            <label>修改后缀:</label>
            <input type="text" id="qrGlobalNewExtInput" class="qr-input" placeholder="如 mkv (留空保持原后缀)">
          </div>
          <div class="qr-input-group">
            <label>字母大小写:</label>
            ${caseSelectHtml}
          </div>
        </div>
      </div>

      <div id="gPanelClean" class="qr-panel-content" style="display: none;">
        <div class="qr-input-row">
          <label class="qr-checkbox-label"><input type="checkbox" id="qrGlobalCleanUrl" checked> 清理广告网址域名</label>
          <label class="qr-checkbox-label" style="margin-left: 12px;"><input type="checkbox" id="qrGlobalCleanBracket" checked> 移除中括号/宣发后缀</label>
          <label class="qr-checkbox-label" style="margin-left: 12px;"><input type="checkbox" id="qrGlobalCleanTrad" checked> 繁体转简体中文</label>
        </div>
      </div>
    </div>

    <div class="qr-filter-bar">
      <div class="qr-type-filters" id="qrGlobalTypeFilters">
        <span class="qr-chip active" data-gtype="all">全部结果</span>
        <span class="qr-chip" data-gtype="file">仅文件</span>
        <span class="qr-chip" data-gtype="dir">仅文件夹</span>
      </div>
      <div class="qr-filter-controls">
        <div style="display: flex; align-items: center; gap: 4px;">
          <label style="font-size: 11px; color: #a1a1aa; white-space: nowrap;">排序:</label>
          ${sortSelectHtml}
        </div>
        <input type="text" id="qrGlobalLocalFilterInput" class="qr-input" placeholder="二次过滤 (.mp4/词)..." style="padding: 2px 8px; font-size: 11px; width: 145px; height: 26px; flex: none;">
        <button type="button" id="qrGlobalSelectChangedBtn" class="qr-btn-tool qr-btn-green" style="height: 26px; padding: 0 8px; font-size: 11px;" title="仅勾选名称将发生变化的结果行">${ICONS.check} 仅勾待改项 (0)</button>
      </div>
    </div>

    <div class="qr-table-wrap">
      <table class="qr-table">
        <thead>
          <tr>
            <th style="width: 38px; text-align: center;"><input type="checkbox" id="qrGlobalSelectAll"></th>
            <th>原文件名 &amp; 所在目录</th>
            <th>修改后名称 (可直接编辑)</th>
            <th style="width: 158px;">状态 / 操作</th>
          </tr>
        </thead>
        <tbody id="qrGlobalTableBody"></tbody>
      </table>
    </div>

    <div class="qr-global-footer">
      <div id="qrGlobalProgressWrap" class="qr-progress-bar-wrap">
        <div id="qrGlobalProgressInner" class="qr-progress-bar-inner"></div>
      </div>
      <div id="qrGlobalLogBox" class="qr-log-box"></div>
      <div class="qr-footer-actions">
        <div class="qr-delay-setting">
          <label>请求间隔(ms):</label>
          <input type="number" id="qrGlobalDelayInput" class="qr-input" value="${state.delayMs || 500}" min="100" max="3000" style="width: 66px; padding: 3px 6px;">
          <span id="qrGlobalStatText" style="font-size: 11px; color: #a1a1aa; margin-left: 6px;">已选 0 项 · 待改 0</span>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <button type="button" id="qrGlobalShareBtn" class="qr-btn-tool qr-btn-purple">${ICONS.share} 分享</button>
          <button type="button" id="qrGlobalDlBtn" class="qr-btn-tool qr-btn-blue">${ICONS.download} 直链</button>
          <button type="button" id="qrGlobalMoveBtn" class="qr-btn-primary qr-btn-blue-solid">${ICONS.move} 移动 (0)</button>
          <button type="button" id="qrGlobalDeleteBtn" class="qr-btn-primary qr-btn-red">${ICONS.trash} 删除 (0)</button>
          <button type="button" id="qrGlobalExecuteBtn" class="qr-btn-primary">${ICONS.zap} 执行全局重命名</button>
        </div>
      </div>
    </div>
  `;

  renderGlobalTable();
}

export function bindGlobalEvents() {
  const globalViewEl = document.getElementById('viewGlobal');
  if (!globalViewEl) return;

  const queryInput = document.getElementById('qrGlobalQueryInput');
  const searchBtn = document.getElementById('qrGlobalSearchBtn');
  const loadMoreBtn = document.getElementById('qrGlobalLoadMoreBtn');
  const clearBtn = document.getElementById('qrGlobalClearBtn');
  const autoSyncCb = document.getElementById('qrGlobalAutoSyncCb');
  const selectChangedBtn = document.getElementById('qrGlobalSelectChangedBtn');
  const selectAllCb = document.getElementById('qrGlobalSelectAll');
  const delayInput = document.getElementById('qrGlobalDelayInput');
  const execBtn = document.getElementById('qrGlobalExecuteBtn');
  const moveBtn = document.getElementById('qrGlobalMoveBtn');
  const delBtn = document.getElementById('qrGlobalDeleteBtn');
  const shareBtn = document.getElementById('qrGlobalShareBtn');
  const dlBtn = document.getElementById('qrGlobalDlBtn');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => runGlobalSearch(queryInput ? queryInput.value : '', { append: false }));
  }

  if (queryInput) {
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runGlobalSearch(queryInput.value, { append: false });
      }
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => runGlobalSearch(state.globalSearch.keyword, { append: true }));
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const gs = state.globalSearch;
      gs.fetchSeq++;
      gs.keyword = '';
      gs.items = [];
      gs.total = 0;
      gs.loadedPages = 0;
      gs.hasMore = false;
      gs.isLoading = false;
      gs.localFilter = '';
      if (queryInput) queryInput.value = '';
      const lf = document.getElementById('qrGlobalLocalFilterInput');
      if (lf) lf.value = '';
      const logBox = document.getElementById('qrGlobalLogBox');
      if (logBox) {
        logBox.style.display = 'none';
        logBox.innerHTML = '';
      }
      const progWrap = document.getElementById('qrGlobalProgressWrap');
      if (progWrap) progWrap.style.display = 'none';
      renderGlobalTable();
    });
  }

  if (autoSyncCb) {
    autoSyncCb.addEventListener('change', (e) => {
      state.globalSearch.autoSyncKeyword = e.target.checked;
    });
  }

  document.querySelectorAll('#qrGlobalRuleTabs .qr-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.gtab;
      state.globalSearch.ruleTab = tab;
      document.querySelectorAll('#qrGlobalRuleTabs .qr-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      const map = {
        replace: 'gPanelReplace',
        prefix: 'gPanelPrefix',
        extension: 'gPanelExtension',
        clean: 'gPanelClean'
      };
      Object.entries(map).forEach(([key, panelId]) => {
        const panel = document.getElementById(panelId);
        if (panel) panel.style.display = key === tab ? 'block' : 'none';
      });
      recalculateGlobalNames();
    });
  });

  const inputIds = [
    'qrGlobalFindInput',
    'qrGlobalReplaceInput',
    'qrGlobalIsRegex',
    'qrGlobalIgnoreCase',
    'qrGlobalPrefixInput',
    'qrGlobalSuffixInput',
    'qrGlobalNewExtInput',
    'qrGlobalCleanUrl',
    'qrGlobalCleanBracket',
    'qrGlobalCleanTrad',
    'qrGlobalLocalFilterInput'
  ];
  inputIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', updateGlobalConfigFromUI);
    el.addEventListener('change', updateGlobalConfigFromUI);
  });

  bindCustomSelects(globalViewEl, updateGlobalConfigFromUI);

  document.querySelectorAll('#qrGlobalTypeFilters .qr-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#qrGlobalTypeFilters .qr-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.globalSearch.targetType = chip.dataset.gtype || 'all';
      recalculateGlobalNames();
    });
  });

  if (selectChangedBtn) {
    selectChangedBtn.addEventListener('click', () => {
      const visible = state.globalSearch.items.filter((f) => f.visible);
      let count = 0;
      visible.forEach((f) => {
        const changed = f.new_name !== f.file_name;
        f.selected = changed;
        if (changed) count++;
      });
      renderGlobalTable();
      if (count === 0) {
        toast('当前没有名称发生变化的待修改项目', 'info');
      } else {
        toast(`已自动勾选 ${count} 个待重命名项目`);
      }
    });
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', (e) => {
      const checked = e.target.checked;
      state.globalSearch.items.forEach((f) => {
        if (f.visible) f.selected = checked;
      });
      renderGlobalTable();
    });
  }

  if (delayInput) {
    delayInput.addEventListener('change', () => {
      const val = Math.max(100, Math.min(3000, parseInt(delayInput.value, 10) || 500));
      state.delayMs = val;
      delayInput.value = String(val);
      const mainDelay = document.getElementById('qrDelayInput');
      if (mainDelay) mainDelay.value = String(val);
      persistUserPrefs();
    });
  }

  function runExecuteWithTargets(targets) {
    const logBox = document.getElementById('qrGlobalLogBox');
    const progWrap = document.getElementById('qrGlobalProgressWrap');
    const progInner = document.getElementById('qrGlobalProgressInner');

    executeBatchRenameTargets(targets, state.globalSearch.items, {
      delayMs: state.delayMs,
      sourceLabel: '全局搜改',
      logFn: appendGlobalLog,
      logBoxEl: logBox,
      progressWrapEl: progWrap,
      progressInnerEl: progInner,
      startBtnEl: execBtn,
      startBtnDefaultHtml: `${ICONS.zap} 执行全局重命名`,
      onValidationUpdate: () => renderGlobalTable(),
      onComplete: () => renderGlobalTable()
    });
  }

  if (execBtn) {
    execBtn.addEventListener('click', () => {
      const visible = state.globalSearch.items.filter((f) => f.visible);
      const selectedTargets = visible.filter((f) => f.selected && f.new_name !== f.file_name);
      if (selectedTargets.length > 0) {
        runExecuteWithTargets(selectedTargets);
        return;
      }

      const allChanged = visible.filter((f) => f.new_name !== f.file_name);
      if (allChanged.length === 0) {
        customAlert('提示', '当前列表没有名称发生变化的项目，请先设置查找替换/清洗规则或直接在表格右侧修改名称。');
        return;
      }

      customConfirm(
        '尚未勾选条目',
        `当前未勾选文件，但当前规则命中了 ${allChanged.length} 个待修改项目。\n是否立即勾选这 ${allChanged.length} 个项目并进入重命名确认？`,
        (ok) => {
          if (!ok) return;
          visible.forEach((f) => {
            f.selected = f.new_name !== f.file_name;
          });
          renderGlobalTable();
          runExecuteWithTargets(allChanged);
        }
      );
    });
  }

  if (moveBtn) {
    moveBtn.addEventListener('click', () => {
      const selected = state.globalSearch.items.filter((f) => f.visible && f.selected);
      runBatchMove(selected, {
        onCompleted: () => renderGlobalTable()
      });
    });
  }

  if (delBtn) {
    delBtn.addEventListener('click', () => {
      const selected = state.globalSearch.items.filter((f) => f.visible && f.selected);
      runBatchDelete(selected, {
        onCompleted: () => renderGlobalTable()
      });
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const selected = state.globalSearch.items.filter((f) => f.visible && f.selected);
      openCreateShareModal(selected, { onSharesCreated: prependCreatedShares });
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener('click', () => {
      const selected = state.globalSearch.items.filter((f) => f.visible && f.selected);
      runExtractDownloadLinks(selected);
    });
  }

  window.addEventListener('qr-files-mutated', () => {
    renderGlobalTable();
  });
}
