/**
 * 历史改名快照：存盘、查看与一键撤销
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml, log } from './utils.js';
import { customAlert, customConfirm, toast } from './dialogs.js';
import { requestRename, fetchFileList } from './api.js';

export function saveHistorySnapshot(items) {
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

export function openHistoryModal() {
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

            const moreText =
              rec.items && rec.items.length > 10 ? `<div class="qr-hist-more">... 更多 ${rec.items.length - 10} 个文件</div>` : '';

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

export async function runUndoHistory(record) {
  customConfirm('确认撤销还原', `确认要将 ${record.time} 修改的 ${record.items.length} 个文件还原为原来的文件名吗？`, async (confirmed) => {
    if (!confirmed) return;
    if (state.isRunning) {
      customAlert('提示', '已有任务正在执行中，请等待当前任务完成后再操作。');
      return;
    }

    const delayInput = document.getElementById('qrDelayInput');
    const delayMs = parseInt(delayInput && delayInput.value) || 400;

    state.isRunning = true;
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
          log(`  还原失败: ${res.message || res.error || '未知错误'}`);
        }
      } catch (err) {
        fail++;
        log(`  异常: ${err.message}`);
      }
      if (i < record.items.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    state.isRunning = false;
    toast(`撤销完成：成功还原 ${success} 个文件，失败 ${fail} 个`);
    fetchFileList();
  });
}
