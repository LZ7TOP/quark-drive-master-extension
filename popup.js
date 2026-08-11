// 夸克网盘全能管理工具 - Popup Script (v3.0.0 整合全能版)

document.addEventListener('DOMContentLoaded', async () => {
  const pageStatusEl = document.getElementById('pageStatus');
  const fidStatusEl = document.getElementById('fidStatus');
  const openPanelBtn = document.getElementById('openPanelBtn');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      pageStatusEl.textContent = '未匹配页面';
      pageStatusEl.className = 'badge badge-warn';
      return;
    }

    const isQuark = tab.url && (tab.url.includes('quark.cn'));
    if (isQuark) {
      pageStatusEl.textContent = '已识别夸克网盘';
      pageStatusEl.className = 'badge badge-success';

      const urlObj = new URL(tab.url);
      const fid = urlObj.searchParams.get('pdir_fid') || urlObj.searchParams.get('fid') || '自动捕获根目录';
      fidStatusEl.textContent = fid.length > 12 ? fid.substring(0, 10) + '...' : fid;
    } else {
      pageStatusEl.textContent = '非夸克网页';
      pageStatusEl.className = 'badge badge-warn';
    }

    openPanelBtn.addEventListener('click', async () => {
      if (!isQuark) {
        chrome.tabs.create({ url: 'https://pan.quark.cn' });
        return;
      }

      try {
        // 发送唤起消息
        await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_RENAME_PANEL' });
        window.close();
      } catch (err) {
        // 如果未注入 Content Script，动态自动注入脚本与 CSS，无需用户手动刷新
        try {
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content.css']
          });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          setTimeout(async () => {
            await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_RENAME_PANEL' });
            window.close();
          }, 200);
        } catch (injectErr) {
          alert('无法在此页面运行脚本，请刷新夸克网盘页面后再试。');
        }
      }
    });

  } catch (e) {
    console.error(e);
  }
});
