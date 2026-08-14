/**
 * 手写弹窗组件：alert / confirm / prompt
 */

import { escapeHtml } from './utils.js';

export function customAlert(title, message) {
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

export function customConfirm(title, message, callback) {
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

export function customPrompt(title, defaultValue, callback) {
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

const TOAST_ICONS = {
  success: `<svg class="qr-icon" viewBox="0 0 24 24" style="fill:#4ade80;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  error: `<svg class="qr-icon" viewBox="0 0 24 24" style="fill:#f87171;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
  info: `<svg class="qr-icon" viewBox="0 0 24 24" style="fill:#60a5fa;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`
};

/**
 * 轻量 Toast 提示：顶部居中显示，自动消失，无需用户点击确定
 */
export function toast(message, type = 'success') {
  document.querySelectorAll('.qr-toast').forEach((t) => t.remove());

  const el = document.createElement('div');
  el.className = `qr-toast qr-toast-${type}`;
  el.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${escapeHtml(message)}</span>`;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('qr-toast-show'));

  setTimeout(() => {
    el.classList.remove('qr-toast-show');
    el.classList.add('qr-toast-hide');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}
