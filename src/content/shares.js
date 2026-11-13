/**
 * 我的分享管理模块：一键全量拉取、本地清单/抓包导入、导出与可视化看板
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import {
  copyTextToClipboard,
  escapeHtml,
  formatSize,
  formatTimestamp,
  friendlyErrorMessage,
  log,
  parseCsvLine,
  sanitizeHttpUrl
} from './utils.js';
import { isQuarkOk, requestDeleteShares, requestMySharesPage } from './api.js';
import { customAlert, customConfirm, toast } from './dialogs.js';
import { mountShareInnerBrowser, openBatchSaveAsModal, openCreateShareModal } from './share-actions.js';

const SHARE_CACHE_KEY = 'quark_shares_cache_v1';
const TEXT_COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function cleanPathInfo(pathInfo) {
  if (!pathInfo) return '根目录';
  return (
    String(pathInfo)
      .replace(/^\.\.\//, '')
      .trim() || '根目录'
  );
}

export function resolveShareStatus(item) {
  if (item.status === 0 || item.status === 3 || item.audit_status === 3) {
    return { key: 'failed', label: '分享失败', tone: 'red', order: 4 };
  }
  if (item.audit_status === 2) {
    return { key: 'violation', label: '文件违规', tone: 'red', order: 3 };
  }
  if (item.partial_violation || item.violation_cnt > 0) {
    const label = item.violation_cnt > 0 ? `有${item.violation_cnt}个违规文件` : '部分违规';
    return { key: 'partial_violation', label, tone: 'amber', order: 2 };
  }

  const now = Date.now();
  const isExpiredByLeft =
    item.expired_type !== 1 && item.expired_left !== undefined && item.expired_left !== null && item.expired_left <= 0;
  const isExpiredByTime = item.expired_type !== 1 && item.expired_at > 0 && item.expired_at < now;
  if (isExpiredByLeft || isExpiredByTime) {
    return { key: 'expired', label: '已过期', tone: 'zinc', order: 5 };
  }

  if (item.audit_status === 1) {
    return { key: 'valid', label: '审核中 (有效)', tone: 'blue', order: 1 };
  }

  if (item.expired_type === 1) {
    return { key: 'valid', label: '永久有效', tone: 'green', order: 0 };
  }

  if (item.expired_left > 0) {
    const days = Math.max(1, Math.ceil(item.expired_left / 86400000));
    return { key: 'valid', label: `剩余 ${days} 天`, tone: 'green', order: 0 };
  }

  return { key: 'valid', label: '有效', tone: 'green', order: 0 };
}

function hasShareTelemetry(item) {
  if (!item) return false;
  return item.click_pv >= 0 || item.save_pv > 0 || item.download_pv > 0 || item.visit_user_count > 0;
}

function normalizeShareItem(raw, index = 0) {
  const firstFile = raw.first_file && typeof raw.first_file === 'object' ? raw.first_file : {};
  const pwdId = String(raw.pwd_id || '').trim();
  const rawUrl = raw.share_url || (pwdId ? `https://pan.quark.cn/s/${pwdId}` : '');
  const shareUrl = sanitizeHttpUrl(rawUrl);

  let inferredPwdId = pwdId;
  if (!inferredPwdId && shareUrl) {
    const match = shareUrl.match(/\/s\/([a-zA-Z0-9]+)/);
    if (match) inferredPwdId = match[1];
  }

  const passcode = String(raw.passcode || '').trim();
  const urlType = Number(raw.url_type) || (passcode ? 2 : 1);
  const isDir =
    typeof raw.is_dir === 'boolean'
      ? raw.is_dir
      : Boolean(firstFile.dir ?? (Number(raw.all_file_num) > 1 || Number(raw.file_only_num) > 1));

  const rawClickPv = raw.click_pv ?? raw.view_pv ?? raw.browse_pv;
  const parsedClickPv =
    rawClickPv !== undefined && rawClickPv !== null && rawClickPv !== '' && !Number.isNaN(Number(rawClickPv)) ? Number(rawClickPv) : -1;

  const item = {
    uid: String(raw.share_id || inferredPwdId || shareUrl || `share_${index}_${Date.now()}`),
    share_id: String(raw.share_id || ''),
    pwd_id: inferredPwdId,
    title: String(raw.title || firstFile.file_name || inferredPwdId || '未命名分享').trim(),
    share_url: shareUrl,
    passcode,
    url_type: urlType,
    is_encrypted: urlType === 2 || Boolean(passcode),
    share_type: Number(raw.share_type) || 0,
    first_fid: String(raw.first_fid || firstFile.fid || ''),
    first_file_name: String(firstFile.file_name || raw.first_file_name || ''),
    is_dir: isDir,
    path_info: String(raw.path_info || ''),
    path_label: cleanPathInfo(raw.path_info),
    size: Number(raw.size) || Number(firstFile.size) || 0,
    file_only_num: Number(raw.file_only_num ?? raw.file_num ?? 1) || 0,
    all_file_num: Number(raw.all_file_num ?? raw.file_num ?? 1) || 0,
    pic_total: Number(raw.pic_total) || 0,
    video_total: Number(raw.video_total) || 0,
    created_at: Number(raw.created_at) || 0,
    updated_at: Number(raw.updated_at) || 0,
    expired_type: Number(raw.expired_type) || 1,
    expired_at: Number(raw.expired_at) || 0,
    expired_left: raw.expired_left !== undefined && raw.expired_left !== null ? Number(raw.expired_left) : null,
    audit_status: raw.audit_status !== undefined && raw.audit_status !== null ? Number(raw.audit_status) : 4,
    status: raw.status !== undefined && raw.status !== null ? Number(raw.status) : 1,
    partial_violation: Boolean(raw.partial_violation),
    violation_cnt: Number(raw.violation_cnt) || 0,
    click_pv: parsedClickPv,
    save_pv: Number(raw.save_pv ?? raw.save_count ?? 0) || 0,
    download_pv: Number(raw.download_pv ?? raw.download_count ?? 0) || 0,
    visit_user_count: Number(raw.visit_user_count ?? raw.visit_uv ?? 0) || 0,
    stoken: String(raw.stoken || ''),
    thumbnail: sanitizeHttpUrl(raw.thumbnail || ''),
    selected: false
  };

  // 如果导入的是自定义 CSV（已带 status_key / status_label），且没有原始数字状态码则尊重导入状态
  if (raw._importedStatusKey) {
    item.statusInfo = {
      key: raw._importedStatusKey,
      label: raw._importedStatusLabel || '有效',
      tone: raw._importedStatusTone || 'green',
      order: 0
    };
  } else {
    item.statusInfo = resolveShareStatus(item);
  }

  return item;
}

function deduplicateShareItems(items) {
  const seen = new Map();
  items.forEach((item) => {
    const key = item.share_id || item.pwd_id || item.share_url || item.uid;
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  });
  return Array.from(seen.values());
}

function extractJsonObjectsFromText(text) {
  const results = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
    }

    if (end !== -1) {
      const candidate = text.slice(start, end + 1);
      try {
        results.push(JSON.parse(candidate));
      } catch (e) {
        // 忽略非 JSON 大括号片段，继续向后扫描
      }
      i = end + 1;
    } else {
      break;
    }
  }
  return results;
}

function mapImportedStatus(statusText) {
  const s = String(statusText || '').trim();
  if (!s) return null;
  if (s.includes('失败')) return { key: 'failed', label: s, tone: 'red' };
  if (s.includes('部分违规') || /有\d+个违规/.test(s)) return { key: 'partial_violation', label: s, tone: 'amber' };
  if (s.includes('违规')) return { key: 'violation', label: s, tone: 'red' };
  if (s.includes('过期')) return { key: 'expired', label: s, tone: 'zinc' };
  if (s.includes('审核')) return { key: 'valid', label: s, tone: 'blue' };
  return { key: 'valid', label: s, tone: 'green' };
}

function parseTimestampInput(val) {
  if (!val) return 0;
  const trimmed = String(val).trim();
  if (/^\d{10,13}$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed.replace(/-/g, '/'));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function splitCsvRecords(text) {
  const records = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (current.trim()) records.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) records.push(current);
  return records;
}

function parseCsvShares(text) {
  const cleaned = text.replace(/^\uFEFF/, '');
  const lines = splitCsvRecords(cleaned);
  if (lines.length === 0) return [];

  const firstParts = parseCsvLine(lines[0]);
  const hasHeader = firstParts.some((col) =>
    ['分享标题', 'title', '标题', '分享链接', 'share_url', '链接', 'url'].includes(col.toLowerCase())
  );

  const headerMap = {};
  let dataStartIdx = 0;
  if (hasHeader) {
    firstParts.forEach((col, idx) => {
      headerMap[col.trim().toLowerCase()] = idx;
    });
    dataStartIdx = 1;
  }

  const getCol = (parts, aliases, fallbackIdx) => {
    if (hasHeader) {
      for (const alias of aliases) {
        const idx = headerMap[alias.toLowerCase()];
        if (idx !== undefined && parts[idx] !== undefined) return parts[idx];
      }
      return '';
    }
    return fallbackIdx !== undefined && parts[fallbackIdx] !== undefined ? parts[fallbackIdx] : '';
  };

  const items = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length === 0 || !parts.some(Boolean)) continue;

    const title = getCol(parts, ['分享标题', 'title', '标题', '文件名'], 0);
    const shareUrl = getCol(parts, ['分享链接', 'share_url', '链接', 'url'], 1);
    const passcode = getCol(parts, ['提取码', 'passcode', '密码'], 2);
    const statusText = getCol(parts, ['分享状态', '状态', 'status'], 3);
    const pathInfo = getCol(parts, ['来源路径', 'path_info', '路径'], 4);
    const fileNum = getCol(parts, ['文件数', 'file_only_num', '文件数量'], 5);
    const sizeBytes = getCol(parts, ['大小(字节)', 'size_bytes', 'size'], 6);
    const createdStr = getCol(parts, ['分享时间', '创建时间', 'created_at'], 8);
    const shareId = getCol(parts, ['share_id'], 10);
    const firstFid = getCol(parts, ['first_fid', '文件fid'], 11);

    if (!title && !shareUrl) continue;

    const statusMapped = mapImportedStatus(statusText);
    const rawObj = {
      title,
      share_url: shareUrl,
      passcode,
      url_type: passcode ? 2 : 1,
      path_info: pathInfo,
      file_only_num: Number(fileNum) || 1,
      all_file_num: Number(fileNum) || 1,
      size: Number(sizeBytes) || 0,
      created_at: parseTimestampInput(createdStr),
      share_id: shareId,
      first_fid: firstFid
    };

    if (statusMapped) {
      rawObj._importedStatusKey = statusMapped.key;
      rawObj._importedStatusLabel = statusMapped.label;
      rawObj._importedStatusTone = statusMapped.tone;
    }

    items.push(normalizeShareItem(rawObj, i));
  }
  return items;
}

function parsePlainTextLinks(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  lines.forEach((line, idx) => {
    const urlMatch = line.match(/https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/);
    if (!urlMatch) return;
    const shareUrl = urlMatch[0];
    const pwdParamMatch = shareUrl.match(/[?&]pwd=([a-zA-Z0-9]+)/);
    const pwdTextMatch = line.match(/(?:提取码|密码)[：:\s]*([a-zA-Z0-9]{4,8})/);
    const passcode = (pwdParamMatch && pwdParamMatch[1]) || (pwdTextMatch && pwdTextMatch[1]) || '';

    let title = line
      .replace(shareUrl, '')
      .replace(/(?:提取码|密码)[：:\s]+[a-zA-Z0-9]{1,8}/g, '')
      .replace(/(?:分享)?(?:链接|地址)[：:\s]*/g, '')
      .replace(/[|｜\t]+/g, ' ')
      .trim();

    if (!title) {
      const idMatch = shareUrl.match(/\/s\/([a-zA-Z0-9]+)/);
      title = idMatch ? `分享_${idMatch[1]}` : `分享链接_${idx + 1}`;
    }

    items.push(
      normalizeShareItem(
        {
          title,
          share_url: shareUrl,
          passcode,
          url_type: passcode ? 2 : 1
        },
        idx
      )
    );
  });
  return items;
}

