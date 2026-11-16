// Dựng app/xepgio-helper.js từ: bộ xếp giờ + phần app dùng chung (cả hai nằm trong his-mo-phong.html) + helper.src.js.
// Chạy: node build.js
const fs = require('fs'), path = require('path');
const here = __dirname, root = path.join(here, '..', '..');
const html = fs.readFileSync(path.join(root, 'his-mo-phong.html'), 'utf8');
const cut = (re, what) => { const m = re.exec(html); if (!m) throw new Error('Không thấy vùng ' + what + ' trong his-mo-phong.html'); return m[1]; };
const engine = cut(/\/\* ENGINE-START[^\n]*\n([\s\S]*?)\/\* ENGINE-END \*\//, 'ENGINE');
const core = cut(/\/\* CORE-START[^\n]*\n([\s\S]*?)\/\* CORE-END \*\//, 'CORE');
const appHtml = cut(/<!-- APP-HTML-START -->([\s\S]*?)<!-- APP-HTML-END -->/, 'APP-HTML');
let css = cut(/<style>([\s\S]*?)<\/style>/, 'CSS');
// Trong trang HIS, giao diện app nằm trong vùng riêng (shadow DOM) và chỉ dùng nền sáng
css = css.replace(/@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{[\s\S]*?\} \}/, '')
  .replace(/:root\[data-theme="dark"\] \{[\s\S]*?\}/, '')
  .replace(/:root \{/, ':host {').replace(/\nbody \{[^}]*\}/, '');
if (/prefers-color-scheme|data-theme|:root/.test(css)) throw new Error('CSS còn sót phần không dùng được trong trang HIS');

let src = fs.readFileSync(path.join(here, 'helper.src.js'), 'utf8');
const put = (mark, text) => { if (src.indexOf(mark) < 0) throw new Error('Không thấy mốc ' + mark); src = src.split(mark).join(text); };
put('/*@ENGINE*/', engine);
put('/*@CORE*/', core);
put('"@CSS"', JSON.stringify(css));
put('"@HTML"', JSON.stringify(appHtml));
new Function(src);   // kiểm tra cú pháp
fs.writeFileSync(path.join(here, '..', 'xepgio-helper.js'), src);
fs.writeFileSync(path.join(root, 'xepgio-engine.js'), '// Bộ xếp giờ thủ thuật. File này được tách tự động từ his-mo-phong.html, sửa ở đó rồi tách lại.\n' + engine + "if (typeof module !== 'undefined') module.exports = X;\n");
console.log('Đã dựng xepgio-helper.js: ' + src.length + ' ký tự');
