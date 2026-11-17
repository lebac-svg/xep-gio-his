// Phần của app chạy trong trang HIS. Bộ khởi động XepGioHIS.exe gắn file xepgio-helper.js (dựng từ file này bằng build.js) vào trang.
// Bản này đọc danh sách từ HIS bằng đúng các truy vấn mà màn Quản lý phẫu thuật thủ thuật vẫn dùng, gỡ xanh và điền giờ được, mỗi lượt đều phải được người dùng xác nhận.
(function () {
'use strict';
if (window.top !== window) return;                           // chỉ gắn ở khung ngoài cùng
if (window.__xepgio) return;                                 // đã gắn rồi thì thôi
const cfg0 = window.__xepgioCfg || {};
if (cfg0.host && location.hostname !== cfg0.host) return;    // chỉ chạy trên đúng địa chỉ HIS đã khai
window.__xepgio = { version: '0.18' };

/*@ENGINE*/
/*@CORE*/

const CSS = "@CSS", HTML = "@HTML";

/* ================= THỦ THUẬT MẶC ĐỊNH (Phụ lục 1, văn bản BVYDCTVP-KHTH ngày 16/3/2026) ================= */
// Đây chỉ là danh sách khởi đầu. Sau lần chạy đầu, danh sách nằm trong cài đặt và sửa được ở thẻ Cài đặt.
// kw = từ khóa trong tên dịch vụ HIS; dur = tổng thời gian; busy = thời gian người làm trực tiếp làm; cert = chứng chỉ; mk = nhóm dùng chung máy
const G = (k, code, label, kw, dur, busy, cert, mk) => ({ k, code, label, kw, dur, busy, cert, mk: mk || k });
const DEF_CERTS = [{ k: 'yhct', label: 'Y học cổ truyền' }, { k: 'phcn', label: 'Phục hồi chức năng' }];
const DEF_GROUPS = [
  { k: 'st', label: 'Sắc thuốc', kw: ['sắc thuốc'], skip: true },   // HIS tự cập nhật
  G('dc', 'ĐC', 'Điện châm', ['điện châm'], 25, 5, 'yhct'),
  G('hc', 'HC', 'Hào châm', ['hào châm'], 25, 5, 'yhct'),
  G('bt', 'BT', 'Bó thuốc', ['bó thuốc'], 30, 5, 'yhct'),
  G('dt', 'ĐT', 'Đặt thuốc', ['đặt thuốc'], 15, 5, 'yhct'),
  G('cc', 'CC', 'Cấy chỉ', ['cấy chỉ'], 30, 30, 'yhct'),
  G('gh', 'GH', 'Giác hơi', ['giác hơi'], 15, 15, 'yhct'),
  G('nt', 'NT', 'Ngâm thuốc', ['ngâm thuốc'], 15, 5, 'yhct'),
  G('tc', 'TC', 'Thủy châm', ['thủy châm', 'thuỷ châm'], 25, 10, 'yhct'),
  G('xbt', 'XT', 'Xoa bóp toàn thân', ['xoa bóp bấm huyệt toàn thân', 'xoa bóp toàn thân'], 60, 60, 'yhct'),
  G('xb', 'XB', 'Xoa bóp bấm huyệt', ['xoa bóp'], 20, 20, 'yhct'),
  G('xh', 'XH', 'Xông hơi thuốc', ['xông hơi'], 15, 5, 'yhct'),
  G('cn', 'CN', 'Cứu ngải', ['cứu ngải'], 15, 15, 'yhct'),
  G('hn', 'HN', 'Tia hồng ngoại', ['hồng ngoại'], 15, 3, 'yhct'),
  G('sn', 'SN', 'Sóng ngắn', ['sóng ngắn'], 15, 5, 'phcn'),
  G('tt', 'TT', 'Từ trường', ['từ trường'], 15, 5, 'phcn'),
  G('dp', 'ĐP', 'Điện phân dẫn thuốc', ['điện phân'], 15, 5, 'phcn'),
  G('dx', 'ĐX', 'Điện xung', ['điện xung'], 15, 5, 'phcn'),
  G('sa', 'SA', 'Siêu âm', ['siêu âm'], 15, 15, 'phcn', 'dx'),
  G('xk', 'XK', 'Sóng xung kích', ['xung kích'], 5, 5, 'phcn'),
  G('gt', 'GT', 'Dòng giao thoa', ['giao thoa'], 15, 5, 'phcn'),
  G('ln', 'LN', 'Laser nội mạch', ['laser công suất thấp nội mạch', 'laser nội mạch'], 30, 5, 'phcn'),
  G('ls', 'LS', 'Laser công suất thấp', ['laser'], 10, 10, 'phcn'),
  G('ox', 'OX', 'Oxy cao áp', ['oxy cao áp'], 60, 5, 'phcn'),
  G('kg', 'KG', 'Kéo giãn cột sống', ['kéo giãn'], 15, 5, 'phcn'),
  G('ts', 'TS', 'Tập đi thanh song song', ['thanh song song'], 15, 15, 'phcn'),
  G('tk', 'TK', 'Tập đi khung tập đi', ['khung tập đi'], 20, 20, 'phcn'),
  G('vt', 'VT', 'Tập vận động thụ động', ['vận động thụ động'], 15, 15, 'phcn'),
  G('vg', 'VG', 'Tập vận động có trợ giúp', ['vận động có trợ giúp'], 15, 15, 'phcn'),
  G('vc', 'VC', 'Tập vận động chủ động', ['vận động chủ động'], 10, 10, 'phcn'),
  G('vk', 'VK', 'Tập vận động có kháng trở', ['vận động có kháng trở'], 10, 10, 'phcn')
];

/* ================= KHUNG GIAO DIỆN TRONG TRANG HIS ================= */
const host = document.createElement('div');
host.id = 'xepgio-root';
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = '<style>' + CSS + `
:host { all: initial; }
[hidden] { display: none !important; }
.xg { font-family: var(--font); font-size: 14px; line-height: 1.5; color: var(--ink); }
.fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; padding: 8px 16px; border: 0; border-radius: 6px; background: var(--accent); color: var(--accent-ink); font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.ov { position: fixed; top: 10px; right: 10px; bottom: 10px; width: min(820px, 50vw); min-width: 420px; max-width: calc(100vw - 20px); z-index: 2147483001; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.35); display: flex; flex-direction: column; overflow: hidden; }
.ov.full { left: 10px; width: auto; }
.ov.mini { top: auto; width: 440px; min-width: 0; }
.ov.mini .ovb, .ov.mini .ovh label, .ov.mini #xgLoad, .ov.mini #xgSize { display: none; }
.ovh { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.ovh h2 { margin-right: auto; }
.ovb { flex: 1; overflow: auto; }
.wrap { padding-block: 12px 24px; }
</style>
<div class="xg">
  <button type="button" class="fab" id="xgFab">Xếp giờ</button>
  <div class="ov" id="xgOv" hidden>
    <div class="ovh">
      <h2>Xếp giờ thủ thuật</h2>
      <span class="muted" id="xgMsg"></span>
      <label for="xgDate">Ngày <input type="date" id="xgDate"></label>
      <button type="button" class="primary" id="xgLoad">Tải danh sách</button>
      <button type="button" id="xgSize">Mở rộng</button>
      <button type="button" id="xgMini">Thu gọn</button>
      <button type="button" id="xgClose">Đóng</button>
    </div>
    <div class="ovb"><div class="wrap">` + HTML + `</div></div>
  </div>
</div>`;
const $ = s => shadow.querySelector(s);

/* ================= BỘ NỐI ĐỌC SỐ LIỆU HIS THẬT ================= */
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const vn = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);          // 2026-11-17 -> 17/11/2026
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const timeOf = s => (s && s.length >= 16) ? X.toMin(s.slice(11)) : null;             // "17/11/2026 08:10:00" -> phút
const R = { tickets: [], pats: new Map(), date: iso(new Date()), loading: false };
const KEY = 'xepgio-v1';
const store = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const weekDates = () => [-1, 0, 1, 2, 3, 4, 5].map(n => addDays(R.date, n));
const onOf = lv => [[true, true], [true, false], [false, true], [false, false]][lv] || [true, true];
const lvOf = on => on[0] && on[1] ? 0 : on[0] ? 1 : on[1] ? 2 : 3;

const H = {
  get tickets() { return R.tickets; }, get pats() { return R.pats; }, get missed() { return R.missed || []; },
  now() { const t = iso(new Date()); if (R.date < t) return 1440; if (R.date > t) return -1; const d = new Date(); return d.getHours() * 60 + d.getMinutes(); },
  get dateLabel() { return vn(R.date); }, get runDate() { return R.date; }, canGo: true, canFill: true, strict: true,
  // Tự điền dần chỉ mở sau khi đã có ít nhất một ca được điền thành công trên máy này
  get noAuto() { return !store().autoOk; },
  get autoNote() { return store().autoOk ? 'Để yên thẻ này. Bạn làm việc HIS ở thẻ khác trong cùng cửa sổ; app tự điền từng ca khi qua giờ kết thúc.' : 'Tự điền dần sẽ mở sau khi lần điền đầu tiên trên máy này thành công.'; },
  savePlan(p) { try { const st = store(); st.days = st.days || {}; st.days[R.date] = Object.assign({}, st.days[R.date], { plan: p }); localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} },
  loadPlan() { return ((store().days || {})[R.date] || {}).plan || null; },
  get weekDays() { return weekDates().map(d => d.slice(8, 10) + '/' + d.slice(5, 7)); }, todayIdx: 1,
  seed: () => ({ staff: [], on: {}, week: {}, groups: DEF_GROUPS, certs: DEF_CERTS, may: {} }),
  nameOf: id => id,   // ở bản này mã nhân viên chính là họ tên ghi trên HIS
  get userHint() { return R.users ? 'Tìm trong ' + R.users.length + ' tài khoản của HIS, gõ không dấu cũng được' : 'Tải danh sách một ngày trước để lấy tài khoản từ HIS'; },
  userSearch(q) {     // tìm theo họ tên hoặc tên đăng nhập, không phân biệt dấu
    const f = fold(q);
    return (R.users || []).filter(u => fold(u.FULLNAME).indexOf(f) >= 0 || fold(u.USERNAME).indexOf(f) >= 0)
      .sort((a, b) => a.FULLNAME.localeCompare(b.FULLNAME, 'vi')).map(u => ({ id: u.FULLNAME, ten: u.FULLNAME, user: u.USERNAME || '', uid: String(u.USER_ID), nhom: nhomOf(u.CHUCDANH) }));
  },
  loadSettings() {    // cài đặt dùng chung mọi ngày; chấm công lưu theo từng ngày để đánh trước được
    const st = store(), S = st.S || null, att = st.att || {}, day = (st.days || {})[R.date] || {};
    const D = { on: {}, week: {}, note: day.note || {}, blocks: (day.blocks || []).slice(), bkSeq: (day.blocks || []).reduce((m, b) => Math.max(m, b.id), 0) };
    ((S && S.staff) || []).forEach(p => { D.week[p.id] = weekDates().map(d => (att[d] && att[d][p.id] != null) ? att[d][p.id] : 0); D.on[p.id] = onOf(D.week[p.id][1]); });
    return { S, D };
  },
  saveSettings(S, D) {
    try {
      const st = store(); st.S = S; st.att = st.att || {}; st.days = st.days || {};
      weekDates().forEach((d, i) => { st.att[d] = st.att[d] || {}; S.staff.forEach(p => { st.att[d][p.id] = i === 1 ? lvOf(D.on[p.id] || [true, true]) : (D.week[p.id] || [])[i] || 0; }); });
      st.days[R.date] = Object.assign({}, st.days[R.date], { note: D.note, blocks: D.blocks.filter(b => !b.auto) });
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch (e) {}
  },
  /* ----- điền giờ: app mở form "Cập nhật PTTT" của HIS cho từng ca, điền rồi bấm "Lưu đóng", đúng như làm tay ----- */
  fillWarn: 'App mở form "Cập nhật PTTT" của HIS cho từng ca, điền giờ, người làm, mã máy rồi bấm "Lưu đóng". Cảnh báo trùng của HIS được bấm Đồng ý và ghi vào nhật ký. HIS từ chối ca nào thì app dừng lại.',
  loadFilled() { return ((store().days || {})[R.date] || {}).filled || []; },
  onFilled(ids) { try { const st = store(); st.autoOk = true; st.days = st.days || {}; st.days[R.date] = Object.assign({}, st.days[R.date], { filled: ids }); localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} },
  async fillBegin() {   // cho lưới của HIS hiện đủ mọi phiếu của ngày chạy trên một trang, để chọn được dòng cần điền
    await query(gridBase(), 'NT.024.3.VS2', { MAUBENHPHAMID: '0', TRANGTHAI_CBOPHIEU: '' }, 1);   // thử một truy vấn nhỏ: phiên đăng nhập hết hạn thì báo ngay, không điền tiếp
    const $j = window.$, g = $j('#grdCK');
    R.keepF = { tu: $j('#txtTUNGAY').val(), den: $j('#txtDENNGAY').val(), tt: $j('#cboTRANGTHAIPHIEU').val(), rowNum: g.jqGrid('getGridParam', 'rowNum') };
    g.jqGrid('setGridParam', { rowNum: 3000 });
    await hisSearch(vn(R.date), vn(R.date), '');
  },
  async fillEnd() { if (formsOpen()) { closeForm(); await waitFor(() => !formsOpen(), 8000); } if (R.keepF) { const k = R.keepF; R.keepF = null; window.$('#grdCK').jqGrid('setGridParam', { rowNum: k.rowNum }); await hisSearch(k.tu, k.den, k.tt); } },
  afterFill(note) { setTimeout(refreshDay, 200); },   // đọc lại từ HIS để số liệu trên app khớp, giữ nguyên bảng giờ các ca chưa điền
  // Mở form "Cập nhật PTTT" của HIS cho một ca. Trả về '' nếu mở được, hoặc lý do không mở được.
  async openForm(t) {
    const $j = window.$, g = $j('#grdCK'), dg = $j('#grdCKChitiet'), mbp = String(t.ref.MAUBENHPHAMID), dv = String(t.ref.DICHVUKHAMBENHID);
    const row = findRow(mbp);
    if (!row) return 'không thấy phiếu ' + t.soPhieu + ' trên lưới của HIS';
    closeAlert();
    if (formsOpen()) { closeForm(); await waitFor(() => !formsOpen(), 8000); }   // không để sót form nào đang mở
    markOldForms();                                                      // đánh dấu khung của các lần mở trước, để biết form mới đã nạp
    const findDv = () => { const ids = dg.jqGrid('getDataIDs'); for (let i = 0; i < ids.length; i++) if (String(dg.jqGrid('getRowData', ids[i]).DICHVUKHAMBENHID) === dv) return ids[i]; return null; };
    g.jqGrid('setSelection', row, true);                                 // chọn phiếu, HIS tải dịch vụ của phiếu
    await waitFor(() => idle('load_grdCKChitiet') && findDv(), 8000);
    const drow = findDv();
    if (!drow) return 'không thấy dịch vụ trong phiếu ' + t.soPhieu;
    dg.jqGrid('setSelection', drow, true);
    $j('#toolbarIdbtnUpdatePttt').trigger('click');                     // nút "Cập nhật PTTT"
    await waitFor(() => alertText() !== '' || formReady(), 20000);
    if (alertText()) { const m = alertText(); closeAlert(); return 'HIS báo: ' + m; }
    if (!formReady()) { closeForm(); return 'form Cập nhật PTTT không mở'; }
    // chờ form tự nạp xong: các ô giờ, người làm, danh sách máy đứng yên qua ba lần xem liên tiếp
    const snap = () => { const d = formDoc(); return d ? ['txtNGAYPHAUTHUATTHUTHUAT', 'txtKETTHUCPTTT_DKLCI', 'cboPHAUTHUATVIEN', 'cboMAMAY'].map(id => { const e = d.getElementById(id); return e ? e.value + '/' + (e.options ? e.options.length : '') : ''; }).join('|') : ''; };
    let last = snap(), same = 0;
    for (let i = 0; i < 40 && same < 3; i++) { await sleep(120); const s = snap(); if (s === last) same++; else { same = 0; last = s; } }
    return '';
  },
  // Đọc danh sách mã máy mà HIS cho chọn ở form của từng thủ thuật; form được đóng lại, không lưu
  async fetchMachines(probes) {
    const out = {};
    await H.fillBegin();
    try {
      for (const p of probes) {
        const why = await H.openForm(p.t);
        if (why) continue;
        const m = formDoc().getElementById('cboMAMAY');
        const codes = m ? Array.from(m.options).map(o => o.value).filter(v => v && v !== '-1') : [];
        if (codes.length) out[p.mk] = codes;
        closeForm(); await waitFor(() => !formsOpen(), 8000);
      }
    } finally { await H.fillEnd(); }
    return out;
  },
  async fill(t, r, opt) {
    opt = opt || {};
    const st = core.staffById(r.perf);
    if (!st || !st.uid) return { ok: false, skip: true, err: 'chưa có tài khoản HIS của người làm ' + core.staffName(r.perf) };
    const mbp = String(t.ref.MAUBENHPHAMID), dv = String(t.ref.DICHVUKHAMBENHID);
    const why = await H.openForm(t);
    if (why) return { ok: false, err: why };
    const d = formDoc(), $f = formWin().$, day = vn(R.date), fmt = m => day + ' ' + X.toHM(m) + ':00';
    let warned = 0;
    const pop = async () => {   // cảnh báo trùng của HIS (dạng hỏi lại) thì bấm Đồng ý; thông báo dạng báo lỗi thì trả về nội dung
      let quiet = 0, bad = '';
      for (let i = 0; i < 80 && quiet < 3 && !bad; i++) {
        await sleep(80);
        const a = alertIn(d);
        if (!a) { quiet++; continue; }
        quiet = 0;
        if (/alertify-confirm/.test(a.className)) warned++; else bad = ((a.querySelector('.alertify-message') || a).textContent || '').trim();
        const b = d.getElementById('alertify-ok'); if (b) b.click();
        await sleep(150);
      }
      return bad;
    };
    const quit = (err, extra) => { closeForm(); return Object.assign({ ok: false, warned, err }, extra || {}); };
    $f('#txtTHOIGIAN_PTTT').val(String(r.e - r.s));
    $f('#cboPHAUTHUATVIEN').empty().append($f('<option>').val(st.uid).text(st.ten));   // người thực hiện chính
    $f('#txtNGAYPHAUTHUATTHUTHUAT').val(fmt(r.s)).trigger('change');
    let bad = await pop(); if (bad) return quit('HIS báo: ' + bad);
    $f('#txtKETTHUCPTTT_DKLCI').val(fmt(r.e)).trigger('change');
    bad = await pop(); if (bad) return quit('HIS báo: ' + bad);
    if (r.may) {
      const m = d.getElementById('cboMAMAY');
      if (!m || !Array.from(m.options).some(o => o.value === r.may)) return quit('mã máy ' + r.may + ' không có trong danh sách của HIS cho dịch vụ này');
      $f('#cboMAMAY').val(r.may).trigger('change');
      bad = await pop(); if (bad) return quit('HIS báo: ' + bad);
    }
    // đọc lại các ô trước khi lưu: phải đúng giá trị định điền
    if ($f('#txtNGAYPHAUTHUATTHUTHUAT').val() !== fmt(r.s) || $f('#txtKETTHUCPTTT_DKLCI').val() !== fmt(r.e) || String($f('#cboPHAUTHUATVIEN').val()) !== String(st.uid) || (r.may && $f('#cboMAMAY').val() !== r.may))
      return quit('form của HIS không nhận đúng giá trị định điền');
    if (opt.dry) return quit('chạy thử, không lưu', { skip: true, dryOk: true });
    $f('#btnLuuDong').trigger('click');                                  // nút "Lưu đóng"
    let done = ''; bad = '';
    for (let i = 0; i < 300 && !done && !bad; i++) {                     // chờ HIS báo kết quả, tối đa khoảng 25 giây
      await sleep(80);
      const top = alertText();
      if (top) { if (/thành công/i.test(top)) done = top; else bad = top; closeAlert(); break; }
      const a = formDoc() && alertIn(formDoc());
      if (a) { if (/alertify-confirm/.test(a.className)) warned++; else bad = ((a.querySelector('.alertify-message') || a).textContent || '').trim(); const b = formDoc().getElementById('alertify-ok'); if (b) b.click(); await sleep(150); continue; }
      const okb = formDoc() && formDoc().getElementById('btn_OK');
      if (okb && okb.getClientRects().length) { warned++; okb.click(); await sleep(150); }   // hộp cảnh báo trùng lúc lưu: bấm OK để lưu tiếp
    }
    if (!done) return quit(bad ? 'HIS báo: ' + bad : 'HIS không báo kết quả sau khi bấm Lưu đóng');
    await sleep(200); await waitFor(() => idle('load_grdCK'), 20000); await sleep(150);
    // đọc lại dịch vụ từ HIS: giờ đã lưu phải đúng giờ định điền
    try {
      const det = await query(gridBase(), 'NT.024.3.VS2', { MAUBENHPHAMID: mbp, TRANGTHAI_CBOPHIEU: '' }, 100), x = det.find(o => String(o.DICHVUKHAMBENHID) === dv);
      if (!x || timeOf(x.NGAYPHAUTHUATTHUTHUAT) !== r.s || timeOf(x.KETTHUCPTTT) !== r.e) return { ok: false, warned, err: 'HIS báo lưu thành công nhưng đọc lại giờ không khớp' };
    } catch (e) { return { ok: false, warned, err: 'đã bấm lưu nhưng không đọc lại được từ HIS để kiểm tra' }; }
    Object.assign(t, { tt: 3, vet: false, s: r.s, e: r.e, perf: r.perf, may: r.may || null });
    return { ok: true, warned };
  },

  /* ----- gỡ xanh: app làm đúng các bước bạn làm tay trên màn Quản lý phẫu thuật thủ thuật ----- */
  goKey: t => String(t.ref.MAUBENHPHAMID),
  goWarn: 'App chọn từng phiếu trên lưới của HIS rồi bấm mục "Gỡ hoàn thành phiếu", đúng như bạn bấm chuột phải. Mọi phiếu đang xanh của ngày đều bị gỡ (trừ sắc thuốc), kể cả phiếu đã cập nhật đúng, nên chỉ dùng trước khi cập nhật thủ thuật của ngày đó. Phiếu đã gỡ vẫn giữ giờ và người làm cũ.',
  async goBegin() {   // nhớ bộ lọc đang đặt trên HIS, rồi lọc danh sách về đúng ngày chạy và trạng thái Đã hoàn thành
    gridBase();
    if (!document.getElementById('GoHoanThanhPhieu')) throw new Error('không thấy mục Gỡ hoàn thành phiếu trong menu của HIS');
    const $j = window.$;
    R.keep = { tu: $j('#txtTUNGAY').val(), den: $j('#txtDENNGAY').val(), tt: $j('#cboTRANGTHAIPHIEU').val() };
    await hisSearch(vn(R.date), vn(R.date), '3');
  },
  async go(t) {
    const $j = window.$, g = $j('#grdCK'), mbp = String(t.ref.MAUBENHPHAMID);
    let row = findRow(mbp);
    if (!row) { await hisSearch(vn(R.date), vn(R.date), '3'); row = findRow(mbp); }
    if (!row) return { ok: false, err: 'không thấy phiếu ' + t.soPhieu + ' trong danh sách Đã hoàn thành của HIS' };
    g.jqGrid('setSelection', row, true);                               // chọn dòng phiếu, HIS tự tải dịch vụ của phiếu đó
    await sleep(250); await waitFor(() => idle('load_grdCKChitiet'), 8000);
    if (String(g.jqGrid('getGridParam', 'selrow')) !== String(row)) return { ok: false, err: 'không chọn được phiếu ' + t.soPhieu + ' trên lưới của HIS' };
    closeAlert();
    $j('#GoHoanThanhPhieu').trigger('click');                          // mục "Gỡ hoàn thành phiếu" của menu chuột phải
    await waitFor(() => alertText() !== '', 8000);
    const msg = alertText(); closeAlert();
    await sleep(300); await waitFor(() => idle('load_grdCK'), 20000); await sleep(600);   // chờ HIS tải lại danh sách; mục menu cần nghỉ hơn nửa giây giữa hai lần bấm
    if (!/thành công/i.test(msg)) return { ok: false, err: msg ? 'HIS báo: ' + msg : 'HIS không báo kết quả cho phiếu ' + t.soPhieu };
    R.tickets.forEach(x => { if (String(x.ref.MAUBENHPHAMID) === mbp) { x.tt = 2; x.vet = x.s != null; } });
    return { ok: true };
  },
  async goEnd() { if (R.keep) { const k = R.keep; R.keep = null; await hisSearch(k.tu, k.den, k.tt); } },   // trả bộ lọc của HIS về như trước
  afterGo(note) { R.note = note; setTimeout(loadDay, 200); }   // tải lại danh sách từ HIS để số liệu trên app khớp với HIS
};
// Số phút còn lại của phiên đăng nhập HIS (HIS cấp phiên 4 giờ mỗi lần trang được tải)
const tokenLeftMin = () => { try { const o = JSON.parse(atob(window.jsonrpc.AjaxJson.uuid.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return Math.round((o.exp * 1000 - Date.now()) / 60000); } catch (e) { return null; } };
// Chốt giữa các thẻ: chỉ thẻ đang giữ chốt mới chạy tự điền
const TAB = Math.random().toString(36).slice(2);
function holdLock() { try { const l = JSON.parse(localStorage.getItem('xepgio-lock') || 'null'); if (l && l.id !== TAB && Date.now() - l.t < 75000) return false; localStorage.setItem('xepgio-lock', JSON.stringify({ id: TAB, t: Date.now() })); return true; } catch (e) { return true; } }
const otherHolds = () => { try { const l = JSON.parse(localStorage.getItem('xepgio-lock') || 'null'); return !!(l && l.id !== TAB && Date.now() - l.t < 75000); } catch (e) { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (cond, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(60); } return false; };
const idle = id => { const l = document.getElementById(id); return !l || getComputedStyle(l).display === 'none'; };   // lưới của HIS không còn đang tải
async function hisSearch(tu, den, tt) { const $j = window.$; $j('#txtTUNGAY').val(tu); $j('#txtDENNGAY').val(den); $j('#cboTRANGTHAIPHIEU').val(tt); $j('#btnTIMKIEM').click(); await sleep(300); await waitFor(() => idle('load_grdCK'), 20000); await sleep(200); }
function findRow(mbp) { const g = window.$('#grdCK'), ids = g.jqGrid('getDataIDs'); for (let i = 0; i < ids.length; i++) if (String(g.jqGrid('getRowData', ids[i]).MAUBENHPHAMID) === mbp) return ids[i]; return null; }
// HIS để lại khung của các lần mở form trước (đã ẩn) với cùng một mã, nên phải tìm đúng khung đang hiện và mới nạp
const formFrames = () => Array.from(document.querySelectorAll('iframe')).filter(f => f.id === 'dlgPTTTifmView');
const frameDoc = f => { try { return f.contentDocument; } catch (e) { return null; } };
const formFrame = () => formFrames().filter(f => f.getClientRects().length && frameDoc(f) && !frameDoc(f).__xgOld).pop() || null;
const formDoc = () => { const f = formFrame(); return f ? frameDoc(f) : null; };
const formWin = () => { const f = formFrame(); return f ? f.contentWindow : null; };
const formReady = () => { const d = formDoc(); return !!(d && d.readyState === 'complete' && d.getElementById('txtNGAYPHAUTHUATTHUTHUAT') && d.getElementById('btnLuuDong') && formWin().$); };
const markOldForms = () => formFrames().forEach(f => { const d = frameDoc(f); if (d) d.__xgOld = true; });
const formsOpen = () => formFrames().filter(f => f.getClientRects().length).length;
const closeForm = () => { formFrames().filter(f => f.getClientRects().length).forEach(f => { const w = f.closest('.jBox-wrapper'), x = w && w.querySelector('.jBox-closeButton'); if (x) x.click(); }); try { if (formsOpen()) window.DlgUtil.close('dlgPTTT'); } catch (e) {} };   // đóng mọi form đang mở, không lưu
const alertIn = doc => { const a = doc.getElementById('alertify'); if (!a || /alertify-(hide|hidden)/.test(a.className)) return null; const cs = doc.defaultView.getComputedStyle(a); return cs.display === 'none' || cs.visibility === 'hidden' ? null : a; };
const alertEl = () => { const a = document.getElementById('alertify'); if (!a || /alertify-(hide|hidden)/.test(a.className)) return null; const cs = getComputedStyle(a); return cs.display === 'none' || cs.visibility === 'hidden' ? null : a; };
const alertText = () => { const a = alertEl(); return a ? ((a.querySelector('.alertify-message') || a).textContent || '').trim() : ''; };
const closeAlert = () => { const b = document.getElementById('alertify-ok'); if (alertEl() && b) b.click(); };
const core = XepGioCore(H, $);

// Địa chỉ và bộ lọc lấy từ chính lưới phiếu của màn Quản lý phẫu thuật thủ thuật (khoa, phòng thực hiện, mã phiên)
function gridBase() {
  let url = '';
  try { url = window.$('#grdCK').jqGrid('getGridParam', 'url') || ''; } catch (e) {}
  if (!url) throw new Error('Hãy mở Nội trú › Quản lý phẫu thuật thủ thuật, chờ danh sách phiếu hiện ra rồi bấm Tải danh sách.');
  const u = new URL(url, location.href), pd = JSON.parse(u.searchParams.get('postData'));
  return { rest: u.origin + u.pathname, uuid: pd.uuid, filter: pd.options[0].value };
}
async function query(base, sql, value, rows) {
  const pd = { func: 'ajaxExecuteQueryPaging', uuid: base.uuid, params: [sql], options: [{ name: '[0]', value }] };
  const url = base.rest + '?postData=' + encodeURIComponent(JSON.stringify(pd)) + '&_search=false&nd=' + Date.now() + '&rows=' + (rows || 500) + '&page=1&sidx=&sord=asc';
  const rs = await fetch(url, { credentials: 'same-origin' });
  let js; try { js = await rs.json(); } catch (e) { throw new Error('HIS không trả về dữ liệu. Có thể phiên đăng nhập đã hết, hãy đăng nhập lại.'); }
  return js.rows || [];
}
const setMsg = s => { $('#xgMsg').textContent = s; };

// Danh sách tài khoản nhân viên, lấy bằng đúng truy vấn mà ô "Người thực hiện" của form Cập nhật PTTT dùng (bệnh viện này cấu hình là PTTT.LOAD_USERID).
const SQL_USER = 'PTTT.LOAD_USERID';
async function loadUsers(base) {
  const pd = { func: 'ajaxExecuteQueryPaging', uuid: base.uuid, params: [SQL_USER], options: [{ name: '[0]', value: 1 }, { name: '[1]', value: String(base.filter.KHOATHUCHIENID || '-1') }] };
  const rs = await fetch(base.rest + '?func=doComboGrid&postData=' + encodeURIComponent(JSON.stringify(pd)) + '&searchTerm=&rows=2000&page=1', { credentials: 'same-origin' });
  const js = await rs.json();
  return (js.rows || []).filter(u => u.FULLNAME);
}
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const nhomOf = c => /bác s[ĩỹ]/i.test(c || '') ? 'Bác sĩ' : /điều dưỡng/i.test(c || '') ? 'Điều dưỡng' : /kỹ thuật/i.test(c || '') ? 'Kỹ thuật viên' : String(c || '').split(/[-\/,]/)[0].trim();
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();   // bỏ dấu để tìm tên

async function refreshDay() {   // đọc lại ngày đang chạy từ HIS mà không xóa bảng giờ đang có trên app
  if (R.loading || core.App.running || !R.tickets.length) return;
  R.loading = true; $('#xgLoad').disabled = true;
  try { const x = await fetchDay(R.date); R.tickets = x.tickets; R.pats = x.pats; core.changed(); setMsg('Ngày ' + vn(R.date) + ': ' + x.tickets.length + ' thủ thuật'); }
  catch (e) { setMsg(e.message || String(e)); }
  R.loading = false; $('#xgLoad').disabled = false;
}
async function loadDay() {
  if (R.loading || core.App.running) return;
  const date = $('#xgDate').value;
  if (!date) { setMsg('Chưa chọn ngày.'); return; }
  R.loading = true; $('#xgLoad').disabled = true;
  try {
    const d = vn(date), got = await fetchDay(date), tickets = got.tickets, pats = got.pats, list = got.list;
    R.tickets = tickets; R.pats = pats; R.date = date;
    core.boot(false);
    const learned = learn(); core.persist(); core.renderAll();
    learned.forEach(m => core.log(m));
    core.log('Đã tải ngày ' + d + ': ' + list.length + ' phiếu, ' + tickets.length + ' thủ thuật của ' + pats.size + ' người bệnh; ' + Array.from(pats.values()).filter(p => p.vao != null).length + ' người bệnh mới vào trong ngày.');
    const none = tickets.filter(t => !core.groupOf(t.ten));
    if (none.length) core.log('Có ' + none.length + ' ca thuộc thủ thuật chưa có quy tắc thời gian: ' + Array.from(new Set(none.map(t => t.ten))).join('; '));
    core.runCheck();
    if (R.note) { core.log(R.note); R.note = ''; }
    setMsg('Ngày ' + d + ': ' + tickets.length + ' thủ thuật');
    loadMissed(date);
  } catch (e) { setMsg(e.message || String(e)); }
  R.loading = false; $('#xgLoad').disabled = false;
}
// Phiếu sót: phiếu của 7 ngày trước ngày chạy vẫn còn ở trạng thái "Đã gửi phiếu"
async function loadMissed(date) {
  R.missed = [];
  try {
    const base = gridBase();
    const list = await query(base, 'NT.049.DSPHIEUCK', Object.assign({}, base.filter, { TUNGAY: vn(addDays(date, -7)), DENNGAY: vn(addDays(date, -1)), TRANGTHAIPHIEU: '2' }), 2000);
    const out = [];
    for (const tk of list.slice(0, 300)) {
      const det = await query(base, 'NT.024.3.VS2', { MAUBENHPHAMID: String(tk.MAUBENHPHAMID), TRANGTHAI_CBOPHIEU: '' }, 100);
      det.forEach(x => { const g = core.groupOf(x.TENDICHVU); if (g && g.skip) return; out.push({ ngay: (tk.NGAYMAUBENHPHAM || '').slice(0, 10), tenBN: tk.TENBENHNHAN, maBA: tk.MABENHAN, ten: x.TENDICHVU, bs: tk.NGUOITAO, cu: !!x.NGAYPHAUTHUATTHUTHUAT }); });
    }
    if (R.date !== date) return;
    R.missed = out; core.renderAll();
    if (out.length) core.log('Có ' + out.length + ' thủ thuật của 7 ngày trước chưa được cập nhật, xem bảng Phiếu sót.');
  } catch (e) {}
}
async function fetchDay(date) {
  {
    const base = gridBase(), d = vn(date);
    if (!R.users) { try { R.users = await loadUsers(base); } catch (e) { R.users = null; } }
    setMsg('Đang tải danh sách phiếu ngày ' + d + '...');
    const list = (await query(base, 'NT.049.DSPHIEUCK', Object.assign({}, base.filter, { TUNGAY: d, DENNGAY: d, TRANGTHAIPHIEU: '-1' }), 5000)).filter(t => String(t.TRANGTHAIMAUBENHPHAM) !== '1');
    const tickets = [], pats = new Map(); let done = 0, i = 0, err = 0;
    const worker = async () => {
      while (i < list.length) {
        const tk = list[i++];
        try {
          const det = await query(base, 'NT.024.3.VS2', { MAUBENHPHAMID: String(tk.MAUBENHPHAMID), TRANGTHAI_CBOPHIEU: '' }, 100);
          const bn = String(tk.BENHNHANID);
          if (!pats.has(bn)) { const v = tk.THOIGIANVAOVIEN || ''; pats.set(bn, { bn, ten: tk.TENBENHNHAN, maBA: tk.MABENHAN, bsId: tk.NGUOITAO || null, vao: v.slice(0, 10) === d ? timeOf(v) : null }); }
          det.forEach(x => {
            let s = timeOf(x.NGAYPHAUTHUATTHUTHUAT), e = timeOf(x.KETTHUCPTTT);
            if (s == null || e == null || e <= s) { s = null; e = null; }
            const green = String(tk.TRANGTHAIMAUBENHPHAM) === '3' && s != null;
            tickets.push({ id: String(x.DICHVUKHAMBENHID), soPhieu: tk.SOPHIEU, maBA: tk.MABENHAN, tenBN: tk.TENBENHNHAN, bn, bsId: tk.NGUOITAO || null, cd: timeOf(tk.NGAYMAUBENHPHAM) || 0, ten: x.TENDICHVU,
              tt: green ? 3 : 2, vet: !green && s != null, perf: x.PHAUTHUATVIEN || null, s, e, may: x.MAMAY && x.MAMAY !== '-1' ? x.MAMAY : null, auto: false,
              ref: { MAUBENHPHAMID: tk.MAUBENHPHAMID, DICHVUKHAMBENHID: x.DICHVUKHAMBENHID, KHAMBENHID: tk.KHAMBENHID, HOSOBENHANID: tk.HOSOBENHANID, TIEPNHANID: tk.TIEPNHANID, PHAUTHUATTHUTHUATID: x.PHAUTHUATTHUTHUATID, FLAG_CA: x.FLAG_CA } });
          });
        } catch (e) { err++; }
        done++; if (done % 10 === 0) setMsg('Đang tải chi tiết: ' + done + '/' + list.length + ' phiếu');
      }
    };
    await Promise.all([1, 2, 3, 4, 5].map(worker));
    if (err) throw new Error('Có ' + err + ' phiếu không tải được chi tiết. Bấm Tải danh sách lần nữa.');
    return { tickets, pats, list };
  }
}

// Rút từ số liệu vừa tải: tên người làm, bác sĩ chỉ định và mã máy đã dùng; đưa vào cài đặt để lần sau có sẵn.
function learn() {
  const S = core.S, msgs = [], have = new Set(S.staff.map(p => p.id)), gone = new Set(S.gone || []), fresh = [];
  const add = (name, nhom) => { if (!name || have.has(name) || gone.has(name)) return; const p = { id: name, user: '', ten: name, nhom, can: {}, prio: {}, cc: {} }; S.staff.push(p); core.ensureStaff(p); have.add(name); fresh.push(name); };
  R.pats.forEach(p => add(p.bsId, 'Bác sĩ'));
  R.tickets.forEach(t => {
    const g = core.groupOf(t.ten);
    if (!g || g.skip) return;
    if (t.perf) { add(t.perf, ''); if (fresh.indexOf(t.perf) >= 0) { const p = S.staff.find(x => x.id === t.perf); p.can[g.k] = true; if (p.cc[g.cert]) p.cc[g.cert].co = true; } }   // người mới: tạm tích các thủ thuật họ đã đứng tên
    if (t.may) { const key = g.mk || g.k, a = S.may[key] = S.may[key] || []; if (a.indexOf(t.may) < 0) { a.push(t.may); a.sort(); } }   // thủ thuật có mã máy trên HIS thì coi là cần máy
  });
  // Ghép với tài khoản HIS theo họ tên: lấy tên đăng nhập, mã nhân viên (dùng khi điền) và nhóm chức danh
  const byName = new Map(); (R.users || []).forEach(u => { const k = norm(u.FULLNAME); byName.set(k, byName.has(k) ? null : u); });
  const miss = [], amb = [];
  S.staff.forEach(p => {
    if (p.uid) return;   // đã có tài khoản (tự ghép hoặc do người dùng chọn) thì giữ nguyên
    const u = byName.get(norm(p.id));
    if (u) { p.user = u.USERNAME || ''; p.uid = String(u.USER_ID); if (!p.nhom) p.nhom = nhomOf(u.CHUCDANH); } else if (u === null) amb.push(p.ten); else if (R.users) miss.push(p.ten);
  });
  if (fresh.length) msgs.push('Đã thêm ' + fresh.length + ' người vào bảng nhân viên theo số liệu HIS: ' + fresh.join(', ') + '. Hãy xem lại bảng chứng chỉ ở thẻ Cài đặt.');
  if (!R.users) msgs.push('Chưa lấy được danh sách tài khoản từ HIS, nên bảng nhân viên chưa có tên đăng nhập.');
  if (miss.length) msgs.push('Không thấy tài khoản HIS trùng họ tên với: ' + miss.join(', ') + '.');
  if (amb.length) msgs.push('Có hai tài khoản HIS cùng họ tên, chưa xác định được tài khoản của: ' + amb.join(', ') + '. Vào Chấm công, bấm Cập nhật danh sách, gõ tên rồi chọn đúng tài khoản.');
  return msgs;
}

/* ================= GẮN VÀO TRANG ================= */
function mount() {
  if (!document.body || host.parentNode) return;
  document.body.appendChild(host);
  $('#xgDate').value = R.date;
  core.boot(false); core.showTab('run');
  $('#xgFab').addEventListener('click', () => { $('#xgOv').hidden = false; $('#xgFab').hidden = true; if (!R.tickets.length) setMsg('Chọn ngày rồi bấm Tải danh sách.'); });
  $('#xgClose').addEventListener('click', () => { $('#xgOv').hidden = true; $('#xgFab').hidden = false; });
  $('#xgLoad').addEventListener('click', loadDay);
  // Cỡ của bảng app: nửa phải màn hình (mặc định, để vẫn thấy HIS bên trái), toàn màn hình, hoặc thu gọn thành một thanh ở góc
  const ui = (() => { try { return JSON.parse(localStorage.getItem('xepgio-ui') || '{}'); } catch (e) { return {}; } })();
  const applyUi = () => {
    const ov = $('#xgOv'); ov.classList.toggle('full', !!ui.full && !ui.mini); ov.classList.toggle('mini', !!ui.mini);
    $('#xgSize').textContent = ui.full ? 'Thu hẹp' : 'Mở rộng'; $('#xgMini').textContent = ui.mini ? 'Mở lại' : 'Thu gọn';
    try { localStorage.setItem('xepgio-ui', JSON.stringify(ui)); } catch (e) {}
  };
  $('#xgSize').addEventListener('click', () => { ui.full = !ui.full; applyUi(); core.renderAll(); });
  $('#xgMini').addEventListener('click', () => { ui.mini = !ui.mini; applyUi(); });
  applyUi();
  // Mỗi nửa phút: ca nào vừa qua giờ kết thúc thì điền (nếu đang bật tự điền), và ghi số ca còn chờ lên tên thẻ trình duyệt
  const title0 = document.title;
  setInterval(() => {
    try {
      const left = Array.from(core.App.plan.values()).filter(r => r.status === 'planned').length;
      const autoOn = !H.noAuto && $('#autoFill').checked && R.date === iso(new Date()) && left > 0;
      if (autoOn && !R.loading && !core.App.running && holdLock()) {
        const m = tokenLeftMin(), st = store();
        if (m != null && m < 20 && Date.now() - (st.lastReload || 0) > 10 * 60000) {
          // Phiên đăng nhập sắp hết hạn: tải lại trang HIS để được cấp phiên mới, rồi app tự tải lại danh sách và chạy tiếp
          st.lastReload = Date.now(); st.resume = { date: R.date, t: Date.now() };
          localStorage.setItem(KEY, JSON.stringify(st)); location.reload(); return;
        }
        if (!st.live || st.live.date !== R.date) { st.live = { date: R.date }; localStorage.setItem(KEY, JSON.stringify(st)); }   // ghi nhớ: hôm nay app đang chạy tự điền
        core.tick();
      }
      if (!left && R.tickets.length && store().live) { const st = store(); delete st.live; localStorage.setItem(KEY, JSON.stringify(st)); }   // đã điền hết: thôi ghi nhớ
      document.title = autoOn ? 'Xếp giờ đang chạy, còn ' + left + ' ca · ' + title0 : title0;
    } catch (e) {}
  }, 30000);
  // Vừa tải lại trang để giữ phiên: chờ lưới của HIS sẵn sàng rồi tải lại danh sách của ngày đang chạy
  const rs = store().resume;
  if (rs) {
    try { const st = store(); delete st.resume; localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    if (Date.now() - rs.t < 10 * 60000) (async () => {
      const ok = await waitFor(() => { try { gridBase(); return true; } catch (e) { return false; } }, 90000);
      if (!ok) return;
      $('#xgDate').value = rs.date; await loadDay();
      core.log('Đã tải lại trang HIS để giữ phiên đăng nhập, app chạy tiếp theo bảng giờ đã xếp.');
    })();
  } else {
    // Thẻ này vừa mở màn Quản lý PTTT trong lúc hôm nay app đang chạy dở: nếu không có thẻ nào khác đang chạy thì thẻ này chạy tiếp
    const lv = store().live;
    if (lv && lv.date === iso(new Date()) && !H.noAuto && !otherHolds()) (async () => {
      const ok = await waitFor(() => { try { gridBase(); return true; } catch (e) { return false; } }, 90000);
      if (!ok || otherHolds()) return;
      $('#xgDate').value = lv.date; await loadDay();
      core.log('App tự chạy tiếp theo bảng giờ đã xếp hôm nay.');
    })();
  }
}
window.__xepgioRemove = function () {   // bộ khởi động gọi khi người dùng tắt app
  if (host.parentNode) host.parentNode.removeChild(host);
  try { delete window.__xepgio; delete window.__xepgioRemove; } catch (e) { window.__xepgio = undefined; }
};
window.__xepgio.core = core; window.__xepgio.H = H;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
