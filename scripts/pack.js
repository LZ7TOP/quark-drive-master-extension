const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('❌ 未找到 manifest.json 文件！');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const releaseDir = path.join(rootDir, 'release');

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

const zipName = `quark-batch-rename-v${version}.zip`;
const zipPath = path.join(releaseDir, zipName);

console.log(`📦 正在开始打包 Chrome Extension v${version}...`);

try {
  // 使用 zip 命令打包所需文件
  const filesToInclude = [
    'manifest.json',
    'background.js',
    'content.js',
    'content.css',
    'popup.html',
    'popup.js',
    'icons',
    'data'
  ];

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  const cmd = `zip -r "${zipPath}" ${filesToInclude.join(' ')}`;
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });

  console.log(`\n🎉 打包完成！发布压缩包位于:\n👉 ${zipPath}\n`);
} catch (err) {
  console.error('❌ 打包失败:', err.message);
  process.exit(1);
}
