const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'release');
const manifestPath = path.join(distDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('❌ 未找到 dist/manifest.json，请先执行 `npm run build:js` 完成构建！');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

const zipName = `quark-batch-rename-v${version}.zip`;
const zipPath = path.join(releaseDir, zipName);

console.log(`📦 正在打包 Chrome Extension v${version}...`);

try {
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // 从 dist/ 目录内打包全部内容（保持扩展根目录结构）
  const cmd = `zip -r "${zipPath}" .`;
  execSync(cmd, { cwd: distDir, stdio: 'inherit' });

  console.log(`\n🎉 打包完成！发布压缩包位于:\n👉 ${zipPath}\n`);
} catch (err) {
  console.error('❌ 打包失败:', err.message);
  process.exit(1);
}