export function parseShareImportText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];

  // 1. 直接尝试解析完整 JSON（数组或对象）
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed?.data?.list || parsed?.list || parsed?.items || [];
      if (Array.isArray(list) && list.length > 0) {
        return deduplicateShareItems(list.map((item, idx) => normalizeShareItem(item, idx)));
      }
    } catch (e) {
      // 可能为多段 JSON 或带前缀文本，转入后续扫描
    }
  }

  // 2. 扫描抓包报文 / 混合文本中的 JSON 对象（兼容 Shre/请求.txt 格式）
  const jsonObjects = extractJsonObjectsFromText(text);
  const extracted = [];
  jsonObjects.forEach((obj) => {
    const list = obj?.data?.list || obj?.list || obj?.items;
    if (Array.isArray(list)) {
      list.forEach((item, idx) => extracted.push(normalizeShareItem(item, idx)));
    }
  });
  if (extracted.length > 0) {
    return deduplicateShareItems(extracted);
  }

  // 3. 尝试按 CSV 解析
  if (text.includes(',') && text.split(/\r?\n/).length >= 1) {
    const csvItems = parseCsvShares(text);
    if (csvItems.length > 0) {
      return deduplicateShareItems(csvItems);
    }
  }

  // 4. 尝试从纯文本行提取夸克分享链接
  return deduplicateShareItems(parsePlainTextLinks(text));
}

function computeShareSummary(list) {
  const summary = {
    total: list.length,
    valid: 0,
    violation: 0,
    partial_violation: 0,
    expired: 0,
    failed: 0,
    encrypted: 0,
    dirCount: 0,
    totalSize: 0,
    avgSize: 0,
    totalFiles: 0,
    totalSaves: 0,
    totalDownloads: 0,
    hasTelemetry: false,
    hasClickPv: false,
    pathCounts: {}
  };

  list.forEach((item) => {
    const st = item.statusInfo?.key || 'valid';
    if (summary[st] !== undefined) summary[st]++;
    if (item.is_encrypted) summary.encrypted++;
    if (item.is_dir) summary.dirCount++;
    if (hasShareTelemetry(item)) summary.hasTelemetry = true;
    if (item.click_pv >= 0) summary.hasClickPv = true;
    summary.totalSize += item.size || 0;
    summary.totalFiles += item.file_only_num || 0;
    summary.totalSaves += item.save_pv || 0;
    summary.totalDownloads += item.download_pv || 0;

    const pLabel = item.path_label || '根目录';
    summary.pathCounts[pLabel] = (summary.pathCounts[pLabel] || 0) + 1;
  });

  summary.avgSize = summary.total > 0 ? Math.round(summary.totalSize / summary.total) : 0;
  return summary;
}

