const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

async function build() {
  // 清空并重建 dist 目录
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  // esbuild 打包三个入口为 IIFE（浏览器非 module 脚本）
  await esbuild.build({
    entryPoints: {
      content: path.join(srcDir, 'content', 'index.js'),
      background: path.join(srcDir, 'background', 'index.js'),
      popup: path.join(srcDir, 'popup', 'index.js')
    },
    bundle: true,
    outdir: distDir,
    format: 'iife',
    target: ['chrome88'],
    minify: false,
    sourcemap: false,
    logLevel: 'info'
  });

  // 复制 public/ 静态资源（manifest、popup.html、css、icons、data）到 dist/
  fs.cpSync(publicDir, distDir, { recursive: true });

  const files = fs.readdirSync(distDir).sort();
  console.log('✔ 构建完成，dist/ 内容:', files.join(', '));
}

build().catch((err) => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
