/**
 * 分享全生命周期增强动作：
 * 1. 主面板批量创建分享（公开/私密、7 档有效期、打包/逐个建链）
 * 2. 分享内部目录浏览与包内全树检索（支持部分文件勾选转存）
 * 3. 多分享链接批量链式转存（SaveAs + 任务轮询 + 满容保护）
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { copyTextToClipboard, escapeHtml, formatSize, formatTimestamp, friendlyErrorMessage, log, sanitizeHttpUrl } from './utils.js';
import {
  createShareAndResolve,
  isQuarkOk,
  requestAccountQuota,
  requestShareDetailPage,
  requestShareToken,
  saveShareAndPoll
} from './api.js';
import { customAlert, toast } from './dialogs.js';
import { openFolderPickerModal } from './picker.js';

const EXPIRE_OPTIONS = [
  { value: 1, label: '永久有效' },
  { value: 2, label: '1 天' },
  { value: 3, label: '7 天' },
  { value: 4, label: '30 天' },
  { value: 5, label: '60 天' },
  { value: 6, label: '100 天' },
  { value: 7, label: '180 天' }
];

function extractPwdId(urlOrId) {
  const s = String(urlOrId || '').trim();
  const match = s.match(/\/s\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9]{8,24}$/.test(s)) return s;
  return '';
}

export function parseShareLinksInput(rawText) {
  const lines = String(rawText || '').split(/\r?\n/);
  const map = new Map();
  let lastAdded = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const urlMatch = line.match(/https?:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:\?[a-zA-Z0-9_=&%.-]*)?/i);
    const pwdInlineMatch = line.match(/[?&]pwd=([a-zA-Z0-9]{3,12})/i);
    const pwdTextMatch = line.match(/(?:提取码|密码)[：:\s]*([a-zA-Z0-9]{3,12})/i);
    const passcodeInLine = (pwdInlineMatch && pwdInlineMatch[1]) || (pwdTextMatch && pwdTextMatch[1]) || '';

    if (urlMatch) {
      const shareUrl = urlMatch[0];
      const pwdId = urlMatch[1];
      let title = line
        .replace(shareUrl, '')
        .replace(/(?:提取码|密码)[：:\s]*[a-zA-Z0-9]{3,12}/gi, '')
        .replace(/(?:分享)?(?:链接|地址)[：:\s]*/gi, '')
        .replace(/[|｜\t]+/g, ' ')
        .replace(/^[\s,，;；\-—:：]+|[\s,，;；\-—:：]+$/g, '')
        .trim();

      if (!title) {
        title = `分享_${pwdId}`;
      }

      if (!map.has(pwdId)) {
        const entry = { pwdId, shareUrl, passcode: passcodeInLine, title };
        map.set(pwdId, entry);
        lastAdded = entry;
      } else if (passcodeInLine && !map.get(pwdId).passcode) {
        map.get(pwdId).passcode = passcodeInLine;
      }
    } else if (lastAdded && !lastAdded.passcode && pwdTextMatch) {
      lastAdded.passcode = pwdTextMatch[1];
    }
  }

  return Array.from(map.values());
}

function getDefaultDestination() {
  const currentFid = state.mainMode === 'dir' ? state.pdir_fid || '0' : '0';
  const crumbs =
    state.mainMode === 'dir' && Array.isArray(state.breadcrumbs) && state.breadcrumbs.length > 0
      ? state.breadcrumbs
      : [{ fid: '0', name: '全部文件' }];
  return {
    fid: currentFid,
    pathLabel: crumbs.map((c) => c.name).join(' / ')
  };
}

function formatCreatedShareText(res) {
  const codePart = res.passcode ? ` 提取码: ${res.passcode}` : '';
  return `${res.title}\n链接: ${res.share_url}${codePart}`.trim();
}