function getFilteredShares() {
  const { list, filterStatus, filterPath, keyword } = state.shares;
  const kw = String(keyword || '')
    .trim()
    .toLowerCase();

  return list.filter((item) => {
    if (filterStatus === 'encrypted') {
      if (!item.is_encrypted) return false;
    } else if (filterStatus === 'expired_failed') {
      if (item.statusInfo.key !== 'expired' && item.statusInfo.key !== 'failed') return false;
    } else if (filterStatus !== 'all') {
      if (item.statusInfo.key !== filterStatus) return false;
    }

    if (filterPath !== 'all' && item.path_label !== filterPath) {
      return false;
    }

    if (kw) {
      const hay = `${item.title} ${item.share_url} ${item.pwd_id} ${item.path_label} ${item.first_file_name}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function sortSharesArray(items) {
  const { sortKey, sortDir } = state.shares;
  const factor = sortDir === 'asc' ? 1 : -1;

  return [...items].sort((a, b) => {
    if (sortKey === 'size') return factor * ((a.size || 0) - (b.size || 0));
    if (sortKey === 'created_at') return factor * ((a.created_at || 0) - (b.created_at || 0));
    if (sortKey === 'save_pv') return factor * ((a.save_pv || 0) - (b.save_pv || 0));
    if (sortKey === 'file_only_num') return factor * ((a.file_only_num || 0) - (b.file_only_num || 0));
    if (sortKey === 'status') {
      const orderDiff = (a.statusInfo?.order || 0) - (b.statusInfo?.order || 0);
      if (orderDiff !== 0) return factor * orderDiff;
      return factor * TEXT_COLLATOR.compare(a.statusInfo?.label || '', b.statusInfo?.label || '');
    }
    return factor * TEXT_COLLATOR.compare(a.title || '', b.title || '');
  });
}

function saveSharesCache(items, source, sourceLabel) {
  try {
    if (!chrome?.storage?.local) return;
    // 仅缓存必要字段，控制 storage 体积（chrome.storage.local 默认 10MB）
    const compact = items.slice(0, 1000).map((it) => ({
      share_id: it.share_id,
      pwd_id: it.pwd_id,
      title: it.title,
      share_url: it.share_url,
      passcode: it.passcode,
      url_type: it.url_type,
      share_type: it.share_type,
      first_fid: it.first_fid,
      first_file: { file_name: it.first_file_name, dir: it.is_dir, size: it.size },
      path_info: it.path_info,
      size: it.size,
      file_only_num: it.file_only_num,
      all_file_num: it.all_file_num,
      pic_total: it.pic_total,
      video_total: it.video_total,
      created_at: it.created_at,
      updated_at: it.updated_at,
      expired_type: it.expired_type,
      expired_at: it.expired_at,
      expired_left: it.expired_left,
      audit_status: it.audit_status,
      status: it.status,
      partial_violation: it.partial_violation,
      violation_cnt: it.violation_cnt,
      click_pv: it.click_pv,
      save_pv: it.save_pv,
      download_pv: it.download_pv,
      visit_user_count: it.visit_user_count,
      thumbnail: it.thumbnail
    }));

    chrome.storage.local.set(
      {
        [SHARE_CACHE_KEY]: {
          source,
          sourceLabel,
          updatedAt: Date.now(),
          items: compact
        }
      },
      () => {
        if (chrome.runtime?.lastError) {
          console.warn('[Quark Shares] 缓存写入受限:', chrome.runtime.lastError.message);
        }
      }
    );
  } catch (err) {
    console.warn('[Quark Shares] 缓存保存异常:', err);
  }
}

function restoreSharesCacheIfEmpty() {
  if (state.shares.cacheLoaded || state.shares.list.length > 0) return;
  state.shares.cacheLoaded = true;

  try {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get([SHARE_CACHE_KEY], (res) => {
      if (chrome.runtime?.lastError) {
        console.warn('[Quark Shares] 读取缓存失败:', chrome.runtime.lastError.message);
        return;
      }
      const cache = res && res[SHARE_CACHE_KEY];
      if (cache && Array.isArray(cache.items) && cache.items.length > 0 && state.shares.list.length === 0) {
        state.shares.list = cache.items.map((item, idx) => normalizeShareItem(item, idx));
        state.shares.source = 'cache';
        state.shares.sourceLabel = `${cache.sourceLabel || '上次快照'}（本地缓存）`;
        state.shares.updatedAt = cache.updatedAt || 0;
        renderSharesAll();
      }
    });
  } catch (err) {
    console.warn('[Quark Shares] 恢复缓存异常:', err);
  }
}

function formatShareLinkText(item, withTitle = true) {
  const url = item.share_url || '';
  const codePart = item.passcode ? ` 提取码: ${item.passcode}` : '';
  if (!withTitle) {
    return `${url}${codePart}`.trim();
  }
  return `${item.title}\n链接: ${url}${codePart}`.trim();
}

function formatSingleLineShareText(item) {
  const url = item.share_url || '';
  if (!url) return '';
  const codePart = item.passcode ? ` 提取码: ${item.passcode}` : '';
  const titlePart = item.title ? `${item.title} ` : '';
  return `${titlePart}${url}${codePart}`.trim();
}

export function prependCreatedShares(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return;
  const incoming = rawItems.map((it, idx) => normalizeShareItem(it, idx));
  const merged = deduplicateShareItems([...incoming, ...state.shares.list]);
  state.shares.list = merged;
  if (state.shares.source === 'none') {
    state.shares.source = 'online';
  }
  state.shares.sourceLabel = `${state.shares.source === 'import' ? '本地导入' : '在线实时'} · ${merged.length} 项`;
  state.shares.updatedAt = Date.now();
  saveSharesCache(merged, state.shares.source, state.shares.sourceLabel);
  if (document.getElementById('qrShareTableBody')) {
    renderSharesAll();
  }
}

export async function fetchAllMyShares() {
  if (state.shares.isLoading) return;

  const seq = ++state.shares.fetchSeq;
  state.shares.isLoading = true;
  const fetchBtn = document.getElementById('qrShareFetchBtn');
  if (fetchBtn) {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = `${ICONS.refresh} 拉取第 1 页...`;
  }

  try {
    const pageSize = 50;
    const firstResp = await requestMySharesPage(1, pageSize, 'all', 'created_at', 'desc');
    if (seq !== state.shares.fetchSeq) return;

    if (!firstResp || (firstResp.code !== 0 && firstResp.status !== 200)) {
      throw new Error(firstResp?.message || firstResp?.error || '获取分享列表失败，请确认已登录夸克网盘');
    }

    const total = Number(firstResp.metadata?._total ?? firstResp.data?.total ?? 0);
    const firstList = Array.isArray(firstResp.data?.list) ? firstResp.data.list : [];
    const collected = [...firstList];

    const hasUnknownMore = total === 0 && firstList.length === pageSize;
    const totalPages = total > 0 ? Math.min(100, Math.ceil(total / pageSize)) : hasUnknownMore ? 50 : 1;
    log(`开始一键拉取我的分享列表，预计共 ${total || firstList.length} 项...`);

    for (let page = 2; page <= totalPages; page++) {
      if (seq !== state.shares.fetchSeq) return;
      if (fetchBtn) {
        const progressText =
          total > 0 ? `拉取 ${page}/${totalPages} 页 (${collected.length}/${total})...` : `拉取第 ${page} 页 (${collected.length} 项)...`;
        fetchBtn.innerHTML = `${ICONS.refresh} ${progressText}`;
      }
      const resp = await requestMySharesPage(page, pageSize, 'all', 'created_at', 'desc');
      if (seq !== state.shares.fetchSeq) return;

      if (resp && (resp.code === 0 || resp.status === 200) && Array.isArray(resp.data?.list)) {
        if (resp.data.list.length === 0) break;
        collected.push(...resp.data.list);
        if (resp.data.list.length < pageSize) break;
        if (total > 0 && collected.length >= total) break;
      } else {
        log(`第 ${page} 页拉取异常: ${resp?.message || resp?.error || '跳过'}`);
        break;
      }

      if (page < totalPages) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    const normalized = deduplicateShareItems(collected.map((item, idx) => normalizeShareItem(item, idx)));
    state.shares.list = normalized;
    state.shares.source = 'online';
    state.shares.sourceLabel = `在线实时 · ${normalized.length} 项`;
    state.shares.updatedAt = Date.now();
    state.shares.filterPath = 'all';

    saveSharesCache(normalized, 'online', `在线拉取 (${normalized.length} 项)`);
    renderSharesAll();

    log(`我的分享列表拉取完成，共 ${normalized.length} 项`);
    toast(`已一键拉取 ${normalized.length} 条我的分享记录`);
  } catch (err) {
    if (seq !== state.shares.fetchSeq) return;
    log(`拉取我的分享失败: ${err.message}`);
    customAlert('拉取分享失败', err.message || '请确认已登录夸克网盘网页端后重试。');
  } finally {
    if (seq === state.shares.fetchSeq) {
      state.shares.isLoading = false;
      if (fetchBtn) {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = `${ICONS.refresh} 一键拉取`;
      }
    }
  }
}

function applyImportedShares(items, label) {
  if (!items || items.length === 0) {
    customAlert('导入失败', '未在文件内容中识别到有效的夸克分享数据，请检查是否为插件导出的 JSON/CSV 或抓包响应文本。');
    return;
  }

  state.shares.list = items;
  state.shares.source = 'import';
  state.shares.sourceLabel = `本地导入 · ${label} (${items.length} 项)`;
  state.shares.updatedAt = Date.now();
  state.shares.filterStatus = 'all';
  state.shares.filterPath = 'all';
  state.shares.keyword = '';

  const kwInput = document.getElementById('qrShareKeywordInput');
  if (kwInput) kwInput.value = '';

  saveSharesCache(items, 'import', label);
  renderSharesAll();
  log(`成功导入分享清单 [${label}]，共 ${items.length} 项`);
  toast(`已成功导入 ${items.length} 条分享记录`);
}

export function importSharesFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const items = parseShareImportText(String(e.target.result || ''));
      applyImportedShares(items, file.name);
    } catch (err) {
      customAlert('解析错误', `无法解析文件 ${file.name}: ${err.message}`);
    }
  };
  reader.onerror = () => {
    customAlert('读取失败', '无法读取所选文件，请重试。');
  };
  reader.readAsText(file, 'utf-8');
}

function openPasteImportModal() {
  document.querySelectorAll('.qr-dialog-overlay:not(.qr-system-dialog-overlay)').forEach((d) => d.remove());

  const dialog = document.createElement('div');
  dialog.className = 'qr-dialog-overlay';
  dialog.innerHTML = `
    <div class="qr-dialog-box qr-share-modal-box">
      <div class="qr-dialog-title qr-history-dialog-title">
        <span class="qr-title-text">${ICONS.paste} 粘贴导入分享数据 / 抓包响应</span>
        <button type="button" class="qr-close-btn qr-dialog-close" aria-label="关闭">&times;</button>
      </div>
      <div class="qr-dialog-content">
        <p style="margin: 0 0 8px; color: #a1a1aa; font-size: 12px; line-height: 1.5;">
          支持直接粘贴：<b>① 浏览器抓包文本（如请求.txt 整段报文或 JSON 响应）</b>、<b>② 插件导出的 JSON/CSV 清单</b>、<b>③ 纯文本夸克分享链接（含提取码）</b>。
        </p>
        <textarea id="qrSharePasteTextarea" class="qr-share-textarea" placeholder="在此粘贴 JSON / CSV / 抓包响应文本 / https://pan.quark.cn/s/... 分享链接列表"></textarea>
      </div>
      <div class="qr-dialog-actions">
        <button type="button" class="qr-btn-secondary qr-dialog-close">取消</button>
        <button type="button" id="qrShareConfirmPasteBtn" class="qr-btn-primary" style="padding: 6px 16px;">解析并导入</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const textarea = dialog.querySelector('#qrSharePasteTextarea');
  if (textarea) setTimeout(() => textarea.focus(), 40);

  const closeDialog = () => {
    document.removeEventListener('keydown', onEsc);
    dialog.remove();
  };
  const onEsc = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.qr-system-dialog-overlay')) closeDialog();
  };
  document.addEventListener('keydown', onEsc);
  dialog.querySelectorAll('.qr-dialog-close').forEach((btn) => btn.addEventListener('click', closeDialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });

  const confirmBtn = dialog.querySelector('#qrShareConfirmPasteBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const text = textarea ? textarea.value : '';
      const items = parseShareImportText(text);
      if (items.length === 0) {
        customAlert('未识别到数据', '未能从粘贴内容中解析出有效分享条目，请检查文本格式。');
        return;
      }
      closeDialog();
      applyImportedShares(items, '剪贴板粘贴');
    });
  }
}

