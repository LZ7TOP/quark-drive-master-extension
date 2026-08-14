/**
 * 重命名算法与配置同步：根据当前 Tab 与配置实时计算目标文件名
 */

import { state } from './state.js';
import { replaceAllText, convertTradToSimpText } from './utils.js';
import { sortFileList } from './api.js';
import { renderTable } from './ui.js';

export function updateConfigFromUI() {
  state.config.replaceSearch = document.getElementById('qrSearchInput').value;
  state.config.replaceTarget = document.getElementById('qrReplaceInput').value;
  state.config.isRegex = document.getElementById('qrIsRegex').checked;
  state.config.ignoreCase = document.getElementById('qrIgnoreCase').checked;

  const targetRangeEl = document.getElementById('qrTargetRange');
  state.config.targetRange = targetRangeEl ? targetRangeEl.dataset.value || 'name' : 'name';

  state.config.prefix = document.getElementById('qrPrefixInput').value;
  state.config.suffix = document.getElementById('qrSuffixInput').value;

  state.config.numberTemplate = document.getElementById('qrNumTemplate').value;
  state.config.numberStart = parseInt(document.getElementById('qrNumStart').value) || 1;
  state.config.numberPad = parseInt(document.getElementById('qrNumPad').value) || 2;

  state.config.newExt = document.getElementById('qrNewExtInput').value.trim();

  const caseChangeEl = document.getElementById('qrCaseChange');
  state.config.caseChange = caseChangeEl ? caseChangeEl.dataset.value || 'none' : 'none';

  const sortByEl = document.getElementById('qrSortBySelect');
  if (sortByEl && sortByEl.dataset.value) {
    state.sortBy = sortByEl.dataset.value;
    sortFileList();
  }

  state.config.cleanUrl = document.getElementById('qrCleanUrl').checked;
  state.config.cleanBracket = document.getElementById('qrCleanBracket').checked;
  state.config.cleanTrad = document.getElementById('qrCleanTrad').checked;

  state.searchKeyword = document.getElementById('qrKeywordInput').value.trim().toLowerCase();

  recalculateNewNames();
}

export function recalculateNewNames() {
  let numIndex = state.config.numberStart;

  state.fileList.forEach((file) => {
    let visible = true;

    if (state.filterType === 'dir' && !file.is_dir) visible = false;
    if (state.filterType !== 'all' && state.filterType !== 'dir' && file.is_dir) visible = false;

    if (state.filterType === 'video' && !/\.(mp4|mkv|flv|avi|mov|wmv|m4v|webm)$/i.test(file.file_name)) visible = false;
    if (state.filterType === 'audio' && !/\.(mp3|flac|wav|aac|m4a|ogg)$/i.test(file.file_name)) visible = false;
    if (state.filterType === 'image' && !/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.file_name)) visible = false;
    if (state.filterType === 'doc' && !/\.(pdf|docx?|xlsx?|pptx?|txt|md)$/i.test(file.file_name)) visible = false;

    if (state.searchKeyword && !file.file_name.toLowerCase().includes(state.searchKeyword)) {
      visible = false;
    }

    file.visible = visible;
    if (!visible) return;

    let namePart = file.file_name;
    let extPart = '';
    if (!file.is_dir) {
      const lastDot = file.file_name.lastIndexOf('.');
      if (lastDot > 0) {
        namePart = file.file_name.substring(0, lastDot);
        extPart = file.file_name.substring(lastDot);
      }
    }

    let newName = file.file_name;

    if (state.activeTab === 'replace') {
      const { replaceSearch, replaceTarget, isRegex, ignoreCase, targetRange } = state.config;
      if (replaceSearch) {
        try {
          if (isRegex) {
            const flags = ignoreCase ? 'gi' : 'g';
            const regex = new RegExp(replaceSearch, flags);
            if (targetRange === 'name') {
              namePart = namePart.replace(regex, replaceTarget);
              newName = namePart + extPart;
            } else if (targetRange === 'ext') {
              extPart = extPart.replace(regex, replaceTarget);
              newName = namePart + extPart;
            } else {
              newName = file.file_name.replace(regex, replaceTarget);
            }
          } else {
            if (targetRange === 'name') {
              namePart = replaceAllText(namePart, replaceSearch, replaceTarget, ignoreCase);
              newName = namePart + extPart;
            } else if (targetRange === 'ext') {
              extPart = replaceAllText(extPart, replaceSearch, replaceTarget, ignoreCase);
              newName = namePart + extPart;
            } else {
              newName = replaceAllText(file.file_name, replaceSearch, replaceTarget, ignoreCase);
            }
          }
        } catch (e) {}
      }
    } else if (state.activeTab === 'prefix') {
      const { prefix, suffix } = state.config;
      newName = `${prefix}${namePart}${suffix}${extPart}`;
    } else if (state.activeTab === 'numbering') {
      const { numberTemplate, numberPad } = state.config;
      const padStr = String(numIndex).padStart(numberPad, '0');
      const formattedName = numberTemplate.replace('{n}', padStr);
      newName = file.is_dir ? formattedName : `${formattedName}${extPart}`;
      numIndex++;
    } else if (state.activeTab === 'extension') {
      const { newExt, caseChange } = state.config;

      let finalExt = extPart;
      if (newExt && !file.is_dir) {
        finalExt = newExt.startsWith('.') ? newExt : `.${newExt}`;
      }

      let finalName = namePart;
      if (caseChange === 'lower') {
        finalName = finalName.toLowerCase();
        finalExt = finalExt.toLowerCase();
      } else if (caseChange === 'upper') {
        finalName = finalName.toUpperCase();
        finalExt = finalExt.toUpperCase();
      }

      newName = `${finalName}${finalExt}`;
    } else if (state.activeTab === 'clean') {
      const { cleanUrl, cleanBracket, cleanTrad } = state.config;
      let cleanName = namePart;

      if (cleanUrl) {
        cleanName = cleanName.replace(/(https?:\/\/)?(www\.)?[\w-]+\.(com|cn|net|org|cc|tv)[\/\w-]*/gi, '');
      }
      if (cleanBracket) {
        cleanName = cleanName.replace(/\[.*?\]|【.*?】|\(.*?\)|（.*?）/g, '');
      }
      if (cleanTrad) {
        cleanName = convertTradToSimpText(cleanName);
      }

      cleanName = cleanName.trim().replace(/^[-_\s]+|[-_\s]+$/g, '');
      newName = file.is_dir ? cleanName : `${cleanName}${extPart}`;
    }

    file.new_name = newName;
  });

  renderTable();
}
