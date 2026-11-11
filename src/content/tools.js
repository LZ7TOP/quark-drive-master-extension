/**
 * 工具箱：目录统计、重复文件检测、文件名规范检查
 */

import { state } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml, formatSize, log } from './utils.js';
import { customAlert, customConfirm, toast } from './dialogs.js';
import { requestDeleteFiles, requestMoveFiles, scanSubdirectoryFiles, fetchFileList } from './api.js';
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

let currentFlattenScan = null;

async function scanFlattenSubdirs() {
  const resultEl = document.getElementById('qrFlattenResult');
  const scanBtn = document.getElementById('qrScanFlattenBtn');
  if (!resultEl) return;

  if (state.mainMode === 'search') {
    customAlert('提示', '当前主面板处于「全盘搜索」结果视图，请先返回具体文件夹后，再扫描提取子目录内容。');
    return;
  }

  const currentFid = state.pdir_fid || '0';
  resultEl.innerHTML = `<div class="qr-tool-tip">🔍 正在深度扫描子目录及包含的文件 (FID: ${escapeHtml(currentFid)})...</div>`;
  if (scanBtn) scanBtn.disabled = true;

  try {
    const scanData = await scanSubdirectoryFiles(currentFid);
    currentFlattenScan = scanData;

    const subDirCount = scanData.subDirs.length;
    const fileCount = scanData.filesToMove.length;
    const totalSize = scanData.filesToMove.reduce((sum, f) => sum + f.size, 0);

    if (fileCount === 0) {
      if (subDirCount === 0) {
        resultEl.innerHTML = `<div class="qr-tool-empty">${ICONS.check} 当前目录下未检测到任何子文件夹</div>`;
      } else {
        resultEl.innerHTML = `<div class="qr-tool-empty">${ICONS.check} 发现 ${subDirCount} 个子文件夹，但内部均为空或无文件</div>`;
      }
      return;
    }

    // 按子目录分组汇总展示
    const dirMap = {};
    scanData.filesToMove.forEach((f) => {
      const dirName = f.parentDir || '子目录';
      if (!dirMap[dirName]) dirMap[dirName] = [];
      dirMap[dirName].push(f);
    });

    const groupHtml = Object.entries(dirMap)
      .map(([dirName, files]) => {
        const dirSize = files.reduce((s, x) => s + x.size, 0);
        return `
          <div class="qr-flatten-group">
            <div class="qr-flatten-group-title">
              <span>📁 ${escapeHtml(dirName)}</span>
              <span class="qr-flatten-group-meta">${files.length} 个文件 · ${formatSize(dirSize)}</span>
            </div>
            <div class="qr-flatten-file-list">
              ${files
                .slice(0, 8)
                .map(
                  (f) => `
                <div class="qr-flatten-file-item">
                  <span class="qr-flatten-file-name" title="${escapeHtml(f.file_name)}">${escapeHtml(f.file_name)}</span>
                  <span class="qr-flatten-file-size">${formatSize(f.size)}</span>
                </div>
              `
                )
                .join('')}
              ${files.length > 8 ? `<div class="qr-flatten-more">... 及其余 ${files.length - 8} 个文件</div>` : ''}
            </div>
          </div>
        `;
      })
      .join('');

    resultEl.innerHTML = `
      <div class="qr-tool-tip">
        共扫描到 <b>${subDirCount}</b> 个子文件夹，包含 <b>${fileCount}</b> 个文件，总大小 <b>${formatSize(totalSize)}</b>。
      </div>
      <div class="qr-flatten-groups-container">
        ${groupHtml}
      </div>
      <div class="qr-tool-actions" style="margin-top: 12px; align-items: center; justify-content: space-between;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d4d4d8; cursor: pointer; user-select: none;">
          <input type="checkbox" id="qrCleanEmptyDirsCb" checked style="cursor: pointer;">
          移出完成后自动清理已清空的子文件夹
        </label>
        <button id="qrExecuteFlattenBtn" class="qr-btn-tool qr-btn-green" style="padding: 6px 16px;">
          ${ICONS.zap} 一键提取到当前目录 (${fileCount})
        </button>
      </div>
    `;

    const execBtn = document.getElementById('qrExecuteFlattenBtn');
    if (execBtn) {
      execBtn.addEventListener('click', executeFlattenMove);
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="qr-tool-empty" style="color: #ef4444;">扫描失败: ${escapeHtml(err.message)}</div>`;
  } finally {
    if (scanBtn) scanBtn.disabled = false;
  }
}

async function executeFlattenMove() {
  if (!currentFlattenScan || currentFlattenScan.filesToMove.length === 0) {
    customAlert('提示', '暂无可移动的子目录文件，请先点击扫描。');
    return;
  }

  const { filesToMove, subDirs } = currentFlattenScan;
  const currentFid = state.pdir_fid || '0';
  const cleanEmpty = document.getElementById('qrCleanEmptyDirsCb')?.checked ?? true;

  customConfirm(
    '确认提取子文件',
    `⚠️ 确认将 ${filesToMove.length} 个文件从各个子文件夹移出至当前目录层级吗？${cleanEmpty ? '\n（操作完成后将自动清理已清空的子文件夹）' : ''}`,
    async (confirmed) => {
      if (!confirmed) return;

      const execBtn = document.getElementById('qrExecuteFlattenBtn');
      const scanBtn = document.getElementById('qrScanFlattenBtn');
      if (execBtn) {
        execBtn.disabled = true;
        execBtn.innerHTML = '正在批量移出文件...';
      }
      if (scanBtn) scanBtn.disabled = true;

      try {
        const fileFids = filesToMove.map((f) => f.fid);
        log(`开始批量移出 ${fileFids.length} 个文件到当前目录 (FID: ${currentFid})...`);

        // 批量分段移动（每批 80 个，兼顾稳定与速度）
        const BATCH_SIZE = 80;
        let successFiles = 0;
        for (let i = 0; i < fileFids.length; i += BATCH_SIZE) {
          const chunk = fileFids.slice(i, i + BATCH_SIZE);
          const moveRes = await requestMoveFiles(chunk, currentFid);
          if (moveRes && (moveRes.code === 0 || moveRes.status === 200)) {
            successFiles += chunk.length;
          } else {
            throw new Error(moveRes?.message || moveRes?.error || '批量移动接口响应异常');
          }
        }

        log(`文件移动完毕，共成功移出 ${successFiles} 个文件！`);

        // 若勾选了清理空子文件夹
        if (cleanEmpty && subDirs.length > 0) {
          log(`正在自动清理 ${subDirs.length} 个已清空的子文件夹...`);
          const dirFids = subDirs.map((d) => d.fid);
          for (let i = 0; i < dirFids.length; i += BATCH_SIZE) {
            const dirChunk = dirFids.slice(i, i + BATCH_SIZE);
            await requestDeleteFiles(dirChunk);
          }
          log(`已清空子文件夹清理完成！`);
        }

        toast(`已成功将 ${successFiles} 个文件提取到当前目录！`);
        currentFlattenScan = null;
        const resultEl = document.getElementById('qrFlattenResult');
        if (resultEl) {
          resultEl.innerHTML = `<div class="qr-tool-empty">${ICONS.check} 已成功将 ${successFiles} 个文件提取到当前目录！</div>`;
        }

        // 联动刷新主面板文件列表与统计
        fetchFileList();
      } catch (err) {
        log(`提取移动异常: ${err.message}`);
        customAlert('移出失败', err.message || '移动文件时遇到错误');
      } finally {
        if (execBtn) {
          execBtn.disabled = false;
          execBtn.innerHTML = `${ICONS.zap} 一键提取到当前目录`;
        }
        if (scanBtn) scanBtn.disabled = false;
      }
    }
  );
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
        <div class="qr-tool-card-header">${ICONS.folder} 提取子文件夹内容（目录扁平化）</div>
        <p class="qr-tool-desc">深度扫描当前目录下的所有子文件夹，将分散在子目录里的剧集、课程或分卷文件统一移出平铺到当前层级。</p>
        <button id="qrScanFlattenBtn" class="qr-btn-tool qr-btn-blue">开始扫描子文件夹</button>
        <div id="qrFlattenResult" class="qr-tool-result"></div>
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
  const flattenBtn = document.getElementById('qrScanFlattenBtn');
  const detectBtn = document.getElementById('qrDetectDupBtn');
  const inspectBtn = document.getElementById('qrInspectBtn');
  const fixBtn = document.getElementById('qrFixNamesBtn');

  if (flattenBtn) flattenBtn.addEventListener('click', scanFlattenSubdirs);
  if (detectBtn) detectBtn.addEventListener('click', detectDuplicates);
  if (inspectBtn) inspectBtn.addEventListener('click', inspectNames);
  if (fixBtn) fixBtn.addEventListener('click', fixNames);
}

export function refreshToolsView() {
  renderStatistics();
}
