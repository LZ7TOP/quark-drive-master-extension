/**
 * 夸克网盘全能管理工具 - Background Service Worker
 * 统一通过后台代理转发夸克网盘 API，规避 CORS 与防盗链拦截
 */

const API_BASE = 'https://drive-pc.quark.cn/1/clouddrive';
const ACCOUNT_INFO_URL = 'https://pan.quark.cn/account/info?fr=pc&platform=pc';
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

async function fetchAccountAndQuota() {
  const [infoRes, memberRes] = await Promise.all([
    apiFetch(ACCOUNT_INFO_URL),
    apiFetch(`${API_BASE}/member?${COMMON_QUERY}&fetch_subscribe=true&_ch=home`)
  ]);

  const rawInfo = infoRes.success && infoRes.data ? infoRes.data.data || infoRes.data : null;
  const memberOk = memberRes.success && memberRes.data && (memberRes.data.code === 0 || memberRes.data.status === 200);
  const rawMember = memberOk ? memberRes.data.data || {} : {};

  const nickname = String(rawInfo?.nickname || rawMember?.nickname || '').trim();
  const useCapacity = Number(rawMember?.use_capacity);
  const totalCapacity = Number(rawMember?.total_capacity);
  const hasCapacity = Number.isFinite(useCapacity) && Number.isFinite(totalCapacity) && totalCapacity > 0;
  const loggedIn = Boolean(nickname || hasCapacity);

  return {
    success: true,
    data: {
      loggedIn,
      nickname: nickname || (loggedIn ? '夸克用户' : ''),
      member_type: String(rawMember?.member_type || 'NORMAL'),
      use_capacity: hasCapacity ? useCapacity : 0,
      total_capacity: hasCapacity ? totalCapacity : 0,
      exp_at: Number(rawMember?.exp_at || rawMember?.subscribe_exp_at || 0)
    }
  };
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
    const page = Math.max(1, parseInt(request.page, 10) || 1);
    const size = Math.min(200, Math.max(1, parseInt(request.size, 10) || 200));
    const url =
      `${API_BASE}/file/sort?${COMMON_QUERY}&pdir_fid=${encodeURIComponent(pdirFid)}` +
      `&_page=${page}&_size=${size}&_fetch_total=1&_fetch_sub_dirs=0&_sort=file_type:asc,updated_at:desc` +
      `&fetch_all_file=1&fetch_risk_file_name=1`;

    apiFetch(url).then(sendResponse);
    return true;
  }

  // 后台代理 GET 全盘文件检索
  if (request.action === 'API_SEARCH_FILES') {
    const q = String(request.q || '').trim();
    const page = Math.max(1, parseInt(request.page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(request.size, 10) || 100));
    const url =
      `${API_BASE}/file/search?${COMMON_QUERY}&q=${encodeURIComponent(q)}` +
      `&_page=${page}&_size=${size}&_fetch_total=1&_sort=file_type:asc,updated_at:desc&_is_hl=0`;

    apiFetch(url).then(sendResponse);
    return true;
  }

  // 后台代理 GET 异步任务轮询
  if (request.action === 'API_POLL_TASK') {
    const taskId = encodeURIComponent(request.task_id || '');
    const retryIndex = Math.max(0, parseInt(request.retry_index, 10) || 0);
    const url = `${API_BASE}/task?${COMMON_QUERY}&task_id=${taskId}&retry_index=${retryIndex}`;

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

  // 后台代理 POST 移动文件/文件夹
  if (request.action === 'API_MOVE_FILES') {
    const url = `${API_BASE}/file/move?${COMMON_QUERY}`;
    const payload = {
      action_type: 2,
      filelist: Array.isArray(request.fids) ? request.fids : [request.fids],
      to_pdir_fid: request.to_pdir_fid || '0'
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 POST 提取文件下载直链
  if (request.action === 'API_FETCH_DOWNLOAD_URLS') {
    const url = `${API_BASE}/file/download?${COMMON_QUERY}`;
    const payload = {
      fids: Array.isArray(request.fids) ? request.fids : [request.fids]
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 GET 我的分享列表
  if (request.action === 'API_FETCH_MY_SHARES') {
    const page = Math.max(1, parseInt(request.page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(request.size, 10) || 50));
    const filter = request.filter || 'all';
    const orderField = request.order_field || 'created_at';
    const orderType = request.order_type || 'desc';
    const url =
      `${API_BASE}/share/mypage/detail?${COMMON_QUERY}` +
      `&_page=${page}&_size=${size}` +
      `&_order_field=${encodeURIComponent(orderField)}&_order_type=${encodeURIComponent(orderType)}` +
      `&_fetch_total=1&_fetch_notify_follow=1&_filter=${encodeURIComponent(filter)}&_share_type=0,1`;

    apiFetch(url).then(sendResponse);
    return true;
  }

  // 后台代理 POST 创建分享
  if (request.action === 'API_CREATE_SHARE') {
    const url = `${API_BASE}/share?${COMMON_QUERY}`;
    const payload = {
      fid_list: Array.isArray(request.fid_list) ? request.fid_list : [request.fid_list],
      title: request.title || '',
      url_type: Number(request.url_type) === 2 ? 2 : 1,
      expired_type: Math.min(7, Math.max(1, Number(request.expired_type) || 1))
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 POST 获取分享最终链接与提取码
  if (request.action === 'API_SHARE_PASSWORD') {
    const url = `${API_BASE}/share/password?${COMMON_QUERY}`;
    const payload = { share_id: request.share_id };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 POST 批量取消分享
  if (request.action === 'API_DELETE_SHARES') {
    const url = `${API_BASE}/share/delete?${COMMON_QUERY}`;
    const payload = {
      share_ids: Array.isArray(request.share_ids) ? request.share_ids : [request.share_ids]
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 POST 获取分享页 stoken
  if (request.action === 'API_SHARE_TOKEN') {
    const url = `${API_BASE}/share/sharepage/token?${COMMON_QUERY}`;
    const payload = {
      pwd_id: request.pwd_id || '',
      passcode: request.passcode || ''
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 GET 获取分享包内目录列表
  if (request.action === 'API_SHARE_DETAIL') {
    const page = Math.max(1, parseInt(request.page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(request.size, 10) || 100));
    const url =
      `${API_BASE}/share/sharepage/detail?${COMMON_QUERY}` +
      `&pwd_id=${encodeURIComponent(request.pwd_id || '')}` +
      `&stoken=${encodeURIComponent(request.stoken || '')}` +
      `&pdir_fid=${encodeURIComponent(request.pdir_fid || '0')}` +
      `&force=0&_page=${page}&_size=${size}&_fetch_banner=0&_fetch_share=1&_fetch_total=1` +
      `&_sort=file_type:asc,updated_at:desc`;

    apiFetch(url).then(sendResponse);
    return true;
  }

  // 后台代理 POST 转存分享文件
  if (request.action === 'API_SAVE_SHARE') {
    const url = `${API_BASE}/share/sharepage/save?${COMMON_QUERY}`;
    const payload = {
      fid_list: Array.isArray(request.fid_list) ? request.fid_list : [],
      fid_token_list: Array.isArray(request.fid_token_list) ? request.fid_token_list : [],
      to_pdir_fid: request.to_pdir_fid || '0',
      pwd_id: request.pwd_id || '',
      stoken: request.stoken || '',
      pdir_fid: request.pdir_fid || '0',
      scene: request.scene || 'link'
    };

    apiFetch(url, { method: 'POST', payload }).then(sendResponse);
    return true;
  }

  // 后台代理 GET 账号信息与容量配额
  if (request.action === 'API_FETCH_ACCOUNT_QUOTA') {
    fetchAccountAndQuota()
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err?.message || '获取账号信息失败' }));
    return true;
  }

  return false;
});
