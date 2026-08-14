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