function getActionTargetShares() {
  const visible = getFilteredShares();
  const checked = visible.filter((it) => it.selected);
  if (checked.length > 0) {
    return { items: checked, fromSelection: true };
  }
  return { items: visible, fromSelection: false };
}

function exportSharesCsv() {
  if (state.shares.list.length === 0) {
    customAlert('提示', '暂无可导出的分享数据，请先一键拉取或导入分享清单。');
    return;
  }

  const { items, fromSelection } = getActionTargetShares();
  if (items.length === 0) {
    customAlert('提示', '当前筛选结果为空，没有可导出的分享记录。');
    return;
  }

  const csvCell = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const headers = [
    '分享标题',
    '分享链接',
    '提取码',
    '分享状态',
    '来源路径',
    '文件数',
    '大小(字节)',
    '大小',
    '分享时间',
    '转存次数',
    'share_id',
    'first_fid'
  ];

  const rows = items.map((it) =>
    [
      csvCell(it.title),
      csvCell(it.share_url),
      csvCell(it.passcode),
      csvCell(it.statusInfo?.label || ''),
      csvCell(it.path_label),
      it.file_only_num,
      it.size,
      csvCell(formatSize(it.size)),
      csvCell(formatTimestamp(it.created_at)),
      it.save_pv,
      csvCell(it.share_id),
      csvCell(it.first_fid)
    ].join(',')
  );

  const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quark_my_shares_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  log(`导出分享 CSV 成功，共 ${items.length} 条`);
  toast(`已导出 ${items.length} 条${fromSelection ? '选中' : '当前视图'}分享至 CSV`);
}

