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
  const code = Number(res.code);
  const message = res.message || res.error || '';
  const text = String(message).toLowerCase();

  if (code === 32003 || code === 32004 || text.includes('capacity') || text.includes('空间不足')) {
    return `网盘剩余空间不足 (${code || 'quota'})：请清理空间或扩容后再试`;
  }
  if (code === 41007 || text.includes('share not exist')) {
    return '分享链接不存在、已过期或已被取消';
  }
  if (code === 41008 || code === 41004 || text.includes('stoken invalid') || text.includes('passcode')) {
    return '提取码错误或分享访问凭证 (stoken) 已过期';
  }
  if (code === 23008 || text.includes('同名') || text.includes('冲突') || text.includes('doloading')) {
    return '名称冲突：该文件夹/文件名称已存在，请更换名称后重试';
  }
  if (code === -1) return message || '网络或代理请求异常，请稍后重试';

  return message || '操作失败';
}

export async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[Quark Assistant] Clipboard API 失败，尝试降级复制:', err);
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch (err) {
    console.warn('[Quark Assistant] 降级复制失败:', err);
    return false;
  }
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = n;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export function formatTimestamp(ms) {
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return '-';
  // 兼容秒级时间戳
  const normalized = num < 1e12 ? num * 1000 : num;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '-';
  return DATE_FORMATTER.format(date).replace(/\//g, '-');
}

export function sanitizeHttpUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(String(url).trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch (e) {
    // 非法 URL 返回空字符串
  }
  return '';
}
