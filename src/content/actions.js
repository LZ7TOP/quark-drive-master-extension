/**
 * 高危操作执行器：单件/批量重命名、批量删除、新建文件夹
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { log, friendlyErrorMessage } from './utils.js';
import { customAlert, customConfirm, customPrompt, toast } from './dialogs.js';
import { requestRename, requestCreateDirectory, requestDeleteFiles, fetchFileList } from './api.js';
import { saveHistorySnapshot } from './history.js';
import { recalculateNewNames } from './rename.js';
import { renderTable, updateStatText } from './ui.js';

export async function runSingleRename(file) {
  if (!file || file.new_name === file.file_name) return;
  if (state.isRunning) {
    customAlert('提示', '已有任务正在执行中，请等待当前任务完成后再操作。');
    return;
  }

  state.isRunning = true;
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
      toast(`已成功将 "${oldName}" 重命名为 "${file.new_name}"`);
    } else {
      log(`修改失败: ${res?.message || res?.error || '请求受阻'}`);
      customAlert('修改失败', res?.message || res?.error || '单件重命名失败');
    }
  } catch (err) {
    log(`修改捕获异常: ${err.message}`);
    customAlert('异常', err.message);
  } finally {
    state.isRunning = false;
  }
}

export async function runBatchRename() {
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
    const delayInput = document.getElementById('qrDelayInput');
    const logBox = document.getElementById('qrLogBox');
    const progressWrap = document.getElementById('qrProgressBarWrap');
    const progressInner = document.getElementById('qrProgressBarInner');

    state.delayMs = parseInt(delayInput.value) || 500;
    startBtn.disabled = true;
    startBtn.innerHTML = `${ICONS.zap} 重命名执行中...`;
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
          log(`  失败: ${result.message || result.error || '未知错误'}`);
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
    startBtn.innerHTML = `${ICONS.zap} 开始批量重命名`;
    state.isRunning = false;

    if (historyItems.length > 0) {
      saveHistorySnapshot(historyItems);
    }

    recalculateNewNames();
  });
}

export function promptCreateDirectory() {
  const defaultName = '新建文件夹';
  customPrompt('新建文件夹', defaultName, async (folderName) => {
    if (!folderName) return;

    log(`正在创建新文件夹 "${folderName}" ...`);
    try {
      const res = await requestCreateDirectory(state.pdir_fid, folderName);
      if (res && (res.code === 0 || res.status === 200)) {
        log(`文件夹 "${folderName}" 创建成功！`);
        toast(`已在当前目录下成功新建文件夹 "${folderName}"`);
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

export async function runBatchDelete() {
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
        toast(`已成功将 ${selectedFiles.length} 个文件/文件夹移入夸克回收站`);
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
