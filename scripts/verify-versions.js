const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

function fail(msg) {
  console.error(`❌ [错误]: ${msg}`);
  process.exit(1);
}

try {
  const manifest = readJson('public/manifest.json');
  const pkg = readJson('package.json');
  const pkgLock = readJson('package-lock.json');
  const about = readJson('public/data/about.json');
  const changelog = readJson('public/data/changelog.json');
  const popupHtml = read('public/popup.html');

  const vManifest = manifest.version;
  const vPkg = pkg.version;
  const vPkgLock = pkgLock.version;
  const vAbout = about.project && about.project.version;
  const vLog = changelog[0] && changelog[0].version && changelog[0].version.replace(/^v/, '');

  console.log(`🔍 正在执行全项目版本号同步校验...`);
  console.log(`  - public/manifest.json:     ${vManifest}`);
  console.log(`  - package.json:             ${vPkg}`);
  console.log(`  - package-lock.json:        ${vPkgLock}`);
  console.log(`  - public/data/about.json:   ${vAbout}`);
  console.log(`  - public/data/changelog.json: ${vLog}`);

  if (vManifest !== vPkg || vManifest !== vPkgLock || vManifest !== vAbout || vManifest !== vLog) {
    fail('项目版本号不一致！必须保持 manifest.json, package.json, package-lock.json, about.json 与 changelog.json 完全统一！');
  }

  const versionTag = `v${vManifest}`;
  if (!popupHtml.includes(versionTag)) {
    fail(`public/popup.html 中的显示版本号与 manifest.json (${versionTag}) 不一致！`);
  }

  const requiredFiles = [
    'LICENSE',
    'README.md',
    'public/manifest.json',
    'public/popup.html',
    'public/content.css',
    'public/icons/icon-128.png',
    'public/data/about.json',
    'public/data/changelog.json',
    'package.json',
    'package-lock.json',
    'src/content/index.js',
    'src/background/index.js',
    'src/popup/index.js'
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(rootDir, file))) {
      fail(`缺失必要的核心文件: ${file}`);
    }
  });

  console.log(`✔ [成功]: 核心源码与静态资源文件完整性校验通过！`);
  console.log(`✔ [成功]: 全项目 6 处版本号 100% 完全同步一键校验通过！(${versionTag})`);
} catch (e) {
  console.error(`❌ [错误]: 版本强校验失败:`, e.message);
  process.exit(1);
}
