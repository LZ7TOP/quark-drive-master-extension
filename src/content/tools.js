/**
 * 工具箱：目录统计、重复文件检测、文件名规范检查
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml, log } from './utils.js';
import { customAlert, customConfirm, toast } from './dialogs.js';
import { requestDeleteFiles, fetchFileList } from './api.js';
import { renderTable, updateStatText } from './ui.js';

const TYPE_PATTERNS = {
  video: /\.(mp4|mkv|flv|avi|mov|wmv|m4v|webm|ts)$/i,
  audio: /\.(mp3|flac|wav|aac|m4a|ogg|ape)$/i,
  image: /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i,
  doc: /\.(pdf|docx?|xlsx?|pptx?|txt|md|epub)$/i
};

const TYPE_LABELS = {
  video: '视频',
  audio: '音频',
  image: '图片',
  doc: '文档',
  other: '其他'
};

const ILLEGAL_CHARS = /[\\/:*?"<>|]/;

function classifyType(fileName) {
  for (const [type, pattern] of Object.entries(TYPE_PATTERNS)) {
    if (pattern.test(fileName)) return type;
  }
  return 'other';
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = n;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function renderStatistics() {
  const grid = document.getElementById('qrStatsGrid');
  const distEl = document.getElementById('qrTypeDist');
  if (!grid || !distEl) return;

  const files = state.fileList;
  const fileCount = files.filter((f) => !f.is_dir).length;
  const dirCount = files.filter((f) => f.is_dir).length;
  const totalSize = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);

  const dist = { video: 0, audio: 0, image: 0, doc: 0, other: 0 };
  files.forEach((f) => {
    if (f.is_dir) return;
    dist[classifyType(f.file_name)]++;
  });

  grid.innerHTML = `
    <div class="qr-stat-item"><span class="qr-stat-value">${files.length}</span><span class="qr-stat-label">总项目</span></div>
    <div class="qr-stat-item"><span class="qr-stat-value">${fileCount}</span><span class="qr-stat-label">文件</span></div>
    <div class="qr-stat-item"><span class="qr-stat-value">${dirCount}</span><span class="qr-stat-label">文件夹</span></div>
    <div class="qr-stat-item"><span class="qr-stat-value">${formatSize(totalSize)}</span><span class="qr-stat-label">总大小</span></div>
  `;

  const totalTyped = dist.video + dist.audio + dist.image + dist.doc + dist.other;
  distEl.innerHTML = Object.keys(dist)
    .map((key) => {
      const count = dist[key];
      const pct = totalTyped > 0 ? Math.round((count / totalTyped) * 100) : 0;
      return `
        <div class="qr-type-row">
          <span class="qr-type-label">${TYPE_LABELS[key]}</span>
          <div class="qr-type-bar"><div class="qr-type-bar-inner" style="width:${pct}%"></div></div>
          <span class="qr-type-count">${count}</span>
        </div>
      `;
    })
    .join('');
}

function detectDuplicates() {
  const resultEl = document.getElementById('qrDupResult');
  if (!resultEl) return;

  const groups = {};
  state.fileList.forEach((f) => {
    if (f.is_dir) return;
    const key = f.file_name.toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  });

  const dupGroups = Object.values(groups).filter((g) => g.length > 1);

  if (dupGroups.length === 0) {
    resultEl.innerHTML = `<div class="qr-tool-empty">${ICONS.check} 未发现重复文件名</div>`;
    return;
  }

  let totalDup = 0;
  resultEl.innerHTML = dupGroups
    .map((group) => {
      const extra = group.length - 1;
      totalDup += extra;
      const rows = group
        .map(
          (f, idx) => `
          <label class="qr-dup-row">
            <input type="checkbox" class="qr-dup-cb" data-fid="${escapeHtml(f.fid)}" ${idx === 0 ? 'disabled' : 'checked'}>
            <span class="qr-dup-name">${escapeHtml(f.file_name)}</span>
            <span class="qr-dup-size">${formatSize(f.size)}</span>
          </label>
        `
        )
        .join('');
      return `
        <div class="qr-dup-group">
          <div class="qr-dup-group-head">同名 ${group.length} 项 · 建议保留首个，勾选删除其余 ${extra} 项</div>
          ${rows}
        </div>
      `;
    })
    .join('');

  resultEl.innerHTML += `
    <div class="qr-tool-actions">
      <span class="qr-tool-tip">共 ${dupGroups.length} 组重复，勾选后将删除所选重复项</span>
      <button id="qrDeleteDupBtn" class="qr-btn-tool qr-btn-red">删除勾选重复项</button>
    </div>
  `;

  const deleteBtn = document.getElementById('qrDeleteDupBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const checked = resultEl.querySelectorAll('.qr-dup-cb:checked');
      const fids = Array.from(checked)
        .map((cb) => cb.dataset.fid)
        .filter(Boolean);
      if (fids.length === 0) {
        customAlert('提示', '请先勾选要删除的重复项。');
        return;
      }
      customConfirm('确认删除重复项', `⚠️ 确认将 ${fids.length} 个重复文件移入夸克回收站吗？`, async (ok) => {
        if (!ok) return;
        const res = await requestDeleteFiles(fids);
        if (res && (res.code === 0 || res.status === 200)) {
          toast(`已删除 ${fids.length} 个重复文件`);
          fetchFileList();
          resultEl.innerHTML = '';
        } else {
          customAlert('删除失败', res?.message || res?.error || '删除请求失败');
        }
      });
    });
  }
}

function inspectNames() {
  const resultEl = document.getElementById('qrInspectResult');
  if (!resultEl) return;

  const issues = [];
  state.fileList.forEach((f) => {
    const name = f.new_name || f.file_name;
    const problems = [];
    if (!name || !name.trim()) problems.push('空文件名');
    if (ILLEGAL_CHARS.test(name)) problems.push('含非法字符 \\/:*?"<>|');
    if (name.length > 255) problems.push('名称超长 (>255)');
    if (name !== name.trim()) problems.push('首尾含空格');
    if (/\.$/.test(name)) problems.push('末尾为点');
    if (problems.length) issues.push({ file: f, problems });
  });

  if (issues.length === 0) {
    resultEl.innerHTML = `<div class="qr-tool-empty">${ICONS.check} 所有文件名均符合规范</div>`;
    return;
  }

  resultEl.innerHTML = `
    <div class="qr-tool-tip">发现 ${issues.length} 个存在问题的文件，点击「一键修复」将自动清理非法字符与首尾空格</div>
    ${issues
      .map(
        (it) => `
        <div class="qr-inspect-row">
          <span class="qr-inspect-name" title="${escapeHtml(it.file.new_name || it.file.file_name)}">${escapeHtml(it.file.new_name || it.file.file_name)}</span>
          <span class="qr-inspect-tags">${it.problems.map((p) => `<span class="qr-inspect-tag">${escapeHtml(p)}</span>`).join('')}</span>
        </div>
      `
      )
      .join('')}
  `;
}

function fixNames() {
  let fixed = 0;
  state.fileList.forEach((f) => {
    const original = f.new_name || f.file_name;
    const cleaned = original
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\.+$/, '');
    if (cleaned !== original) {
      f.new_name = cleaned;
      f.selected = true;
      fixed++;
    }
  });

  if (fixed === 0) {
    customAlert('提示', '没有需要修复的文件名。');
    return;
  }

  renderTable();
  updateStatText();
  inspectNames();
  log(`已修复 ${fixed} 个文件名，请在主面板确认后点击「开始批量重命名」生效`);
}

export function renderToolsViewComponent() {
  const toolsViewEl = document.getElementById('viewTools');
  if (!toolsViewEl) return;

  toolsViewEl.innerHTML = `
    <div class="qr-page-container qr-tools-container">
      <div class="qr-tool-card">
        <div class="qr-tool-card-header">${ICONS.stats} 目录统计</div>
        <div id="qrStatsGrid" class="qr-stat-grid"></div>
        <div id="qrTypeDist" class="qr-type-dist"></div>
      </div>

      <div class="qr-tool-card">
        <div class="qr-tool-card-header">${ICONS.target} 重复文件名检测</div>
        <p class="qr-tool-desc">按文件名（忽略大小写）检测当前目录下的重复文件，支持一键删除多余项。</p>
        <button id="qrDetectDupBtn" class="qr-btn-tool qr-btn-blue">开始检测重复</button>
        <div id="qrDupResult" class="qr-tool-result"></div>
      </div>

      <div class="qr-tool-card">
        <div class="qr-tool-card-header">${ICONS.check} 文件名规范检查</div>
        <p class="qr-tool-desc">检测空文件名、Windows 非法字符、名称超长、首尾空格等问题，支持一键修复。</p>
        <div class="qr-tool-actions">
          <button id="qrInspectBtn" class="qr-btn-tool qr-btn-blue">开始检查</button>
          <button id="qrFixNamesBtn" class="qr-btn-tool qr-btn-green">一键修复</button>
        </div>
        <div id="qrInspectResult" class="qr-tool-result"></div>
      </div>
    </div>
  `;
}

export function bindToolsEvents() {
  const detectBtn = document.getElementById('qrDetectDupBtn');
  const inspectBtn = document.getElementById('qrInspectBtn');
  const fixBtn = document.getElementById('qrFixNamesBtn');

  if (detectBtn) detectBtn.addEventListener('click', detectDuplicates);
  if (inspectBtn) inspectBtn.addEventListener('click', inspectNames);
  if (fixBtn) fixBtn.addEventListener('click', fixNames);
}

export function refreshToolsView() {
  renderStatistics();
}
