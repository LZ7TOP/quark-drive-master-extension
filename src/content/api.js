/**
 * 夸克网盘 API 请求层与目录/搜索/分享数据加载
 * 统一采用「前台同源优先、Service Worker 后台代理降级」双保险
 */

import { state } from './state.js';
import { escapeHtml, log } from './utils.js';
import { recalculateNewNames } from './rename.js';

const API_BASE = 'https://drive-pc.quark.cn/1/clouddrive';
const COMMON_QUERY = 'pr=ucpro&fr=pc&uc_param_str=';

export function bgSendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        resolve({
          success: false,
          error: chrome.runtime.lastError?.message || '扩展后台通讯异常'
        });
      } else {
        resolve(resp);
      }
    });
  });
}

async function requestWithFallback({ url, method = 'GET', payload, corsError, bgAction, bgPayload = {}, defaultError = '请求失败' }) {
  try {
    const fetchOpts = { method, credentials: 'include' };
    if (payload !== undefined) {
      fetchOpts.headers = { 'Content-Type': 'application/json;charset=UTF-8' };
      fetchOpts.body = JSON.stringify(payload);
    }

    const resp = await fetch(url, fetchOpts);
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      return data;
    } catch (parseErr) {
      if (corsError && text.includes('Invalid CORS')) {
        console.warn('前台 fetch 触发 CORS 校验拦截，自动降级为 Service Worker 代理发包');
      } else {
        console.warn(`前台 ${bgAction} 解析非 JSON，自动降级为 Service Worker 代理`);
      }
    }
  } catch (e) {
    console.warn(`前台 ${bgAction} 网络异常，自动降级到 Service Worker 后台:`, e);
  }

  const bgRes = await bgSendMessage({ action: bgAction, ...bgPayload });
  if (!bgRes || !bgRes.success) {
    return { code: -1, message: bgRes?.error || defaultError };
  }
  return bgRes.data;
}

export function isQuarkOk(res) {
  return Boolean(res && (res.code === 0 || res.status === 200));
}

// 重命名文件/文件夹
export function requestRename(fid, newFileName) {
  return requestWithFallback({
    url: `${API_BASE}/file/rename?${COMMON_QUERY}`,
    method: 'POST',
    payload: { fid, file_name: newFileName },
    corsError: 'Invalid CORS',
    bgAction: 'API_RENAME_FILE',
    bgPayload: { fid, file_name: newFileName },
    defaultError: '重命名响应异常'
  });
}

// 新建文件夹
export function requestCreateDirectory(pdirFid, folderName) {
  const payload = {
    pdir_fid: pdirFid || '0',
    file_name: folderName,
    dir_path: '',
    dir_init_lock: false
  };
  return requestWithFallback({
    url: `${API_BASE}/file?${COMMON_QUERY}`,
    method: 'POST',
    payload,
    bgAction: 'API_CREATE_DIRECTORY',
    bgPayload: { pdir_fid: pdirFid, file_name: folderName },
    defaultError: '新建文件夹失败'
  });
}

// 批量删除文件/文件夹
export function requestDeleteFiles(fids) {
  const list = Array.isArray(fids) ? fids : [fids];
  return requestWithFallback({
    url: `${API_BASE}/file/delete?${COMMON_QUERY}`,
    method: 'POST',
    payload: { action_type: 2, filelist: list, exclude_fids: [] },
    bgAction: 'API_DELETE_FILES',
    bgPayload: { fids: list },
    defaultError: '删除请求失败'
  });
}

// 批量移动文件/文件夹
export function requestMoveFiles(fids, toPdirFid) {
  const list = Array.isArray(fids) ? fids : [fids];
  const targetFid = toPdirFid || '0';
  return requestWithFallback({
    url: `${API_BASE}/file/move?${COMMON_QUERY}`,
    method: 'POST',
    payload: { action_type: 2, filelist: list, to_pdir_fid: targetFid },
    bgAction: 'API_MOVE_FILES',
    bgPayload: { fids: list, to_pdir_fid: targetFid },
    defaultError: '移动请求失败'
  });
}

// 提取个人文件下载直链
export function requestDownloadUrls(fids) {
  const list = Array.isArray(fids) ? fids : [fids];
  return requestWithFallback({
    url: `${API_BASE}/file/download?${COMMON_QUERY}`,
    method: 'POST',
    payload: { fids: list },
    bgAction: 'API_FETCH_DOWNLOAD_URLS',
    bgPayload: { fids: list },
    defaultError: '提取下载直链失败'
  });
}