function exportSharesJson() {
  if (state.shares.list.length === 0) {
    customAlert('提示', '暂无可导出的分享数据，请先一键拉取或导入分享清单。');
    return;
  }

  const { items, fromSelection } = getActionTargetShares();
  if (items.length === 0) {
    customAlert('提示', '当前筛选结果为空，没有可导出的分享记录。');
    return;
  }

  const payload = {
    exported_at: new Date().toISOString(),
    source: state.shares.source,
    total: items.length,
    list: items.map((it) => ({
      title: it.title,
      share_id: it.share_id,
      pwd_id: it.pwd_id,
      share_url: it.share_url,
      passcode: it.passcode,
      url_type: it.url_type,
      first_fid: it.first_fid,
      first_file: {
        fid: it.first_fid,
        file_name: it.first_file_name,
        dir: it.is_dir,
        size: it.size
      },
      path_info: it.path_info,
      size: it.size,
      file_only_num: it.file_only_num,
      all_file_num: it.all_file_num,
      pic_total: it.pic_total,
      video_total: it.video_total,
      created_at: it.created_at,
      updated_at: it.updated_at,
      expired_type: it.expired_type,
      expired_at: it.expired_at,
      expired_left: it.expired_left,
      audit_status: it.audit_status,
      status: it.status,
      partial_violation: it.partial_violation,
      violation_cnt: it.violation_cnt,
      click_pv: it.click_pv,
      save_pv: it.save_pv,
      download_pv: it.download_pv,
      visit_user_count: it.visit_user_count,
      thumbnail: it.thumbnail
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quark_my_shares_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);

  log(`导出分享 JSON 成功，共 ${items.length} 条`);
  toast(`已导出 ${items.length} 条${fromSelection ? '选中' : '当前视图'}分享至 JSON`);
}

async function copySelectedShares() {
  if (state.shares.list.length === 0) {
    customAlert('提示', '暂无可复制的分享数据，请先一键拉取或导入分享清单。');
    return;
  }

  const { items, fromSelection } = getActionTargetShares();
  if (items.length === 0) {
    customAlert('提示', '当前筛选结果为空。');
    return;
  }

  const text = items.map((it) => formatShareLinkText(it, true)).join('\n\n');
  const ok = await copyTextToClipboard(text);
  if (ok) {
    toast(`已复制 ${items.length} 条${fromSelection ? '选中' : '当前视图'}分享链接`);
  } else {
    customAlert('复制失败', '浏览器拒绝写入剪贴板，请使用「导出 CSV/JSON」功能。');
  }
}

function selectInvalidOrViolationShares() {
  if (state.shares.list.length === 0) {
    customAlert('提示', '请先拉取或导入分享列表。');
    return;
  }

  const targetKeys = state.shares.filterStatus === 'partial_violation' ? ['partial_violation'] : ['expired', 'failed', 'violation'];
  const visible = getFilteredShares();
  let matched = visible.filter((it) => targetKeys.includes(it.statusInfo?.key));

  if (matched.length === 0 && (state.shares.filterStatus !== 'all' || state.shares.filterPath !== 'all')) {
    const allMatched = state.shares.list.filter((it) => ['expired', 'failed', 'violation'].includes(it.statusInfo?.key));
    if (allMatched.length > 0) {
      state.shares.filterStatus = 'all';
      state.shares.filterPath = 'all';
      allMatched.forEach((it) => {
        it.selected = true;
      });
      renderSharesAll();
      toast(`已切换到全部视图并勾选 ${allMatched.length} 条失效/违规分享`);
      return;
    }
  }

  if (matched.length === 0) {
    const partialCount = state.shares.list.filter((it) => it.statusInfo?.key === 'partial_violation').length;
    if (partialCount > 0) {
      toast(`未发现全包失效/违规记录（另有 ${partialCount} 条「部分违规」可点击筛选单独检查）`, 'info');
    } else {
      toast('当前列表中未发现过期、失败或违规分享记录', 'info');
    }
    return;
  }

  matched.forEach((it) => {
    it.selected = true;
  });
  renderShareTable();
  toast(`已自动勾选 ${matched.length} 条失效/违规分享`);
}

function openBatchSaveFromSharesView() {
  const visible = getFilteredShares();
  const checked = visible.filter((it) => it.selected && it.share_url);
  const initialLinksText = checked.map(formatSingleLineShareText).filter(Boolean).join('\n');
  openBatchSaveAsModal({ initialLinksText });
}

function runBatchCancelShares() {
  if (state.isRunning || state.shares.isLoading) {
    customAlert('提示', '当前已有操作或拉取任务正在执行，请稍候。');
    return;
  }

  const visible = getFilteredShares();
  const selected = visible.filter((it) => it.selected);
  if (selected.length === 0) {
    customAlert('提示', '请先勾选需要取消的分享记录（也可点击「勾选失效/违规」快速选中过期与违规分享）。');
    return;
  }

  const cancelable = selected.filter((it) => Boolean(it.share_id));
  const skippedCount = selected.length - cancelable.length;
  if (cancelable.length === 0) {
    customAlert(
      '缺少 share_id',
      '所选分享记录缺少官方 share_id（通常为纯文本链接导入），请点击「一键拉取分享」同步线上列表后再执行取消操作。'
    );
    return;
  }

  const skippedHint = skippedCount > 0 ? `\n（注意：其中 ${skippedCount} 条缺少 share_id 的文本导入项将被跳过）` : '';
  customConfirm(
    '确认批量取消分享',
    `⚠️ 确认永久取消已选中的 ${cancelable.length} 条分享链接吗？\n取消后外链将立即失效，网盘内的原文件不会被删除。${skippedHint}`,
    async (confirmed) => {
      if (!confirmed) return;

      state.isRunning = true;
      const cancelBtn = document.getElementById('qrShareCancelBtn');
      if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.innerHTML = `${ICONS.refresh} 取消中...`;
      }

      const shareIds = cancelable.map((it) => it.share_id);
      const removedIds = new Set();
      const CHUNK_SIZE = 50;

      try {
        for (let i = 0; i < shareIds.length; i += CHUNK_SIZE) {
          const chunk = shareIds.slice(i, i + CHUNK_SIZE);
          const res = await requestDeleteShares(chunk);
          if (!isQuarkOk(res)) {
            throw new Error(friendlyErrorMessage(res));
          }
          chunk.forEach((id) => removedIds.add(id));
          if (i + CHUNK_SIZE < shareIds.length) {
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        state.shares.list = state.shares.list.filter((it) => !removedIds.has(it.share_id));
        state.shares.sourceLabel = `${state.shares.source === 'import' ? '本地导入' : '在线实时'} · ${state.shares.list.length} 项`;
        saveSharesCache(state.shares.list, state.shares.source, state.shares.sourceLabel);
        renderSharesAll();
        log(`批量取消分享完成: 已永久关闭 ${removedIds.size} 条分享链接`);
        toast(`已取消 ${removedIds.size} 条分享链接`);
      } catch (err) {
        if (removedIds.size > 0) {
          state.shares.list = state.shares.list.filter((it) => !removedIds.has(it.share_id));
          saveSharesCache(state.shares.list, state.shares.source, state.shares.sourceLabel);
          renderSharesAll();
        }
        const msg = err.message || '取消分享失败';
        log(`取消分享失败: ${msg}`);
        customAlert('取消分享失败', removedIds.size > 0 ? `已取消 ${removedIds.size} 条，后续批次失败：${msg}` : msg);
      } finally {
        state.isRunning = false;
        if (cancelBtn) cancelBtn.disabled = false;
        updateShareActionLabels();
      }
    }
  );
}

function openReshareForItem(item) {
  if (!item) return;
  if (!item.first_fid) {
    customAlert(
      '无法重开分享',
      '该分享记录缺少原始文件 FID（first_fid，常见于纯文本导入记录），请先点击顶部「一键拉取」同步线上记录后再试。'
    );
    return;
  }

  openCreateShareModal(
    [
      {
        fid: item.first_fid,
        file_name: item.first_file_name || item.title,
        is_dir: Boolean(item.is_dir),
        size: Number(item.size) || 0
      }
    ],
    {
      initialTitle: item.title,
      initialUrlType: item.url_type,
      initialExpiredType: item.expired_type,
      onSharesCreated: prependCreatedShares
    }
  );
}

function openShareDetailModal(item) {
  if (!item) return;
  document.querySelectorAll('.qr-dialog-overlay:not(.qr-system-dialog-overlay)').forEach((d) => d.remove());

  const safeHref = sanitizeHttpUrl(item.share_url);
  const st = item.statusInfo || resolveShareStatus(item);
  const telemetryReady = hasShareTelemetry(item);
  const dirCount = Math.max(0, (Number(item.all_file_num) || 0) - (Number(item.file_only_num) || 0));
  const clickText = !telemetryReady ? 'PC端未下发' : item.click_pv < 0 ? '未公开' : String(item.click_pv);
  const visitorMetaText = telemetryReady ? `${clickText} / ${item.visit_user_count} 人` : 'PC端未开放统计';
  const mediaMetaText =
    item.pic_total > 0 || item.video_total > 0
      ? `${item.pic_total} 图 / ${item.video_total} 视频`
      : `${item.file_only_num} 文件${dirCount > 0 ? ` · ${dirCount} 子目录` : ''}`;
  const expireText = item.expired_type === 1 ? '永久有效' : formatTimestamp(item.expired_at);

  const dialog = document.createElement('div');
  dialog.className = 'qr-dialog-overlay';
  dialog.innerHTML = `
    <div class="qr-dialog-box qr-share-detail-box">
      <div class="qr-dialog-title qr-history-dialog-title">
        <span class="qr-title-text">${ICONS.eye} 分享详情与包内文件浏览器</span>
        <button type="button" class="qr-close-btn qr-dialog-close" aria-label="关闭">&times;</button>
      </div>
      <div class="qr-dialog-content qr-share-detail-body">
        <div class="qr-share-detail-hero">
          <div class="qr-share-detail-title">${escapeHtml(item.title)}</div>
          <div class="qr-share-detail-badges">
            <span class="qr-share-badge qr-share-badge-${st.tone}">${escapeHtml(st.label)}</span>
            ${item.is_encrypted ? `<span class="qr-share-badge qr-share-badge-purple">${ICONS.lock} 加密链接</span>` : ''}
            <span class="qr-share-badge qr-share-badge-blue">${item.is_dir ? '文件夹' : '单文件'}</span>
          </div>
        </div>

        <div class="qr-tabs qr-detail-tabs">
          <button type="button" class="qr-tab-btn active" data-detail-tab="overview">概览与统计指标</button>
          <button type="button" class="qr-tab-btn" data-detail-tab="files">${ICONS.folder} 包内文件浏览 &amp; 搜索</button>
        </div>

        <div id="qrDetailOverviewPane" style="display:flex; flex-direction:column; gap:10px;">
          <div class="qr-share-detail-link-row">
            <span class="qr-share-detail-label">分享链接</span>
            <div class="qr-share-detail-link-val">
              ${
                safeHref
                  ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer" class="qr-author-link">${escapeHtml(safeHref)}</a>`
                  : '<span style="color:#71717a;">无链接</span>'
              }
              ${item.passcode ? `<span class="qr-share-pwd-pill">提取码: ${escapeHtml(item.passcode)}</span>` : ''}
            </div>
          </div>

          <div class="qr-share-detail-kpis">
            <div class="qr-stat-item"><span class="qr-stat-value">${formatSize(item.size)}</span><span class="qr-stat-label">分享总体积</span></div>
            <div class="qr-stat-item"><span class="qr-stat-value">${item.file_only_num} / ${item.all_file_num}</span><span class="qr-stat-label">文件数 / 含目录</span></div>
            <div class="qr-stat-item"><span class="qr-stat-value" style="${telemetryReady ? '' : 'color:#71717a;'}" title="${telemetryReady ? '' : '夸克 PC 端列表接口未下发转存统计'}">${telemetryReady ? item.save_pv : '未下发'}</span><span class="qr-stat-label">转存次数</span></div>
            <div class="qr-stat-item"><span class="qr-stat-value" style="${telemetryReady ? '' : 'color:#71717a;'}" title="${telemetryReady ? '' : '夸克 PC 端列表接口未下发下载统计'}">${telemetryReady ? item.download_pv : '未下发'}</span><span class="qr-stat-label">下载次数</span></div>
          </div>

          <div class="qr-share-detail-meta">
            <div><span>来源路径：</span><b>${escapeHtml(item.path_label)}</b></div>
            <div><span>源文件名：</span><b>${escapeHtml(item.first_file_name || item.title)}</b></div>
            <div><span>创建时间：</span><b>${escapeHtml(formatTimestamp(item.created_at))}</b></div>
            <div><span>更新时间：</span><b>${escapeHtml(formatTimestamp(item.updated_at))}</b></div>
            <div><span>有效期至：</span><b>${escapeHtml(expireText)}</b></div>
            <div><span>浏览/访客：</span><b title="${telemetryReady ? '' : '夸克 PC 网页端接口返回 click_pv=-1，访客/浏览统计未对外开放'}">${escapeHtml(visitorMetaText)}</b></div>
            <div><span>内容结构：</span><b>${escapeHtml(mediaMetaText)}</b></div>
            <div><span>Share ID：</span><b style="font-family:monospace;">${escapeHtml(item.share_id || '-')}</b></div>
            <div><span>First FID：</span><b style="font-family:monospace;">${escapeHtml(item.first_fid || '-')}</b></div>
          </div>
        </div>

        <div id="qrDetailBrowserPane" class="hidden"></div>
      </div>
      <div class="qr-dialog-actions" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" id="qrDetailCopyBtn" class="qr-btn-tool qr-btn-purple">${ICONS.copy} 复制分享文案</button>
          <button type="button" id="qrDetailSaveAsBtn" class="qr-btn-tool qr-btn-green">${ICONS.download} 转存此分享</button>
          ${
            item.first_fid
              ? `<button type="button" id="qrDetailReshareBtn" class="qr-btn-tool qr-btn-amber" title="使用原文件一键重新生成新分享链接">${ICONS.replay} 重开分享</button>`
              : ''
          }
        </div>
        <div style="display:flex; gap:8px;">
          ${
            safeHref
              ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer" class="qr-btn-tool qr-btn-blue" style="text-decoration:none;">${ICONS.external} 打开分享页</a>`
              : ''
          }
          <button type="button" class="qr-btn-secondary qr-dialog-close">关闭</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  const closeDialog = () => {
    document.removeEventListener('keydown', onEsc);
    dialog.remove();
  };
  const onEsc = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.qr-subdialog-overlay') && !document.querySelector('.qr-system-dialog-overlay')) {
      closeDialog();
    }
  };
  document.addEventListener('keydown', onEsc);
  dialog.querySelectorAll('.qr-dialog-close').forEach((btn) => btn.addEventListener('click', closeDialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });

  const overviewPane = dialog.querySelector('#qrDetailOverviewPane');
  const browserPane = dialog.querySelector('#qrDetailBrowserPane');
  const browserCtrl = mountShareInnerBrowser(browserPane, item, {
    onSaveSelected: (directEntries) => openBatchSaveAsModal({ directEntries })
  });

  dialog.querySelectorAll('.qr-detail-tabs .qr-tab-btn').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const targetTab = tabBtn.dataset.detailTab;
      dialog.querySelectorAll('.qr-detail-tabs .qr-tab-btn').forEach((b) => b.classList.toggle('active', b === tabBtn));
      if (overviewPane) overviewPane.classList.toggle('hidden', targetTab !== 'overview');
      if (browserPane) browserPane.classList.toggle('hidden', targetTab !== 'files');
      if (targetTab === 'files' && browserCtrl) {
        browserCtrl.ensureLoaded();
      }
    });
  });

  const copyBtn = dialog.querySelector('#qrDetailCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(formatShareLinkText(item, true));
      if (ok) toast('已复制该分享完整文案');
    });
  }

  const saveAsBtn = dialog.querySelector('#qrDetailSaveAsBtn');
  if (saveAsBtn) {
    saveAsBtn.addEventListener('click', () => {
      const linkLine = formatSingleLineShareText(item);
      if (!linkLine) {
        customAlert('提示', '该分享缺少有效链接，无法发起转存。');
        return;
      }
      openBatchSaveAsModal({ initialLinksText: linkLine });
    });
  }

  const reshareBtn = dialog.querySelector('#qrDetailReshareBtn');
  if (reshareBtn) {
    reshareBtn.addEventListener('click', () => {
      closeDialog();
      openReshareForItem(item);
    });
  }
}

