const fs = require('fs');

try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const about = JSON.parse(fs.readFileSync('data/about.json', 'utf8'));
  const changelog = JSON.parse(fs.readFileSync('data/changelog.json', 'utf8'));
  const popupHtml = fs.readFileSync('popup.html', 'utf8');

  const vManifest = manifest.version;
  const vPkg = pkg.version;
  const vAbout = about.project?.version;
  const vLog = changelog[0]?.version?.replace(/^v/, '');

  console.log(`🔍 正在执行全项目版本号同步校验...`);
  console.log(`  - manifest.json:  ${vManifest}`);
  console.log(`  - package.json:   ${vPkg}`);
  console.log(`  - data/about.json:${vAbout}`);
  console.log(`  - changelog.json: ${vLog}`);

  if (vManifest !== vPkg || vManifest !== vAbout || vManifest !== vLog) {
    console.error(`❌ [错误]: 项目版本号不一致！必须保持 manifest.json, package.json, about.json 与 changelog.json 完全统一！`);
    process.exit(1);
  }

  if (!popupHtml.includes(`v${vManifest}`)) {
    console.error(`❌ [错误]: popup.html 中的显示版本号与 manifest.json (v${vManifest}) 不一致！`);
    process.exit(1);
  }

  const requiredFiles = ['LICENSE', 'README.md', 'manifest.json', 'package.json', 'data/about.json', 'data/changelog.json'];
  requiredFiles.forEach((file) => {
    if (!fs.existsSync(file)) {
      console.error(`❌ [错误]: 缺失必要的核心规范文件: ${file}`);
      process.exit(1);
    }
  });

  console.log(`✔ [成功]: 根目录必备规范文件完整性校验通过！`);
  console.log(`✔ [成功]: 全项目所有 5 处版本号及说明文件 100% 完全同步一键校验通过！(v${vManifest})`);
} catch (e) {
  console.error(`❌ [错误]: 版本强校验失败:`, e.message);
  process.exit(1);
}
