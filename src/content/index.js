/**
 * 夸克网盘全能管理工具 - Content Script 入口
 * 引导 UI 初始化与全局事件绑定
 */

import { createFloatButton, createModalUI, bindEvents, parseUrlAndSyncState } from './ui.js';
import { fetchFileList } from './api.js';

function init() {
  createFloatButton();
  createModalUI();
  bindEvents();
  parseUrlAndSyncState();

  window.addEventListener('hashchange', () => {
    parseUrlAndSyncState();
    const modal = document.getElementById('qrModalOverlay');
    if (modal && modal.classList.contains('active')) {
      fetchFileList();
    }
  });
}

if (window.__QUARK_RENAME_ASSISTANT_LOADED__) {
  // 已注入则跳过，避免重复初始化
} else {
  window.__QUARK_RENAME_ASSISTANT_LOADED__ = true;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
}
