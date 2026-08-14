/**
 * 夸克网盘全能管理工具 - Background Service Worker
 * 统一通过后台代理转发夸克网盘 API，规避 CORS 与防盗链拦截
 */

const API_BASE = 'https://drive-pc.quark.cn/1/clouddrive';
const COMMON_QUERY = 'pr=ucpro&fr=pc&uc_param_str=';

async function apiFetch(url, { method = 'GET', payload, corsError } = {}) {
  try {
    const opts = { method, credentials: 'include' };
    if (payload !== undefined) {
      opts.headers = { 'Content-Type': 'application/json;charset=UTF-8' };
      opts.body = JSON.stringify(payload);
    }

    const resp = await fetch(url, opts);
    const text = await resp.text();

    try {
      return { success: true, data: JSON.parse(text) };
    } catch (e) {
      if (corsError && text.includes('Invalid CORS')) {
        return { success: false, error: corsError };
      }
      return { success: false, error: text || '响应解析异常' };
    }
  } catch (err) {
    return { success: false, error: err.message || '网络请求异常' };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Quark Assistant] 插件后台服务启动');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    sendResponse({ status: 'PONG' });
    return true;
  }

  // 后台代理 GET 目录文件列表
  if (request.action === 'API_FETCH_DIRECTORY') {
    const pdirFid = request.pdir_fid || '0';
    const url =
      `${API_BASE}/file/sort?${COMMON_QUERY}&pdir_fid=${pdirFid}` +
      `&_page=1&_size=200&_fetch_total=1&_fetch_sub_dirs=0&_sort=file_type:asc,updated_at:desc` +
      `&fetch_all_file=1&fetch_risk_file_name=1`;

    apiFetch(url).then(sendResponse);
    return true;
  }

  // 后台代理 POST 重命名文件
  if (request.action === 'API_RENAME_FILE') {
    const url = `${API_BASE}/file/rename?${COMMON_QUERY}`;
    const payload = { fid: request.fid, file_name: request.file_name };

    apiFetch(url, {
      method: 'POST',
      payload,
      corsError: '夸克跨域校验风控拦截 (Invalid CORS request)，请尝试刷新网页'
    }).then(sendResponse);
    return true;
  }

  // 后台代理 POST 删除文件
  if (request.action === 'API_DELETE_FILES') {
    const url = `${API_BASE}/file/delete?${COMMON_QUERY}`;
    const payload = {
      action_type: 2,
      filelist: Array.isArray(request.fids) ? request.fids : [request.fids],
      exclude_fids: []
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 POST 新建文件夹
  if (request.action === 'API_CREATE_DIRECTORY') {
    const url = `${API_BASE}/file?${COMMON_QUERY}`;
    const payload = {
      pdir_fid: request.pdir_fid || '0',
      file_name: request.file_name,
      dir_path: '',
      dir_init_lock: false
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  return false;
});
