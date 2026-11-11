/**
 * 高危操作执行器：单件/批量重命名、批量移动、批量删除、新建文件夹、直链提取
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { copyTextToClipboard, escapeHtml, formatSize, friendlyErrorMessage, log, sanitizeHttpUrl } from './utils.js';
import { customAlert, customConfirm, customPrompt, toast } from './dialogs.js';
import {
  fetchFileList,
  isQuarkOk,
  requestAccountQuota,
  requestCreateDirectory,
  requestDeleteFiles,
  requestDownloadUrls,
  requestMoveFiles,
  requestRename,
  searchDriveFiles
} from './api.js';
import { saveHistorySnapshot } from './history.js';
import { recalculateNewNames, validateRenameTargets } from './rename.js';
import { openFolderPickerModal } from './picker.js';
import { refreshAccountQuotaUI, renderBreadcrumbs, renderTable, updateStatText } from './ui.js';

function reloadMainViewList() {
  if (state.mainMode === 'search' && state.searchQuery) {
    return searchDriveFiles(state.searchQuery);
  }
  return fetchFileList();
}

export async function runSingleRename(file, { sourceLabel = '主面板改名', siblingPool = state.fileList, onAfterRename } = {}) {
  if (!file || file.new_name === file.file_name) return;
  if (state.isRunning) {
    customAlert('提示', '已有任务正在执行中，请等待当前任务完成后再操作。');
    return;
  }

  const { invalidItems } = validateRenameTargets([file], siblingPool);
  if (invalidItems.length > 0) {
    if (typeof onAfterRename === 'function') {
      onAfterRename(false);
    } else {
      renderTable();
      updateStatText();
    }
    customAlert('命名校验失败', invalidItems[0].reason);
    return;
  }

  state.isRunning = true;
  log(`正在修改单件: [${file.file_name}] ➔ [${file.new_name}] ...`);
  try {
    const res = await requestRename(file.fid, file.new_name);
    if (isQuarkOk(res)) {
      saveHistorySnapshot([{ fid: file.fid, old_name: file.file_name, new_name: file.new_name }], sourceLabel);
      log(`修改成功: [${file.file_name}] 已成功重命名为 [${file.new_name}]！`);
      const oldName = file.file_name;
      file.file_name = file.new_name;
      file._renameError = '';

      // 同步更新另一视图中的同 FID 项
      [state.fileList, state.globalSearch.items].forEach((pool) => {
        const peer = pool.find((x) => x !== file && String(x.fid) === String(file.fid));
        if (peer) {
          peer.file_name = file.file_name;
          peer.new_name = file.file_name;
          peer._renameError = '';
        }
      });

      if (typeof onAfterRename === 'function') {
        onAfterRename(true);
      } else {
        renderTable();
        updateStatText();
      }
      toast(`已成功将 "${oldName}" 重命名为 "${file.file_name}"`);
    } else {
      const msg = friendlyErrorMessage(res);
      file._renameError = msg;
      if (typeof onAfterRename === 'function') {
        onAfterRename(false);
      } else {
        renderTable();
      }
      log(`修改失败: ${msg}`);
      customAlert('修改失败', msg);
    }
  } catch (err) {
    file._renameError = err.message || '请求异常';
    if (typeof onAfterRename === 'function') {
      onAfterRename(false);
    } else {
      renderTable();
    }
    log(`修改捕获异常: ${err.message}`);
    customAlert('异常', err.message);
  } finally {
    state.isRunning = false;
  }
}

export function executeBatchRenameTargets(
  rawTargets,
  siblingPool,
  {
    delayMs = state.delayMs || 500,
    sourceLabel = '主面板改名',
    logFn = log,
    logBoxEl = null,
    progressWrapEl = null,
    progressInnerEl = null,
    startBtnEl = null,
    startBtnDefaultHtml = `${ICONS.zap} 开始批量重命名`,
    onValidationUpdate = null,
    onComplete = null
  } = {}
) {
  if (state.isRunning) {
    customAlert('提示', '当前已有批量任务正在执行，请等待完成后再试。');
    return;
  }

  const targets = Array.isArray(rawTargets) ? rawTargets.filter((f) => f && f.new_name !== f.file_name) : [];
  if (targets.length === 0) {
    customAlert('提示', '没有选中的可改名项目（已选项目的新旧名称完全相同）。');
    return;
  }

  const { validTargets, invalidItems } = validateRenameTargets(targets, siblingPool);
  if (typeof onValidationUpdate === 'function') {
    onValidationUpdate();
  }

  if (validTargets.length === 0) {
    const preview = invalidItems
      .slice(0, 5)
      .map((it) => `• ${it.file.file_name}: ${it.reason}`)
      .join('\n');
    const extra = invalidItems.length > 5 ? `\n... 等共 ${invalidItems.length} 项异常` : '';
    customAlert('重命名校验未通过', `所选项目均存在命名不合法或同名冲突，请根据表格状态列红字提示调整：\n${preview}${extra}`);
    return;
  }

  const confirmText =
    invalidItems.length > 0
      ? `检测到 ${invalidItems.length} 项存在非法字符或同目录重名冲突（已在列表标红跳过）。\n确认将剩余合法的 ${validTargets.length} 个项目执行重命名吗？`
      : `确认要将选中的 ${validTargets.length} 个项目重命名吗？`;

  customConfirm('确认重命名', confirmText, async (confirmed) => {
    if (!confirmed) return;

    state.isRunning = true;
    const safeDelay = Math.max(100, parseInt(delayMs, 10) || 500);
    if (startBtnEl) {
      startBtnEl.disabled = true;
      startBtnEl.innerHTML = `${ICONS.zap} 重命名执行中...`;
    }
    if (logBoxEl) {
      logBoxEl.style.display = 'block';
      logBoxEl.innerHTML = '';
    }
    if (progressWrapEl) progressWrapEl.style.display = 'block';
    if (progressInnerEl) progressInnerEl.style.width = '0%';

    let successCount = 0;
    let failCount = 0;
    const historyItems = [];
    const renamedMap = new Map();

    for (let i = 0; i < validTargets.length; i++) {
      const file = validTargets[i];
      if (progressInnerEl) {
        progressInnerEl.style.width = `${Math.round(((i + 1) / validTargets.length) * 100)}%`;
      }

      logFn(`[${i + 1}/${validTargets.length}] 改名中: ${file.file_name} -> ${file.new_name}`);

      try {
        const result = await requestRename(file.fid, file.new_name);
        if (isQuarkOk(result)) {
          successCount++;
          file._renameError = '';
          historyItems.push({
            fid: file.fid,
            old_name: file.file_name,
            new_name: file.new_name
          });
          file.file_name = file.new_name;
          renamedMap.set(String(file.fid), file.new_name);
          logFn(`  改名成功`);
        } else {
          const msg = friendlyErrorMessage(result);
          file._renameError = msg;
          failCount++;
          logFn(`  失败: ${msg}`);
        }
      } catch (err) {
        const msg = err.message || '请求异常';
        file._renameError = msg;
        failCount++;
        logFn(`  异常: ${msg}`);
      }

      if (i < validTargets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, safeDelay));
      }
    }

    logFn(`执行完成！成功: ${successCount} 个，失败: ${failCount} 个`);
    if (startBtnEl) {
      startBtnEl.disabled = false;
      startBtnEl.innerHTML = startBtnDefaultHtml;
    }
    state.isRunning = false;

    if (historyItems.length > 0) {
      saveHistorySnapshot(historyItems, sourceLabel);
      // 跨视图内存列表同步已成功改名的文件名
      [state.fileList, state.globalSearch.items].forEach((pool) => {
        pool.forEach((f) => {
          const nextName = renamedMap.get(String(f.fid));
          if (nextName) {
            f.file_name = nextName;
            f.new_name = nextName;
            f._renameError = '';
          }
        });
      });
    }

    if (typeof onComplete === 'function') {
      onComplete({ successCount, failCount, invalidCount: invalidItems.length });
    }

    if (failCount === 0 && invalidItems.length === 0) {
      toast(`批量重命名完成：成功 ${successCount} 项`);
    } else {
      toast(`重命名结束：成功 ${successCount} 项，失败/跳过 ${failCount + invalidItems.length} 项`, 'info');
    }
  });
}

export async function runBatchRename() {
  if (state.isRunning) return;

  const targets = state.fileList.filter((f) => f.visible && f.selected && f.new_name !== f.file_name);
  const startBtn = document.getElementById('qrStartBtn');
  const delayInput = document.getElementById('qrDelayInput');
  const logBox = document.getElementById('qrLogBox');
  const progressWrap = document.getElementById('qrProgressBarWrap');
  const progressInner = document.getElementById('qrProgressBarInner');

  state.delayMs = parseInt(delayInput?.value, 10) || state.delayMs || 500;

  executeBatchRenameTargets(targets, state.fileList, {
    delayMs: state.delayMs,
    sourceLabel: '主面板改名',
    logFn: log,
    logBoxEl: logBox,
    progressWrapEl: progressWrap,
    progressInnerEl: progressInner,
    startBtnEl: startBtn,
    startBtnDefaultHtml: `${ICONS.zap} 开始批量重命名`,
    onValidationUpdate: () => {
      renderTable();
      updateStatText();
    },
    onComplete: () => {
      renderTable();
      updateStatText();
    }
  });
}

export function promptCreateDirectory() {
  const defaultName = '新建文件夹';
  customPrompt('新建文件夹', defaultName, async (folderName) => {
    if (!folderName) return;

    const targetParentFid = state.pdir_fid || '0';
    log(`正在创建新文件夹 "${folderName}" ...`);
    try {
      const res = await requestCreateDirectory(targetParentFid, folderName);
      if (isQuarkOk(res)) {
        log(`文件夹 "${folderName}" 创建成功！`);
        toast(`已在目录下成功新建文件夹 "${folderName}"`);
        state.mainMode = 'dir';
        renderBreadcrumbs();
        fetchFileList();
      } else {
        const errMsg = friendlyErrorMessage(res);
        log(`新建文件夹失败: ${errMsg}`);
        customAlert('创建失败', errMsg);
      }
    } catch (err) {
      log(`创建文件夹捕获异常: ${err.message}`);
      customAlert('异常', err.message);
    }
  });
}

export async function runBatchDelete(customFiles = null, { onCompleted } = {}) {
  if (state.isRunning) return;

  const isCustom = Array.isArray(customFiles);
  const selectedFiles = isCustom ? customFiles.filter((f) => f && f.fid) : state.fileList.filter((f) => f.visible && f.selected);
  if (selectedFiles.length === 0) {
    customAlert('提示', '请先在列表中勾选需要删除的文件或文件夹。');
    return;
  }

  const fids = selectedFiles.map((f) => f.fid);
  customConfirm('确认批量删除', `⚠️ 警告：确认要将选中的 ${selectedFiles.length} 个文件/文件夹删除并放入回收站吗？`, async (confirmed) => {
    if (!confirmed) return;

    state.isRunning = true;
    const moveBtn = document.getElementById('qrMoveBtn');
    const deleteBtn = document.getElementById('qrDeleteBtn');
    const startBtn = document.getElementById('qrStartBtn');

    if (moveBtn) moveBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;
    if (startBtn) startBtn.disabled = true;

    log(`正在发起批量删除 ${selectedFiles.length} 个文件...`);

    try {
      const BATCH_SIZE = 80;
      for (let i = 0; i < fids.length; i += BATCH_SIZE) {
        const chunk = fids.slice(i, i + BATCH_SIZE);
        const res = await requestDeleteFiles(chunk);
        if (!isQuarkOk(res)) {
          throw new Error(friendlyErrorMessage(res));
        }
      }

      const deletedSet = new Set(fids.map(String));
      state.fileList = state.fileList.filter((f) => !deletedSet.has(String(f.fid)));
      state.globalSearch.items = state.globalSearch.items.filter((f) => !deletedSet.has(String(f.fid)));

      log(`批量删除成功: 共删除 ${selectedFiles.length} 项文件！`);
      toast(`已成功将 ${selectedFiles.length} 个文件/文件夹移入夸克回收站`);

      if (typeof onCompleted === 'function') {
        onCompleted(fids);
      } else if (!isCustom) {
        reloadMainViewList();
      } else {
        renderTable();
      }

      window.dispatchEvent(new CustomEvent('qr-files-mutated', { detail: { type: 'delete', fids } }));
      requestAccountQuota().then(() => refreshAccountQuotaUI());
    } catch (err) {
      const msg = err.message || '批量删除失败';
      log(`批量删除失败: ${msg}`);
      customAlert('删除失败', msg);
    } finally {
      state.isRunning = false;
      if (moveBtn) moveBtn.disabled = false;
      if (deleteBtn) deleteBtn.disabled = false;
      if (startBtn) startBtn.disabled = false;
    }
  });
}

export function runBatchMove(customFiles = null, { onCompleted } = {}) {
  if (state.isRunning) return;

  const isCustom = Array.isArray(customFiles);
  const selectedFiles = isCustom ? customFiles.filter(Boolean) : state.fileList.filter((f) => f.visible && f.selected);
  if (selectedFiles.length === 0) {
    customAlert('提示', '请先在列表中勾选需要移动的文件或文件夹。');
    return;
  }

  const validFiles = selectedFiles.filter((f) => f.fid && !String(f.fid).startsWith('dom_'));
  if (validFiles.length === 0) {
    customAlert('提示', '当前选中的条目为网页 DOM 降级抓取结果，缺少真实文件 FID，请点击「加载目录」刷新后重试。');
    return;
  }

  const excludedFids = validFiles.filter((f) => f.is_dir).map((f) => f.fid);
  const initialFid = !isCustom && state.mainMode === 'dir' ? state.pdir_fid || '0' : '0';
  const initialBreadcrumbs = !isCustom && state.mainMode === 'dir' ? state.breadcrumbs : [{ fid: '0', name: '全部文件' }];

  openFolderPickerModal({
    title: `批量移动已选的 ${validFiles.length} 个项目到...`,
    confirmText: '移动到此目录',
    initialFid,
    initialBreadcrumbs,
    excludedFids,
    onConfirm: ({ fid: targetFid, pathLabel }) => {
      if (validFiles.every((f) => String(f.pdir_fid || '') === String(targetFid))) {
        customAlert('无需移动', `所选的 ${validFiles.length} 个项目当前已在目标目录「${pathLabel}」中，请选择其他文件夹。`);
        return;
      }

      customConfirm('确认批量移动', `确认将选中的 ${validFiles.length} 个文件/文件夹移动到「${pathLabel}」吗？`, async (confirmed) => {
        if (!confirmed) return;

        state.isRunning = true;
        const moveBtn = document.getElementById('qrMoveBtn');
        const deleteBtn = document.getElementById('qrDeleteBtn');
        const startBtn = document.getElementById('qrStartBtn');
        const delayInput = document.getElementById('qrDelayInput');
        const logBox = document.getElementById('qrLogBox');
        const progressWrap = document.getElementById('qrProgressBarWrap');
        const progressInner = document.getElementById('qrProgressBarInner');

        const delayMs = Math.max(200, parseInt(delayInput?.value, 10) || state.delayMs || 500);
        if (moveBtn) moveBtn.disabled = true;
        if (deleteBtn) deleteBtn.disabled = true;
        if (startBtn) startBtn.disabled = true;
        if (!isCustom) {
          if (logBox) logBox.style.display = 'block';
          if (progressWrap) progressWrap.style.display = 'block';
        }

        const fids = validFiles.map((f) => f.fid);
        const BATCH_SIZE = 80;
        const totalBatches = Math.ceil(fids.length / BATCH_SIZE);
        let movedCount = 0;

        log(`开始批量移动 ${fids.length} 个项目 ➔ ${pathLabel} (FID: ${targetFid})...`);

        try {
          for (let i = 0; i < totalBatches; i++) {
            const chunk = fids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            if (!isCustom && progressInner) {
              progressInner.style.width = `${Math.round(((i + 1) / totalBatches) * 100)}%`;
            }

            const res = await requestMoveFiles(chunk, targetFid);
            if (!isQuarkOk(res)) {
              throw new Error(friendlyErrorMessage(res));
            }
            movedCount += chunk.length;

            if (i < totalBatches - 1) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }

          const movedSet = new Set(fids.map(String));
          state.globalSearch.items.forEach((f) => {
            if (movedSet.has(String(f.fid))) {
              f.pdir_fid = String(targetFid);
            }
          });

          log(`批量移动完成: 共移动 ${movedCount} 个项目至「${pathLabel}」`);
          toast(`已将 ${movedCount} 个项目移动到「${pathLabel}」`);

          if (typeof onCompleted === 'function') {
            onCompleted(fids, targetFid);
          } else if (!isCustom) {
            reloadMainViewList();
          }

          window.dispatchEvent(new CustomEvent('qr-files-mutated', { detail: { type: 'move', fids, toPdirFid: targetFid } }));
        } catch (err) {
          const msg = err.message || '移动请求失败';
          log(`批量移动失败: ${msg}`);
          customAlert('移动失败', movedCount > 0 ? `已移动 ${movedCount} 项，后续批次中断：${msg}` : msg);
          if (movedCount > 0 && !isCustom) reloadMainViewList();
        } finally {
          state.isRunning = false;
          if (moveBtn) moveBtn.disabled = false;
          if (deleteBtn) deleteBtn.disabled = false;
          if (startBtn) startBtn.disabled = false;
        }
      });
    }
  });
}

export function buildAria2TaskText(items) {
  return items
    .map((item) => {
      const safeUrl = sanitizeHttpUrl(item.download_url);
      if (!safeUrl) return '';
      const safeOut = String(item.file_name || item.fid || 'download')
        .replace(/[\r\n]+/g, ' ')
        .trim();
      return `${safeUrl}\n  out=${safeOut}\n  header=Referer: https://pan.quark.cn/`;
    })
    .filter(Boolean)
    .join('\n\n');
}

export async function runExtractDownloadLinks(customFiles = null) {
  if (state.isRunning) {
    customAlert('提示', '当前已有任务正在执行中，请等待完成后再提取直链。');
    return;
  }

  const isCustom = Array.isArray(customFiles);
  const selectedVisible = isCustom ? customFiles.filter(Boolean) : state.fileList.filter((f) => f.visible && f.selected);
  if (selectedVisible.length === 0) {
    customAlert('提示', '请先在列表勾选需要提取下载直链的文件。');
    return;
  }

  const targetFiles = selectedVisible.filter((f) => !f.is_dir && f.fid && !String(f.fid).startsWith('dom_'));
  if (targetFiles.length === 0) {
    customAlert('提示', '已选条目均为文件夹或 DOM 降级项（暂不支持整目录提取直链），请进入目录并勾选具体文件。');
    return;
  }

  document.querySelectorAll('.qr-dialog-overlay:not(.qr-system-dialog-overlay)').forEach((d) => d.remove());

  const dialog = document.createElement('div');
  dialog.className = 'qr-dialog-overlay';
  dialog.innerHTML = `
    <div class="qr-dialog-box qr-download-box">
      <div class="qr-dialog-title qr-history-dialog-title">
        <span class="qr-title-text">${ICONS.download} 批量提取文件下载直链（已选 ${targetFiles.length} 个文件）</span>
        <button type="button" class="qr-close-btn qr-dialog-close" aria-label="关闭">&times;</button>
      </div>

      <div class="qr-dialog-content qr-share-form">
        <div class="qr-saveas-quota-banner is-ok" style="margin:0;">
          ${ICONS.warn} 直链具有时效性，外部下载工具（如 Aria2 / IDM）需携带请求头 <code>Referer: https://pan.quark.cn/</code> 及有效登录上下文。
        </div>

        <div class="qr-progress-bar-wrap" style="display:block;">
          <div id="qrDlBar" class="qr-progress-bar-inner"></div>
        </div>
        <div id="qrDlStage" class="qr-stage-text">准备向夸克服务端请求直链...</div>

        <div id="qrDlList" class="qr-result-list" style="max-height: 260px;"></div>
      </div>

      <div class="qr-dialog-actions" style="justify-content: space-between;">
        <div style="display:flex; gap:8px;">
          <button type="button" id="qrDlCopyAllBtn" class="qr-btn-tool qr-btn-purple" disabled>${ICONS.copy} 复制全部直链 (0)</button>
          <button type="button" id="qrDlExportAria2Btn" class="qr-btn-tool qr-btn-amber" disabled>${ICONS.download} 导出 Aria2 任务</button>
        </div>
        <button type="button" class="qr-btn-secondary qr-dialog-close">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const barEl = dialog.querySelector('#qrDlBar');
  const stageEl = dialog.querySelector('#qrDlStage');
  const listEl = dialog.querySelector('#qrDlList');
  const copyAllBtn = dialog.querySelector('#qrDlCopyAllBtn');
  const exportAria2Btn = dialog.querySelector('#qrDlExportAria2Btn');

  let aborted = false;
  const extractedItems = [];

  const closeDialog = () => {
    aborted = true;
    document.removeEventListener('keydown', onEsc);
    dialog.remove();
  };
  const onEsc = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.qr-system-dialog-overlay')) {
      closeDialog();
    }
  };
  document.addEventListener('keydown', onEsc);
  dialog.querySelectorAll('.qr-dialog-close').forEach((btn) => btn.addEventListener('click', closeDialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });

  if (copyAllBtn) {
    copyAllBtn.addEventListener('click', async () => {
      const urls = extractedItems.map((it) => sanitizeHttpUrl(it.download_url)).filter(Boolean);
      if (urls.length === 0) return;
      const ok = await copyTextToClipboard(urls.join('\n'));
      if (ok) toast(`已复制 ${urls.length} 条文件下载直链`);
    });
  }

  if (exportAria2Btn) {
    exportAria2Btn.addEventListener('click', () => {
      const content = buildAria2TaskText(extractedItems);
      if (!content) return;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quark_aria2_tasks_${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`已导出 ${extractedItems.length} 条 Aria2 下载任务`);
    });
  }

  function appendDlRow(item) {
    if (!listEl) return;
    const safeUrl = sanitizeHttpUrl(item.download_url);
    const row = document.createElement('div');
    row.className = `qr-result-row ${safeUrl ? 'is-ok' : 'is-err'}`;
    row.innerHTML = safeUrl
      ? `
        <div class="qr-result-main">
          <div class="qr-result-title">${escapeHtml(item.file_name)} <span style="color:#71717a; font-weight:400;">(${formatSize(item.size)})</span></div>
          <div class="qr-result-sub" style="font-family:monospace; color:#93c5fd;">${escapeHtml(safeUrl)}</div>
        </div>
        <div style="display:flex; gap:4px; flex-shrink:0;">
          <button type="button" class="qr-btn-tool qr-btn-purple qr-dl-copy-one">${ICONS.copy} 复制</button>
          <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="qr-btn-tool qr-btn-blue" style="text-decoration:none;">${ICONS.external}</a>
        </div>
      `
      : `
        <div class="qr-result-main">
          <div class="qr-result-title">${escapeHtml(item.file_name)}</div>
          <div class="qr-result-sub" style="color:#f87171;">${escapeHtml(item.error || '未能获取有效直链')}</div>
        </div>
      `;

    const copyOne = row.querySelector('.qr-dl-copy-one');
    if (copyOne && safeUrl) {
      copyOne.addEventListener('click', async () => {
        const ok = await copyTextToClipboard(safeUrl);
        if (ok) toast(`已复制直链：${item.file_name}`);
      });
    }
    listEl.appendChild(row);
    listEl.scrollTop = listEl.scrollHeight;
  }

  const delayInput = document.getElementById('qrDelayInput');
  const delayMs = Math.max(200, parseInt(delayInput?.value, 10) || state.delayMs || 500);
  const CHUNK_SIZE = 15;
  const totalChunks = Math.ceil(targetFiles.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    if (aborted) return;
    const chunkFiles = targetFiles.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const chunkFids = chunkFiles.map((f) => f.fid);
    if (barEl) barEl.style.width = `${Math.round(((i + 1) / totalChunks) * 100)}%`;
    if (stageEl) stageEl.textContent = `正在提取第 ${i + 1}/${totalChunks} 批（${chunkFiles.length} 个文件）...`;

    try {
      const res = await requestDownloadUrls(chunkFids);
      if (aborted) return;

      if (!isQuarkOk(res)) {
        const errMsg = friendlyErrorMessage(res);
        chunkFiles.forEach((f) => appendDlRow({ file_name: f.file_name, error: errMsg }));
      } else {
        const rawList = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.list) ? res.data.list : [];
        const byFid = new Map();
        rawList.forEach((entry) => {
          if (entry && entry.fid) byFid.set(String(entry.fid), entry);
        });

        chunkFiles.forEach((f) => {
          const matched = byFid.get(String(f.fid));
          const url = matched?.download_url || '';
          if (url && sanitizeHttpUrl(url)) {
            const record = {
              fid: f.fid,
              file_name: matched.file_name || f.file_name,
              size: Number(matched.size ?? f.size) || 0,
              download_url: url,
              md5: matched.md5 || ''
            };
            extractedItems.push(record);
            appendDlRow(record);
          } else {
            appendDlRow({ file_name: f.file_name, error: '接口未返回此文件的 download_url' });
          }
        });
      }
    } catch (err) {
      if (aborted) return;
      chunkFiles.forEach((f) => appendDlRow({ file_name: f.file_name, error: err.message || '请求异常' }));
    }

    if (copyAllBtn) {
      copyAllBtn.disabled = extractedItems.length === 0;
      copyAllBtn.innerHTML = `${ICONS.copy} 复制全部直链 (${extractedItems.length})`;
    }
    if (exportAria2Btn) {
      exportAria2Btn.disabled = extractedItems.length === 0;
    }

    if (i < totalChunks - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!aborted && stageEl) {
    stageEl.textContent = `提取完成：成功获取 ${extractedItems.length} / ${targetFiles.length} 个文件直链`;
    log(`直链提取完成: 成功 ${extractedItems.length} / ${targetFiles.length} 个文件`);
  }
}
