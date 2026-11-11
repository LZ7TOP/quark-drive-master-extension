/**
 * 夸克网盘全能管理工具 - Popup Script 入口
 */

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function loadAccountQuota() {
  const nameEl = document.getElementById('accountName');
  const memberBadgeEl = document.getElementById('memberBadge');
  const quotaTextEl = document.getElementById('quotaText');
  const quotaBarEl = document.getElementById('quotaBarFill');
  if (!nameEl || !memberBadgeEl || !quotaTextEl || !quotaBarEl) return;

  try {
    chrome.runtime.sendMessage({ action: 'API_FETCH_ACCOUNT_QUOTA' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success || !resp.data) {
        nameEl.textContent = '获取失败';
        memberBadgeEl.textContent = '离线';
        memberBadgeEl.className = 'badge badge-muted';
        quotaTextEl.textContent = '-- / --';
        return;
      }

      const acc = resp.data;
      if (!acc.loggedIn) {
        nameEl.textContent = '未登录夸克网盘';
        memberBadgeEl.textContent = '未登录';
        memberBadgeEl.className = 'badge badge-warn';
        quotaTextEl.textContent = '请先登录网页版';
        quotaBarEl.style.width = '0%';
        return;
      }

      nameEl.textContent = acc.nickname || '夸克用户';
      const tier = String(acc.member_type || 'NORMAL').toUpperCase();
      if (tier.includes('SVIP')) {
        memberBadgeEl.textContent = 'SVIP';
        memberBadgeEl.className = 'badge badge-vip';
      } else if (tier.includes('VIP')) {
        memberBadgeEl.textContent = 'VIP';
        memberBadgeEl.className = 'badge badge-blue';
      } else {
        memberBadgeEl.textContent = '普通会员';
        memberBadgeEl.className = 'badge badge-muted';
      }

      const useCap = Number(acc.use_capacity) || 0;
      const totalCap = Number(acc.total_capacity) || 0;
      if (totalCap > 0) {
        const pct = Math.min(100, Math.round((useCap / totalCap) * 100));
        quotaTextEl.textContent = `${formatBytes(useCap)} / ${formatBytes(totalCap)} (${pct}%)`;
        quotaBarEl.style.width = `${pct}%`;
        quotaBarEl.className = `quota-bar-fill ${pct >= 95 ? 'is-danger' : pct >= 85 ? 'is-warn' : ''}`.trim();
      } else {
        quotaTextEl.textContent = '暂未获取到容量';
        quotaBarEl.style.width = '0%';
      }
    });
  } catch (err) {
    console.warn('[Quark Popup] 获取账号容量异常:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const pageStatusEl = document.getElementById('pageStatus');
  const fidStatusEl = document.getElementById('fidStatus');
  const openPanelBtn = document.getElementById('openPanelBtn');

  loadAccountQuota();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      pageStatusEl.textContent = '未匹配页面';
      pageStatusEl.className = 'badge badge-warn';
      return;
    }

    const isQuark = tab.url && (tab.url.startsWith('https://pan.quark.cn') || tab.url.startsWith('https://drive-pc.quark.cn'));
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