// ==========================================
// 1. 主面板选中文件 -> 一键创建/批量创建分享
// ==========================================
export function openCreateShareModal(
  selectedFiles,
  { onSharesCreated, initialTitle = '', initialUrlType = 1, initialExpiredType = 1 } = {}
) {
  const targets = Array.isArray(selectedFiles) ? selectedFiles.filter((f) => f && f.fid && !String(f.fid).startsWith('dom_')) : [];
  if (targets.length === 0) {
    customAlert('提示', '请先在主面板勾选至少一个有效文件或文件夹（DOM 降级条目缺少真实 FID 无法分享）。');
    return;
  }
  if (state.isRunning) {
    customAlert('提示', '当前已有批量任务正在执行中，请等待完成后再创建分享。');
    return;
  }

  document.querySelectorAll('.qr-dialog-overlay:not(.qr-system-dialog-overlay)').forEach((d) => d.remove());

  const fallbackTitle = targets.length === 1 ? targets[0].file_name : `${targets[0].file_name} 等 ${targets.length} 项`;
  const defaultTitle = String(initialTitle || '').trim() || fallbackTitle;
  let bundleMode = 'single'; // 'single' 打包分享 | 'each' 逐个建链
  let urlType = Number(initialUrlType) === 2 ? 2 : 1; // 1 公开 | 2 私密
  let expiredType = Math.min(7, Math.max(1, Number(initialExpiredType) || 1)); // 1..7
  const createdResults = [];

  const dialog = document.createElement('div');
  dialog.className = 'qr-dialog-overlay';
  dialog.innerHTML = `
    <div class="qr-dialog-box qr-share-create-box">
      <div class="qr-dialog-title qr-history-dialog-title">
        <span class="qr-title-text">${ICONS.share} 创建夸克分享链接（已选 ${targets.length} 项）</span>
        <button type="button" class="qr-close-btn qr-dialog-close" aria-label="关闭">&times;</button>
      </div>

      <div id="qrCreateShareForm" class="qr-dialog-content qr-share-form">
        <div class="qr-form-row">
          <label class="qr-form-label">生成模式</label>
          <div class="qr-segmented" id="qrShareBundleGroup">
            <button type="button" class="qr-seg-btn active" data-mode="single">打包为 1 个分享 (${targets.length} 项)</button>
            <button type="button" class="qr-seg-btn" data-mode="each" ${targets.length === 1 ? 'disabled' : ''}>逐项独立建链 (${targets.length} 次)</button>
          </div>
        </div>

        <div class="qr-form-row" id="qrShareTitleRow">
          <label class="qr-form-label" for="qrCreateShareTitle">分享标题</label>
          <input type="text" id="qrCreateShareTitle" class="qr-input" value="${escapeHtml(defaultTitle)}" placeholder="输入分享页面标题（留空将使用文件名）">
        </div>

        <div class="qr-form-row">
          <label class="qr-form-label">访问权限</label>
          <div class="qr-segmented" id="qrShareUrlTypeGroup">
            <button type="button" class="qr-seg-btn ${urlType === 1 ? 'active' : ''}" data-urltype="1">公开链接（免提取码）</button>
            <button type="button" class="qr-seg-btn ${urlType === 2 ? 'active' : ''}" data-urltype="2">${ICONS.lock} 私密链接（自动生成提取码）</button>
          </div>
        </div>

        <div class="qr-form-row">
          <label class="qr-form-label">有效期限</label>
          <div class="qr-expire-pills" id="qrShareExpireGroup">
            ${EXPIRE_OPTIONS.map((opt) => `<button type="button" class="qr-chip ${opt.value === expiredType ? 'active' : ''}" data-exp="${opt.value}">${opt.label}</button>`).join('')}
          </div>
        </div>
      </div>

      <div id="qrCreateShareProgress" class="qr-modal-progress hidden">
        <div class="qr-progress-bar-wrap" style="display:block;">
          <div id="qrCreateShareBar" class="qr-progress-bar-inner"></div>
        </div>
        <div id="qrCreateShareStage" class="qr-stage-text">准备就绪...</div>
        <div id="qrCreateShareResultList" class="qr-result-list"></div>
      </div>

      <div class="qr-dialog-actions" style="justify-content: space-between; margin-top: 12px;">
        <button type="button" id="qrCopyCreatedSharesBtn" class="qr-btn-tool qr-btn-purple hidden">${ICONS.copy} 复制全部分享文案</button>
        <div style="display:flex; gap:8px; margin-left:auto;">
          <button type="button" class="qr-btn-secondary qr-dialog-close" id="qrCreateShareCancelBtn">关闭</button>
          <button type="button" id="qrCreateShareStartBtn" class="qr-btn-primary" style="padding: 6px 16px;">${ICONS.share} 立即生成分享</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const onEsc = (e) => {
    if (e.key === 'Escape' && !state.isRunning && !document.querySelector('.qr-system-dialog-overlay')) {
      closeDialog();
    }
  };
  const closeDialog = () => {
    if (state.isRunning) {
      toast('分享创建任务正在进行中，请稍候...', 'info');
      return;
    }
    document.removeEventListener('keydown', onEsc);
    dialog.remove();
  };
  document.addEventListener('keydown', onEsc);
  dialog.querySelectorAll('.qr-dialog-close').forEach((btn) => btn.addEventListener('click', closeDialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });

  const titleRow = dialog.querySelector('#qrShareTitleRow');
  const titleInput = dialog.querySelector('#qrCreateShareTitle');
  const progressWrap = dialog.querySelector('#qrCreateShareProgress');
  const barEl = dialog.querySelector('#qrCreateShareBar');
  const stageEl = dialog.querySelector('#qrCreateShareStage');
  const resultListEl = dialog.querySelector('#qrCreateShareResultList');
  const copyAllBtn = dialog.querySelector('#qrCopyCreatedSharesBtn');
  const startBtn = dialog.querySelector('#qrCreateShareStartBtn');

  dialog.querySelectorAll('#qrShareBundleGroup .qr-seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      dialog.querySelectorAll('#qrShareBundleGroup .qr-seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bundleMode = btn.dataset.mode === 'each' ? 'each' : 'single';
      if (titleRow) titleRow.style.opacity = bundleMode === 'each' ? '0.45' : '1';
      if (titleInput) titleInput.disabled = bundleMode === 'each';
    });
  });

  dialog.querySelectorAll('#qrShareUrlTypeGroup .qr-seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      dialog.querySelectorAll('#qrShareUrlTypeGroup .qr-seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      urlType = Number(btn.dataset.urltype) === 2 ? 2 : 1;
    });
  });

  dialog.querySelectorAll('#qrShareExpireGroup .qr-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      dialog.querySelectorAll('#qrShareExpireGroup .qr-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      expiredType = Number(chip.dataset.exp) || 1;
    });
  });

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', async () => {
      const okItems = createdResults.filter((r) => r.ok);
      if (okItems.length === 0) return;
      const text = okItems.map(formatCreatedShareText).join('\n\n');
      const copied = await copyTextToClipboard(text);
      if (copied) toast(`已复制 ${okItems.length} 条分享链接与提取码`);
    });
  }

  function appendResultRow(res) {
    if (!resultListEl) return;
    const row = document.createElement('div');
    row.className = `qr-result-row ${res.ok ? 'is-ok' : 'is-err'}`;
    if (res.ok) {
      const safeHref = sanitizeHttpUrl(res.share_url);
      row.innerHTML = `
        <div class="qr-result-main">
          <div class="qr-result-title">${escapeHtml(res.title)}</div>
          <div class="qr-result-sub">
            ${safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer" class="qr-author-link">${escapeHtml(safeHref)}</a>` : escapeHtml(res.share_url)}
            ${res.passcode ? `<span class="qr-share-pwd-pill">提取码: ${escapeHtml(res.passcode)}</span>` : '<span style="color:#4ade80;">公开链接</span>'}
          </div>
        </div>
        <button type="button" class="qr-btn-tool qr-btn-purple qr-result-copy-one">${ICONS.copy} 复制</button>
      `;
      const copyBtn = row.querySelector('.qr-result-copy-one');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const copied = await copyTextToClipboard(formatCreatedShareText(res));
          if (copied) toast(`已复制：${res.title}`);
        });
      }
    } else {
      row.innerHTML = `
        <div class="qr-result-main">
          <div class="qr-result-title">${escapeHtml(res.title)}</div>
          <div class="qr-result-sub" style="color:#f87171;">${escapeHtml(res.error)}</div>
        </div>
      `;
    }
    resultListEl.appendChild(row);
    resultListEl.scrollTop = resultListEl.scrollHeight;
  }

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (state.isRunning) return;
      state.isRunning = true;
      startBtn.disabled = true;
      startBtn.innerHTML = `${ICONS.refresh} 生成中...`;
      if (progressWrap) progressWrap.classList.remove('hidden');
      if (resultListEl) resultListEl.innerHTML = '';
      createdResults.length = 0;

      const jobs =
        bundleMode === 'each'
          ? targets.map((file) => ({
              fidList: [file.fid],
              title: file.file_name,
              firstFile: file
            }))
          : [
              {
                fidList: targets.map((f) => f.fid),
                title: (titleInput ? titleInput.value.trim() : '') || defaultTitle,
                firstFile: targets[0]
              }
            ];

      const delayInput = document.getElementById('qrDelayInput');
      const delayMs = Math.max(200, parseInt(delayInput?.value, 10) || state.delayMs || 500);
      const rawCreatedForSharesView = [];

      try {
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          const pct = Math.round(((i + 1) / jobs.length) * 100);
          if (barEl) barEl.style.width = `${pct}%`;
          if (stageEl) stageEl.textContent = `[${i + 1}/${jobs.length}] 正在分享「${job.title}」...`;

          const res = await createShareAndResolve({
            fidList: job.fidList,
            title: job.title,
            urlType,
            expiredType,
            onStage: (text) => {
              if (stageEl) stageEl.textContent = `[${i + 1}/${jobs.length}] ${job.title} · ${text}`;
            }
          });

          if (isQuarkOk(res) && res.data?.share_url) {
            const d = res.data;
            const entry = {
              ok: true,
              title: d.title || job.title,
              share_url: d.share_url,
              passcode: d.passcode || '',
              share_id: d.share_id || '',
              pwd_id: d.pwd_id || extractPwdId(d.share_url)
            };
            createdResults.push(entry);
            appendResultRow(entry);
            rawCreatedForSharesView.push({
              share_id: entry.share_id,
              pwd_id: entry.pwd_id,
              title: entry.title,
              share_url: entry.share_url,
              passcode: entry.passcode,
              url_type: urlType,
              expired_type: expiredType,
              created_at: Date.now(),
              updated_at: Date.now(),
              audit_status: 4,
              status: 1,
              first_fid: job.firstFile?.fid || '',
              first_file: {
                fid: job.firstFile?.fid || '',
                file_name: job.firstFile?.file_name || entry.title,
                dir: Boolean(job.firstFile?.is_dir),
                size: job.firstFile?.size || 0
              },
              file_only_num: job.fidList.length,
              all_file_num: job.fidList.length,
              size:
                targets.length === job.fidList.length ? targets.reduce((s, f) => s + (Number(f.size) || 0), 0) : job.firstFile?.size || 0
            });
            log(`分享生成成功: ${entry.title} -> ${entry.share_url}`);
          } else {
            const errMsg = friendlyErrorMessage(res);
            const entry = { ok: false, title: job.title, error: errMsg };
            createdResults.push(entry);
            appendResultRow(entry);
            log(`分享生成失败 (${job.title}): ${errMsg}`);
          }

          if (i < jobs.length - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        const successCount = createdResults.filter((r) => r.ok).length;
        const failCount = createdResults.length - successCount;
        if (stageEl) stageEl.textContent = `执行完毕：成功 ${successCount} 项，失败 ${failCount} 项`;
        if (successCount > 0 && copyAllBtn) copyAllBtn.classList.remove('hidden');

        if (rawCreatedForSharesView.length > 0 && typeof onSharesCreated === 'function') {
          onSharesCreated(rawCreatedForSharesView);
        }

        if (successCount > 0) {
          toast(`成功生成 ${successCount} 条分享链接`);
        }
      } finally {
        state.isRunning = false;
        startBtn.disabled = false;
        startBtn.innerHTML = `${ICONS.share} 重新生成`;
      }
    });
  }
}

// ==========================================
// 2. 分享详情弹窗内的「包内文件浏览 & 搜索」引擎
// ==========================================
function isRiskyShareItem(raw) {
  return Boolean(
    Number(raw.risk_type) > 0 || raw.ban_flag || raw.audit_status === 2 || raw.status === 0 || raw.status === 3 || raw.violation
  );
}

function normalizeShareInnerItem(raw, parentFid, relPath = '') {
  const fileName = String(raw.file_name || raw.filename || '未命名');
  const isDir = Boolean(raw.dir || raw.file_type === '0' || raw.file_type === 0 || raw.file_type === 'dir');
  return {
    fid: String(raw.fid || ''),
    pdir_fid: String(parentFid || '0'),
    file_name: fileName,
    is_dir: isDir,
    size: Number(raw.size) || 0,
    share_fid_token: String(raw.share_fid_token || ''),
    updated_at: Number(raw.updated_at || raw.l_updated_at) || 0,
    relPath: relPath || fileName,
    isRisky: isRiskyShareItem(raw),
    selected: false
  };
}

export function mountShareInnerBrowser(containerEl, shareItem, { onSaveSelected } = {}) {
  if (!containerEl) return;

  const pwdId = shareItem.pwd_id || extractPwdId(shareItem.share_url);
  if (!pwdId) {
    containerEl.innerHTML = `<div class="qr-picker-empty">当前分享缺少有效的分享 ID (pwd_id)，无法在线读取内部文件列表。</div>`;
    return;
  }

  let activeStoken = shareItem.stoken || '';
  const breadcrumbs = [{ fid: '0', name: shareItem.title || '根目录' }];
  let currentFid = '0';
  let currentEntries = [];
  let inSearchView = false;
  let searchKeyword = '';
  let loadSeq = 0;

  containerEl.innerHTML = `
    <div class="qr-share-browser-bar">
      <div id="qrShareInnerCrumbs" class="qr-breadcrumbs-bar" style="flex:1; min-width:0;"></div>
      <div class="qr-share-browser-search">
        <input type="text" id="qrShareInnerKwInput" class="qr-input" placeholder="搜索包内文件 (BFS 全树)..." style="height:26px; font-size:11px; width:160px;">
        <button type="button" id="qrShareInnerSearchBtn" class="qr-btn-tool qr-btn-blue" style="height:26px; padding:0 8px;">${ICONS.search} 搜索</button>
        <button type="button" id="qrShareInnerResetBtn" class="qr-btn-tool qr-btn-amber hidden" style="height:26px; padding:0 8px;">返回目录</button>
      </div>
    </div>

    <div class="qr-share-browser-table-wrap">
      <table class="qr-table" style="font-size:11px;">
        <thead>
          <tr>
            <th style="width:34px; text-align:center;"><input type="checkbox" id="qrShareInnerSelectAll" aria-label="全选当前文件"></th>
            <th>文件名 ${shareItem.partial_violation ? '（含异常检测）' : ''}</th>
            <th style="width:84px;">大小</th>
            <th style="width:152px;">状态 / 更新时间</th>
          </tr>
        </thead>
        <tbody id="qrShareInnerTbody">
          <tr><td colspan="4" style="text-align:center; color:#71717a; padding:24px;">切换到本页签后开始加载包内目录...</td></tr>
        </tbody>
      </table>
    </div>

    <div class="qr-share-browser-foot">
      <span id="qrShareInnerStatus" style="font-size:11px; color:#a1a1aa;">尚未加载</span>
      <button type="button" id="qrShareInnerSaveSelectedBtn" class="qr-btn-tool qr-btn-green" disabled>${ICONS.download} 转存选中文件 (0)</button>
    </div>
  `;

  const crumbsEl = containerEl.querySelector('#qrShareInnerCrumbs');
  const kwInput = containerEl.querySelector('#qrShareInnerKwInput');
  const searchBtn = containerEl.querySelector('#qrShareInnerSearchBtn');
  const resetBtn = containerEl.querySelector('#qrShareInnerResetBtn');
  const selectAllCb = containerEl.querySelector('#qrShareInnerSelectAll');
  const tbodyEl = containerEl.querySelector('#qrShareInnerTbody');
  const statusEl = containerEl.querySelector('#qrShareInnerStatus');
  const saveSelBtn = containerEl.querySelector('#qrShareInnerSaveSelectedBtn');

  async function ensureStoken(forceRefresh = false) {
    if (activeStoken && !forceRefresh) return activeStoken;
    const tokRes = await requestShareToken(pwdId, shareItem.passcode || '');
    if (!isQuarkOk(tokRes) || !tokRes.data?.stoken) {
      throw new Error(friendlyErrorMessage(tokRes));
    }
    activeStoken = tokRes.data.stoken;
    shareItem.stoken = activeStoken;
    return activeStoken;
  }

  async function fetchFolderAllPages(pdirFid, relPrefix = '') {
    const token = await ensureStoken(false);
    const items = [];
    const pageSize = 100;

    for (let page = 1; page <= 5; page++) {
      let res = await requestShareDetailPage({ pwdId, stoken: token, pdirFid, page, size: pageSize });
      if (
        Number(res?.code) === 41008 ||
        String(res?.message || '')
          .toLowerCase()
          .includes('stoken')
      ) {
        const refreshed = await ensureStoken(true);
        res = await requestShareDetailPage({ pwdId, stoken: refreshed, pdirFid, page, size: pageSize });
      }
      if (!isQuarkOk(res)) {
        throw new Error(friendlyErrorMessage(res));
      }

      const list = Array.isArray(res.data?.list) ? res.data.list : [];
      list.forEach((raw) => {
        const name = String(raw.file_name || raw.filename || '');
        const rel = relPrefix ? `${relPrefix}/${name}` : name;
        items.push(normalizeShareInnerItem(raw, pdirFid, rel));
      });

      const total = Number(res.metadata?._total ?? res.data?.total ?? 0);
      if (list.length < pageSize || (total > 0 && items.length >= total)) break;
    }

    return items;
  }

  function renderBreadcrumbs() {
    if (!crumbsEl) return;
    if (inSearchView) {
      crumbsEl.innerHTML = `<span class="qr-crumb-item current">${ICONS.search} 包内搜索: "${escapeHtml(searchKeyword)}" (${currentEntries.length} 项)</span>`;
      return;
    }
    crumbsEl.innerHTML = breadcrumbs
      .map((c, idx) => {
        if (idx === breadcrumbs.length - 1) {
          return `<span class="qr-crumb-item current">${escapeHtml(c.name)}</span>`;
        }
        return `<span class="qr-crumb-item" data-idx="${idx}">${escapeHtml(c.name)}</span><span class="qr-crumb-sep">/</span>`;
      })
      .join('');

    crumbsEl.querySelectorAll('.qr-crumb-item[data-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        if (Number.isNaN(idx)) return;
        breadcrumbs.splice(idx + 1);
        loadDirectory(breadcrumbs[breadcrumbs.length - 1].fid);
      });
    });
  }

  function updateFooterCount() {
    const selected = currentEntries.filter((e) => e.selected);
    if (saveSelBtn) {
      saveSelBtn.disabled = selected.length === 0;
      saveSelBtn.innerHTML = `${ICONS.download} 转存选中文件 (${selected.length})`;
    }
    if (selectAllCb) {
      selectAllCb.checked = currentEntries.length > 0 && selected.length === currentEntries.length;
      selectAllCb.indeterminate = selected.length > 0 && selected.length < currentEntries.length;
    }
  }

  function renderRows() {
    if (!tbodyEl) return;
    if (currentEntries.length === 0) {
      tbodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#71717a; padding:26px;">${inSearchView ? '包内未搜索到匹配文件' : '该目录下无文件'}</td></tr>`;
      updateFooterCount();
      return;
    }

    const rowMap = new Map();
    currentEntries.forEach((it) => rowMap.set(it.fid, it));

    tbodyEl.innerHTML = currentEntries
      .map((entry) => {
        const nameBlock = entry.is_dir
          ? `<span class="qr-dir-link qr-inner-dir" data-fid="${escapeHtml(entry.fid)}" data-name="${escapeHtml(entry.file_name)}">${ICONS.folder} <span>${escapeHtml(entry.file_name)}</span></span>`
          : `<span class="qr-main-file-name">${ICONS.file} <span>${escapeHtml(entry.file_name)}</span></span>`;
        const pathSub =
          inSearchView && entry.relPath !== entry.file_name
            ? `<div style="font-size:10px; color:#71717a; padding-left:18px;">${escapeHtml(entry.relPath)}</div>`
            : '';
        const statusCell = entry.isRisky
          ? `<span class="qr-share-badge qr-share-badge-red">疑似违规/受限</span>`
          : `<span style="color:#71717a;">${escapeHtml(formatTimestamp(entry.updated_at))}</span>`;

        return `
          <tr>
            <td style="text-align:center;"><input type="checkbox" class="qr-inner-cb" data-fid="${escapeHtml(entry.fid)}" ${entry.selected ? 'checked' : ''}></td>
            <td>${nameBlock}${pathSub}</td>
            <td>${entry.is_dir ? '文件夹' : formatSize(entry.size)}</td>
            <td>${statusCell}</td>
          </tr>
        `;
      })
      .join('');

    tbodyEl.querySelectorAll('.qr-inner-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const item = rowMap.get(cb.dataset.fid);
        if (item) item.selected = cb.checked;
        updateFooterCount();
      });
    });

    tbodyEl.querySelectorAll('.qr-inner-dir').forEach((el) => {
      el.addEventListener('click', () => {
        const nextFid = el.dataset.fid;
        const nextName = el.dataset.name || '文件夹';
        inSearchView = false;
        if (resetBtn) resetBtn.classList.add('hidden');
        breadcrumbs.push({ fid: nextFid, name: nextName });
        loadDirectory(nextFid);
      });
    });

    updateFooterCount();
  }

  async function loadDirectory(pdirFid) {
    const seq = ++loadSeq;
    inSearchView = false;
    currentFid = String(pdirFid || '0');
    if (resetBtn) resetBtn.classList.add('hidden');
    renderBreadcrumbs();
    if (tbodyEl) {
      tbodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#60a5fa; padding:24px;">正在拉取包内目录文件...</td></tr>`;
    }
    if (statusEl) statusEl.textContent = '加载中...';

    try {
      const items = await fetchFolderAllPages(currentFid);
      if (seq !== loadSeq) return;
      currentEntries = items;
      renderRows();
      if (statusEl) statusEl.textContent = `当前目录共 ${items.length} 项`;
    } catch (err) {
      if (seq !== loadSeq) return;
      if (tbodyEl) {
        tbodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f87171; padding:24px;">加载失败: ${escapeHtml(err.message || '请检查链接是否有效')}</td></tr>`;
      }
      if (statusEl) statusEl.textContent = `加载异常: ${err.message}`;
    }
  }

  async function searchInsideShare(kw) {
    const query = String(kw || '')
      .trim()
      .toLowerCase();
    if (!query) {
      loadDirectory(currentFid);
      return;
    }

    const seq = ++loadSeq;
    inSearchView = true;
    searchKeyword = kw.trim();
    if (resetBtn) resetBtn.classList.remove('hidden');
    renderBreadcrumbs();

    if (tbodyEl) {
      tbodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#60a5fa; padding:24px;">正在深度遍历包内目录检索「${escapeHtml(searchKeyword)}」...</td></tr>`;
    }

    try {
      const queue = [{ fid: '0', prefix: '', depth: 0 }];
      const matches = [];
      let visitedDirs = 0;
      const maxDirs = 50;
      const maxDepth = 4;

      while (queue.length > 0 && visitedDirs < maxDirs) {
        if (seq !== loadSeq) return;
        const { fid, prefix, depth } = queue.shift();
        visitedDirs++;
        if (statusEl) statusEl.textContent = `扫描目录 ${visitedDirs}/${maxDirs} · 命中 ${matches.length} 项...`;

        const children = await fetchFolderAllPages(fid, prefix);
        if (seq !== loadSeq) return;

        for (const item of children) {
          if (item.file_name.toLowerCase().includes(query)) {
            matches.push(item);
          }
          if (item.is_dir && depth < maxDepth) {
            queue.push({ fid: item.fid, prefix: item.relPath, depth: depth + 1 });
          }
        }

        if (queue.length > 0) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }

      currentEntries = matches;
      renderBreadcrumbs();
      renderRows();
      if (statusEl) statusEl.textContent = `搜索完成（扫描 ${visitedDirs} 个目录），匹配 ${matches.length} 项`;
    } catch (err) {
      if (seq !== loadSeq) return;
      if (tbodyEl) {
        tbodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f87171; padding:24px;">搜索失败: ${escapeHtml(err.message)}</td></tr>`;
      }
      if (statusEl) statusEl.textContent = `搜索失败`;
    }
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      currentEntries.forEach((it) => {
        it.selected = selectAllCb.checked;
      });
      renderRows();
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => searchInsideShare(kwInput ? kwInput.value : ''));
  }

  if (kwInput) {
    kwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchInsideShare(kwInput.value);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (kwInput) kwInput.value = '';
      loadDirectory(currentFid);
    });
  }

  if (saveSelBtn) {
    saveSelBtn.addEventListener('click', () => {
      const selected = currentEntries.filter((it) => it.selected && it.fid);
      if (selected.length === 0) return;
      if (typeof onSaveSelected === 'function') {
        onSaveSelected({
          title: shareItem.title,
          pwdId,
          passcode: shareItem.passcode || '',
          stoken: activeStoken,
          pdirFid: inSearchView ? selected[0].pdir_fid : currentFid,
          items: selected
        });
      }
    });
  }

  return {
    ensureLoaded() {
      if (currentEntries.length === 0 && loadSeq === 0) {
        loadDirectory('0');
      }
    }
  };
}

