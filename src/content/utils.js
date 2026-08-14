/**
 * 通用工具函数：转义、日志、字符串处理与 CSV 行解析
 */

import { TRAD_SIMP_MAP } from './trad-simp-map.js';

export async function fetchJsonData(relativePath) {
  try {
    const url = chrome.runtime.getURL(relativePath);
    const resp = await fetch(url);
    return await resp.json();
  } catch (e) {
    console.warn('[Quark Rename] 读取 JSON 数据失败:', relativePath, e);
    return null;
  }
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function log(msg) {
  const logBox = document.getElementById('qrLogBox');
  if (!logBox) return;
  const timeStr = new Date().toLocaleTimeString();
  logBox.innerHTML += `<div>[${timeStr}] ${escapeHtml(msg)}</div>`;
  logBox.scrollTop = logBox.scrollHeight;
}

export function replaceAllText(str, search, replacement, ignoreCase) {
  if (!search) return str;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = ignoreCase ? 'gi' : 'g';
  return str.replace(new RegExp(escaped, flags), replacement);
}

export function convertTradToSimpText(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    result += TRAD_SIMP_MAP[char] || char;
  }
  return result;
}

export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

export function friendlyErrorMessage(res) {
  if (!res) return '操作失败';
  const code = res.code;
  const message = res.message || res.error || '';
  const text = String(message).toLowerCase();

  if (code === 23008 || text.includes('同名') || text.includes('冲突') || text.includes('doloading')) {
    return '名称冲突：该文件夹/文件名称已存在，请更换名称后重试';
  }
  if (code === -1) return '网络或代理请求异常，请稍后重试';

  return message || '操作失败';
}
