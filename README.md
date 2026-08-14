<div align="center">
  <img src="icons/icon-128.png" width="100" height="100" alt="Logo" />
  <h1>夸克网盘全能管理工具 (Quark Drive Master)</h1>
  <p><b>专为夸克网盘打造的全能自动化管理助手 · 批量重命名 · 批量删除 · 快捷新建文件夹 · CSV交互 · 历史撤销</b></p>

[![Extension Release](https://img.shields.io/badge/Extension-v3.0.3-2563EB?logo=googlechrome&logoColor=white)](manifest.json)
[![Manifest Version](https://img.shields.io/badge/Manifest-V3-34A853?logo=googlechrome&logoColor=white)](manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Author: LZ7工作室](https://img.shields.io/badge/Author-LZ7工作室-2563EB.svg)](https://github.com/LZ7TOP)
</div>

---

## 💡 为什么选择「夸克网盘全能管理工具」？

**夸克网盘全能管理工具 (Quark Drive Master)** 是一款专为夸克网盘网页端 (`https://pan.quark.cn`) 打造的高级 Chrome 扩展插件。

它超越了传统的单一重命名插件，将 **批量重命名、行内快捷保存、批量删除清理、快捷新建文件夹、CSV 表格映射协同、智能自然排序与改名历史撤销** 等全套自动化功能完美整合在一个纯手写、无弹窗阻挡的高颜值极简面板中。

---

## 🔥 核心大能力矩阵

### 1. ⚡ 批量重命名与行内快捷编辑 (Batch & Inline Rename)
- **表格内直接打字修改**：在表格“修改后名称”列直接打字，打字状态瞬间由灰色 `未变动` 响应为绿色 `待更新`。
- **行内单件【✓ 保存】快捷键**：为每一个手写修改的文件行生成专属 `[✓ 保存]` 按键，无需批量操作，点击即可秒级完成单件发包与历史存档。
- **文本查找与替换**：支持普通字符串替换与正则表达式（Regex）高级匹配，支持忽略大小写。
- **添加前缀 / 后缀**：一键为所有选中的文件统一插入前缀或后缀。
- **智能自增序号**：自定义序号起始值（如 `1`）与填充位数（如 `01`, `001`），支持在文件名任意位置插入。
- **大小写与繁简转换**：支持转大写/小写/首字母大写，以及一键将繁体中文转换为简体中文。
- **扩展名变更**：支持批量修改文件扩展名或去除特定后缀。

### 2. 🗑️ 批量文件删除 (Batch Delete)
- **快捷批量移入回收站**：全面接入夸克官方 `file/delete` 接口，支持在列表勾选任意文件/文件夹后一键批量删除。
- **高饱和警示红与二次确认**：具备严格的确认机制与实时勾选数量统计，安全高效。

### 3. 📁 当前目录快捷新建文件夹 (Create Directory)
- **快捷创建新目录**：接入夸克官方 `clouddrive/file` 接口，支持在顶栏一键弹出手写 Prompt 弹窗创建新文件夹。
- **键盘 Enter 瞬间确认**：自动全选默认名称，按 Enter 键极速完成新建并自动刷新页面。

### 4. 📄 CSV 表格协同 (CSV Interoperability)
- **一键导出 CSV 文件清单**：导出当前目录全量文件名与 FID 映射关系。
- **Excel 批量编辑后导入覆盖**：在 Excel / WPS 中完成高度个性化的修改后，一键导入覆盖，瞬间批量重命名。

### 5. ⏪ 历史快照与一键撤销 (Undo History)
- **安全快照存档**：每次重命名自动存入日志快照。
- **纯矢量 SVG 图标与向心对齐**：告别 Emoji 符号，采用标准 SVG 图标与对向聚焦对齐 (`text-align: right` / `text-align: left`)。
- **一键反向还原与清空历史**：支持一键还原误操作文件名，并提供一键清空全部历史快照功能。

---

## 🛠️ 安装与使用方法

1. **下载或拉取源码包**：
   下载解压发布包 `release/quark-batch-rename-v3.0.3.zip`（或前往 [GitHub Releases](https://github.com/LZ7TOP/quark-drive-master-extension/releases) 下载最新版离线包）。
2. **打开 Chrome 扩展程序页面**：
   在浏览器地址栏输入 `chrome://extensions/`，并开启右上角的 **「开发者模式」**。
3. **加载已解压的扩展程序**：
   点击左上角的 **「加载已解压的扩展程序」** 按钮，选择本插件解压目录即可。
4. **即刻使用**：
   打开夸克网盘 `https://pan.quark.cn`，网页右下角将 **100% 自动悬挂** 主悬浮按键 **「夸克全能工具」**，点击即可开启管理面板！

---

## 🛡️ 技术架构与安全

- **Manifest V3 架构**：严格遵循 Google Chrome Manifest V3 最新开发规范。
- **前台同源优先发包**：包含完整的同源发包与 Service Worker 后台发包代理，完美规避 CORS 与防盗链拦截。
- **纯手写 CustomSelect 下拉组件**：彻底剔除原生 `<select>` 弹窗，全量手写 Dark 扁平悬浮列表。
- **纯矢量 SVG 图标**：全量淘汰 Emoji 符号，统一标准 UI 视觉规范。

---

## 🧪 本地开发与打包

```bash
# 校验全项目版本号一致性与核心文件完整性
npm run check

# 打包生成 release/quark-batch-rename-vX.Y.Z.zip 离线包
npm run pack

# 一键校验并打包
npm run build
```

---

## 📝 更新日志

完整的历史版本更新明细请见 [FULL_RELEASE_NOTES.md](FULL_RELEASE_NOTES.md) 与 [data/changelog.json](data/changelog.json)，也可在插件面板的「更新日志」页签内实时查看。

### v3.0.3 (2026-08-11)

- 修复 CSV 导出按钮重复触发导致下载两份同名文件的问题。
- 修复批量删除按钮二次绑定隐患，杜绝重复弹窗。
- CSV 导入支持引号转义字段与 UTF-8 BOM，正确解析含逗号/引号文件名。
- 繁体转简体映射由 35 字扩充至 300+ 常用字。
- 新增目录加载竞态防护与单件/撤销任务锁，避免并发冲突。
- 统一全项目版本号至 v3.0.3 并强化版本校验脚本。

---

## 📄 开源协议与版权

- **作者**：[LZ7 工作室 (LZ7 Studio)](https://github.com/LZ7TOP)
- **License**：[MIT License](LICENSE)