// ==========================================
// 3. 多分享链接 / 指定包内文件 批量链式转存（SaveAs）
// ==========================================
export function groupDirectEntriesByParent(directEntries) {
  const byParent = new Map();
  const fallbackParent = String(directEntries?.pdirFid || '0');
  (directEntries?.items || []).forEach((it) => {
    const parentFid = String(it.pdir_fid || fallbackParent || '0');
    if (!byParent.has(parentFid)) {
      byParent.set(parentFid, []);
    }
    byParent.get(parentFid).push(it);
  });

  const groups = Array.from(byParent.entries());
  return groups.map(([pdirFid, items], idx) => ({
    mode: 'direct',
    title:
      groups.length > 1
        ? `${directEntries.title || directEntries.pwdId} (目录组 ${idx + 1} · ${items.length} 项)`
        : directEntries.title || directEntries.pwdId,
    pwdId: directEntries.pwdId,
    passcode: directEntries.passcode,
    stoken: directEntries.stoken,
    pdirFid,
    items
  }));
}

export function openBatchSaveAsModal({ initialLinksText = '', directEntries = null } = {}) {
  if (state.isRunning) {
    customAlert('提示', '当前已有任务正在执行中，请等待当前任务完成后再发起转存。');
    return;
  }

  const isDirectMode = Boolean(directEntries && Array.isArray(directEntries.items) && directEntries.items.length > 0);
  const directJobs = isDirectMode ? groupDirectEntriesByParent(directEntries) : [];
  const overlayClass = isDirectMode ? 'qr-dialog-overlay qr-subdialog-overlay' : 'qr-dialog-overlay';
  if (!isDirectMode) {
    document.querySelectorAll('.qr-dialog-overlay:not(.qr-system-dialog-overlay)').forEach((d) => d.remove());
  } else {
    document.querySelectorAll('.qr-subdialog-overlay').forEach((d) => d.remove());
  }

  let destination = getDefaultDestination();

  const dialog = document.createElement('div');
  dialog.className = overlayClass;
  dialog.innerHTML = `
    <div class="qr-dialog-box qr-saveas-box">
      <div class="qr-dialog-title qr-history-dialog-title">
        <span class="qr-title-text">${ICONS.download} ${isDirectMode ? `转存选中文件 (${directEntries.items.length} 项)` : '批量链式转存（SaveAs）'}</span>
        <button type="button" class="qr-close-btn qr-dialog-close" aria-label="关闭">&times;</button>
      </div>

      <div class="qr-dialog-content qr-share-form">
        <div class="qr-saveas-dest-bar">
          <div class="qr-saveas-dest-info">
            <span class="qr-form-label" style="margin:0;">保存目录：</span>
            <span id="qrSaveAsDestText" class="qr-saveas-dest-path">${escapeHtml(destination.pathLabel)}</span>
            <span class="qr-share-code-pill" id="qrSaveAsDestFid">(FID: ${escapeHtml(destination.fid)})</span>
          </div>
          <button type="button" id="qrSaveAsPickDirBtn" class="qr-btn-tool qr-btn-blue">${ICONS.folder} 选择目标目录</button>
        </div>

        <div id="qrSaveAsQuotaBanner" class="qr-saveas-quota-banner">正在读取当前账号剩余可用容量...</div>

        ${
          isDirectMode
            ? `
          <div class="qr-saveas-direct-preview">
            <div style="font-size:12px; color:#fafafa; font-weight:500;">来源分享：${escapeHtml(directEntries.title || directEntries.pwdId)}</div>
            <div style="font-size:11px; color:#a1a1aa; margin-top:4px;">已选中 ${directEntries.items.length} 个项目（总大小约 ${formatSize(directEntries.items.reduce((s, it) => s + (it.size || 0), 0))}）</div>
          </div>
        `
            : `
          <div>
            <div style="font-size:12px; color:#a1a1aa; margin-bottom:6px;">
              每行粘贴一条夸克分享链接（自动识别 <code>?pwd=</code> 与同行/次行提取码），将按全局请求间隔排队转存并轮询结果：
            </div>
            <textarea id="qrSaveAsTextarea" class="qr-share-textarea" style="height:135px;" placeholder="示例：
https://pan.quark.cn/s/xxxxxx?pwd=abcd
某部资料 https://pan.quark.cn/s/yyyyyy 提取码: 1234">${escapeHtml(initialLinksText)}</textarea>
          </div>
        `
        }

        <div id="qrSaveAsProgressWrap" class="qr-modal-progress hidden">
          <div class="qr-progress-bar-wrap" style="display:block;">
            <div id="qrSaveAsBar" class="qr-progress-bar-inner"></div>
          </div>
          <div id="qrSaveAsStage" class="qr-stage-text">准备中...</div>
          <div id="qrSaveAsResults" class="qr-result-list"></div>
        </div>
      </div>

      <div class="qr-dialog-actions" style="justify-content: space-between;">
        <span id="qrSaveAsParseCount" style="font-size:11px; color:#71717a;">${isDirectMode ? `共 ${directJobs.length} 个目录转存任务（${directEntries.items.length} 项）` : ''}</span>
        <div style="display:flex; gap:8px;">
          <button type="button" class="qr-btn-secondary qr-dialog-close">关闭</button>
          <button type="button" id="qrSaveAsStartBtn" class="qr-btn-primary" style="padding: 6px 16px;">${ICONS.download} 开始执行转存</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const destTextEl = dialog.querySelector('#qrSaveAsDestText');
  const destFidEl = dialog.querySelector('#qrSaveAsDestFid');
  const pickBtn = dialog.querySelector('#qrSaveAsPickDirBtn');
  const quotaBanner = dialog.querySelector('#qrSaveAsQuotaBanner');
  const textarea = dialog.querySelector('#qrSaveAsTextarea');
  const parseCountEl = dialog.querySelector('#qrSaveAsParseCount');
  const progressWrap = dialog.querySelector('#qrSaveAsProgressWrap');
  const barEl = dialog.querySelector('#qrSaveAsBar');
  const stageEl = dialog.querySelector('#qrSaveAsStage');
  const resultsEl = dialog.querySelector('#qrSaveAsResults');
  const startBtn = dialog.querySelector('#qrSaveAsStartBtn');

  const closeDialog = () => {
    if (state.isRunning) {
      toast('转存任务正在执行中，请勿关闭弹窗', 'info');
      return;
    }
    document.removeEventListener('keydown', onEsc);
    dialog.remove();
  };
  const onEsc = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.qr-system-dialog-overlay') && !document.querySelector('.qr-picker-box')) {
      closeDialog();
    }
  };
  document.addEventListener('keydown', onEsc);
  dialog.querySelectorAll('.qr-dialog-close').forEach((btn) => btn.addEventListener('click', closeDialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });

  function updateParsedCount() {
    if (!textarea || !parseCountEl) return;
    const links = parseShareLinksInput(textarea.value);
    parseCountEl.textContent = `已识别 ${links.length} 条去重分享链接`;
  }
  if (textarea) {
    textarea.addEventListener('input', updateParsedCount);
    updateParsedCount();
  }

  // 加载实时剩余容量提示
  let freeBytes = -1;
  (async () => {
    const acc = await requestAccountQuota();
    if (!dialog.isConnected || !quotaBanner) return;
    if (acc && acc.loggedIn && acc.total_capacity > 0) {
      freeBytes = Math.max(0, acc.total_capacity - acc.use_capacity);
      const pct = Math.round((acc.use_capacity / acc.total_capacity) * 100);
      const isLow = pct >= 90;
      quotaBanner.className = `qr-saveas-quota-banner ${isLow ? 'is-warn' : 'is-ok'}`;
      quotaBanner.innerHTML = `${isLow ? ICONS.warn : ICONS.check} 当前账号 <b>${escapeHtml(acc.nickname)}</b> · 剩余可用容量 <b>${formatSize(freeBytes)}</b>（已用 ${pct}%）`;
    } else {
      quotaBanner.className = 'qr-saveas-quota-banner';
      quotaBanner.textContent = '未检测到账号容量数据，将在提交时由服务端校验空间';
    }
  })();

  if (pickBtn) {
    pickBtn.addEventListener('click', () => {
      openFolderPickerModal({
        title: '选择转存目标文件夹',
        confirmText: '选为转存目标',
        initialFid: destination.fid,
        onConfirm: ({ fid, pathLabel }) => {
          destination = { fid, pathLabel };
          if (destTextEl) destTextEl.textContent = pathLabel;
          if (destFidEl) destFidEl.textContent = `(FID: ${fid})`;
        }
      });
    });
  }

  function appendSaveResult(row) {
    if (!resultsEl) return;
    const el = document.createElement('div');
    el.className = `qr-result-row ${row.ok ? 'is-ok' : 'is-err'}`;
    el.innerHTML = `
      <div class="qr-result-main">
        <div class="qr-result-title">${escapeHtml(row.title)}</div>
        <div class="qr-result-sub" style="color:${row.ok ? '#4ade80' : '#f87171'};">${escapeHtml(row.message)}</div>
      </div>
    `;
    resultsEl.appendChild(el);
    resultsEl.scrollTop = resultsEl.scrollHeight;
  }

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (state.isRunning) return;

      const jobs = isDirectMode
        ? directJobs
        : parseShareLinksInput(textarea ? textarea.value : '').map((link) => ({ mode: 'link', ...link }));

      if (jobs.length === 0) {
        customAlert('提示', '请至少输入一条有效的夸克分享链接（https://pan.quark.cn/s/...）。');
        return;
      }

      state.isRunning = true;
      startBtn.disabled = true;
      startBtn.innerHTML = `${ICONS.refresh} 转存排队中...`;
      if (progressWrap) progressWrap.classList.remove('hidden');
      if (resultsEl) resultsEl.innerHTML = '';

      const delayInput = document.getElementById('qrDelayInput');
      const delayMs = Math.max(300, parseInt(delayInput?.value, 10) || state.delayMs || 500);
      let okCount = 0;
      let failCount = 0;
      let stoppedByQuota = false;

      try {
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          const pct = Math.round(((i + 1) / jobs.length) * 100);
          if (barEl) barEl.style.width = `${pct}%`;
          if (stageEl) stageEl.textContent = `[${i + 1}/${jobs.length}] 处理「${job.title}」...`;

          try {
            let stoken = job.stoken || '';
            let fidList = [];
            let fidTokenList = [];
            let shareTitle = job.title;
            let pdirFid = job.pdirFid || '0';
            let estimatedBytes = 0;

            if (job.mode === 'direct') {
              fidList = job.items.map((it) => it.fid);
              fidTokenList = job.items.map((it) => it.share_fid_token || '');
              estimatedBytes = job.items.reduce((s, it) => s + (Number(it.size) || 0), 0);
            } else {
              if (stageEl) stageEl.textContent = `[${i + 1}/${jobs.length}] 验证分享与提取码...`;
              const tokRes = await requestShareToken(job.pwdId, job.passcode || '');
              if (!isQuarkOk(tokRes) || !tokRes.data?.stoken) {
                throw new Error(friendlyErrorMessage(tokRes));
              }
              stoken = tokRes.data.stoken;
              shareTitle = tokRes.data.title || job.title;

              if (stageEl) stageEl.textContent = `[${i + 1}/${jobs.length}] 获取根目录文件清单...`;
              const detRes = await requestShareDetailPage({ pwdId: job.pwdId, stoken, pdirFid: '0', page: 1, size: 100 });
              if (!isQuarkOk(detRes) || !Array.isArray(detRes.data?.list)) {
                throw new Error(friendlyErrorMessage(detRes));
              }
              const topItems = detRes.data.list;
              if (topItems.length === 0) {
                throw new Error('该分享内没有任何可转存文件');
              }
              fidList = topItems.map((it) => it.fid);
              fidTokenList = topItems.map((it) => it.share_fid_token || '');
              estimatedBytes = topItems.reduce((s, it) => s + (Number(it.size) || 0), 0);
            }

            if (freeBytes >= 0 && estimatedBytes > 0 && estimatedBytes > freeBytes) {
              throw Object.assign(new Error(`预估体积 ${formatSize(estimatedBytes)} 超出剩余空间 ${formatSize(freeBytes)}`), {
                isQuotaError: true
              });
            }

            const saveRes = await saveShareAndPoll({
              fidList,
              fidTokenList,
              toPdirFid: destination.fid,
              pwdId: job.pwdId,
              stoken,
              pdirFid,
              onStage: (text) => {
                if (stageEl) stageEl.textContent = `[${i + 1}/${jobs.length}] ${shareTitle} · ${text}`;
              }
            });

            const errCode = Number(saveRes?.code);
            if (errCode === 32003 || errCode === 32004) {
              throw Object.assign(new Error(friendlyErrorMessage(saveRes)), { isQuotaError: true });
            }
            if (!isQuarkOk(saveRes)) {
              throw new Error(friendlyErrorMessage(saveRes));
            }

            if (freeBytes >= 0 && estimatedBytes > 0) {
              freeBytes = Math.max(0, freeBytes - estimatedBytes);
            }

            const savedDirName = saveRes.data?.save_as?.to_pdir_name || destination.pathLabel;
            okCount++;
            appendSaveResult({
              ok: true,
              title: shareTitle,
              message: `转存成功（共 ${fidList.length} 个项目 ➔ ${savedDirName}）`
            });
            log(`批量转存成功: ${shareTitle} -> ${savedDirName}`);
          } catch (err) {
            failCount++;
            appendSaveResult({
              ok: false,
              title: job.title,
              message: err.message || '转存失败'
            });
            log(`批量转存失败 (${job.title}): ${err.message}`);

            if (err.isQuotaError) {
              stoppedByQuota = true;
              customAlert('网盘空间不足', `${err.message}，已立即中止剩余 ${jobs.length - i - 1} 条转存任务，请清理空间后重试。`);
              break;
            }
          }

          if (i < jobs.length - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        if (stageEl) {
          stageEl.textContent = stoppedByQuota
            ? `因空间不足已中止：成功 ${okCount} 项，失败 ${failCount} 项`
            : `全部队列完成：成功 ${okCount} 项，失败 ${failCount} 项`;
        }
        if (okCount > 0) {
          toast(`批量转存完成：成功 ${okCount} 项`);
          await requestAccountQuota();
          if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('qr-account-updated', { detail: { destinationFid: destination.fid } }));
          }
        }
      } finally {
        state.isRunning = false;
        startBtn.disabled = false;
        startBtn.innerHTML = `${ICONS.download} 再次执行转存`;
      }
    });
  }
}
