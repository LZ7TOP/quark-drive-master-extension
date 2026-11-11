/**
 * 重命名算法、规则计算、前置冲突校验与配置同步
 */

import { state } from './state.js';
import { replaceAllText, convertTradToSimpText } from './utils.js';
import { sortFileList } from './api.js';
import { renderTable } from './ui.js';

export const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/;

export function splitFileNameParts(fileName, isDir) {
  const safeName = String(fileName || '');
  if (isDir) {
    return { namePart: safeName, extPart: '' };
  }
  const lastDot = safeName.lastIndexOf('.');
  if (lastDot > 0) {
    return {
      namePart: safeName.substring(0, lastDot),
      extPart: safeName.substring(lastDot)
    };
  }
  return { namePart: safeName, extPart: '' };
}

export function computeTargetFileName(file, activeTab, config, numIndex = 1) {
  let { namePart, extPart } = splitFileNameParts(file.file_name, file.is_dir);
  let newName = file.file_name;
  let regexError = '';

  if (activeTab === 'replace') {
    const { replaceSearch, replaceTarget, isRegex, ignoreCase, targetRange } = config;
    if (replaceSearch) {
      try {
        const replacement = String(replaceTarget ?? '');
        if (isRegex) {
          const flags = ignoreCase ? 'gi' : 'g';
          const regex = new RegExp(replaceSearch, flags);
          if (targetRange === 'name') {
            namePart = namePart.replace(regex, replacement);
            newName = namePart + extPart;
          } else if (targetRange === 'ext') {
            extPart = extPart.replace(regex, replacement);
            newName = namePart + extPart;
          } else {
            newName = file.file_name.replace(regex, replacement);
          }
        } else if (targetRange === 'name') {
          namePart = replaceAllText(namePart, replaceSearch, replacement, ignoreCase);
          newName = namePart + extPart;
        } else if (targetRange === 'ext') {
          extPart = replaceAllText(extPart, replaceSearch, replacement, ignoreCase);
          newName = namePart + extPart;
        } else {
          newName = replaceAllText(file.file_name, replaceSearch, replacement, ignoreCase);
        }
      } catch (err) {
        regexError = `正则语法错误: ${err.message || '表达式无效'}`;
        newName = file.file_name;
      }
    }
  } else if (activeTab === 'prefix') {
    const { prefix = '', suffix = '' } = config;
    newName = `${prefix}${namePart}${suffix}${extPart}`;
  } else if (activeTab === 'numbering') {
    const { numberTemplate = '文件_{n}', numberPad = 2 } = config;
    const padStr = String(numIndex).padStart(numberPad, '0');
    const formattedName = String(numberTemplate || '{n}').replace(/\{n\}/g, padStr);
    newName = file.is_dir ? formattedName : `${formattedName}${extPart}`;
  } else if (activeTab === 'extension') {
    const { newExt = '', caseChange = 'none' } = config;
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
  } else if (activeTab === 'clean') {
    const { cleanUrl, cleanBracket, cleanTrad } = config;
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

  return { newName, regexError };
}

export function applyRenameRulesToItems(items, { activeTab, config, onlyVisible = true, selectedOnlyNumbering = true } = {}) {
  if (!Array.isArray(items)) return;
  let numIndex = Number(config?.numberStart ?? 1);
  if (!Number.isFinite(numIndex)) numIndex = 1;

  items.forEach((file) => {
    if (onlyVisible && file.visible === false) return;

    file._renameError = '';
    file._regexError = '';

    if (activeTab === 'numbering' && selectedOnlyNumbering && !file.selected) {
      file.new_name = file.file_name;
      return;
    }

    const { newName, regexError } = computeTargetFileName(file, activeTab, config, numIndex);
    file._regexError = regexError;
    file.new_name = newName;

    if (activeTab === 'numbering') {
      numIndex++;
    }
  });
}

export function validateRenameTargets(targets, siblingPool = []) {
  const safeTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const targetByFid = new Map();
  safeTargets.forEach((f) => {
    targetByFid.set(String(f.fid), f);
  });

  // 按父目录 pdir_fid 聚合最终文件名，预检同目录冲突（排除仅修改大小写的自身同名）
  const parentNameCounts = new Map();
  const seenFids = new Set();
  const combinedPool = [...(Array.isArray(siblingPool) ? siblingPool : []), ...safeTargets];

  combinedPool.forEach((item) => {
    const fid = String(item?.fid || '');
    if (!fid || seenFids.has(fid)) return;
    seenFids.add(fid);

    const parentKey = String(item.pdir_fid || '0');
    const targetOverride = targetByFid.get(fid);
    const finalName = String(targetOverride ? targetOverride.new_name : item.file_name || '')
      .trim()
      .toLowerCase();
    if (!finalName) return;

    if (!parentNameCounts.has(parentKey)) {
      parentNameCounts.set(parentKey, new Map());
    }
    const nameMap = parentNameCounts.get(parentKey);
    nameMap.set(finalName, (nameMap.get(finalName) || 0) + 1);
  });

  const validTargets = [];
  const invalidItems = [];

  safeTargets.forEach((file) => {
    const candidate = String(file.new_name ?? '');
    const trimmed = candidate.trim();
    const reasons = [];

    if (!trimmed) {
      reasons.push('新名称不能为空');
    } else {
      if (ILLEGAL_FILENAME_CHARS.test(candidate)) {
        reasons.push('含非法字符 \\ / : * ? " < > |');
      }
      if (candidate.length > 255) {
        reasons.push('名称超过 255 字符');
      }
      if (/\.$/.test(trimmed)) {
        reasons.push('末尾不能为英文句点');
      }
      const parentKey = String(file.pdir_fid || '0');
      const countInParent = parentNameCounts.get(parentKey)?.get(trimmed.toLowerCase()) || 0;
      if (countInParent > 1) {
        reasons.push('同目录目标名称冲突');
      }
    }

    if (reasons.length > 0) {
      const reasonText = reasons.join('；');
      file._renameError = reasonText;
      invalidItems.push({ file, reason: reasonText });
    } else {
      file._renameError = '';
      validTargets.push(file);
    }
  });

  return { validTargets, invalidItems };
}

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
  const parsedStart = parseInt(document.getElementById('qrNumStart').value, 10);
  state.config.numberStart = Number.isNaN(parsedStart) ? 1 : parsedStart;
  state.config.numberPad = parseInt(document.getElementById('qrNumPad').value, 10) || 2;

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

  const kwInputEl = document.getElementById('qrKeywordInput');
  state.searchKeyword = kwInputEl ? kwInputEl.value.trim().toLowerCase() : '';

  recalculateNewNames();
}

export function recalculateNewNames() {
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
  });

  applyRenameRulesToItems(state.fileList, {
    activeTab: state.activeTab,
    config: state.config,
    onlyVisible: true,
    selectedOnlyNumbering: true
  });

  renderTable();
}