function renderShareDashboard() {
  const dashEl = document.getElementById('qrShareDashboard');
  if (!dashEl) return;

  const summary = computeShareSummary(state.shares.list);
  const expiredFailed = summary.expired + summary.failed;
  const violationTotal = summary.violation + summary.partial_violation;
  const validPct = summary.total > 0 ? Math.round((summary.valid / summary.total) * 100) : 0;

  const pct = (count) => (summary.total > 0 ? ((count / summary.total) * 100).toFixed(2) : '0');

  const topPaths = Object.entries(summary.pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const pathChipsHtml =
    summary.total > 0
      ? `
    <div class="qr-share-path-bar">
      <span class="qr-share-path-label">来源目录:</span>
      <div class="qr-share-path-chips">
        <button type="button" class="qr-chip ${state.shares.filterPath === 'all' ? 'active' : ''}" data-share-path="all">全部目录 (${summary.total})</button>
        ${topPaths
          .map(
            ([pathName, cnt]) =>
              `<button type="button" class="qr-chip ${state.shares.filterPath === pathName ? 'active' : ''}" data-share-path="${escapeHtml(pathName)}" title="${escapeHtml(pathName)}">${escapeHtml(pathName)} (${cnt})</button>`
          )
          .join('')}
      </div>
    </div>
  `
      : '';

  dashEl.innerHTML = `
    <div class="qr-share-stats-grid">
      <div class="qr-stat-item">
        <span class="qr-stat-value">${summary.total}</span>
        <span class="qr-stat-label">分享总数 (${summary.totalFiles} 文件)</span>
      </div>
      <div class="qr-stat-item">
        <span class="qr-stat-value" style="color: #4ade80;">${summary.valid}</span>
        <span class="qr-stat-label">正常有效 (${validPct}%)</span>
      </div>
      <div class="qr-stat-item">
        <span class="qr-stat-value" style="color: ${violationTotal > 0 ? '#fbbf24' : '#71717a'};">${violationTotal}</span>
        <span class="qr-stat-label">违规 ${summary.violation} · 部分 ${summary.partial_violation}</span>
      </div>
      <div class="qr-stat-item">
        <span class="qr-stat-value" style="color: #c084fc;">${summary.encrypted} / ${expiredFailed}</span>
        <span class="qr-stat-label">加密链接 / 过期失效</span>
      </div>
      <div class="qr-stat-item">
        <span class="qr-stat-value" style="color: #60a5fa;">${formatSize(summary.totalSize)}</span>
        <span class="qr-stat-label" title="${
          summary.total === 0 || summary.hasTelemetry
            ? ''
            : '夸克 PC 网页端列表接口未下发浏览/转存/下载次数（click_pv=-1），此处展示单条平均体积'
        }">${
          summary.total === 0
            ? '总分享体积'
            : summary.hasTelemetry
              ? `总分享体积 · 转存 ${summary.totalSaves}`
              : `总分享体积 · 均 ${formatSize(summary.avgSize)}/条`
        }</span>
      </div>
    </div>

    <div class="qr-share-dist-wrap" aria-label="分享状态分布占比">
      <div class="qr-share-dist-bar">
        <div class="qr-share-dist-seg seg-green" style="width:${pct(summary.valid)}%" title="正常有效: ${summary.valid} 项 (${pct(summary.valid)}%)"></div>
        <div class="qr-share-dist-seg seg-amber" style="width:${pct(summary.partial_violation)}%" title="部分违规: ${summary.partial_violation} 项 (${pct(summary.partial_violation)}%)"></div>
        <div class="qr-share-dist-seg seg-red" style="width:${pct(summary.violation)}%" title="文件违规: ${summary.violation} 项 (${pct(summary.violation)}%)"></div>
        <div class="qr-share-dist-seg seg-zinc" style="width:${pct(expiredFailed)}%" title="过期/失败: ${expiredFailed} 项 (${pct(expiredFailed)}%)"></div>
      </div>
      <div class="qr-share-dist-legend">
        <button type="button" class="qr-legend-btn" data-legend-filter="valid"><span class="qr-dot seg-green"></span>正常有效 ${summary.valid}</button>
        <button type="button" class="qr-legend-btn" data-legend-filter="partial_violation"><span class="qr-dot seg-amber"></span>部分违规 ${summary.partial_violation}</button>
        <button type="button" class="qr-legend-btn" data-legend-filter="violation"><span class="qr-dot seg-red"></span>文件违规 ${summary.violation}</button>
        <button type="button" class="qr-legend-btn" data-legend-filter="expired_failed"><span class="qr-dot seg-zinc"></span>过期/失败 ${expiredFailed}</button>
      </div>
    </div>

    ${pathChipsHtml}
  `;

  dashEl.querySelectorAll('.qr-legend-btn[data-legend-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetFilter = btn.dataset.legendFilter;
      state.shares.filterStatus = state.shares.filterStatus === targetFilter ? 'all' : targetFilter;
      renderSharesAll();
    });
  });

  dashEl.querySelectorAll('.qr-chip[data-share-path]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.shares.filterPath = chip.dataset.sharePath || 'all';
      renderSharesAll();
    });
  });
}

function renderShareFilterChips() {
  const chipsWrap = document.getElementById('qrShareFilterChips');
  if (!chipsWrap) return;

  const summary = computeShareSummary(state.shares.list);
  const filters = [
    { key: 'all', label: '全部', count: summary.total },
    { key: 'valid', label: '有效', count: summary.valid },
    { key: 'violation', label: '文件违规', count: summary.violation },
    { key: 'partial_violation', label: '部分违规', count: summary.partial_violation },
    { key: 'expired_failed', label: '过期/失败', count: summary.expired + summary.failed },
    { key: 'encrypted', label: '加密链接', count: summary.encrypted }
  ];

  chipsWrap.innerHTML = filters
    .map(
      (f) =>
        `<button type="button" class="qr-chip ${state.shares.filterStatus === f.key ? 'active' : ''}" data-share-filter="${f.key}">${f.label} (${f.count})</button>`
    )
    .join('');

  chipsWrap.querySelectorAll('.qr-chip[data-share-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.shares.filterStatus = btn.dataset.shareFilter || 'all';
      renderSharesAll();
    });
  });
}