// 获取当前用户分享列表（分页）
export function requestMySharesPage(page = 1, size = 50, filter = 'all', orderField = 'created_at', orderType = 'desc') {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeSize = Math.min(100, Math.max(1, parseInt(size, 10) || 50));
  const url =
    `${API_BASE}/share/mypage/detail?${COMMON_QUERY}` +
    `&_page=${safePage}&_size=${safeSize}` +
    `&_order_field=${encodeURIComponent(orderField)}&_order_type=${encodeURIComponent(orderType)}` +
    `&_fetch_total=1&_fetch_notify_follow=1&_filter=${encodeURIComponent(filter)}&_share_type=0,1`;

  return requestWithFallback({
    url,
    method: 'GET',
    bgAction: 'API_FETCH_MY_SHARES',
    bgPayload: { page: safePage, size: safeSize, filter, order_field: orderField, order_type: orderType },
    defaultError: '获取分享列表失败'
  });
}

// 轮询异步任务（创建分享、批量转存共用）
export function requestPollTask(taskId, retryIndex = 0) {
  const safeRetry = Math.max(0, parseInt(retryIndex, 10) || 0);
  const url = `${API_BASE}/task?${COMMON_QUERY}&task_id=${encodeURIComponent(taskId)}&retry_index=${safeRetry}`;
  return requestWithFallback({
    url,
    method: 'GET',
    bgAction: 'API_POLL_TASK',
    bgPayload: { task_id: taskId, retry_index: safeRetry },
    defaultError: '轮询任务状态失败'
  });
}

