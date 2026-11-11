/**
 * 通用目标文件夹选择器弹窗：复用于「主面板批量移动」与「批量链式转存」
 */

import { ICONS } from './constants.js';
import { escapeHtml, formatTimestamp, friendlyErrorMessage } from './utils.js';
import { isQuarkOk, listSubdirectoriesForPicker, requestCreateDirectory } from './api.js';
import { customAlert, customPrompt, toast } from './dialogs.js';

export function openFolderPickerModal({
  title = '选择目标文件夹',
  confirmText = '确认选择此目录',
  initialFid = '0',
  initialBreadcrumbs = null,
  excludedFids = [],
  onConfirm
} = {}) {
  document.querySelectorAll('.qr-subdialog-overlay').forEach((d) => d.remove());

  const excludedSet = new Set((excludedFids || []).map((id) => String(id)));
  const startFid = String(initialFid || '0');
  const breadcrumbs =
    Array.isArray(initialBreadcrumbs) && initialBreadcrumbs.length > 0
      ? initialBreadcrumbs.map((c) => ({ fid: String(c.fid), name: String(c.name || '文件夹') }))
      : startFid === '0'
        ? [{ fid: '0', name: '全部文件' }]
        : [
            { fid: '0', name: '全部文件' },
            { fid: startFid, name: `当前目录 (${startFid.slice(0, 8)}...)` }
          ];

  let currentFid = breadcrumbs[breadcrumbs.length - 1].fid;
  let loadSeq = 0;

  const dialog = document.createElement('div');
  dialog.className = 'qr-dialog-overlay qr-subdialog-overlay';
  dialog.innerHTML = `
    <div class="qr-dialog-box qr-picker-box">
      <div class="qr-dialog-title qr-history-dialog-title">
        <span class="qr-title-text">${ICONS.folder} ${escapeHtml(title)}</span>
        <button type="button" class="qr-close-btn qr-dialog-close" aria-label="关闭">&times;</button>
      </div>

      <div class="qr-picker-top">
        <div id="qrPickerBreadcrumbs" class="qr-breadcrumbs-bar qr-picker-breadcrumbs"></div>
        <button type="button" id="qrPickerMkdirBtn" class="qr-btn-tool qr-btn-green" title="在当前目录新建子文件夹">
          ${ICONS.folder} + 新建文件夹
        </button>
      </div>

      <div id="qrPickerList" class="qr-picker-list"></div>

      <div class="qr-picker-fid-row">
        <label for="qrPickerFidInput">目标 FID:</label>
        <input type="text" id="qrPickerFidInput" class="qr-input" value="${escapeHtml(currentFid)}" placeholder="输入目标目录 FID (0 代表根目录)" style="font-family: monospace; font-size: 12px;">
        <span id="qrPickerTargetPath" class="qr-picker-target-path"></span>
      </div>

      <div class="qr-dialog-actions" style="justify-content: space-between; margin-top: 10px;">
        <button type="button" id="qrPickerRootBtn" class="qr-btn-tool qr-btn-blue">回到根目录 (0)</button>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="qr-btn-secondary qr-dialog-close">取消</button>
          <button type="button" id="qrPickerConfirmBtn" class="qr-btn-primary" style="padding: 6px 16px;">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const crumbsEl = dialog.querySelector('#qrPickerBreadcrumbs');
  const listEl = dialog.querySelector('#qrPickerList');
  const fidInput = dialog.querySelector('#qrPickerFidInput');
  const pathHintEl = dialog.querySelector('#qrPickerTargetPath');
  const mkdirBtn = dialog.querySelector('#qrPickerMkdirBtn');
  const rootBtn = dialog.querySelector('#qrPickerRootBtn');
  const confirmBtn = dialog.querySelector('#qrPickerConfirmBtn');

  const closeDialog = () => {
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

  function currentPathLabel() {
    return breadcrumbs.map((c) => c.name).join(' / ');
  }

  function renderCrumbs() {
    if (!crumbsEl) return;
    crumbsEl.innerHTML = breadcrumbs
      .map((crumb, idx) => {
        const isLast = idx === breadcrumbs.length - 1;
        if (isLast) {
          return `<span class="qr-crumb-item current">${escapeHtml(crumb.name)}</span>`;
        }
        return `
          <span class="qr-crumb-item" data-idx="${idx}">${escapeHtml(crumb.name)}</span>
          <span class="qr-crumb-sep">/</span>
        `;
      })
      .join('');

    crumbsEl.querySelectorAll('.qr-crumb-item[data-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        if (Number.isNaN(idx)) return;
        breadcrumbs.splice(idx + 1);
        currentFid = breadcrumbs[breadcrumbs.length - 1].fid;
        loadFolder(currentFid);
      });
    });

    if (fidInput) fidInput.value = currentFid;
    if (pathHintEl) pathHintEl.textContent = currentPathLabel();
  }

  async function loadFolder(targetFid) {
    currentFid = String(targetFid || '0');
    renderCrumbs();

    const seq = ++loadSeq;
    if (listEl) {
      listEl.innerHTML = `<div class="qr-picker-empty">正在读取子文件夹列表...</div>`;
    }

    try {
      const dirs = await listSubdirectoriesForPicker(currentFid);
      if (seq !== loadSeq) return;

      if (dirs.length === 0) {
        listEl.innerHTML = `<div class="qr-picker-empty">此目录下暂无子文件夹（可直接选为目标目录）</div>`;
        return;
      }

      listEl.innerHTML = dirs
        .map((dir) => {
          const isExcluded = excludedSet.has(String(dir.fid));
          return `
            <button type="button" class="qr-picker-dir-row ${isExcluded ? 'disabled' : ''}" data-fid="${escapeHtml(dir.fid)}" data-name="${escapeHtml(dir.file_name)}" ${isExcluded ? 'disabled title="不可选择待移动目录自身"' : ''}>
              <span class="qr-picker-dir-left">
                <span class="qr-share-type-icon">${ICONS.folder}</span>
                <span class="qr-picker-dir-name">${escapeHtml(dir.file_name)}</span>
              </span>
              <span class="qr-picker-dir-meta">
                ${isExcluded ? '<span style="color:#f87171;">已选中自身</span>' : escapeHtml(formatTimestamp(dir.updated_at))}
              </span>
            </button>
          `;
        })
        .join('');

      listEl.querySelectorAll('.qr-picker-dir-row:not([disabled])').forEach((row) => {
        row.addEventListener('click', () => {
          const nextFid = row.dataset.fid;
          const nextName = row.dataset.name || '文件夹';
          breadcrumbs.push({ fid: nextFid, name: nextName });
          loadFolder(nextFid);
        });
      });
    } catch (err) {
      if (seq !== loadSeq) return;
      listEl.innerHTML = `<div class="qr-picker-empty" style="color:#f87171;">加载失败: ${escapeHtml(err.message || '网络异常')}</div>`;
    }
  }

  if (rootBtn) {
    rootBtn.addEventListener('click', () => {
      breadcrumbs.splice(0, breadcrumbs.length, { fid: '0', name: '全部文件' });
      loadFolder('0');
    });
  }

  if (fidInput) {
    fidInput.addEventListener('input', () => {
      const manual = fidInput.value.trim();
      if (pathHintEl) {
        pathHintEl.textContent = manual && manual !== currentFid ? `手动指定 FID: ${manual}` : currentPathLabel();
      }
    });
  }

  if (mkdirBtn) {
    mkdirBtn.addEventListener('click', () => {
      customPrompt('在当前位置新建文件夹', '新建文件夹', async (folderName) => {
        if (!folderName) return;
        const res = await requestCreateDirectory(currentFid, folderName);
        if (isQuarkOk(res)) {
          toast(`已在当前目录新建「${folderName}」`);
          loadFolder(currentFid);
        } else {
          customAlert('创建失败', friendlyErrorMessage(res));
        }
      });
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const targetFid = (fidInput ? fidInput.value.trim() : '') || currentFid || '0';
      if (excludedSet.has(String(targetFid))) {
        customAlert('目标不可用', '无法将选中的文件夹移动到其自身内部，请更换目标目录。');
        return;
      }

      const pathLabel = targetFid === currentFid ? currentPathLabel() : `FID: ${targetFid}`;
      closeDialog();
      if (typeof onConfirm === 'function') {
        onConfirm({ fid: targetFid, pathLabel });
      }
    });
  }

  loadFolder(currentFid);
}