function updateShareActionLabels() {
  const visible = getFilteredShares();
  const checkedCount = visible.filter((it) => it.selected).length;
  const cancelableCount = visible.filter((it) => it.selected && Boolean(it.share_id)).length;

  const sourceBadge = document.getElementById('qrShareSourceBadge');
  if (sourceBadge) {
    sourceBadge.textContent = state.shares.sourceLabel;
  }

  const hasAnyTelemetry = state.shares.list.some(hasShareTelemetry);
  const telemetryHint = document.getElementById('qrShareTelemetryHint');
  if (telemetryHint) {
    telemetryHint.classList.toggle('hidden', state.shares.list.length === 0 || hasAnyTelemetry);
  }

  const timeColLabel = document.getElementById('qrShareTimeColLabel');
  if (timeColLabel) {
    const useAttrLabel = state.shares.list.length > 0 && !hasAnyTelemetry;
    timeColLabel.textContent = useAttrLabel ? '分享时间 / 属性' : '分享时间 / 热度';
    timeColLabel.title = useAttrLabel ? '夸克 PC 网页端列表接口返回 click_pv=-1 且未下发热度统计，当前显示分享属性' : '';
  }

  const copyBtn = document.getElementById('qrShareCopyBtn');
  if (copyBtn) {
    copyBtn.innerHTML = checkedCount > 0 ? `${ICONS.copy} 复制选中 (${checkedCount})` : `${ICONS.copy} 复制全部 (${visible.length})`;
  }

  const batchSaveBtn = document.getElementById('qrShareBatchSaveBtn');
  if (batchSaveBtn) {
    batchSaveBtn.innerHTML = checkedCount > 0 ? `${ICONS.download} 转存选中 (${checkedCount})` : `${ICONS.download} 批量转存`;
  }

  const cancelBtn = document.getElementById('qrShareCancelBtn');
  if (cancelBtn) {
    cancelBtn.innerHTML = `${ICONS.trash} 取消分享 (${cancelableCount})`;
  }

  const selectAllCb = document.getElementById('qrShareSelectAll');
  if (selectAllCb) {
    selectAllCb.checked = visible.length > 0 && checkedCount === visible.length;
    selectAllCb.indeterminate = checkedCount > 0 && checkedCount < visible.length;
  }
}

function syncTableHeaderSortState() {
  const table = document.getElementById('qrShareTable');
  if (!table || !table.tHead || !table.tHead.rows[0]) return;

  for (const th of table.tHead.rows[0].cells) {
    const key = th.dataset.sortKey;
    if (key && key === state.shares.sortKey) {
      th.setAttribute('aria-sort', state.shares.sortDir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  }
}

function sortExistingTableRows(sortKey, type, direction) {
  const table = document.getElementById('qrShareTable');
  const tbody = document.getElementById('qrShareTableBody');
  const statusEl = document.getElementById('qrShareSortStatus');
  if (!table || !tbody) return;

  const rows = [...tbody.rows];
  if (rows.length <= 1 && rows[0]?.dataset.emptyRow === 'true') return;

  const th = [...table.tHead.rows[0].cells].find((cell) => cell.dataset.sortKey === sortKey);
  if (!th) return;

  const colIndex = th.cellIndex;
  const factor = direction === 'asc' ? 1 : -1;

  const readSortValue = (row) => {
    const cell = row.cells[colIndex];
    return cell ? (cell.dataset.value ?? cell.textContent.trim()) : '';
  };

  rows.sort((a, b) => {
    const va = readSortValue(a);
    const vb = readSortValue(b);
    if (type === 'number') {
      return factor * ((Number(va) || 0) - (Number(vb) || 0));
    }
    return factor * TEXT_COLLATOR.compare(String(va), String(vb));
  });

  // 遵循 sortable-table 规范：直接移动已有 tr 节点以保留行内选中状态与焦点
  for (const row of rows) {
    if (typeof tbody.moveBefore === 'function') {
      tbody.moveBefore(row, null);
    } else {
      tbody.appendChild(row);
    }
  }

  if (statusEl) {
    statusEl.textContent = `已按 ${th.textContent.trim()} ${direction === 'asc' ? '升序' : '降序'}排列，共 ${rows.length} 项`;
  }
}

function renderShareTable() {
  const tbody = document.getElementById('qrShareTableBody');
  if (!tbody) return;

  const filtered = sortSharesArray(getFilteredShares());
  syncTableHeaderSortState();

  if (state.shares.list.length === 0) {
    tbody.innerHTML = `
      <tr data-empty-row="true">
        <td colspan="6" style="text-align: center; color: #71717a; padding: 36px 16px;">
          尚未加载分享数据，点击右上角 <b>「一键拉取」</b> 或 <b>「导入清单」</b>（支持 JSON / CSV / 抓包响应如 请求.txt）即可可视化查看。
        </td>
      </tr>
    `;
    updateShareActionLabels();
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr data-empty-row="true">
        <td colspan="6" style="text-align: center; color: #71717a; padding: 30px;">
          没有符合当前筛选条件的分享内容
        </td>
      </tr>
    `;
    updateShareActionLabels();
    return;
  }

  const itemMap = new Map();
  filtered.forEach((item) => itemMap.set(item.uid, item));

  tbody.innerHTML = filtered
    .map((item) => {
      const st = item.statusInfo;
      const safeHref = sanitizeHttpUrl(item.share_url);
      const dirCount = Math.max(0, (Number(item.all_file_num) || 0) - (Number(item.file_only_num) || 0));
      const countLabel =
        item.file_only_num > 0 ? `${item.file_only_num} 个文件` : item.is_dir ? `${item.all_file_num || 1} 个目录` : '1 个文件';
      const countTitle = dirCount > 0 ? `含 ${item.file_only_num} 个文件 · ${dirCount} 个文件夹` : countLabel;

      let subMetaHtml = '';
      if (hasShareTelemetry(item)) {
        const pvParts = [];
        if (item.click_pv >= 0) pvParts.push(`浏览 ${item.click_pv}`);
        pvParts.push(`转存 ${item.save_pv}`);
        pvParts.push(`下载 ${item.download_pv}`);
        subMetaHtml = `<div class="qr-share-sub-meta">${pvParts.join(' · ')}</div>`;
      } else {
        const accessLabel = item.is_encrypted ? '加密链接' : '公开链接';
        const kindLabel = item.is_dir ? '文件夹' : '单文件';
        subMetaHtml = `<div class="qr-share-sub-meta qr-share-sub-muted" title="夸克 PC 网页端列表接口未下发浏览/转存/下载统计（click_pv=-1）">${accessLabel} · ${kindLabel} · 热度未下发</div>`;
      }

      return `
        <tr class="qr-share-row" data-uid="${escapeHtml(item.uid)}">
          <td style="text-align: center;">
            <input type="checkbox" class="qr-share-cb" data-uid="${escapeHtml(item.uid)}" ${item.selected ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.title)}">
          </td>
          <td data-value="${escapeHtml(item.title)}">
            <div class="qr-share-title-cell">
              <div class="qr-share-title-line">
                <span class="qr-share-type-icon" title="${item.is_dir ? '文件夹' : '文件'}">${item.is_dir ? ICONS.folder : ICONS.file}</span>
                <span class="qr-share-title-text" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
              </div>
              <div class="qr-share-sub-line">
                <span class="qr-share-path-pill" title="源目录: ${escapeHtml(item.path_label)}">${escapeHtml(item.path_label)}</span>
                ${item.pwd_id ? `<span class="qr-share-code-pill">/${escapeHtml(item.pwd_id)}</span>` : ''}
                ${item.is_encrypted ? `<span class="qr-share-badge qr-share-badge-purple">${ICONS.lock} 加密${item.passcode ? `:${escapeHtml(item.passcode)}` : ''}</span>` : ''}
              </div>
            </div>
          </td>
          <td data-value="${item.size}">
            <div class="qr-share-size-main">${formatSize(item.size)}</div>
            <div class="qr-share-sub-meta" title="${escapeHtml(countTitle)}">${countLabel}</div>
          </td>
          <td data-value="${st.order}_${escapeHtml(st.label)}">
            <span class="qr-share-badge qr-share-badge-${st.tone}">${escapeHtml(st.label)}</span>
          </td>
          <td data-value="${item.created_at}">
            <div class="qr-share-time-main">${escapeHtml(formatTimestamp(item.created_at))}</div>
            ${subMetaHtml}
          </td>
          <td>
            <div class="qr-share-row-actions">
              <button type="button" class="qr-btn-tool qr-btn-purple qr-share-row-copy" data-uid="${escapeHtml(item.uid)}" title="复制分享链接">${ICONS.copy}</button>
              ${
                item.first_fid && (st.key === 'expired' || st.key === 'failed')
                  ? `<button type="button" class="qr-btn-tool qr-btn-amber qr-share-row-reshare" data-uid="${escapeHtml(item.uid)}" title="使用原文件一键重开分享">${ICONS.replay}</button>`
                  : safeHref
                    ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer" class="qr-btn-tool qr-share-row-open qr-btn-blue" title="新窗口打开分享">${ICONS.external}</a>`
                    : ''
              }
              <button type="button" class="qr-btn-tool qr-btn-green qr-share-row-detail" data-uid="${escapeHtml(item.uid)}" title="查看可视化详情">${ICONS.eye}</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.qr-share-cb').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const target = itemMap.get(e.target.dataset.uid);
      if (target) target.selected = e.target.checked;
      updateShareActionLabels();
    });
  });

  tbody.querySelectorAll('.qr-share-row-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = itemMap.get(btn.dataset.uid);
      if (!target) return;
      const ok = await copyTextToClipboard(formatShareLinkText(target, false));
      if (ok) {
        toast(`已复制链接：${target.title}`);
      } else {
        customAlert('复制失败', '无法写入剪贴板，请手动打开详情复制。');
      }
    });
  });

  tbody.querySelectorAll('.qr-share-row-detail').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = itemMap.get(btn.dataset.uid);
      if (target) openShareDetailModal(target);
    });
  });

  tbody.querySelectorAll('.qr-share-row-reshare').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = itemMap.get(btn.dataset.uid);
      if (target) openReshareForItem(target);
    });
  });

  updateShareActionLabels();
}

