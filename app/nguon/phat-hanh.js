// Phát hành một bản mới của app Xếp giờ HIS.
//   node app/nguon/phat-hanh.js          dựng lại, ghi version.json, đóng gói phat-hanh/XepGioHIS.zip
//   node app/nguon/phat-hanh.js --day    làm như trên rồi đẩy lên GitHub (cần git và gh đã đăng nhập)
// Số bản lấy từ dòng "version: '...'" trong helper.src.js. Máy ở viện tự lấy bản mới khi mở app,
// vì file chạy đọc app/version.json trên GitHub rồi tải các file đã đổi.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const nguon = __dirname, app = path.join(nguon, '..'), root = path.join(app, '..'), out = path.join(root, 'phat-hanh');
const run = (cmd, args, opt) => cp.execFileSync(cmd, args, Object.assign({ cwd: root, stdio: 'inherit' }, opt || {}));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 1. dựng xepgio-helper.js
run(process.execPath, [path.join(nguon, 'build.js')]);

// 2. biên dịch lại file chạy chỉ khi mã nguồn của nó mới hơn (biên dịch lại là file đổi mã kiểm tra)
const exe = path.join(app, 'XepGioHIS.exe'), cs = path.join(nguon, 'XepGioHIS.cs');
if (!fs.existsSync(exe) || fs.statSync(cs).mtimeMs > fs.statSync(exe).mtimeMs) {
  run('cmd.exe', ['/c', path.join(nguon, 'build.cmd')]);
  console.log('Đã biên dịch lại XepGioHIS.exe');
}

// 3. version.json
const m = /version:\s*'([\d.]+)'/.exec(fs.readFileSync(path.join(nguon, 'helper.src.js'), 'utf8'));
if (!m) throw new Error('Không thấy số bản trong helper.src.js');
const cfg = JSON.parse(fs.readFileSync(path.join(app, 'xepgio.config.json'), 'utf8'));
const repo = /githubusercontent\.com\/([^/]+\/[^/]+)\//.exec(cfg.update || '');
const AUTO = ['xepgio-helper.js', 'Huong-dan.html'];   // các file máy ở viện tự tải khi đổi
const d = new Date(), p2 = n => String(n).padStart(2, '0');
const man = {
  version: m[1],
  date: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()),
  files: AUTO.map(n => ({ name: n, sha256: sha(path.join(app, n)) })),
  exe: { sha256: sha(exe) },
  page: repo ? 'https://github.com/' + repo[1] + '/releases/latest' : ''
};
fs.writeFileSync(path.join(app, 'version.json'), JSON.stringify(man, null, 2) + '\n');
console.log('Bản ' + man.version + ', version.json đã ghi');

// 4. gói zip: một thư mục XepGioHIS chứa đủ các file để chạy
const stage = path.join(out, 'XepGioHIS'), zip = path.join(out, 'XepGioHIS.zip');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
['XepGioHIS.exe', 'xepgio-helper.js', 'xepgio.config.json', 'version.json', 'Huong-dan.html'].forEach(n => fs.copyFileSync(path.join(app, n), path.join(stage, n)));
run('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -LiteralPath $env:XG_STAGE -DestinationPath $env:XG_ZIP -Force'], { env: Object.assign({}, process.env, { XG_STAGE: stage, XG_ZIP: zip }) });
console.log('Đã đóng gói: ' + zip + ' (' + Math.round(fs.statSync(zip).size / 1024) + ' KB)');

// 5. đẩy lên GitHub
if (process.argv.indexOf('--day') >= 0) {
  const tag = 'v' + man.version, quiet = { stdio: 'pipe' };
  run('git', ['add', '-A']);
  let changed = true;
  try { run('git', ['diff', '--cached', '--quiet'], quiet); changed = false; } catch (e) {}
  if (changed) run('git', ['commit', '-m', 'Bản ' + man.version]);
  run('git', ['push', 'origin', 'HEAD']);
  let has = true;
  try { run('gh', ['release', 'view', tag], quiet); } catch (e) { has = false; }
  if (has) run('gh', ['release', 'upload', tag, zip, '--clobber']);
  else run('gh', ['release', 'create', tag, zip, '--title', 'Bản ' + man.version, '--notes', 'Tải XepGioHIS.zip, giải nén, bấm đúp XepGioHIS.exe. Máy đã có app thì tự lấy bản này khi mở app.', '--latest']);
  console.log('Đã đẩy bản ' + man.version + ' lên GitHub');
}
