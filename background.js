// 夸克网盘全能管理工具 - Background Service Worker (v3.0.3)

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
    const url = `https://drive-pc.quark.cn/1/clouddrive/file/sort?pr=ucpro&fr=pc&uc_param_str=&pdir_fid=${pdirFid}&_page=1&_size=200&_fetch_total=1&_fetch_sub_dirs=0&_sort=file_type:asc,updated_at:desc&fetch_all_file=1&fetch_risk_file_name=1`;

    fetch(url, {
      method: 'GET',
      credentials: 'include'
    })
      .then((res) => res.text())
      .then((text) => {
        try {
          const data = JSON.parse(text);
          sendResponse({ success: true, data });
        } catch (e) {
          sendResponse({ success: false, error: text || '服务响应格式异常' });
        }
      })
      .catch((err) => sendResponse({ success: false, error: err.message || '网络请求异常' }));

    return true;
  }

  // 后台代理 POST 重命名文件
  if (request.action === 'API_RENAME_FILE') {
    const url = 'https://drive-pc.quark.cn/1/clouddrive/file/rename?pr=ucpro&fr=pc&uc_param_str=';
    const payload = {
      fid: request.fid,
      file_name: request.file_name
    };

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then((res) => res.text())
      .then((text) => {
        try {
          const data = JSON.parse(text);
          sendResponse({ success: true, data });
        } catch (e) {
          if (text.includes('Invalid CORS')) {
            sendResponse({ success: false, error: '夸克跨域校验风控拦截 (Invalid CORS request)，请尝试刷新网页' });
          } else {
            sendResponse({ success: false, error: text || '请求响应未解析为 JSON' });
          }
        }
      })
      .catch((err) => sendResponse({ success: false, error: err.message || '重命名请求失败' }));

    return true;
  }

  // 后台代理 POST 删除文件
  if (request.action === 'API_DELETE_FILES') {
    const url = 'https://drive-pc.quark.cn/1/clouddrive/file/delete?pr=ucpro&fr=pc&uc_param_str=';
    const payload = {
      action_type: 2,
      filelist: Array.isArray(request.fids) ? request.fids : [request.fids],
      exclude_fids: []
    };

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then((res) => res.text())
      .then((text) => {
        try {
          const data = JSON.parse(text);
          sendResponse({ success: true, data });
        } catch (e) {
          sendResponse({ success: false, error: text || '删除响应解析异常' });
        }
      })
      .catch((err) => sendResponse({ success: false, error: err.message || '删除请求失败' }));

    return true;
  }

  // 后台代理 POST 新建文件夹
  if (request.action === 'API_CREATE_DIRECTORY') {
    const url = 'https://drive-pc.quark.cn/1/clouddrive/file?pr=ucpro&fr=pc&uc_param_str=';
    const payload = {
      pdir_fid: request.pdir_fid || '0',
      file_name: request.file_name,
      dir_path: '',
      dir_init_lock: false
    };

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then((res) => res.text())
      .then((text) => {
        try {
          const data = JSON.parse(text);
          sendResponse({ success: true, data });
        } catch (e) {
          sendResponse({ success: false, error: text || '创建文件夹响应解析异常' });
        }
      })
      .catch((err) => sendResponse({ success: false, error: err.message || '创建文件夹请求失败' }));

    return true;
  }
});