export function renderSharesAll() {
  renderShareDashboard();
  renderShareFilterChips();
  renderShareTable();
}

export function onEnterSharesView() {
  restoreSharesCacheIfEmpty();
  renderSharesAll();
}

export function renderSharesViewComponent() {
  const sharesViewEl = document.getElementById('viewShares');
  if (!sharesViewEl) return;

  sharesViewEl.innerHTML = `
    <input type="file" id="qrShareFileInput" accept=".json,.csv,.txt" style="display: none;">

    <div class="qr-share-toolbar">
      <div class="qr-share-source-info">
        <span class="qr-share-source-dot"></span>
        <span id="qrShareSourceBadge" class="qr-share-source-text">${escapeHtml(state.shares.sourceLabel)}</span>
        <span id="qrShareTelemetryHint" class="qr-share-api-hint hidden" title="夸克 PC 网页端 /share/mypage/detail 接口未下发浏览/转存/下载统计（click_pv=-1），属官方接口限制而非拉取异常">官方未下发热度</span>
      </div>
      <div class="qr-share-toolbar-actions">
        <button type="button" id="qrShareFetchBtn" class="qr-btn-tool qr-btn-blue" title="在线分页拉取当前账号全部我的分享">${ICONS.refresh} 一键拉取</button>
        <button type="button" id="qrShareBatchSaveBtn" class="qr-btn-tool qr-btn-green" title="批量链式转存多条夸克分享链接">${ICONS.download} 批量转存</button>
        <button type="button" id="qrShareCancelBtn" class="qr-btn-tool qr-btn-red" title="批量永久取消勾选的分享链接（不删除网盘原文件）">${ICONS.trash} 取消分享 (0)</button>
        <button type="button" id="qrShareImportBtn" class="qr-btn-tool qr-btn-green" title="导入 JSON / CSV 或浏览器抓包文本（如请求.txt）">${ICONS.upload} 导入清单</button>
        <button type="button" id="qrSharePasteBtn" class="qr-btn-tool qr-btn-blue" title="直接粘贴抓包 JSON、CSV 或分享链接文本导入">${ICONS.paste} 粘贴导入</button>
        <button type="button" id="qrShareExportCsvBtn" class="qr-btn-tool qr-btn-amber" title="导出分享清单为 CSV 表格">${ICONS.download} CSV</button>
        <button type="button" id="qrShareExportJsonBtn" class="qr-btn-tool qr-btn-amber" title="导出分享完整数据为 JSON">${ICONS.download} JSON</button>
        <button type="button" id="qrShareCopyBtn" class="qr-btn-tool qr-btn-purple" title="批量复制分享标题、链接与提取码">${ICONS.copy} 复制全部 (0)</button>
      </div>
    </div>

    <div id="qrShareDashboard" class="qr-share-dashboard"></div>

    <div class="qr-filter-bar qr-share-filter-bar">
      <div id="qrShareFilterChips" class="qr-type-filters"></div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto;">
        <button type="button" id="qrShareSelectInvalidBtn" class="qr-btn-tool qr-btn-amber" style="height: 26px; padding: 0 8px; font-size: 11px;" title="一键勾选已过期、失败或全包违规的分享记录">${ICONS.warn} 勾选失效/违规</button>
        <input type="text" id="qrShareKeywordInput" class="qr-input" placeholder="搜索标题 / 链接 / 目录..." style="padding: 2px 8px; font-size: 11px; width: 160px; height: 26px; flex: none;">
      </div>
    </div>

    <div class="qr-table-wrap qr-share-table-wrap" tabindex="0" role="region" aria-labelledby="qrShareTableCaption">
      <div id="qrShareSortStatus" class="qr-sr-only" role="status" aria-live="polite"></div>
      <table id="qrShareTable" class="qr-table qr-share-table">
        <caption id="qrShareTableCaption" class="qr-sr-only">当前用户的夸克网盘分享内容列表</caption>
        <thead>
          <tr>
            <th scope="col" style="width: 38px; text-align: center;">
              <input type="checkbox" id="qrShareSelectAll" aria-label="全选当前分享列表">
            </th>
            <th scope="col" class="qr-th-sortable" data-sort-key="title" data-type="text">
              <button type="button" class="qr-th-sort-btn">
                <span>分享标题 / 来源路径</span>
                <span class="qr-sort-indicator" aria-hidden="true"></span>
              </button>
            </th>
            <th scope="col" class="qr-th-sortable" data-sort-key="size" data-type="number" style="width: 112px;">
              <button type="button" class="qr-th-sort-btn">
                <span>大小 / 文件</span>
                <span class="qr-sort-indicator" aria-hidden="true"></span>
              </button>
            </th>
            <th scope="col" class="qr-th-sortable" data-sort-key="status" data-type="text" style="width: 124px;">
              <button type="button" class="qr-th-sort-btn">
                <span>分享状态</span>
                <span class="qr-sort-indicator" aria-hidden="true"></span>
              </button>
            </th>
            <th scope="col" class="qr-th-sortable" data-sort-key="created_at" data-type="number" aria-sort="descending" style="width: 186px;">
              <button type="button" class="qr-th-sort-btn">
                <span id="qrShareTimeColLabel">分享时间 / 热度</span>
                <span class="qr-sort-indicator" aria-hidden="true"></span>
              </button>
            </th>
            <th scope="col" style="width: 114px; text-align: center;">操作</th>
          </tr>
        </thead>
        <tbody id="qrShareTableBody"></tbody>
      </table>
    </div>
  `;

  renderSharesAll();
}

export function bindSharesEvents() {
  const fetchBtn = document.getElementById('qrShareFetchBtn');
  const batchSaveBtn = document.getElementById('qrShareBatchSaveBtn');
  const cancelBtn = document.getElementById('qrShareCancelBtn');
  const selectInvalidBtn = document.getElementById('qrShareSelectInvalidBtn');
  const importBtn = document.getElementById('qrShareImportBtn');
  const fileInput = document.getElementById('qrShareFileInput');
  const pasteBtn = document.getElementById('qrSharePasteBtn');
  const exportCsvBtn = document.getElementById('qrShareExportCsvBtn');
  const exportJsonBtn = document.getElementById('qrShareExportJsonBtn');
  const copyBtn = document.getElementById('qrShareCopyBtn');
  const keywordInput = document.getElementById('qrShareKeywordInput');
  const selectAllCb = document.getElementById('qrShareSelectAll');
  const table = document.getElementById('qrShareTable');

  if (fetchBtn) fetchBtn.addEventListener('click', fetchAllMyShares);
  if (batchSaveBtn) batchSaveBtn.addEventListener('click', openBatchSaveFromSharesView);
  if (cancelBtn) cancelBtn.addEventListener('click', runBatchCancelShares);
  if (selectInvalidBtn) selectInvalidBtn.addEventListener('click', selectInvalidOrViolationShares);
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importSharesFromFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }
  if (pasteBtn) pasteBtn.addEventListener('click', openPasteImportModal);
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportSharesCsv);
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportSharesJson);
  if (copyBtn) copyBtn.addEventListener('click', copySelectedShares);

  if (keywordInput) {
    keywordInput.addEventListener('input', (e) => {
      state.shares.keyword = e.target.value;
      renderShareTable();
    });
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const visible = getFilteredShares();
      visible.forEach((item) => {
        item.selected = checked;
      });
      renderShareTable();
    });
  }

  if (table && table.tHead) {
    table.tHead.querySelectorAll('.qr-th-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const th = btn.closest('th');
        if (!th || !th.dataset.sortKey) return;

        const key = th.dataset.sortKey;
        const type = th.dataset.type || 'text';
        const nextDir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';

        state.shares.sortKey = key;
        state.shares.sortDir = nextDir === 'ascending' ? 'asc' : 'desc';

        syncTableHeaderSortState();
        sortExistingTableRows(key, type, state.shares.sortDir);
      });
    });
  }
}
