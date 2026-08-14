/**
 * 夸克网盘 API 请求层与目录数据加载
 * 统一采用「前台同源优先、Service Worker 后台代理降级」双保险
 */

import { state } from './state.js';
import { log } from './utils.js';
import { recalculateNewNames } from './rename.js';

// 智能重命名算法：前台同源优先（自动带有完整 Cookie / Origin / Referer 完美通过跨域），后台代理降级
export async function requestRename(fid, newFileName) {
  try {
    const url = 'https://drive-pc.quark.cn/1/clouddrive/file/rename?pr=ucpro&fr=pc&uc_param_str=';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      credentials: 'include',
      body: JSON.stringify({ fid: fid, file_name: newFileName })
    });
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      // 前台拿到任何合法 JSON（无论成功或失败）都直接返回，交由调用方判断状态码
      return data;
    } catch (parseErr) {
      if (text.includes('Invalid CORS')) {
        console.warn('前台 fetch 触发 CORS 校验拦截，自动降级为 Service Worker 代理发包');
      }
    }
  } catch (e) {
    console.warn('前台同源发包网络异常，自动降级到 Service Worker 后台:', e);
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'API_RENAME_FILE', fid: fid, file_name: newFileName }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) {
        resolve({ code: -1, message: resp?.error || chrome.runtime.lastError?.message || '重命名响应异常' });
      } else {
        resolve(resp.data);
      }
    });
  });
}

// 夸克 API 新建文件夹函数（前台同源优先发包与后台代理降级双保险）
export async function requestCreateDirectory(pdirFid, folderName) {
  const payload = {
    pdir_fid: pdirFid || '0',
    file_name: folderName,
    dir_path: '',
    dir_init_lock: false
  };

  try {
    const url = 'https://drive-pc.quark.cn/1/clouddrive/file?pr=ucpro&fr=pc&uc_param_str=';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      // 前台拿到任何合法 JSON（无论成功或失败）都直接返回，交由调用方判断状态码
      return data;
    } catch (parseErr) {
      console.warn('前台新建文件夹 fetch 解析非 JSON，自动降级为 Service Worker 代理');
    }
  } catch (e) {
    console.warn('前台新建文件夹网络异常，自动降级到 Service Worker 后台:', e);
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'API_CREATE_DIRECTORY', pdir_fid: pdirFid, file_name: folderName }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) {
        resolve({ code: -1, message: resp?.error || chrome.runtime.lastError?.message || '新建文件夹失败' });
      } else {
        resolve(resp.data);
      }
    });
  });
}

// 夸克 API 批量删除文件/文件夹函数
export async function requestDeleteFiles(fids) {
  if (!Array.isArray(fids)) fids = [fids];
  const payload = {
    action_type: 2,
    filelist: fids,
    exclude_fids: []
  };

  try {
    const url = 'https://drive-pc.quark.cn/1/clouddrive/file/delete?pr=ucpro&fr=pc&uc_param_str=';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      // 前台拿到任何合法 JSON（无论成功或失败）都直接返回，交由调用方判断状态码
      return data;
    } catch (parseErr) {
      console.warn('前台删除 fetch 解析非 JSON，自动降级为 Service Worker 代理');
    }
  } catch (e) {
    console.warn('前台删除网络异常，自动降级到 Service Worker 后台:', e);
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'API_DELETE_FILES', fids: fids }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) {
        resolve({ code: -1, message: resp?.error || chrome.runtime.lastError?.message || '删除请求失败' });
      } else {
        resolve(resp.data);
      }
    });
  });
}

// 完美安全代理后台 Fetch，彻底解决跨域 CORS TypeError: Failed to fetch
export async function loadDirectoryFiles(pdirFid, currentPath, depth = 0) {
  if (depth > 5) return;

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'API_FETCH_DIRECTORY', pdir_fid: pdirFid }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        resolve({ success: false, error: chrome.runtime.lastError?.message || '通讯异常' });
      } else {
        resolve(resp);
      }
    });
  });

  if (!res.success) {
    throw new Error(res.error || `请求 FID ${pdirFid} 异常`);
  }

  const data = res.data;
  if (data && (data.code === 0 || data.status === 200) && data.data && data.data.list) {
    const items = data.data.list;

    for (const item of items) {
      const relPath = currentPath ? `${currentPath}/${item.file_name}` : item.file_name;
      const isDirectory = item.dir || item.file_type === 'dir' || item.file_type === 0;

      state.fileList.push({
        fid: item.fid,
        pdir_fid: pdirFid,
        file_name: item.file_name,
        is_dir: isDirectory,
        file_type: item.file_type,
        size: item.size || 0,
        selected: true,
        visible: true,
        new_name: item.file_name
      });

      if (state.includeSubDirs && isDirectory) {
        log(`扫描子目录: ${relPath}`);
        await loadDirectoryFiles(item.fid, relPath, depth + 1);
      }
    }
  } else {
    throw new Error((data && data.message) || `获取 FID ${pdirFid} 文件列表失败`);
  }
}