export async function pollCloudDriveTask(taskId, { intervalMs = 800, maxRetries = 45, onTick } = {}) {
  let networkFailures = 0;

  for (let retryIndex = 0; retryIndex < maxRetries; retryIndex++) {
    if (typeof onTick === 'function') {
      onTick(retryIndex);
    }

    const res = await requestPollTask(taskId, retryIndex);
    if (!res) {
      networkFailures++;
      if (networkFailures >= 3) {
        return { code: -1, message: '异步任务轮询连续无响应' };
      }
    } else if (res.code === -1) {
      networkFailures++;
      if (networkFailures >= 3) {
        return res;
      }
    } else {
      networkFailures = 0;
      const codeNum = Number(res.code);
      if (codeNum === 32003 || codeNum === 32004) {
        return res;
      }
      if (!isQuarkOk(res)) {
        return res;
      }

      const taskStatus = Number(res.data?.status);
      if (taskStatus === 2 || res.data?.share_id) {
        return res;
      }
      if (taskStatus === 3) {
        return {
          code: Number(res.data?.errno || -1),
          message: res.data?.error_info || res.message || '服务端异步任务执行失败',
          data: res.data
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { code: -1, message: '异步任务轮询超时，请稍后刷新查看结果' };
}

// 创建分享任务
export function requestCreateShare({ fidList, title = '', urlType = 1, expiredType = 1 }) {
  const safeFids = Array.isArray(fidList) ? fidList : [fidList];
  const payload = {
    fid_list: safeFids,
    title: String(title || ''),
    url_type: Number(urlType) === 2 ? 2 : 1,
    expired_type: Math.min(7, Math.max(1, Number(expiredType) || 1))
  };
  return requestWithFallback({
    url: `${API_BASE}/share?${COMMON_QUERY}`,
    method: 'POST',
    payload,
    bgAction: 'API_CREATE_SHARE',
    bgPayload: payload,
    defaultError: '创建分享失败'
  });
}

// 根据 share_id 获取分享链接及服务端生成提取码
export function requestSharePassword(shareId) {
  return requestWithFallback({
    url: `${API_BASE}/share/password?${COMMON_QUERY}`,
    method: 'POST',
    payload: { share_id: shareId },
    bgAction: 'API_SHARE_PASSWORD',
    bgPayload: { share_id: shareId },
    defaultError: '获取分享链接详情失败'
  });
}

// 创建分享并完整获取链接 + 提取码
export async function createShareAndResolve({ fidList, title = '', urlType = 1, expiredType = 1, onStage } = {}) {
  if (typeof onStage === 'function') onStage('创建分享任务...');
  const createRes = await requestCreateShare({ fidList, title, urlType, expiredType });
  if (!isQuarkOk(createRes)) {
    return createRes;
  }

  let shareId = createRes.data?.share_id || '';
  const taskId = createRes.data?.task_id || '';

  if (!shareId && taskId) {
    if (typeof onStage === 'function') onStage('等待服务端生成分享...');
    const pollRes = await pollCloudDriveTask(taskId);
    if (!isQuarkOk(pollRes)) {
      return pollRes;
    }
    shareId = pollRes.data?.share_id || pollRes.data?.save_as?.share_id || '';
  }

  if (!shareId) {
    return { code: -1, message: '未获取到有效的 share_id' };
  }

  if (typeof onStage === 'function') onStage('获取分享链接与提取码...');
  const pwdRes = await requestSharePassword(shareId);
  if (!isQuarkOk(pwdRes)) {
    return pwdRes;
  }

  return {
    code: 0,
    data: {
      ...(pwdRes.data || {}),
      share_id: shareId,
      title: pwdRes.data?.title || title,
      url_type: Number(urlType) === 2 ? 2 : 1,
      expired_type: Math.min(7, Math.max(1, Number(expiredType) || 1))
    }
  };
}

// 批量取消/删除分享
export function requestDeleteShares(shareIds) {
  const list = Array.isArray(shareIds) ? shareIds : [shareIds];
  return requestWithFallback({
    url: `${API_BASE}/share/delete?${COMMON_QUERY}`,
    method: 'POST',
    payload: { share_ids: list },
    bgAction: 'API_DELETE_SHARES',
    bgPayload: { share_ids: list },
    defaultError: '取消分享失败'
  });
}

// 解析/验证分享页面获取 stoken
export function requestShareToken(pwdId, passcode = '') {
  const payload = { pwd_id: pwdId, passcode: passcode || '' };
  return requestWithFallback({
    url: `${API_BASE}/share/sharepage/token?${COMMON_QUERY}`,
    method: 'POST',
    payload,
    bgAction: 'API_SHARE_TOKEN',
    bgPayload: payload,
    defaultError: '获取分享访问凭证失败'
  });
}

// 获取分享链接内部目录文件列表
export function requestShareDetailPage({ pwdId, stoken, pdirFid = '0', page = 1, size = 100 }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeSize = Math.min(100, Math.max(1, parseInt(size, 10) || 100));
  const url =
    `${API_BASE}/share/sharepage/detail?${COMMON_QUERY}` +
    `&pwd_id=${encodeURIComponent(pwdId || '')}` +
    `&stoken=${encodeURIComponent(stoken || '')}` +
    `&pdir_fid=${encodeURIComponent(pdirFid || '0')}` +
    `&force=0&_page=${safePage}&_size=${safeSize}&_fetch_banner=0&_fetch_share=1&_fetch_total=1` +
    `&_sort=file_type:asc,updated_at:desc`;

  return requestWithFallback({
    url,
    method: 'GET',
    bgAction: 'API_SHARE_DETAIL',
    bgPayload: { pwd_id: pwdId, stoken, pdir_fid: pdirFid || '0', page: safePage, size: safeSize },
    defaultError: '获取分享包内目录失败'
  });
}

// 发起分享转存请求
export function requestSaveShare({ fidList, fidTokenList, toPdirFid = '0', pwdId, stoken, pdirFid = '0', scene = 'link' }) {
  const payload = {
    fid_list: Array.isArray(fidList) ? fidList : [],
    fid_token_list: Array.isArray(fidTokenList) ? fidTokenList : [],
    to_pdir_fid: toPdirFid || '0',
    pwd_id: pwdId || '',
    stoken: stoken || '',
    pdir_fid: pdirFid || '0',
    scene: scene || 'link'
  };
  return requestWithFallback({
    url: `${API_BASE}/share/sharepage/save?${COMMON_QUERY}`,
    method: 'POST',
    payload,
    bgAction: 'API_SAVE_SHARE',
    bgPayload: payload,
    defaultError: '发起转存失败'
  });
}

// 提交转存并轮询直至任务结束
export async function saveShareAndPoll({ fidList, fidTokenList, toPdirFid = '0', pwdId, stoken, pdirFid = '0', onStage } = {}) {
  if (typeof onStage === 'function') onStage('提交转存请求...');
  const saveRes = await requestSaveShare({ fidList, fidTokenList, toPdirFid, pwdId, stoken, pdirFid, scene: 'link' });
  if (!isQuarkOk(saveRes)) {
    return saveRes;
  }

  const taskId = saveRes.data?.task_id || '';
  if (!taskId) {
    return saveRes;
  }

  if (typeof onStage === 'function') onStage('服务端正在转存...');
  return pollCloudDriveTask(taskId);
}

// 全盘文件搜索
export function requestSearchDriveFiles({ query, page = 1, size = 100 }) {
  const safeQuery = String(query || '').trim();
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeSize = Math.min(100, Math.max(1, parseInt(size, 10) || 100));
  const url =
    `${API_BASE}/file/search?${COMMON_QUERY}&q=${encodeURIComponent(safeQuery)}` +
    `&_page=${safePage}&_size=${safeSize}&_fetch_total=1&_sort=file_type:asc,updated_at:desc&_is_hl=0`;

  return requestWithFallback({
    url,
    method: 'GET',
    bgAction: 'API_SEARCH_FILES',
    bgPayload: { q: safeQuery, page: safePage, size: safeSize },
    defaultError: '全盘搜索请求失败'
  });
}

// 获取当前登录账号及网盘容量（统一走 Service Worker 规避 pan.quark.cn / drive-pc.quark.cn 跨子域差异）
export async function requestAccountQuota() {
  state.account.loading = true;
  try {
    const res = await bgSendMessage({ action: 'API_FETCH_ACCOUNT_QUOTA' });
    if (res && res.success && res.data) {
      Object.assign(state.account, {
        loading: false,
        loaded: true,
        loggedIn: Boolean(res.data.loggedIn),
        nickname: res.data.nickname || '',
        member_type: res.data.member_type || 'NORMAL',
        use_capacity: Number(res.data.use_capacity) || 0,
        total_capacity: Number(res.data.total_capacity) || 0,
        exp_at: Number(res.data.exp_at) || 0
      });
      return state.account;
    }
    state.account.loading = false;
    state.account.loaded = true;
    return state.account;
  } catch (err) {
    state.account.loading = false;
    console.warn('[Quark Assistant] 获取账号容量失败:', err);
    return state.account;
  }
}

async function fetchDirectoryAllPages(pdirFid, maxPages = 20) {
  const collected = [];
  const pageSize = 200;

  for (let page = 1; page <= maxPages; page++) {
    const res = await bgSendMessage({ action: 'API_FETCH_DIRECTORY', pdir_fid: pdirFid, page, size: pageSize });
    if (!res.success) {
      throw new Error(res.error || `请求 FID ${pdirFid} 异常`);
    }

    const data = res.data;
    if (!isQuarkOk(data) || !Array.isArray(data?.data?.list)) {
      throw new Error(data?.message || `获取 FID ${pdirFid} 文件列表失败`);
    }

    const list = data.data.list;
    collected.push(...list);

    const total = Number(data.metadata?._total ?? data.data?.total ?? 0);
    if (list.length < pageSize || (total > 0 && collected.length >= total)) {
      break;
    }
  }

  return collected;
}

// 目录选择器懒加载子目录列表（仅文件夹，不改动主面板 state.fileList）
export async function listSubdirectoriesForPicker(pdirFid = '0') {
  const items = await fetchDirectoryAllPages(pdirFid || '0', 10);
  return items
    .filter((item) => Boolean(item.dir || item.file_type === 'dir' || item.file_type === 0 || item.file_type === '0'))
    .map((item) => ({
      fid: item.fid,
      pdir_fid: pdirFid || '0',
      file_name: item.file_name,
      updated_at: item.updated_at || item.l_updated_at || 0
    }))
    .sort((a, b) => a.file_name.localeCompare(b.file_name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
}

// 递归扫描当前目录下的所有子文件夹及内部文件（用于子目录内容平铺提取）
export async function scanSubdirectoryFiles(parentPdirFid) {
  const result = {
    subDirs: [],
    filesToMove: []
  };

  async function traverse(pdirFid, currentPath, depth = 0) {
    if (depth > 6) return;

    let items = [];
    try {
      items = await fetchDirectoryAllPages(pdirFid, 10);
    } catch (err) {
      log(`扫描子目录 ${pdirFid} 跳过: ${err.message}`);
      return;
    }

    for (const item of items) {
      const isDir = Boolean(item.dir || item.file_type === 'dir' || item.file_type === 0 || item.file_type === '0');
      const relPath = currentPath ? `${currentPath}/${item.file_name}` : item.file_name;

      if (isDir) {
        result.subDirs.push({
          fid: item.fid,
          file_name: item.file_name,
          path: relPath,
          pdir_fid: pdirFid
        });
        await traverse(item.fid, relPath, depth + 1);
      } else if (depth > 0) {
        result.filesToMove.push({
          fid: item.fid,
          file_name: item.file_name,
          size: Number(item.size) || 0,
          parentDir: currentPath,
          pdir_fid: pdirFid
        });
      }
    }
  }

  await traverse(parentPdirFid, '', 0);
  return result;
}

// 加载目录文件到主面板（支持分页与可选递归子目录）
export async function loadDirectoryFiles(pdirFid, currentPath, depth = 0) {
  if (depth > 5) return;

  const items = await fetchDirectoryAllPages(pdirFid, 20);
  for (const item of items) {
    const relPath = currentPath ? `${currentPath}/${item.file_name}` : item.file_name;
    const isDirectory = Boolean(item.dir || item.file_type === 'dir' || item.file_type === 0 || item.file_type === '0');

    state.fileList.push({
      fid: item.fid,
      pdir_fid: item.pdir_fid || pdirFid,
      file_name: item.file_name,
      is_dir: isDirectory,
      file_type: item.file_type,
      size: Number(item.size) || 0,
      selected: true,
      visible: true,
      new_name: item.file_name
    });

    if (state.includeSubDirs && isDirectory) {
      log(`扫描子目录: ${relPath}`);
      await loadDirectoryFiles(item.fid, relPath, depth + 1);
    }
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
        fid,
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
  state.mainMode = 'dir';
  state.searchQuery = '';
  state.searchTotal = 0;

  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">正在获取文件数据 (FID: ${escapeHtml(String(state.pdir_fid))})...</td></tr>`;
  }
  state.fileList = [];

  const dupResult = document.getElementById('qrDupResult');
  if (dupResult) dupResult.innerHTML = '';
  const inspectResult = document.getElementById('qrInspectResult');
  if (inspectResult) inspectResult.innerHTML = '';

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
    } else if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 30px;">加载失败: ${escapeHtml(err.message || '网络问题')}</td></tr>`;
    }
  }
}

// 执行全盘云端检索并渲染到主表格
export async function searchDriveFiles(keyword) {
  const q = String(keyword || '').trim();
  if (!q) return;

  const tableBody = document.getElementById('qrTableBody');
  state.mainMode = 'search';
  state.searchQuery = q;
  state.searchTotal = 0;
  state.fileList = [];

  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #60a5fa; padding: 30px;">正在全盘检索「${escapeHtml(q)}」...</td></tr>`;
  }

  const seq = ++state.fetchSeq;

  try {
    const collected = [];
    const pageSize = 100;
    const maxPages = 5;
    let total = 0;

    for (let page = 1; page <= maxPages; page++) {
      const res = await requestSearchDriveFiles({ query: q, page, size: pageSize });
      if (seq !== state.fetchSeq) return;

      if (!isQuarkOk(res)) {
        throw new Error(res?.message || res?.error || '全盘搜索失败');
      }

      const pageList = Array.isArray(res.data?.list) ? res.data.list : [];
      if (page === 1) {
        total = Number(res.metadata?._total ?? res.data?.total ?? pageList.length);
      }
      collected.push(...pageList);

      if (pageList.length < pageSize || (total > 0 && collected.length >= total)) {
        break;
      }
    }

    state.searchTotal = total || collected.length;
    state.fileList = collected.map((item) => {
      const isDir = Boolean(item.dir || item.file_type === 'dir' || item.file_type === 0 || item.file_type === '0');
      const fileName = String(item.file_name || item.filename || '');
      return {
        fid: item.fid,
        pdir_fid: item.pdir_fid || '0',
        file_name: fileName,
        is_dir: isDir,
        file_type: item.file_type,
        size: Number(item.size) || 0,
        updated_at: item.updated_at || item.l_updated_at || 0,
        fromSearch: true,
        selected: false,
        visible: true,
        new_name: fileName
      };
    });

    sortFileList();
    recalculateNewNames();
    log(
      `全盘搜索「${q}」完成，命中 ${state.fileList.length} 项${state.searchTotal > state.fileList.length ? `（总计 ${state.searchTotal} 项）` : ''}`
    );
  } catch (err) {
    if (seq !== state.fetchSeq) return;
    log(`全盘搜索失败: ${err.message}`);
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 30px;">全盘搜索失败: ${escapeHtml(err.message || '请确认登录状态')}</td></tr>`;
    }
  }
}
