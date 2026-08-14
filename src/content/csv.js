/**
 * CSV 映射导出与导入（兼容 Excel / WPS 带引号字段）
 */

import { state } from './state.js';
import { customAlert } from './dialogs.js';
import { log, parseCsvLine } from './utils.js';
import { switchPageView, renderTable } from './ui.js';

export function exportCsvMapping() {
  if (state.fileList.length === 0) {
    customAlert('提示', '当前列表中没有可导出的文件项目。');
    return;
  }

  let csvContent = '\uFEFF' + '原文件名,修改后名称,文件FID\n';
  state.fileList.forEach((file) => {
    const oldName = `"${file.file_name.replace(/"/g, '""')}"`;
    const newName = `"${file.new_name.replace(/"/g, '""')}"`;
    csvContent += `${oldName},${newName},${file.fid}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quark_rename_export_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  log(`导出 CSV 文件重命名清单成功`);
}

export function importCsvMapping(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      // 去掉 UTF-8 BOM，避免表头首行误判
      const text = String(e.target.result).replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/);
      let matchCount = 0;

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('原文件名')) return;
        const parts = parseCsvLine(line);
        if (parts.length >= 2) {
          const oldName = parts[0];
          const newName = parts[1];
          const fid = (parts[2] || '').trim();

          const targetFile = state.fileList.find((f) => f.file_name === oldName || (fid && f.fid === fid));
          if (targetFile && newName) {
            targetFile.new_name = newName;
            targetFile.selected = true;
            matchCount++;
          }
        }
      });

      switchPageView('main');
      renderTable();
      customAlert('导入成功', `已从 CSV 表格中读取并匹配了 ${matchCount} 个文件的修改映射！`);
      log(`导入 CSV 表格匹配成功: ${matchCount} 项`);
    } catch (err) {
      customAlert('解析错误', 'CSV 文件格式解析异常。');
    }
  };
  reader.readAsText(file, 'utf-8');
}