export function sortFileList() {
  state.fileList.sort((a, b) => {
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }

    if (state.sortBy === 'natural_asc') {
      return a.file_name.localeCompare(b.file_name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (state.sortBy === 'natural_desc') {
      return b.file_name.localeCompare(a.file_name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (state.sortBy === 'name_asc') {
      return a.file_name.localeCompare(b.file_name);
    } else if (state.sortBy === 'name_desc') {
      return b.file_name.localeCompare(a.file_name);
    } else if (state.sortBy === 'size_asc') {
      return a.size - b.size;
    } else if (state.sortBy === 'size_desc') {
      return b.size - a.size;
    }
    return 0;
  });
}

// 从夸克网盘网页 DOM 节点中精准智能捕获文件与 FID (带严密噪音过滤)
export function captureFilesFromDom() {
  const domElements = document.querySelectorAll('.grid-item, .file-item, [class*="file-item-box"]');
  domElements.forEach((el, idx) => {
    const fid = el.getAttribute('data-fid') || el.dataset.fid || el.getAttribute('fid') || `dom_${idx}`;
    const nameEl = el.querySelector('.file-name, .name, [class*="file-name-title"], [class*="filename"]') || el;
    let name = nameEl ? nameEl.textContent.trim() : '';

    if (name.includes('\n')) name = name.split('\n')[0].trim();

    const isDateOrTime = /^\d{4}[-\/\.]\d{2}[-\/\.]\d{2}/.test(name) || /^\d{2}:\d{2}/.test(name);
    const isSymbolOnly = /^[-_\s\.\/]+$/.test(name);
    const isSystemUiText = ['文件名', '大小', '修改时间', '更新时间', '操作', '全选', '类型', '文件大小'].includes(name);

    if (name && !isDateOrTime && !isSymbolOnly && !isSystemUiText && !state.fileList.some((f) => f.file_name === name)) {
      const isDir = el.querySelector('[class*="folder"]') || name.includes('文件夹') || !name.includes('.');
      state.fileList.push({
        fid: fid,
        pdir_fid: state.pdir_fid,
        file_name: name,
        is_dir: !!isDir,
        file_type: isDir ? 'dir' : 'file',
        size: 0,
        selected: true,
        visible: true,
        new_name: name
      });
    }
  });
}

export async function fetchFileList() {
  const tableBody = document.getElementById('qrTableBody');
  tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">正在获取文件数据 (FID: ${state.pdir_fid})...</td></tr>`;
  state.fileList = [];

  // 目录数据即将更新，清空工具箱中基于旧数据的检测/检查结果，避免过期提示残留
  const dupResult = document.getElementById('qrDupResult');
  if (dupResult) dupResult.innerHTML = '';
  const inspectResult = document.getElementById('qrInspectResult');
  if (inspectResult) inspectResult.innerHTML = '';

  // 竞态防护：仅保留最后一次请求的结果，避免快速切换目录时旧数据覆盖新数据
  const seq = ++state.fetchSeq;

  try {
    await loadDirectoryFiles(state.pdir_fid, '');
    if (seq !== state.fetchSeq) return;
    sortFileList();
    recalculateNewNames();
    if (state.fileList.length === 0) {
      log(`当前目录 FID:${state.pdir_fid} 为空文件夹 (0 项)`);
    } else {
      log(`加载成功: 当前层级文件 ${state.fileList.length} 项`);
    }
  } catch (err) {
    if (seq !== state.fetchSeq) return;
    console.warn('接口加载异常，自动启动 DOM 降级抓取:', err);
    captureFilesFromDom();
    sortFileList();
    recalculateNewNames();
    if (state.fileList.length > 0) {
      log(`DOM 自动捕获成功: 抓取网页文件 ${state.fileList.length} 项`);
      log('⚠️ 降级模式: 若未抓到真实 FID，重命名/删除可能失败，建议刷新页面后重试');
    } else {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 30px;">加载失败: ${err.message || '网络问题'}</td></tr>`;
    }
  }
}
