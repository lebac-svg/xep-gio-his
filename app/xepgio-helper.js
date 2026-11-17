// Phần của app chạy trong trang HIS. Bộ khởi động XepGioHIS.exe gắn file xepgio-helper.js (dựng từ file này bằng build.js) vào trang.
// Bản này đọc danh sách từ HIS bằng đúng các truy vấn mà màn Quản lý phẫu thuật thủ thuật vẫn dùng, gỡ xanh và điền giờ được, mỗi lượt đều phải được người dùng xác nhận.
(function () {
'use strict';
if (window.top !== window) return;                           // chỉ gắn ở khung ngoài cùng
if (window.__xepgio) return;                                 // đã gắn rồi thì thôi
const cfg0 = window.__xepgioCfg || {};
if (cfg0.host && location.hostname !== cfg0.host) return;    // chỉ chạy trên đúng địa chỉ HIS đã khai
window.__xepgio = { version: '0.26' };

const X = (function () {
  const toMin = s => { const m = /(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const toHM = n => n == null ? '' : String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const rank = (st, gk) => (st.prio && st.prio[gk]) || 2;

  // Sổ ghi các khoảng đã bận của người làm (P:), người bệnh (B:), máy (M:). Khoảng chặn không cộng thêm thời gian nghỉ.
  function makeBook(blocks) {
    const book = new Map();
    const get = k => { let v = book.get(k); if (!v) book.set(k, v = []); return v; };
    const bk = {
      clash: (k, s, e, gap) => get(k).some(iv => { const g = iv[2] ? 0 : gap; return s < iv[1] + g && iv[0] < e + g; }),
      add: (k, s, e, isBlock) => { get(k).push([s, e, isBlock ? 1 : 0]); }
    };
    (blocks || []).forEach(b => bk.add((b.kind === 'perf' ? 'P:' : 'B:') + b.who, b.s, b.e, true));
    return bk;
  }

  // Giờ sớm nhất một người làm nhận được ca t. Người làm chỉ bận phần trực tiếp làm (busy), người bệnh và máy bận cả ca.
  function earliest(t, st, cfg, bk, relax) {
    relax = relax || {};
    const idx = cfg.shifts.map((_, i) => i);
    const want = t.hold != null ? t.hold : cfg.spread ? t.pref : null;   // hold: buổi mà ca đã làm, ưu tiên hơn gợi ý chia buổi
    if (want != null) idx.sort((a, b) => (a === want ? 0 : 1) - (b === want ? 0 : 1) || a - b);
    for (const i of idx) {
      if (!st.on[i]) continue;
      const a = cfg.shifts[i][0], b = cfg.shifts[i][1];
      for (let s = Math.max(a, (t.order || 0) + cfg.lead); s + t.dur <= b; s++) {
        if (!relax.perf && bk.clash('P:' + st.id, s, s + t.busy, cfg.gapPerf)) continue;
        if (!relax.bn && bk.clash('B:' + t.bn, s, s + t.dur, cfg.gapBn)) continue;
        let may = null;
        if (t.machines && !relax.may) { may = t.machines.find(m => !bk.clash('M:' + m, s, s + t.dur, cfg.gapMay)); if (!may) continue; }
        return { s, may, shift: i };
      }
    }
    return null;
  }
  const cands = (t, staff) => t.pinPerf ? staff.filter(x => x.id === t.pinPerf) : staff.filter(st => st.can[t.gk]);

  // Lý do một ca không xếp được, để người dùng biết phải gỡ ở đâu.
  function explain(t, staff, cfg, bk) {
    const all = cands(t, staff);
    if (!all.length) return 'Không ai có chứng chỉ còn hạn cho thủ thuật này';
    const on = all.filter(st => st.on.some(Boolean));
    if (!on.length) return t.pinPerf ? 'Người làm đã chọn không đi làm hôm nay' : 'Người có chứng chỉ đều nghỉ hôm nay';
    if (t.machines && !t.machines.length) return 'Không có máy nào dùng được hôm nay';
    const lastEnd = Math.max.apply(null, cfg.shifts.map(x => x[1]));
    if ((t.order || 0) + cfg.lead + t.dur > lastEnd) return 'Chỉ định lúc ' + toHM(t.order) + ', không kịp xong trước ' + toHM(lastEnd);
    const can = r => on.some(st => earliest(t, st, cfg, bk, r));
    if (can({ bn: true })) return 'Người bệnh không còn khoảng trống phù hợp';
    if (can({ may: true })) return 'Máy đã kín lịch';
    if (can({ perf: true })) return 'Người làm có chứng chỉ đã kín lịch';
    return 'Người bệnh, người làm và máy đều kín lịch';
  }

  function pass(tasks, staff, cfg, blocks) {
    const bk = makeBook(blocks), out = new Map(), load = {};
    const put = (t, perf, s, e, busyEnd, may) => {
      if (perf) { bk.add('P:' + perf, s, busyEnd); load[perf] = (load[perf] || 0) + (busyEnd - s); }
      bk.add('B:' + t.bn, s, e); if (may) bk.add('M:' + may, s, e);
    };
    tasks.forEach(t => {
      if (!t.fixed) return; const f = t.fixed;
      put(t, f.perf, f.s, f.e, Math.min(f.e, f.s + t.busy), f.may);
      out.set(t.id, { s: f.s, e: f.e, may: f.may || null, perf: f.perf || null, status: 'fixed', note: '' });
    });
    tasks.forEach(t => {
      if (t.fixed) return;
      if (t.keepAt) {   // ca đang có giờ trên HIS được thả ra để lấy chỗ: giờ cũ còn trống thì giữ nguyên
        const k = t.keepAt, be = Math.min(k.e, k.s + (t.busy || k.e - k.s));
        if (!(k.perf && bk.clash('P:' + k.perf, k.s, be, cfg.gapPerf)) && !bk.clash('B:' + t.bn, k.s, k.e, cfg.gapBn) && !(k.may && bk.clash('M:' + k.may, k.s, k.e, cfg.gapMay))) {
          put(t, k.perf, k.s, k.e, be, k.may);
          out.set(t.id, { s: k.s, e: k.e, may: k.may || null, perf: k.perf || null, status: 'planned', note: '', kept: true }); return;
        }
      }
      if (!(t.dur > 0)) { out.set(t.id, { status: 'stuck', note: 'Chưa có quy tắc thời gian cho thủ thuật này' }); return; }
      let found = [];
      cands(t, staff).forEach(st => { const r = earliest(t, st, cfg, bk); if (r) found.push({ st, s: r.s, may: r.may, shift: r.shift }); });
      if (!found.length) { out.set(t.id, { status: 'stuck', note: explain(t, staff, cfg, bk) }); return; }
      const want = t.hold != null ? t.hold : cfg.spread ? t.pref : null;   // hold: ca đã làm ở buổi nào thì ưu tiên xếp lại trong buổi đó
      if (want != null && found.some(f => f.shift === want)) found = found.filter(f => f.shift === want);
      const best = Math.min.apply(null, found.map(f => f.s));
      const ok = found.filter(f => f.s <= best + cfg.tol);   // người ưu tiên hơn được chọn nếu chỉ chậm hơn tối đa tol phút
      ok.sort((x, y) => rank(x.st, t.gk) - rank(y.st, t.gk) || (load[x.st.id] || 0) - (load[y.st.id] || 0) || x.s - y.s);
      const c = ok[0];
      put(t, c.st.id, c.s, c.s + t.dur, c.s + t.busy, c.may);
      out.set(t.id, { s: c.s, e: c.s + t.dur, may: c.may, perf: c.st.id, status: 'planned', note: '' });
    });
    return tasks.map(t => Object.assign({}, t, out.get(t.id)));
  }

  // Thứ tự xếp: xoay vòng theo người bệnh. Đồng thời gợi ý buổi cho từng ca để mỗi người bệnh có ca ở cả sáng và chiều.
  function prepare(tasks, cfg) {
    const by = new Map();
    tasks.forEach(t => { if (!by.has(t.bn)) by.set(t.bn, []); by.get(t.bn).push(t); });
    const groups = [], keeps = [];
    by.forEach(list => {
      const todo = list.filter(t => !t.fixed && !t.keepAt).map(t => Object.assign({}, t)).sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id);
      list.forEach(t => { if (!t.fixed && t.keepAt) keeps.push(Object.assign({}, t)); });
      if (cfg.spread && cfg.shifts.length === 2 && list.length >= 2) {
        const mid = cfg.shifts[0][1];
        const amFixed = list.filter(t => (t.fixed || t.keepAt) && (t.fixed || t.keepAt).s < mid).length;
        const needAm = Math.max(0, Math.min(todo.length, Math.round(list.length * 0.56) - amFixed)), needPm = todo.length - needAm;
        // Người bệnh thứ chẵn làm các ca đầu buổi sáng, thứ lẻ làm các ca đầu buổi chiều, để từng người làm cũng có ca ở cả hai buổi.
        const flip = by.size > 1 && groups.length % 2 === 1;
        todo.forEach((t, i) => { t.pref = flip ? (i < needPm ? 1 : 0) : (i < needAm ? 0 : 1); });
      }
      if (todo.length) groups.push(todo);
    });
    groups.sort((x, y) => (x[0].order || 0) - (y[0].order || 0));
    const out = []; let more = true;
    for (let i = 0; more; i++) { more = false; groups.forEach(g => { if (g[i]) { out.push(g[i]); more = true; } }); }
    return keeps.concat(out);   // ca giữ giờ cũ đi trước; ở lượt sau, ca kẹt được đưa lên trước cả chúng
  }

  // Xếp nhiều lượt: ca bị kẹt ở lượt trước được xếp trước ở lượt sau. Giữ lượt ít ca kẹt nhất.
  function plan(tasks, staff, cfg, blocks, tries) {
    const fixed = tasks.filter(t => t.fixed);
    let order = prepare(tasks, cfg), best = null;
    for (let k = 0; k < (tries || 6); k++) {
      const res = pass(fixed.concat(order), staff, cfg, blocks);
      const stuck = new Set(res.filter(r => r.status === 'stuck').map(r => r.id));
      if (!best || stuck.size < best.n) best = { res, n: stuck.size };
      if (!stuck.size) break;
      order = order.filter(t => stuck.has(t.id)).concat(order.filter(t => !stuck.has(t.id)));
    }
    return best.res;
  }

  // Soát lỗi trên một bảng giờ bất kỳ (đã lưu hoặc dự kiến). Trả về danh sách {type, level, ids, extra}.
  function check(rows, staff, cfg, blocks) {
    const out = [], ok = rows.filter(r => r.s != null);
    const add = (type, level, ids, extra) => out.push({ type, level, ids, extra: extra || '' });
    const groupBy = key => { const m = new Map(); ok.forEach(r => { const k = key(r); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); m.forEach(v => v.sort((a, b) => a.s - b.s || a.e - b.e)); return m; };
    const sweep = (m, endOf, gap, type) => m.forEach(v => { let last = null; v.forEach(n => {
      if (last) { const le = endOf(last); if (n.s < le) add(type, 'err', [last.id, n.id]); else if (n.s < le + gap) add(type, 'warn', [last.id, n.id]); }
      if (!last || endOf(n) > endOf(last)) last = n;
    }); });
    sweep(groupBy(r => r.perf), r => Math.min(r.e, r.s + r.busy), cfg.gapPerf, 'perf');
    sweep(groupBy(r => r.bn), r => r.e, cfg.gapBn, 'bn');
    sweep(groupBy(r => r.may), r => r.e, cfg.gapMay, 'may');
    const byId = new Map(staff.map(s => [s.id, s]));
    ok.forEach(r => {
      if (r.order != null) { if (r.s < r.order) add('order', 'err', [r.id]); else if (r.s < r.order + cfg.lead) add('order', 'warn', [r.id]); }
      const si = cfg.shifts.findIndex(sh => r.s >= sh[0] && r.e <= sh[1]);
      if (si < 0) add('shift', 'err', [r.id]);
      const st = byId.get(r.perf);
      if (st) { if (!st.can[r.gk]) add('cert', 'err', [r.id]); if (si >= 0 && !st.on[si]) add('absent', 'err', [r.id]); }
      if (r.needMay && !r.may) add('nomay', 'err', [r.id]);
      if (r.need && r.e - r.s < r.need) add('dur', 'err', [r.id], 'làm ' + (r.e - r.s) + ' phút, quy định ' + r.need + ' phút');
      (blocks || []).forEach(b => {
        if (b.kind === 'perf' && b.who === r.perf && r.s < b.e && b.s < Math.min(r.e, r.s + r.busy)) add('pblock', 'err', [r.id], b.note);
        if (b.kind === 'bn' && b.who === r.bn && r.s < b.e && b.s < r.e) add('bblock', 'err', [r.id], b.note);
      });
    });
    return out;
  }
  return { toMin, toHM, plan, check, prepare, pass };
})();

function XepGioCore(H, $) {
  const hm = X.toHM;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();   // bỏ dấu để tìm tên
  const eid = s => String(s).replace(/[^A-Za-z0-9_-]/g, c => '_' + c.charCodeAt(0).toString(36));
  // Thủ thuật (S.groups), loại chứng chỉ (S.certs) và mã máy (S.may) đều là cài đặt, sửa được ở thẻ Cài đặt.
  // Một dịch vụ trên HIS thuộc thủ thuật nào là do từ khóa (kw): lấy thủ thuật có từ khóa dài nhất nằm trong tên dịch vụ, không phân biệt dấu.
  let WORK = [];
  const groupOf = name => { const n = fold(name); let best = null, len = 0; S.groups.forEach(g => (g.kw || []).forEach(k => { const x = fold(k).trim(); if (x && x.length > len && n.indexOf(x) >= 0) { best = g; len = x.length; } })); return best; };
  const mayList = g => { const a = S.may[g.k]; return a && a.length ? a : null; };
  const offKey = (g, m) => g.k + '|' + m;   // ô tích máy là của riêng từng thủ thuật
  // Cài đặt kiểu cũ: vài thủ thuật dùng chung một danh sách máy (mk) và ô tích là chung theo mã máy. Chuyển sang kiểu mới, giữ nguyên máy nào đang tích.
  function normMay() {
    S.may = S.may || {}; S.mayOff = S.mayOff || [];
    S.groups.forEach(g => { if (g.mk && g.mk !== g.k && !(S.may[g.k] && S.may[g.k].length) && S.may[g.mk]) S.may[g.k] = S.may[g.mk].slice(); });
    S.groups.forEach(g => { g.mk = g.k; });
    if (S.mayV !== 2) { const old = S.mayOff; S.mayOff = []; S.groups.forEach(g => (S.may[g.k] || []).forEach(m => { if (old.indexOf(m) >= 0) S.mayOff.push(offKey(g, m)); })); S.mayV = 2; }
  }
  // Thủ thuật đang dùng: có trong danh sách ngày, đã tích cho ai đó, hoặc do người dùng thêm
  function refreshWork() { const used = new Set(H.tickets.map(t => (groupOf(t.ten) || {}).k)); WORK = S.groups.filter(g => !g.skip && (g.pin || used.has(g.k) || S.staff.some(p => holds(p, g)))); }

  const S = {};   // cài đặt lâu dài
  const D = {};   // dữ liệu trong ngày: chấm công, chặn giờ
  function ensureStaff(st) {
    st.can = st.can || {}; st.prio = st.prio || {}; st.cc = st.cc || {};
    S.certs.forEach(c => {
      const cc = st.cc[c.k] = st.cc[c.k] || { so: '', han: '' };
      if (cc.co === undefined) {   // chuyển từ cách lưu cũ: coi là có chứng chỉ nếu đang được tích ít nhất một thủ thuật của nó; thủ thuật chưa tích thì ghi rõ là không làm
        const gs = S.groups.filter(g => !g.skip && g.cert === c.k);
        cc.co = gs.some(g => st.can[g.k] === true);
        gs.forEach(g => { if (st.can[g.k] !== true) st.can[g.k] = false; });
      }
    });
    if (!D.on[st.id]) D.on[st.id] = [true, true];
    if (!D.week[st.id]) D.week[st.id] = [0, 0, 0, 0, 0, 0, 0];
  }
  function defaults() {
    const seed = H.seed();
    Object.assign(S, { staff: seed.staff, groups: JSON.parse(JSON.stringify(seed.groups)), certs: JSON.parse(JSON.stringify(seed.certs)), may: JSON.parse(JSON.stringify(seed.may || {})), stamp: '', shifts: [[450, 720], [780, 990]], lead: 5, gapPerf: 1, gapBn: 5, gapMay: 1, tol: 15, newBlock: 10, spread: true, mayOff: [], mayV: 0, setup: null, wkBlocks: [], wkSeq: 0 });
    D.on = seed.on || {}; D.note = {}; D.week = seed.week || {}; D.blocks = []; D.bkSeq = 0; D.wkOff = [];
    const saved = H.loadSettings ? H.loadSettings() : null;
    if (saved && saved.S) Object.assign(S, saved.S);
    normMay();
    if (!S.setup) { const done = !!(saved && saved.S && S.staff.length); S.setup = { staff: done, cert: done, svc: done, param: done }; }   // máy đã có cài đặt từ trước thì coi như thiết lập xong
    if (saved && saved.D) Object.assign(D, saved.D);
    normWk();
    S.staff.forEach(ensureStaff);
  }
  const persist = () => { if (H.saveSettings) H.saveSettings(S, D); };
  const staffById = id => S.staff.find(s => s.id === id);
  const staffName = id => { const s = staffById(id); return s ? s.ten : (H.nameOf && H.nameOf(id)) || id || ''; };
  const expired = (st, cert) => { const h = st.cc[cert] && st.cc[cert].han; return !!h && h < H.runDate; };
  const nearExp = (st, cert) => { const h = st.cc[cert] && st.cc[cert].han; if (!h || h < H.runDate) return false; return (new Date(h) - new Date(H.runDate)) / 864e5 <= 30; };
  // Một người làm được thủ thuật khi có chứng chỉ của thủ thuật đó và không bị bỏ tích riêng thủ thuật ấy
  const holds = (st, g) => !!(st.cc && st.cc[g.cert] && st.cc[g.cert].co) && st.can[g.k] !== false;
  const canDo = (st, g) => holds(st, g) && !expired(st, g.cert);
  const staffEng = () => S.staff.map(st => ({ id: st.id, on: (D.on[st.id] || [false, false]).slice(), can: Object.fromEntries(WORK.map(g => [g.k, canDo(st, g)])), prio: st.prio }));
  const cfg = () => ({ shifts: S.shifts, gapPerf: S.gapPerf, gapBn: S.gapBn, gapMay: S.gapMay, lead: S.lead, tol: S.tol, spread: S.spread });
  const machinesOf = g => { const a = mayList(g); return a ? a.filter(m => S.mayOff.indexOf(offKey(g, m)) < 0) : null; };
  const byId = id => H.tickets.find(t => t.id === id);
  // Người bệnh đã ra viện: theo trạng thái trên HIS, hoặc có giờ chặn "Ra viện, xử trí". Ca xanh của họ không được tự xếp lại.
  const outBn = bn => { const p = H.pats.get(bn); return !!(p && p.ra) || D.blocks.some(b => b.kind === 'rv' && b.who === bn); };
  const workTickets = () => H.tickets.filter(t => { const g = groupOf(t.ten); return !(g && g.skip); });

  const App = { plan: new Map(), manual: new Map(), filled: new Set(), move: new Set(), lock: new Set(), free: new Set(), skip: new Set(), sel: new Set(), conflicts: null, warn: 0, running: false, stop: false, dirty: false };
  function resetApp() { Object.assign(App, { plan: new Map(), manual: new Map(), filled: new Set(), move: new Set(), lock: new Set(), free: new Set(), replan: false, skip: new Set(), sel: new Set(), conflicts: null, warn: 0, dirty: false }); $('#log').innerHTML = ''; }
  function log(msg) { const d = document.createElement('div'); d.textContent = msg; const el = $('#log'); el.appendChild(d); while (el.childNodes.length > 500) el.removeChild(el.firstChild); el.scrollTop = el.scrollHeight; }
  function changed() { if (App.running) return; if (App.replan) { App.replan = false; buildPlan(null); } App.conflicts = null; renderAll(); }
  function dirty() { if (App.plan.size) App.dirty = true; App.conflicts = null; persist(); renderAll(); }

  // Bảng giờ được lưu theo ngày, để đóng cửa sổ rồi mở lại vẫn điền tiếp được đúng bảng cũ
  const savePlan = () => { if (H.savePlan) H.savePlan({ plan: Array.from(App.plan.values()).filter(r => r.status !== 'fixed'), manual: Array.from(App.manual), skip: Array.from(App.skip), move: Array.from(App.move), lock: Array.from(App.lock) }); };
  function restorePlan() {
    const sp = H.loadPlan ? H.loadPlan() : null; if (!sp) return;
    const mv = new Set((sp.move || []).filter(id => { const t = byId(id); return t && t.tt === 3; }));   // ca xanh có lỗi đã được xếp giờ mới, chờ ghi đè
    (sp.plan || []).forEach(r => { const t = byId(r.id); if (!t || (r.status === 'planned' && t.tt === 3 && !mv.has(r.id))) return; App.plan.set(r.id, Object.assign({}, r, { wait: false })); });
    App.move = new Set(Array.from(mv).filter(id => App.plan.has(id) && App.plan.get(id).status === 'planned'));
    App.lock = new Set((sp.lock || []).filter(id => byId(id)));
    App.manual = new Map((sp.manual || []).filter(x => byId(x[0]))); App.skip = new Set((sp.skip || []).filter(id => byId(id)));
    const n = Array.from(App.plan.values()).filter(r => r.status === 'planned').length;
    if (n) log('Đã lấy lại bảng giờ xếp từ trước: ' + n + ' ca dự kiến chưa điền.');
  }
  // Chặn giờ cố định theo tuần: một việc lặp lại (giao ban, họp khoa...) chặn nhiều nhân viên cùng lúc vào những thứ đã tích. Lưu trong cài đặt chung.
  const DOW = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
  function normWk() {
    if (!Array.isArray(S.wkBlocks)) S.wkBlocks = [];
    S.wkBlocks = S.wkBlocks.filter(r => r && r.id != null).map(r => ({ id: +r.id, ten: String(r.ten || ''), s: r.s == null ? null : +r.s, e: r.e == null ? null : +r.e, days: DOW.map((d, i) => !!(r.days && r.days[i])), who: Array.isArray(r.who) ? r.who.slice() : [] }));
    S.wkSeq = S.wkBlocks.reduce((m, r) => Math.max(m, r.id), +S.wkSeq || 0);
    if (!Array.isArray(D.wkOff)) D.wkOff = [];
  }
  const wkIdx = () => { const d = new Date(String(H.runDate) + 'T00:00:00'); return isNaN(d) ? -1 : (d.getDay() + 6) % 7; };   // 0 = thứ 2 ... 6 = chủ nhật
  const wkWho = r => r.who.filter(id => staffById(id));
  const wkOk = r => r.s != null && r.e != null && r.e > r.s && wkWho(r).length > 0;
  const wkToday = () => { const i = wkIdx(); return (S.wkBlocks || []).filter(r => wkOk(r) && r.days[i]); };
  const wkOn = r => (D.wkOff || []).indexOf(r.id) < 0;   // hôm nay có áp dụng không
  const wkName = r => r.ten || 'Việc cố định theo tuần';
  const blocksEng = () => D.blocks.map(b => ({ kind: b.kind === 'perf' ? 'perf' : 'bn', who: b.who, s: b.s, e: b.kind === 'rv' ? 1440 : b.e, note: b.note }))
    .concat(wkToday().filter(wkOn).reduce((a, r) => a.concat(wkWho(r).map(id => ({ kind: 'perf', who: id, s: r.s, e: r.e, note: wkName(r) + ' (hằng tuần)' }))), []));
  function autoBlocks() {   // người bệnh vào viện trong ngày: chặn bác sĩ chỉ định của người đó
    D.blocks = D.blocks.filter(b => !b.auto);
    H.pats.forEach(p => { if (p.vao != null && p.bsId) D.blocks.push({ id: ++D.bkSeq, kind: 'perf', who: p.bsId, s: p.vao, e: p.vao + S.newBlock, note: 'Khám ' + p.ten + ' mới vào lúc ' + hm(p.vao), auto: true }); });
  }

  // scope: null = cả khoa, hoặc Set mã người bệnh để chạy riêng (ca của người khác được giữ nguyên)
  function buildPlan(scope) {
    const tasks = [];
    workTickets().forEach(t => {
      if (App.skip.has(t.id)) { App.plan.delete(t.id); return; }
      const g = groupOf(t.ten), old = App.plan.get(t.id);
      const b = { id: t.id, bn: t.bn, gk: g ? g.k : '?', dur: g ? g.dur : 0, busy: g ? g.busy : 0, machines: g ? machinesOf(g) : null, order: t.cd, pinPerf: App.manual.get(t.id) || null };
      if (t.tt === 3 && !App.move.has(t.id) && !App.free.has(t.id)) { b.fixed = { s: t.s, e: t.e, may: t.may, perf: t.perf }; b.dur = t.e - t.s; b.busy = Math.min(b.busy || b.dur, b.dur); b.keep = 'his'; }
      else if (t.tt === 3 && t.s != null && (!scope || scope.has(t.bn))) { const si = S.shifts.findIndex(sh => t.s >= sh[0] && t.s < sh[1]); if (si >= 0) b.hold = si; if (!App.move.has(t.id)) b.keepAt = { s: t.s, e: t.e, may: t.may, perf: t.perf }; }   // ca xanh có lỗi: xếp lại trong đúng buổi đã làm nếu còn chỗ
      if (b.fixed) {} else if (scope && !scope.has(t.bn)) { if (old && old.status === 'planned') { b.fixed = { s: old.s, e: old.e, may: old.may, perf: old.perf }; b.keep = 'plan'; } else return; }
      tasks.push(b);
    });
    const res = X.plan(tasks, staffEng(), cfg(), blocksEng());
    if (!scope) App.plan = new Map();
    res.forEach(r => App.plan.set(r.id, { id: r.id, s: r.s, e: r.e, may: r.may, perf: r.perf, status: r.keep === 'plan' ? 'planned' : r.kept ? 'fixed' : r.status, note: r.note || '', wait: false }));
    App.dirty = false; App.conflicts = null; savePlan();
    return res.filter(r => !r.keep);
  }

  // Bảng giờ hiện hành: ca dự kiến (chưa điền) nếu có, không thì ca đã lưu trên HIS
  function curRows() {
    return workTickets().map(t => {
      const g = groupOf(t.ten), p = App.plan.get(t.id);
      const v = p && p.status === 'planned' ? p : t.tt === 3 ? t : null;
      if (!v || v.s == null) return null;
      return { id: t.id, t, g, src: v === t ? 'his' : 'plan', s: v.s, e: v.e, perf: v.perf, may: v.may, bn: t.bn, gk: g ? g.k : '?', busy: g ? Math.min(g.busy, v.e - v.s) : v.e - v.s, order: t.cd, needMay: !!(g && mayList(g)), need: g ? g.dur : 0 };
    }).filter(Boolean);
  }
  const gLabel = r => r.g ? r.g.label : r.t.ten;
  const rowLabel = r => `${hm(r.s)}–${hm(r.e)} · ${r.t.tenBN} · ${gLabel(r)} · ${staffName(r.perf)}${r.may ? ' · ' + r.may : ''}${r.src === 'plan' ? ' (dự kiến)' : ''}`;
  const TYPES = {
    perf: ['Trùng người làm', 'Người làm nghỉ chưa đủ giữa hai ca'], bn: ['Trùng người bệnh', 'Người bệnh nghỉ chưa đủ giữa hai ca'], may: ['Trùng máy', 'Máy nghỉ chưa đủ giữa hai ca'],
    order: ['Làm trước giờ chỉ định', 'Chưa đủ thời gian sau giờ chỉ định'], shift: ['Ngoài giờ làm việc'], cert: ['Người làm không có chứng chỉ còn hạn'], absent: ['Người làm không đi làm buổi đó'],
    nomay: ['Thiếu mã máy'], dur: ['Thời gian làm ngắn hơn quy định'], pblock: ['Đụng giờ chặn của người làm'], bblock: ['Đụng giờ chặn của người bệnh']
  };
  const typeName = c => (TYPES[c.type] || [c.type])[c.level === 'warn' ? 1 : 0] || TYPES[c.type][0];

  function runCheck(silent) {
    App.conflicts = X.check(curRows(), staffEng(), cfg(), blocksEng());
    const e = App.conflicts.filter(c => c.level === 'err').length, w = App.conflicts.length - e;
    if (!silent) log(`Kiểm tra trùng: ${e} lỗi, ${w} cảnh báo trên ${curRows().length} ca.`);
    renderAll(); return e + w;
  }
  // Ca đã xanh trên HIS mà có lỗi (trùng, sai buổi, thiếu thời gian...) thì được xếp giờ mới như ca vàng; ca xanh không lỗi giữ nguyên.
  // Trong mỗi cặp trùng, ca đứng sau được dời. Lặp vài vòng vì dời xong một ca có thể lộ ra cặp trùng khác.
  // Ca xanh nào không tìm được giờ mới thì trả về giữ nguyên như trên HIS, để các ca khác né nó.
  // Không đụng tới ca xanh của người bệnh đã ra viện và ca HIS đã không cho ghi lại; trong cặp trùng có ca như vậy thì dời ca còn lại.
  // Trả về { moved: số ca xanh được xếp giờ mới, kept: số ca xanh có lỗi được giữ nguyên vì hai lý do trên }.
  function fixGreen() {
    const fresh = new Set();
    const held = id => { const t = byId(id); return !!t && t.tt === 3 && (App.lock.has(id) || outBn(t.bn)); };
    const can = id => { const t = byId(id); return !!t && t.tt === 3 && !App.move.has(id) && !fresh.has(id) && !held(id); };
    for (let round = 0; round < 8; round++) {
      const ids = new Set();
      X.check(curRows(), staffEng(), cfg(), blocksEng()).forEach(c => { const id = c.ids.slice().reverse().find(can); if (id != null) ids.add(id); });
      if (!ids.size) break;
      ids.forEach(id => { App.move.add(id); fresh.add(id); });
      buildPlan(null);
    }
    const back = Array.from(App.move).filter(id => { const p = App.plan.get(id); return !p || p.status !== 'planned'; });
    if (back.length) { back.forEach(id => App.move.delete(id)); buildPlan(null); }
    const kept = new Set(); X.check(curRows(), staffEng(), cfg(), blocksEng()).forEach(c => c.ids.forEach(id => { if (held(id)) kept.add(id); }));
    return { moved: Array.from(fresh).filter(id => App.move.has(id)).length, kept: kept.size, back };
  }
  // Còn ca kẹt vì hết chỗ, hoặc ca xanh có lỗi chưa tìm được giờ mới: xem lại cả giờ của các ca đã xanh không lỗi.
  // Mọi ca xanh được thả ra cùng lúc nhưng ưu tiên giữ đúng giờ cũ; chỉ ca nào vướng mới bị dời, và chỉ nhận kết quả khi số ca kẹt giảm
  // mà không ca xanh nào bị mất giờ. Không thả ca của người bệnh đã ra viện, ca HIS không cho ghi lại, ca chưa có quy tắc thời gian.
  // back: các ca xanh có lỗi mà fixGreen chưa tìm được giờ mới. Trả về null nếu không cần thử, hoặc { placed, moved }.
  function makeRoom(back) {
    back = (back || []).filter(id => { const t = byId(id); return t && t.tt === 3 && !App.lock.has(id) && !outBn(t.bn); });
    const stuckN = () => planCount('stuck'), st = id => (App.plan.get(id) || {}).status;
    const full = Array.from(App.plan.values()).some(r => r.status === 'stuck' && /kín lịch|không còn khoảng trống/.test(r.note || ''));
    const need0 = stuckN() + back.length;
    if (!need0 || (!full && !back.length)) return null;
    const cand = workTickets().filter(t => t.tt === 3 && t.s != null && groupOf(t.ten) && !App.move.has(t.id) && !App.lock.has(t.id) && !outBn(t.bn) && back.indexOf(t.id) < 0).map(t => t.id);
    if (!cand.length) return null;
    const snap = new Set(App.move), undo = () => { App.free.clear(); App.move = snap; buildPlan(null); return { placed: 0, moved: 0 }; };
    back.forEach(id => App.move.add(id)); cand.forEach(id => App.free.add(id));
    buildPlan(null);
    const lost = cand.filter(id => st(id) !== 'planned' && st(id) !== 'fixed'), still = back.filter(id => st(id) !== 'planned');
    if (lost.length || stuckN() >= need0) return undo();
    const moved = cand.filter(id => st(id) === 'planned');
    App.free.clear(); moved.forEach(id => App.move.add(id));
    if (still.length) { still.forEach(id => App.move.delete(id)); buildPlan(null); }
    const need1 = stuckN() + still.length;
    if (need1 >= need0 || moved.some(id => st(id) !== 'planned')) return undo();
    savePlan();
    return { placed: need0 - need1, moved: moved.length };
  }
  const roomNote = r => !r ? '' : r.placed ? ` Để có chỗ cho ${r.placed} ca đang kẹt, app dời ${r.moved} ca đã xanh sang giờ khác; các ca này sẽ được ghi đè khi điền.` : ' App đã xem lại cả giờ của các ca đã xanh nhưng vẫn không đủ chỗ cho ca kẹt.';
  const keptNote = n => n ? ' ' + n + ' ca xanh có lỗi được giữ nguyên vì người bệnh đã ra viện hoặc HIS không cho ghi lại.' : '';
  const planCount = st => Array.from(App.plan.values()).filter(r => r.status === st).length;
  function runFix() {   // xếp lại các ca chưa điền, và xếp giờ mới cho ca xanh có lỗi
    if (!App.conflicts) runCheck(true);
    const before = App.conflicts.length;
    if (!before && !planCount('stuck')) { log('Không có ca nào cần sắp xếp lại.'); return; }   // còn ca kẹt thì vẫn thử xếp lại để lấy chỗ
    buildPlan(null);
    const fx = fixGreen(), room = makeRoom(fx.back), left = runCheck(true);
    log(`Tự sắp xếp lại: trước đó có ${before} lỗi hoặc cảnh báo. ${fx.moved} ca đã xanh trên HIS được xếp giờ mới, sẽ ghi đè giờ cũ khi điền.${keptNote(fx.kept)}${roomNote(room)} Sau khi xếp: còn ${left} lỗi hoặc cảnh báo, ${planCount('stuck')} ca kẹt.`);
    if (H.canFill && !H.noAuto && $('#autoFill').checked) runFill();
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Số ca sẽ điền nếu bấm lúc này: chỉ ca đã qua giờ kết thúc
  function fillStat(scope) {
    const now = H.now(), rows = Array.from(App.plan.values()).filter(r => r.status === 'planned' && (!scope || scope.has(byId(r.id).bn)));
    const due = rows.filter(r => r.e <= now);
    return { due: due.length, over: due.filter(r => byId(r.id).s != null).length, wait: rows.length - due.length, now };
  }
  function askFill(scope) { if (App.running || !H.canFill) return; App.fillAsk = { scope: scope || null }; App.goAsk = false; renderTiles(); }   // luôn hỏi lại trước khi ghi vào HIS
  function renderFillAsk() {
    const el = $('#fillAsk'), a = App.fillAsk; el.hidden = !a || App.running; if (el.hidden) return;
    const st = fillStat(a.scope), who = a.scope ? ' của ' + Array.from(a.scope).map(b => (H.pats.get(b) || {}).ten || b).join(', ') : '';
    const lúc = st.now < 0 ? 'Ngày đang chạy chưa tới.' : st.now >= 1440 ? 'Ngày đang chạy đã qua.' : 'Bây giờ là ' + hm(st.now) + '.';
    el.innerHTML = st.due ? `<b>Điền ${st.due} ca${esc(who)} đã qua giờ kết thúc vào HIS?</b><br>${lúc} ${st.over ? st.over + ' ca trong đó đang có giờ cũ và sẽ bị ghi đè. ' : ''}${st.wait ? st.wait + ' ca chưa qua giờ kết thúc được để lại. ' : ''}${esc(H.fillWarn || '')}<div class="row" style="margin-top:8px"><button type="button" data-fill="1">Điền thử 1 ca</button><button type="button" class="primary" data-fill="all">Điền cả ${st.due} ca</button><button type="button" data-fill="no">Thôi</button></div>`
      : `<b>Chưa có ca nào${esc(who)} qua giờ kết thúc.</b><br>${lúc} ${st.wait} ca dự kiến được để lại; bấm Điền vào HIS lần nữa khi các ca đã làm xong.<div class="row" style="margin-top:8px"><button type="button" data-fill="no">Đóng</button></div>`;
  }
  async function runFill(scope, limit, auto) {
    if (App.running || !H.canFill) return;
    if (!auto) App.autoStop = false;   // người dùng tự bấm thì cho tự điền chạy lại
    const now = H.now();
    const all = Array.from(App.plan.values()).filter(r => r.status === 'planned' && (!scope || scope.has(byId(r.id).bn))).sort((a, b) => a.s - b.s);
    all.forEach(r => { r.wait = r.e > now; });   // chỉ điền ca đã qua giờ kết thúc
    const rows = all.filter(r => !r.wait).slice(0, limit || 1e9), wait = all.filter(r => r.wait).length;
    App.fillAsk = null;
    if (!rows.length) { renderAll(); return; }
    App.running = true; App.stop = false; renderTiles();
    let ok = 0, fail = 0, skip = 0, keep = 0, err = ''; const w0 = App.warn;
    let streak = [];   // các ca liên tiếp bị HIS từ chối; đủ 5 thì coi là lỗi chung (mất phiên, HIS treo), dừng và trả các ca đó về như trước
    try { if (H.fillBegin) await H.fillBegin(); } catch (e) { err = e.message || String(e); }
    for (let i = 0; i < rows.length && !err && !App.stop; i++) {
      const r = rows[i], t = byId(r.id);
      const had = t.s != null ? `${hm(t.s)}–${hm(t.e)} ${staffName(t.perf)}${t.may ? ' ' + t.may : ''}` : '';
      const res = (await H.fill(t, r)) || { ok: false, err: 'không có kết quả' };
      if (res.warned) App.warn += res.warned === true ? 1 : res.warned;
      if (res.ok) {
        App.filled.add(r.id); App.move.delete(r.id); r.status = 'fixed'; r.wait = false; ok++; streak = [];
        if (H.onFilled) H.onFilled(Array.from(App.filled)); savePlan();
        if (had) log(`${t.tenBN} · ${t.ten}: ghi đè ${had} thành ${hm(r.s)}–${hm(r.e)} ${staffName(r.perf)}${r.may ? ' ' + r.may : ''}`);
      } else if (res.skip) { skip++; log(`${hm(r.s)} ${t.tenBN} · ${t.ten}: bỏ qua, ${res.err}`); }
      else if (t.tt === 3) {   // ca đã xanh mà HIS không cho ghi lại (ví dụ người bệnh đã ra viện): giữ nguyên như trên HIS, không thử lại, chạy tiếp
        keep++; App.move.delete(r.id); App.lock.add(r.id); streak.push({ id: r.id, row: Object.assign({}, r), green: true });
        App.plan.set(r.id, { id: r.id, s: t.s, e: t.e, may: t.may, perf: t.perf, status: 'fixed', note: '', wait: false });
        log(`${hm(t.s)} ${t.tenBN} · ${t.ten}: HIS không cho ghi lại (${res.err || 'không lưu được'}), giữ nguyên như trên HIS`);
      }
      else {   // ca vàng HIS từ chối: ghi lý do vào bảng giờ, không thử lại cho tới lần xếp giờ sau, chạy tiếp
        fail++; streak.push({ id: r.id, row: Object.assign({}, r), green: false });
        r.status = 'stuck'; r.note = 'HIS từ chối: ' + (res.err || 'không lưu được'); r.wait = false;
        log(`${hm(r.s)} ${t.tenBN} · ${t.ten}: HIS từ chối, ${res.err || 'không lưu được'}. Bỏ qua ca này.`);
      }
      if (streak.length >= 5) {
        streak.forEach(x => { App.plan.set(x.id, x.row); if (x.green) { App.lock.delete(x.id); App.move.add(x.id); keep--; } else fail--; });
        streak = []; err = '5 ca liên tiếp bị HIS từ chối, có thể do phiên đăng nhập hoặc HIS đang lỗi. Các ca đó được giữ lại để điền sau';
      }
      if (i % 12 === 0) { renderTiles(); await sleep(0); }
    }
    try { if (H.fillEnd) await H.fillEnd(); } catch (e) {}
    const note = `${App.stop ? 'Đã dừng theo lệnh. ' : ''}Điền ${ok} ca lúc ${now >= 1440 || now < 0 ? '' : hm(now)}${wait ? `, ${wait} ca chưa qua giờ kết thúc nên để lại` : ''}${skip ? `, ${skip} ca bỏ qua` : ''}${keep ? `, ${keep} ca xanh HIS không cho ghi lại nên giữ nguyên` : ''}${fail ? `, ${fail} ca HIS từ chối` : ''}. HIS báo trùng ${App.warn - w0} lần, app đã bấm Đồng ý.${err ? ' Dừng lại vì: ' + err + '.' : ''}`;
    if (ok || fail || skip || keep || err) log(note);
    if (err) { App.autoStop = true; if (auto) log('Tự điền tạm dừng vì có lỗi. Xem lý do ở trên rồi bấm Điền vào HIS để chạy lại.'); }
    if (keep) App.replan = true;   // các ca chưa điền sẽ được xếp lại để né ca vừa giữ nguyên, sau khi số liệu được đọc lại từ HIS
    savePlan();
    App.running = false;
    const reread = !!(H.afterFill && (ok || fail || keep));
    if (App.replan && !reread) changed(); else { App.conflicts = null; renderAll(); }
    if (reread) H.afterFill(note);
  }
  // Các phiếu sẽ bị gỡ: đang xanh, không phải sắc thuốc (HIS tự cập nhật), không phải ca app vừa điền. Mỗi phiếu chỉ tính một lần.
  // all = true: gỡ cả phiếu app đã điền, để chạy lại cả ngày. Phiếu của người bệnh đã ra viện luôn được để nguyên.
  const goKeyOf = t => H.goKey ? H.goKey(t) : t.id;
  function goList(all, out) { const seen = new Set(); return H.tickets.filter(t => { if (t.tt !== 3 || t.auto || (!all && App.filled.has(t.id)) || (groupOf(t.ten) || {}).skip || !!out !== outBn(t.bn)) return false; const k = goKeyOf(t); if (seen.has(k)) return false; seen.add(k); return true; }); }
  async function runGoAll(limit, all) {
    if (App.running || !H.canGo) return;
    const list = goList(all).slice(0, limit || 1e9);
    App.goAsk = false; App.running = true; App.stop = false; renderTiles();
    let ok = 0, fail = 0, streak = 0, err = ''; const why = {};
    try { if (H.goBegin) await H.goBegin(); } catch (e) { err = e.message || String(e); }
    for (let i = 0; i < list.length && !err && !App.stop; i++) {   // phiếu HIS không cho gỡ thì bỏ qua, gỡ tiếp phiếu sau; 5 phiếu liên tiếp không gỡ được thì dừng
      const t = list[i], k = goKeyOf(t), r = (await H.go(t)) || { ok: true };
      if (r.ok) {
        ok++; streak = 0; let was = false;
        H.tickets.forEach(x => { if (goKeyOf(x) !== k) return; if (App.filled.delete(x.id)) was = true; App.move.delete(x.id); App.lock.delete(x.id); App.plan.delete(x.id); });
        if (was && H.onFilled) H.onFilled(Array.from(App.filled));
      } else {
        fail++; streak++; const m = r.err || 'HIS không gỡ được'; why[m] = (why[m] || 0) + 1;
        if (fail <= 5) log(`${t.tenBN} · phiếu ${t.soPhieu || ''}: không gỡ được, ${m}. Để nguyên phiếu này.`);
        if (streak >= 5) err = '5 phiếu liên tiếp không gỡ được';
      }
      if (i % 12 === 0) { renderTiles(); await sleep(0); }
    }
    try { if (H.goEnd) await H.goEnd(); } catch (e) {}
    savePlan();
    const reasons = Object.keys(why).map(m => why[m] + ' phiếu: ' + m).join('; ');
    const note = `Đã gỡ xanh ${ok} trên ${list.length} phiếu${fail ? `, ${fail} phiếu HIS không cho gỡ nên để nguyên (${reasons})` : ''}${App.stop ? ', rồi dừng theo lệnh' : ''}${err ? '. Dừng lại vì: ' + err : ''}. Phiếu đã gỡ vẫn giữ giờ cũ trên HIS cho đến khi được điền lại.`;
    log(note);
    App.running = false; App.conflicts = null; renderAll();
    if (H.afterGo) H.afterGo(note);
  }
  async function runBn(scope) {   // chạy riêng: xếp (và điền, nếu được phép ghi) chỉ cho các người bệnh trong scope
    if (App.running || !scope.size) return;
    const res = buildPlan(scope);
    const names = Array.from(scope).map(b => H.pats.get(b).ten).join(', ');
    log(`Chạy riêng cho ${names}: ${res.filter(r => r.status === 'planned').length} ca đã xếp, ${res.filter(r => r.status === 'stuck').length} ca kẹt.`);
    renderAll(); askFill(scope);
  }

  /* ---------- các bảng ---------- */
  function planInfo(t) {
    const p = App.plan.get(t.id);
    if (App.skip.has(t.id)) return ['info', 'Bỏ qua lượt này'];
    if (p && p.status === 'planned') return p.wait ? ['info', 'Chờ qua giờ kết thúc'] : ['vang', t.tt === 3 ? 'Xếp lại, sẽ ghi đè giờ cũ' : 'Dự kiến, chưa điền'];
    if (p && p.status === 'stuck') return ['do', p.note];
    if (t.tt === 3) return ['xanh', App.filled.has(t.id) ? 'Đã điền' : 'Đã có trên HIS'];
    return ['vang', t.vet ? 'Chưa xếp, còn giờ cũ' : 'Chưa xếp'];
  }
  // Bảng giờ: một bảng cho mọi ca của ngày. Xem theo giờ, theo người bệnh (có Chạy riêng), theo người làm (có tổng), hoặc thanh thời gian.
  const VIEWS = ['gio', 'bn', 'perf', 'tl'];
  function setView(v) { App.view = VIEWS.indexOf(v) >= 0 ? v : 'gio'; try { localStorage.setItem('xg-view', App.view); } catch (e) {} renderBang(); renderTL(); }
  function renderBang() {
    const view = VIEWS.indexOf(App.view) >= 0 ? App.view : 'gio', find = fold($('#bangSearch').value.trim()), fp = $('#planPerf').value, fs = $('#planSt').value, eng = staffEng(), mid = S.shifts[0][1];
    Array.from($('#bangView').querySelectorAll('button')).forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view ? 'true' : 'false'));
    $('#bangTable').hidden = view === 'tl'; $('#tlBox').hidden = view !== 'tl'; $('#btnRunSel').hidden = view !== 'bn'; $('#planSt').hidden = view === 'tl';
    const all = workTickets().map(t => {
      const p = App.plan.get(t.id), g = groupOf(t.ten), v0 = p && p.status === 'planned' ? p : t.tt === 3 ? t : null, v = v0 && v0.s != null ? v0 : null;
      return { t, g, v, st: planInfo(t), kind: !v ? 'none' : v === t ? 'his' : 'plan', who: v ? staffName(v.perf) : '', busy: v ? (g ? Math.min(g.busy, v.e - v.s) : v.e - v.s) : 0 };
    });
    const n = k => all.filter(x => x.kind === k).length;
    const list = all.filter(x => (!fp || (x.v && x.v.perf === fp)) && (!fs || (fs === 'bad' ? x.st[0] === 'do' : x.kind === fs)) &&
      (!find || fold([x.t.tenBN, x.t.maBA, x.t.ten, x.who, x.v ? x.v.may || '' : ''].join(' ')).indexOf(find) >= 0));
    const filtered = !!(find || fp || fs);
    $('#dsInfo').textContent = !H.tickets.length ? 'Chưa có danh sách. Tải danh sách của ngày cần chạy trước.'
      : `Ngày ${H.dateLabel}: ${all.length} thủ thuật của ${new Set(all.map(x => x.t.bn)).size} người bệnh · ${n('his')} đã lưu trên HIS · ${n('plan')} dự kiến · ${n('none')} chưa có giờ${filtered ? ' · đang hiện ' + list.length + ' dòng khớp bộ lọc' : ''}`;
    $('#bangSum').textContent = H.tickets.length ? `${all.length} thủ thuật · ${n('his')} đã lưu · ${n('plan')} dự kiến · ${n('none')} chưa có giờ` : '';
    if (view === 'tl' || !$('#tab-bang').open) return;
    const time = x => x.v ? x.v.s : 9999, cmp = (a, b) => String(a).localeCompare(String(b), 'vi'), byTime = (a, b) => time(a) - time(b) || cmp(a.t.tenBN, b.t.tenBN) || (a.t.id < b.t.id ? -1 : 1);
    const line = (x, showBn) => {
      const t = x.t, v = x.v; let who = esc(x.who);
      if (t.tt !== 3 || App.move.has(t.id)) {   // ca chưa lưu, hoặc ca xanh đang được xếp lại: chọn được người làm
        const m = App.manual.get(t.id) || '';
        who = `<select id="pp_${eid(t.id)}" data-pin="${esc(t.id)}" aria-label="Người làm"><option value="">${v && !m ? esc(x.who) + ' (tự chọn)' : 'Tự chọn'}</option>` +
          eng.filter(s => x.g && s.can[x.g.k]).map(s => `<option value="${esc(s.id)}"${s.id === m ? ' selected' : ''}>${esc(staffName(s.id))}${s.on.some(Boolean) ? '' : ' (nghỉ)'}</option>`).join('') + '</select>';
      }
      const btn = x.st[0] === 'do' || App.skip.has(t.id) ? ` <button type="button" class="small" data-skip="${esc(t.id)}">${App.skip.has(t.id) ? 'Đưa lại vào lượt chạy' : 'Bỏ qua lượt này'}</button>` : '';
      return `<tr>${showBn ? '' : '<td></td>'}<td>${v ? hm(v.s) + '–' + hm(v.e) : ''}</td>${showBn ? `<td>${esc(t.tenBN)}<span class="sub">${esc(t.maBA || '')}</span></td>` : ''}<td class="dsname">${esc(t.ten)}</td><td>${hm(t.cd)}</td><td>${who}</td><td>${esc(v ? v.may || '' : '')}</td><td class="stcell"><span class="pill ${x.st[0]}">${esc(x.st[1])}</span>${btn}</td></tr>`;
    };
    const head = view === 'bn' ? '<th></th><th>Giờ làm</th><th>Thủ thuật</th><th>Chỉ định</th><th>Người làm</th><th>Máy</th><th>Trạng thái</th>' : '<th>Giờ làm</th><th>Người bệnh</th><th>Thủ thuật</th><th>Chỉ định</th><th>Người làm</th><th>Máy</th><th>Trạng thái</th>';
    let body = '';
    if (view === 'gio') body = list.slice().sort(byTime).map(x => line(x, true)).join('');
    else if (view === 'bn') {
      body = Array.from(H.pats.values()).map(p => {
        const rows = list.filter(x => x.t.bn === p.bn).sort(byTime); if (!rows.length) return '';
        const mine = all.filter(x => x.t.bn === p.bn), has = mine.filter(x => x.v), am = has.filter(x => x.v.s < mid).length, rest = mine.length - has.length;
        return `<tr class="grp"><td class="c"><input type="checkbox" id="bs_${eid(p.bn)}" data-selbn="${esc(p.bn)}"${App.sel.has(p.bn) ? ' checked' : ''} aria-label="Chọn ${esc(p.ten)}"></td><td colspan="5">${esc(p.ten)}<span class="sub">${esc(p.maBA || '')}</span>${p.vao != null ? ' <span class="tag">mới vào ' + hm(p.vao) + '</span>' : ''}${outBn(p.bn) ? ' <span class="tag">đã ra viện</span>' : ''} <span class="muted" style="font-weight:400">· ${mine.length} thủ thuật · ${am} sáng, ${has.length - am} chiều${rest ? ', ' + rest + ' chưa có giờ' : ''}</span></td><td><button type="button" class="small" data-runbn="${esc(p.bn)}">Chạy riêng</button></td></tr>` +
          rows.map(x => line(x, false)).join('');
      }).join('');
    } else {
      const known = new Set(S.staff.map(s => s.id));
      const others = Array.from(new Set(all.map(x => x.v && x.v.perf).filter(p => p && !known.has(p)))).map(p => ({ id: p, ten: staffName(p), out: true }));
      body = S.staff.concat(others).filter(st => !fp || st.id === fp).map(st => {
        const rows = list.filter(x => x.v && x.v.perf === st.id).sort(byTime); if (!rows.length && filtered && !(fp && !find && !fs)) return '';
        const mine = all.filter(x => x.v && x.v.perf === st.id), on = D.on[st.id] || [false, false], avail = (on[0] ? S.shifts[0][1] - S.shifts[0][0] : 0) + (on[1] ? S.shifts[1][1] - S.shifts[1][0] : 0);
        const busy = mine.reduce((k, x) => k + x.busy, 0), am = mine.filter(x => x.v.s < mid).length;
        return `<tr class="grp"><td colspan="7">${esc(st.ten)} <span class="muted" style="font-weight:400">· ${st.out ? 'không có trong bảng nhân viên' : on[0] && on[1] ? 'cả ngày' : on[0] ? 'buổi sáng' : on[1] ? 'buổi chiều' : 'nghỉ'} · ${mine.length} ca (${am} sáng, ${mine.length - am} chiều) · ${busy} phút trực tiếp làm${avail ? ' trên ' + avail + ' phút có mặt' : ''}</span></td></tr>` + rows.map(x => line(x, true)).join('');
      }).join('');
      const none = list.filter(x => !x.v || !x.v.perf).sort(byTime);
      if (none.length && !fp) body += `<tr class="grp"><td colspan="7">Chưa có người làm <span class="muted" style="font-weight:400">· ${none.length} ca</span></td></tr>` + none.map(x => line(x, true)).join('');
    }
    $('#plan').innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + (body || `<tr><td colspan="7" class="empty">${!H.tickets.length ? 'Chưa có danh sách. Tải danh sách của ngày cần chạy trước.' : 'Không có ca nào khớp bộ lọc.'}</td></tr>`) + '</tbody>';
  }
  function renderBlocks() {
    const kindName = b => b.auto ? 'Bác sĩ khám người bệnh mới' : b.kind === 'perf' ? 'Chặn người làm' : b.kind === 'rv' ? 'Ra viện, xử trí' : 'Chặn người bệnh';
    const wk = wkToday();
    $('#blocks').innerHTML = '<thead><tr><th>Loại</th><th>Ai</th><th>Từ</th><th>Đến</th><th></th></tr></thead><tbody>' +
      wk.map(r => { const on = wkOn(r), who = wkWho(r); return `<tr${on ? '' : ' class="off"'}><td>Chặn người làm <span class="tag">hằng tuần</span></td><td class="wrapcell" title="${esc(who.map(staffName).join(', '))}">${esc(wkName(r))} · ${who.length} người${on ? '' : ' · hôm nay không áp dụng'}</td><td>${hm(r.s)}</td><td>${hm(r.e)}</td><td><button type="button" class="small" data-wkoff="${r.id}">${on ? 'Bỏ hôm nay' : 'Dùng lại'}</button></td></tr>`; }).join('') +
      (D.blocks.length ? D.blocks.slice().sort((a, b) => a.s - b.s).map(b => `<tr><td>${kindName(b)}${b.auto ? ' <span class="tag">tự động</span>' : ''}</td>` +
        `<td>${esc(b.kind === 'perf' ? staffName(b.who) : (H.pats.get(b.who) || {}).ten || b.who)}</td><td>${hm(b.s)}</td><td>${b.kind === 'rv' ? 'hết ngày' : hm(b.e)}</td><td><button type="button" class="small" data-delbk="${b.id}">Xóa</button></td></tr>`).join('')
        : wk.length ? '' : '<tr><td colspan="5" class="empty">Chưa có giờ chặn nào.</td></tr>') + '</tbody>';
    const kind = $('#bkKind').value, cur = $('#bkWho').value;
    $('#bkWho').innerHTML = kind === 'perf' ? S.staff.map(s => `<option value="${esc(s.id)}">${esc(s.ten)}</option>`).join('') : Array.from(H.pats.values()).map(p => `<option value="${esc(p.bn)}">${esc(p.ten)}</option>`).join('');
    if (cur && Array.from($('#bkWho').options).some(o => o.value === cur)) $('#bkWho').value = cur;
    $('#bkELabel').hidden = kind === 'rv';
  }
  function renderTiles() {
    const work = workTickets(), p = Array.from(App.plan.values());
    const sao = work.filter(t => t.tt === 3 && !App.filled.has(t.id)).length;
    const chua = work.filter(t => t.tt === 2 && !App.skip.has(t.id) && !(App.plan.get(t.id) && App.plan.get(t.id).status === 'planned')).length;
    const planned = p.filter(r => r.status === 'planned').length, stuck = p.filter(r => r.status === 'stuck').length;
    const errs = App.conflicts ? App.conflicts.length : null;
    const tiles = [['Phiếu vàng chưa xếp', chua, '', 'bang:none'], [H.canGo ? 'Phiếu xanh do sao phiếu' : 'Ca đã xanh trên HIS', sao, sao && H.canGo ? 'bad' : '', 'bang:his'], ['Dự kiến, chờ điền', planned, '', 'bang:plan'], ['Ca kẹt cần gỡ', stuck, stuck ? 'bad' : '', 'bang:bad'],
      ['Đã điền vào HIS', App.filled.size, App.filled.size ? 'good' : '', 'bang:his'], ['Lỗi và cảnh báo trùng', errs == null ? '—' : errs, errs ? 'bad' : errs === 0 ? 'good' : '', 'trung']];
    $('#tiles').innerHTML = tiles.map(t => `<button type="button" class="tile ${t[2]}" data-goto="${t[3]}" title="Bấm để xem"><b>${t[1]}</b><span>${t[0]}</span></button>`).join('');
    const glAll = goList(true).length;
    $('#goInfo').textContent = !H.canGo ? `Có ${sao} ca đang xanh trên HIS. Bản này chưa gỡ xanh.` : sao ? `Có ${sao} ca đang xanh từ trước lượt chạy này. Gỡ xanh để biết đúng những thủ thuật cần chạy.` : glAll ? 'Không còn phiếu xanh do sao phiếu. Muốn chạy lại cả ngày thì bấm Gỡ xanh để gỡ cả các phiếu app đã điền.' : 'Không còn phiếu xanh do sao phiếu.';
    const on = S.staff.map(st => D.on[st.id]), n = k => on.filter(k).length;
    $('#ccInfo').textContent = `Chấm công: ${n(o => o[0] && o[1])} người cả ngày, ${n(o => o[0] && !o[1])} sáng, ${n(o => !o[0] && o[1])} chiều, ${n(o => !o[0] && !o[1])} nghỉ. Chặn giờ: ${D.blocks.length + wkToday().filter(wkOn).length}.`;
    $('#btnGoAll').disabled = App.running || !glAll || !H.canGo;
    $('#btnPlan').disabled = App.running || !H.tickets.length; $('#btnFill').disabled = App.running || !planned || !H.canFill; $('#btnStop').disabled = !App.running;
    ['#btnCheck2', '#btnFix2', '#btnRunSel'].forEach(s => { $(s).disabled = App.running || !H.tickets.length; });
    $('#btnRunSel').textContent = H.canFill ? 'Chạy riêng cho người đã tích' : 'Xếp riêng cho người đã tích';
    $('#dirtyNote').hidden = !App.dirty; $('#roNote').hidden = !!H.canFill || !!H.canGo; $('#roNote').textContent = H.canGo ? 'Bản này gỡ xanh được nhưng chưa điền vào HIS: bảng giờ xếp xong mới nằm trên app.' : 'Bản này chỉ đọc số liệu từ HIS: xếp giờ và soát trùng được, chưa gỡ xanh và chưa điền vào HIS.';
    const ask = $('#goAsk'), gl = goList(false).length, raN = goList(true, true).length; ask.hidden = !App.goAsk || App.running || !glAll;
    if (!ask.hidden) ask.innerHTML = `<b>Gỡ hoàn thành phiếu đang xanh của ngày ${esc(H.dateLabel)}?</b><br>${esc(H.goWarn || 'Phiếu đã gỡ về vàng nhưng vẫn giữ giờ và người làm cũ cho đến khi được điền lại. Sắc thuốc không bị gỡ.')} Phiếu nào HIS không cho gỡ thì app để nguyên và gỡ tiếp phiếu sau.${raN ? ` ${raN} phiếu của người bệnh đã ra viện được để nguyên.` : ''}<div class="row" style="margin-top:8px">${gl ? `<button type="button" data-go="1">Gỡ thử 1 phiếu</button><button type="button" class="primary" data-go="all">Gỡ ${gl} phiếu app chưa điền</button>` : ''}${glAll > gl ? `<button type="button"${gl ? '' : ' class="primary"'} data-go="re">Chạy lại cả ngày: gỡ cả ${glAll} phiếu, gồm ${glAll - gl} phiếu app đã điền</button>` : ''}<button type="button" data-go="no">Thôi</button></div>`;
    $('#ccTitle').textContent = 'Chấm công ngày ' + H.dateLabel;
    const c = $('#cntTrung'); c.hidden = !errs; c.textContent = errs || '';
    renderFillAsk();
    const an = $('#autoNote'); an.hidden = !(App.autoStop || (H.autoNote && (H.noAuto || $('#autoFill').checked))); an.textContent = App.autoStop ? 'Tự điền đang tạm dừng vì lần điền trước có lỗi.' : (H.autoNote || '');
    const af = $('#autoFill').closest('label'); if (af) af.hidden = !!H.noAuto;   // HIS thật: chưa cho tự điền, mỗi lượt điền đều phải bấm và xác nhận
  }
  function renderTrung() {
    const sel = $('#trungType'), cur = sel.value;
    sel.innerHTML = '<option value="">Mọi loại</option>' + Object.keys(TYPES).map(k => `<option value="${k}">${TYPES[k][0]}</option>`).join(''); sel.value = cur;
    const c = App.conflicts;
    if (!c) { $('#trungTiles').innerHTML = ''; $('#trungTable').innerHTML = '<tbody><tr><td class="empty">Chưa kiểm tra. Bấm Kiểm tra trùng để soát mọi ca đã lưu trên HIS và ca dự kiến.</td></tr></tbody>'; return; }
    const e = c.filter(x => x.level === 'err').length, rows = new Map(curRows().map(r => [r.id, r]));
    $('#trungTiles').innerHTML = `<div class="tile ${e ? 'bad' : 'good'}"><b>${e}</b><span>Lỗi</span></div><div class="tile"><b>${c.length - e}</b><span>Cảnh báo</span></div><div class="tile"><b>${rows.size}</b><span>Ca đã soát</span></div>`;
    const list = c.filter(x => !cur || x.type === cur);
    $('#trungTable').innerHTML = '<thead><tr><th>Mức</th><th>Loại</th><th>Ca liên quan</th></tr></thead><tbody>' + (list.length ? list.map(x =>
      `<tr><td><span class="pill ${x.level === 'err' ? 'do' : 'vang'}">${x.level === 'err' ? 'Lỗi' : 'Cảnh báo'}</span></td><td>${esc(typeName(x))}${x.extra ? '<br><span class="muted">' + esc(x.extra) + '</span>' : ''}</td><td class="wrapcell">${x.ids.map(id => esc(rows.has(id) ? rowLabel(rows.get(id)) : '')).join('<br>')}</td></tr>`).join('')
      : `<tr><td colspan="3" class="empty">${c.length ? 'Không có lỗi loại này.' : 'Không có ca nào trùng hoặc sai quy tắc trong ' + rows.size + ' ca đã soát.'}</td></tr>`) + '</tbody>';
  }
  function renderTL() {
    if (!$('#tab-bang').open || App.view !== 'tl') return;
    // Theo người làm: mỗi ô là quãng trực tiếp làm, nên các ô của một người không chồng lên nhau. Theo người bệnh hoặc máy: mỗi ô là cả ca.
    const mode = $('#tlMode').value, rows = curRows(), sh = S.shifts, ppm = mode === 'perf' ? 3.2 : 2.4, find = fold($('#bangSearch').value.trim());
    const t0 = sh[0][0] - 15, t1 = sh[sh.length - 1][1] + 15, W = Math.round((t1 - t0) * ppm), px = m => Math.round((Math.max(t0, Math.min(t1, m)) - t0) * ppm);
    const bad = new Set(); (App.conflicts || []).forEach(c => { if (c.level === 'err') c.ids.forEach(i => bad.add(i)); });
    const uniq = a => Array.from(new Set(a));
    const lanes = (mode === 'perf' ? S.staff.map(s => ({ id: s.id, name: s.ten })) : mode === 'bn' ? Array.from(H.pats.values()).map(p => ({ id: p.bn, name: p.ten })) : uniq([].concat.apply([], WORK.map(mayList).filter(Boolean))).map(m => ({ id: m, name: m })))
      .filter(l => (!find || fold(l.name).indexOf(find) >= 0) && (mode !== 'perf' || !$('#planPerf').value || l.id === $('#planPerf').value));
    const off = [[t0, sh[0][0]]].concat(sh.slice(1).map((s, i) => [sh[i][1], s[0]]), [[sh[sh.length - 1][1], t1]]);
    const grid = `background-size:${30 * ppm}px 100%;background-position:${((30 - t0 % 30) % 30) * ppm}px 0`;
    let ticks = ''; for (let m = Math.ceil(t0 / 30) * 30; m <= t1; m += 30) ticks += `<span style="left:${px(m)}px">${hm(m)}</span>`;
    let html = `<div class="lname muted">${mode === 'perf' ? 'Người làm' : mode === 'bn' ? 'Người bệnh' : 'Máy'}</div><div class="track axis" style="width:${W}px">${ticks}</div>`;
    lanes.forEach(l => {
      const mine = rows.filter(r => (mode === 'perf' ? r.perf : mode === 'bn' ? r.bn : r.may) === l.id);
      let inner = off.map(o => `<div class="off" style="left:${px(o[0])}px;width:${px(o[1]) - px(o[0])}px"></div>`).join('');
      if (mode === 'perf') { const on = D.on[l.id] || [true, true]; sh.forEach((s, i) => { if (!on[i]) inner += `<div class="off" style="left:${px(s[0])}px;width:${px(s[1]) - px(s[0])}px"></div>`; }); }
      blocksEng().filter(b => (mode === 'perf' && b.kind === 'perf' || mode === 'bn' && b.kind === 'bn') && b.who === l.id).forEach(b => { inner += `<div class="blk" style="left:${px(b.s)}px;width:${Math.max(3, px(b.e) - px(b.s))}px" data-tip="Giờ chặn ${hm(b.s)}–${b.e >= 1440 ? 'hết ngày' : hm(b.e)} · ${esc(b.note)}"></div>`; });
      mine.forEach(r => { const end = mode === 'perf' ? r.s + r.busy : r.e, w = Math.max(6, px(end) - px(r.s) - 2);
        inner += `<div class="bar ${r.src === 'plan' ? 'plan' : ''} ${bad.has(r.id) ? 'bad' : ''}" style="left:${px(r.s)}px;width:${w}px" data-tip="${esc(rowLabel(r))}">${w >= 26 ? '<span>' + esc(r.g ? r.g.code : '?') + '</span>' : ''}</div>`; });
      html += `<div class="lname" title="${esc(l.name)}"${mode === 'perf' ? ' data-lane="' + esc(l.id) + '" style="cursor:pointer"' : ''}>${esc(l.name)}</div><div class="track" style="width:${W}px;${grid}">${inner}</div>`;
    });
    $('#tl').innerHTML = lanes.length ? html : '<div class="empty" style="grid-column:1/-1">Không có dòng nào khớp từ đang tìm.</div>';
  }
  const lvOf = on => on[0] && on[1] ? 0 : on[0] ? 1 : on[1] ? 2 : 3, onOf = lv => [[true, true], [true, false], [false, true], [false, false]][lv];
  /* ---------- quản lý nhân viên: dùng ở thẻ Chấm công (nút Cập nhật danh sách) và thẻ Cài đặt ---------- */
  const NHOM = ['Bác sĩ', 'Điều dưỡng', 'Kỹ thuật viên', 'Khác'];
  function mgrResults() {
    const q = (App.stq || '').trim(), all = q ? H.userSearch(q) : [], list = all.slice(0, 8);
    App.stRes = list;
    return q ? (list.length ? list.map((u, i) => `<button type="button" class="small" data-addst="${i}">Thêm ${esc(u.ten)}${u.user ? ' · ' + esc(u.user) : ''}${u.nhom ? ' · ' + esc(u.nhom) : ''}</button>`).join('') + (all.length > 8 ? `<span class="muted">và ${all.length - 8} người khác, gõ thêm để thu hẹp</span>` : '') : '<span class="muted">Không thấy ai khớp tên đang gõ.</span>') : '';
  }
  function mgrHtml(p) {
    return '<div class="scroll tall"><table><thead><tr><th>Họ tên</th><th>Tên đăng nhập HIS</th><th>Nhóm</th><th></th></tr></thead><tbody>' +
      (S.staff.length ? S.staff.map(st => `<tr><td>${esc(st.ten)}</td><td>${esc(st.user || 'chưa có')}</td><td><select id="nh${p}_${eid(st.id)}" data-nhom="${esc(st.id)}" aria-label="Nhóm của ${esc(st.ten)}">${NHOM.concat(st.nhom && NHOM.indexOf(st.nhom) < 0 ? [st.nhom] : []).map(n => `<option${(st.nhom || 'Khác') === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></td>` +
        `<td><button type="button" class="small" data-delst="${esc(st.id)}">${App.delAsk === st.id ? 'Bấm lần nữa để xóa' : 'Xóa'}</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Chưa có nhân viên nào.</td></tr>') + '</tbody></table></div>' +
      `<div class="row"><input type="text" id="stQ${p}" data-stq="1" value="${esc(App.stq || '')}" placeholder="Gõ tên người cần thêm" aria-label="Tìm nhân viên để thêm"><span class="muted">${esc(H.userHint || '')}</span></div><div class="row" data-stres="1">${mgrResults()}</div><p class="muted" data-stmsg="1">${esc(App.stMsg || '')}</p>`;
  }
  function renderMgr() { $('#stMgrCD').innerHTML = mgrHtml('CD'); $('#stMgrCC').hidden = !App.ccEdit; $('#stMgrCC').innerHTML = App.ccEdit ? mgrHtml('CC') : ''; $('#ccEdit').textContent = App.ccEdit ? 'Xong' : 'Cập nhật danh sách'; }
  function mgrInput(e) {   // gõ tên: chỉ vẽ lại phần kết quả để không mất con trỏ
    if (!e.target.dataset.stq) return;
    App.stq = e.target.value; const html = mgrResults();
    Array.from($('#tab-cc').querySelectorAll('[data-stres]')).concat(Array.from($('#tab-cd').querySelectorAll('[data-stres]'))).forEach(el => { el.innerHTML = html; });
  }
  function mgrClick(e) {
    const d = e.target.dataset;
    if (d.addst != null) {
      const u = (App.stRes || [])[+d.addst]; if (!u) return;
      const old = S.staff.find(p => fold(p.ten) === fold(u.ten));
      if (old) { old.user = u.user || old.user; old.uid = u.uid || old.uid; if (u.nhom) old.nhom = u.nhom; App.stMsg = 'Đã cập nhật tài khoản HIS cho ' + old.ten + '.'; }
      else { const p = { id: u.id || u.ten, ten: u.ten, user: u.user || '', uid: u.uid || '', nhom: u.nhom || 'Khác', can: {}, prio: {}, cc: {} }; S.gone = (S.gone || []).filter(x => x !== p.id); S.staff.push(p); ensureStaff(p); App.stMsg = 'Đã thêm ' + p.ten + '. Tích chứng chỉ cho người này ở thẻ Cài đặt.'; }
      App.stq = ''; dirty(); return true;
    }
    if (d.delst != null) {
      if (App.delAsk !== d.delst) { App.delAsk = d.delst; renderMgr(); return true; }
      const st = staffById(d.delst); App.delAsk = null;
      S.staff = S.staff.filter(p => p.id !== d.delst); delete D.on[d.delst]; delete D.week[d.delst]; S.gone = (S.gone || []).concat([d.delst]);   // nhớ để không tự thêm lại
      D.blocks = D.blocks.filter(b => !(b.kind === 'perf' && b.who === d.delst && !b.auto));
      S.wkBlocks.forEach(r => { r.who = r.who.filter(id => id !== d.delst); });
      App.manual.forEach((v, k) => { if (v === d.delst) App.manual.delete(k); });
      App.stMsg = 'Đã xóa ' + (st ? st.ten : d.delst) + ' khỏi bảng nhân viên.'; dirty(); return true;
    }
    return false;
  }
  function renderCC() {
    const rows = curRows(), mins = i => S.shifts[i][1] - S.shifts[i][0];
    $('#ccDay').innerHTML = '<thead><tr><th>Họ tên</th><th>Tên đăng nhập HIS</th><th>Nhóm</th><th class="c">Sáng</th><th class="c">Chiều</th><th>Phút có mặt</th><th>Đã xếp</th></tr></thead><tbody>' +
      (S.staff.length ? S.staff.map(st => { const on = D.on[st.id], rs = rows.filter(r => r.perf === st.id), k = eid(st.id);
        return `<tr><td>${esc(st.ten)}</td><td>${esc(st.user || 'chưa có')}</td><td>${esc(st.nhom || '')}</td><td class="c"><input type="checkbox" id="on0_${k}" data-on="${esc(st.id)}" data-i="0"${on[0] ? ' checked' : ''} aria-label="${esc(st.ten)} làm buổi sáng"></td><td class="c"><input type="checkbox" id="on1_${k}" data-on="${esc(st.id)}" data-i="1"${on[1] ? ' checked' : ''} aria-label="${esc(st.ten)} làm buổi chiều"></td>` +
          `<td>${(on[0] ? mins(0) : 0) + (on[1] ? mins(1) : 0)}</td>` +
          `<td>${rs.length} ca · ${rs.reduce((n, r) => n + r.busy, 0)} phút</td></tr>`; }).join('')
        : '<tr><td colspan="7" class="empty">Chưa có nhân viên nào. Bấm Cập nhật danh sách để thêm.</td></tr>') + '</tbody>';
    const LV = ['Cả ngày', 'Sáng', 'Chiều', 'Nghỉ'], days = H.weekDays;
    $('#ccWeek').innerHTML = '<thead><tr><th>Họ tên</th>' + days.map((d, i) => `<th>${esc(d)}${i === H.todayIdx ? ' (ngày chạy)' : ''}</th>`).join('') + '</tr></thead><tbody>' +
      S.staff.map(st => `<tr><td>${esc(st.ten)}</td>` + days.map((d, i) => `<td><select id="wk_${eid(st.id)}_${i}" data-wk="${esc(st.id)}" data-d="${i}" aria-label="${esc(st.ten)} ngày ${esc(d)}">${LV.map((l, k) => `<option value="${k}"${D.week[st.id][i] === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>`).join('') + '</tr>').join('') + '</tbody>';
    renderMgr();
  }
  function wkNote(r) {
    const who = wkWho(r), ds = DOW.filter((d, i) => r.days[i]);
    if (r.s == null || r.e == null || r.e <= r.s) return 'Chưa dùng được: giờ đến phải sau giờ từ.';
    if (!who.length) return 'Chưa dùng được: chưa tích nhân viên nào.';
    if (!ds.length) return 'Chưa dùng được: chưa tích ngày nào.';
    return `Chặn ${who.length} người từ ${hm(r.s)} đến ${hm(r.e)}, vào ${ds.length === 7 ? 'mọi ngày trong tuần' : ds.join(', ').toLowerCase()}.` + (r.days[wkIdx()] ? (wkOn(r) ? ' Ngày đang chạy có áp dụng.' : ' Ngày đang chạy đã bấm bỏ.') : '');
  }
  function renderWkWeek() {
    const ti = wkIdx(), rules = S.wkBlocks.filter(wkOk), sts = S.staff.filter(st => rules.some(r => r.who.indexOf(st.id) >= 0 && r.days.some(Boolean)));
    $('#wkWeek').innerHTML = '<thead><tr><th>Họ tên</th>' + DOW.map((d, i) => `<th>${d}${i === ti ? ' (ngày chạy)' : ''}</th>`).join('') + '</tr></thead><tbody>' +
      (sts.length ? sts.map(st => `<tr><td>${esc(st.ten)}</td>` + DOW.map((d, i) => { const rs = rules.filter(r => r.days[i] && r.who.indexOf(st.id) >= 0).sort((a, b) => a.s - b.s);
        return `<td>${rs.length ? rs.map(r => `${hm(r.s)}–${hm(r.e)} ${esc(wkName(r))}`).join('<br>') : '<span class="muted">—</span>'}</td>`; }).join('') + '</tr>').join('')
        : '<tr><td colspan="8" class="empty">Chưa có việc cố định nào dùng được.</td></tr>') + '</tbody>';
  }
  function renderWk() {
    if (App.wkKeep) {   // vừa sửa ngay trong bảng: giữ nguyên các ô đang gõ, chỉ cập nhật dòng ghi chú
      App.wkKeep = false; S.wkBlocks.forEach(r => { const el = $('#wkn_' + r.id); if (el) el.textContent = wkNote(r); }); renderWkWeek(); return;
    }
    const nhoms = Array.from(new Set(S.staff.map(st => st.nhom).filter(Boolean)));
    $('#wkList').innerHTML = S.wkBlocks.length ? S.wkBlocks.map(r => `<div class="wk" data-wkid="${r.id}">` +
      `<div class="row"><input type="text" id="wkt_${r.id}" data-wkf="ten" value="${esc(r.ten)}" placeholder="Tên việc, ví dụ Giao ban" size="24" aria-label="Tên việc">` +
      `<label for="wks_${r.id}">Từ <input type="time" id="wks_${r.id}" data-wkf="s" value="${r.s == null ? '' : hm(r.s)}"></label>` +
      `<label for="wke_${r.id}">Đến <input type="time" id="wke_${r.id}" data-wkf="e" value="${r.e == null ? '' : hm(r.e)}"></label>` +
      `<button type="button" class="small" data-wkdel="${r.id}">${App.delAsk === 'w:' + r.id ? 'Bấm lần nữa để xóa' : 'Xóa việc này'}</button></div>` +
      `<div class="who"><span class="muted">Ngày:</span>` + DOW.map((d, i) => `<label class="ck" for="wkd_${r.id}_${i}"><input type="checkbox" id="wkd_${r.id}_${i}" data-wkd="${i}"${r.days[i] ? ' checked' : ''}> ${d}</label>`).join('') +
      `<button type="button" class="small" data-wkset="d5">Thứ 2 đến thứ 6</button><button type="button" class="small" data-wkset="d7">Cả tuần</button></div>` +
      `<div class="who"><span class="muted">Nhân viên:</span>` + (S.staff.length ? S.staff.map(st => `<label class="ck" for="wkw_${r.id}_${eid(st.id)}"><input type="checkbox" id="wkw_${r.id}_${eid(st.id)}" data-wkw="${esc(st.id)}"${r.who.indexOf(st.id) >= 0 ? ' checked' : ''}> ${esc(st.ten)}</label>`).join('') : '<span class="muted">chưa có nhân viên nào trong bảng nhân viên</span>') + '</div>' +
      `<div class="row"><button type="button" class="small" data-wkset="all">Tích tất cả</button>` + (nhoms.length > 1 ? nhoms.map((n, i) => `<button type="button" class="small" data-wkset="n${i}">Cả nhóm ${esc(n)}</button>`).join('') : '') + `<button type="button" class="small" data-wkset="none">Bỏ hết</button></div>` +
      `<div class="muted" id="wkn_${r.id}">${esc(wkNote(r))}</div></div>`).join('')
      : '<div class="empty">Chưa có việc cố định nào. Bấm Thêm việc cố định, đặt tên, giờ, tích ngày và tích những người tham gia.</div>';
    renderWkWeek();
  }
  const touch = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); S.stamp = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const initials = s => fold(s).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'TT';
  function renderCD() {
    const byCert = c => WORK.filter(g => g.cert === c.k);
    $('#certMgr').innerHTML = '<span class="muted">Loại chứng chỉ:</span>' + S.certs.map(c => `<span class="row" style="gap:4px"><input type="text" id="cnm_${c.k}" data-cname="${c.k}" value="${esc(c.label)}" size="18" aria-label="Tên chứng chỉ"><button type="button" class="small" data-delcert="${c.k}">${App.delAsk === 'c:' + c.k ? 'Bấm lần nữa để xóa' : 'Xóa'}</button></span>`).join('') +
      '<span class="row" style="gap:4px"><input type="text" id="certNew" placeholder="Tên chứng chỉ mới" size="18" aria-label="Tên chứng chỉ mới"><button type="button" class="small" id="certAdd">Thêm chứng chỉ</button></span>';
    $('#certMsg').textContent = App.certMsg || '';
    $('#certTable').innerHTML = '<thead><tr><th rowspan="2">Họ tên</th>' + S.certs.map(c => `<th colspan="${byCert(c).length + 3}">${esc(c.label)}</th>`).join('') + '</tr><tr>' +
      S.certs.map(c => '<th class="c">Có chứng chỉ</th>' + byCert(c).map(g => `<th class="c">${esc(g.label)}</th>`).join('') + '<th>Số chứng chỉ</th><th>Ngày hết hạn</th>').join('') + '</tr></thead><tbody>' +
      S.staff.map(st => { const k = eid(st.id); return `<tr><td>${esc(st.ten)}</td>` + S.certs.map(c => { const gs = byCert(c), has = !!st.cc[c.k].co, ex = expired(st, c.k), nr = nearExp(st, c.k);
        return `<td class="c"><input type="checkbox" id="cg_${k}_${c.k}" data-cg="${esc(st.id)}" data-c="${c.k}"${has ? ' checked' : ''} aria-label="${esc(st.ten)} có chứng chỉ ${esc(c.label)}"></td>` +
          gs.map(g => `<td class="c"><input type="checkbox" id="cn_${k}_${g.k}" data-cn="${esc(st.id)}" data-g="${g.k}"${holds(st, g) ? ' checked' : ''} aria-label="${esc(st.ten)} làm ${esc(g.label)}"></td>`).join('') +
          `<td><input type="text" id="cs_${k}_${c.k}" data-cs="${esc(st.id)}" data-c="${c.k}" value="${esc(st.cc[c.k].so)}" size="10" aria-label="Số chứng chỉ ${esc(c.label)} của ${esc(st.ten)}"></td>` +
          `<td><input type="date" id="ch_${k}_${c.k}" data-ch="${esc(st.id)}" data-c="${c.k}" value="${esc(st.cc[c.k].han)}" aria-label="Ngày hết hạn ${esc(c.label)} của ${esc(st.ten)}">${ex ? ' <span class="pill do">Hết hạn</span>' : nr ? ' <span class="pill vang">Sắp hết hạn</span>' : ''}</td>`; }).join('') + '</tr>'; }).join('') + '</tbody>';
    $('#prioTable').innerHTML = '<thead><tr><th>Họ tên</th>' + WORK.map(g => `<th class="c">${esc(g.label)}</th>`).join('') + '</tr></thead><tbody>' +
      S.staff.map(st => `<tr><td>${esc(st.ten)}</td>` + WORK.map(g => canDo(st, g) ? `<td class="c"><select id="pr_${eid(st.id)}_${g.k}" data-pr="${esc(st.id)}" data-g="${g.k}" aria-label="Ưu tiên ${esc(st.ten)} làm ${esc(g.label)}">${[1, 2, 3].map(n => `<option${(st.prio[g.k] || 2) === n ? ' selected' : ''}>${n}</option>`).join('')}</select></td>` : '<td class="c muted">—</td>').join('') + '</tr>').join('') + '</tbody>';
    const certName = k => (S.certs.find(c => c.k === k) || {}).label || 'chưa gán';
    if (!App.svEdit) {
      $('#svcTable').innerHTML = '<thead><tr><th>Thủ thuật</th><th>Chứng chỉ</th><th>Thực hiện</th><th>Lưu, theo dõi</th><th>Tổng</th><th>Máy dùng được hôm nay</th></tr></thead><tbody>' +
        (WORK.length ? WORK.map(g => { const ml = mayList(g);
          return `<tr><td>${esc(g.label)}</td><td>${esc(certName(g.cert))}</td><td>${g.busy} phút</td><td>${g.dur - g.busy ? g.dur - g.busy + ' phút' : '—'}</td><td>${g.dur} phút</td><td class="wrapcell">${ml ? ml.map(m => `<label for="my_${g.k}_${eid(m)}"><input type="checkbox" id="my_${g.k}_${eid(m)}" data-may="${esc(m)}" data-g="${g.k}"${S.mayOff.indexOf(offKey(g, m)) < 0 ? ' checked' : ''}> ${esc(m)}</label>`).join(' ') : '<span class="muted">không dùng máy</span>'}</td></tr>`; }).join('')
          : '<tr><td colspan="6" class="empty">Chưa có thủ thuật nào đang dùng. Bấm Cập nhật để xem và sửa toàn bộ danh sách.</td></tr>') + '</tbody>';
    } else {   // chế độ cập nhật: hiện toàn bộ thủ thuật, sửa được thời gian, chứng chỉ, từ khóa và mã máy
      $('#svcTable').innerHTML = '<thead><tr><th>Tên thủ thuật</th><th>Từ khóa trong tên dịch vụ HIS</th><th>Thực hiện (phút)</th><th>Tổng (phút)</th><th>Chứng chỉ</th><th>Mã máy</th><th></th></tr></thead><tbody>' +
        S.groups.filter(g => !g.skip).map(g => { const ml = mayList(g) || [];
          return `<tr><td><input type="text" id="gl_${g.k}" data-ge="${g.k}" data-f="label" value="${esc(g.label)}" size="20" aria-label="Tên thủ thuật"></td>` +
            `<td><input type="text" id="gk_${g.k}" data-ge="${g.k}" data-f="kw" value="${esc((g.kw || []).join(', '))}" size="22" aria-label="Từ khóa của ${esc(g.label)}"></td>` +
            `<td><input type="number" id="gb_${g.k}" data-ge="${g.k}" data-f="busy" value="${g.busy}" min="1" max="240" aria-label="Phút thực hiện của ${esc(g.label)}"></td>` +
            `<td><input type="number" id="gd_${g.k}" data-ge="${g.k}" data-f="dur" value="${g.dur}" min="1" max="240" aria-label="Tổng phút của ${esc(g.label)}"></td>` +
            `<td><select id="gc_${g.k}" data-ge="${g.k}" data-f="cert" aria-label="Chứng chỉ của ${esc(g.label)}">${S.certs.map(c => `<option value="${c.k}"${c.k === g.cert ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></td>` +
            `<td class="wrapcell">${ml.map(m => `<span class="tag">${esc(m)}<button type="button" data-delmay="${esc(m)}" data-g="${g.k}" aria-label="Bỏ máy ${esc(m)}">×</button></span>`).join(' ') + ` <input type="text" id="gm_${g.k}" data-addmay="${g.k}" placeholder="Thêm mã máy" size="14" aria-label="Thêm mã máy cho ${esc(g.label)}">`}</td>` +
            `<td><button type="button" class="small" data-delg="${g.k}">${App.delAsk === 'g:' + g.k ? 'Bấm lần nữa để xóa' : 'Xóa'}</button></td></tr>`; }).join('') + '</tbody>';
    }
    $('#svEdit').textContent = App.svEdit ? 'Xong' : 'Cập nhật'; $('#svFoot').hidden = !App.svEdit && !App.svMsg; $('#svAdd').hidden = !App.svEdit; $('#svMsg').textContent = App.svMsg || '';
    $('#mayFetch').hidden = !H.fetchMachines; $('#mayFetch').disabled = App.running || !H.tickets.length;
    $('#svStamp').textContent = S.stamp ? 'Cập nhật lần cuối: ' + S.stamp : '';
    $('#svHelp').textContent = App.svEdit ? 'Sửa xong một ô thì bấm ra ngoài ô để ghi nhận. Thời gian lưu, theo dõi bằng tổng trừ thực hiện. Từ khóa là cụm chữ có trong tên dịch vụ trên HIS, cách nhau bằng dấu phẩy.' : 'Thời gian theo Phụ lục 1 của bệnh viện. Mỗi thủ thuật có ô tích máy riêng: tích những máy thủ thuật đó được dùng, bỏ tích máy hỏng hoặc đang bảo trì. Bấm Cập nhật để sửa thời gian, thêm thủ thuật hoặc thêm bớt mã máy.';
    $('#pA0').value = hm(S.shifts[0][0]); $('#pA1').value = hm(S.shifts[0][1]); $('#pB0').value = hm(S.shifts[1][0]); $('#pB1').value = hm(S.shifts[1][1]);
    $('#pLead').value = S.lead; $('#pGapPerf').value = S.gapPerf; $('#pGapBn').value = S.gapBn; $('#pGapMay').value = S.gapMay; $('#pNew').value = S.newBlock; $('#pSpread').value = S.spread ? '1' : '0';
    $('#cfgText').value = JSON.stringify(S);
  }
  // Sửa thủ thuật, mã máy, loại chứng chỉ
  function cdEdit(e) {
    const d = e.target.dataset, v = e.target.value;
    if (d.ge) {
      const g = S.groups.find(x => x.k === d.ge); if (!g) return false;
      if (d.f === 'label') { g.label = v.trim() || g.label; if (g.custom) g.code = initials(g.label); }
      else if (d.f === 'kw') g.kw = v.split(',').map(s => s.trim()).filter(Boolean);
      else if (d.f === 'busy') { g.busy = Math.max(1, Math.round(+v) || 1); if (g.busy > g.dur) g.dur = g.busy; }
      else if (d.f === 'dur') { g.dur = Math.max(1, Math.round(+v) || 1); if (g.busy > g.dur) g.busy = g.dur; }
      else if (d.f === 'cert') g.cert = v;
      touch(); return true;
    }
    if (d.addmay) { const g = S.groups.find(x => x.k === d.addmay), code = v.trim(); if (!g || !code) return false; const key = g.k, a = S.may[key] = S.may[key] || []; if (a.indexOf(code) < 0) { a.push(code); a.sort(); } touch(); return true; }
    if (d.cname) { const c = S.certs.find(x => x.k === d.cname); if (!c) return false; c.label = v.trim() || c.label; touch(); return true; }
    return false;
  }
  function cdClick(e) {
    const d = e.target.dataset, id = e.target.id;
    if (id === 'mayFetch') { runMayFetch(); return; }
    if (id === 'svEdit') { App.svEdit = !App.svEdit; App.delAsk = null; App.svMsg = ''; renderAll(); return; }
    if (id === 'svAdd') { const k = 'g' + Date.now().toString(36); S.groups.push({ k, code: 'TT', label: 'Thủ thuật mới', kw: [], dur: 15, busy: 5, cert: S.certs[0].k, pin: true, custom: true }); App.svMsg = 'Đã thêm một dòng ở cuối bảng. Điền tên, từ khóa và thời gian cho thủ thuật mới.'; touch(); dirty(); return; }
    if (d.delmay != null) { const g = S.groups.find(x => x.k === d.g), key = g.k; S.may[key] = (S.may[key] || []).filter(m => m !== d.delmay); S.mayOff = S.mayOff.filter(m => m !== offKey(g, d.delmay)); touch(); dirty(); return; }
    if (d.delg != null) {
      if (App.delAsk !== 'g:' + d.delg) { App.delAsk = 'g:' + d.delg; renderCD(); return; }
      const g = S.groups.find(x => x.k === d.delg); App.delAsk = null;
      S.groups = S.groups.filter(x => x.k !== d.delg); S.staff.forEach(p => { delete p.can[d.delg]; delete p.prio[d.delg]; });
      App.svMsg = 'Đã xóa thủ thuật ' + (g ? g.label : '') + '. Ca thuộc thủ thuật này sẽ báo chưa có quy tắc thời gian.'; touch(); dirty(); return;
    }
    if (id === 'certAdd') { const name = $('#certNew').value.trim(); if (!name) { App.certMsg = 'Chưa gõ tên chứng chỉ mới.'; renderCD(); return; } const k = 'c' + Date.now().toString(36); S.certs.push({ k, label: name }); S.staff.forEach(ensureStaff); App.certMsg = 'Đã thêm chứng chỉ ' + name + '. Tích ô Có chứng chỉ cho những người có nó; bấm Cập nhật ở bảng Thủ thuật và máy để gán thủ thuật cho chứng chỉ này.'; touch(); dirty(); return; }
    if (d.delcert != null) {
      const c = S.certs.find(x => x.k === d.delcert), n = S.groups.filter(g => g.cert === d.delcert).length;
      if (S.certs.length <= 1) { App.certMsg = 'Phải còn ít nhất một loại chứng chỉ.'; renderCD(); return; }
      if (n) { App.certMsg = 'Còn ' + n + ' thủ thuật thuộc chứng chỉ ' + c.label + '. Chuyển chúng sang chứng chỉ khác rồi mới xóa được.'; App.delAsk = null; renderCD(); return; }
      if (App.delAsk !== 'c:' + d.delcert) { App.delAsk = 'c:' + d.delcert; renderCD(); return; }
      App.delAsk = null; S.certs = S.certs.filter(x => x.k !== d.delcert); App.certMsg = 'Đã xóa chứng chỉ ' + c.label + '.'; touch(); dirty();
    }
  }
  // Phiếu sót: thủ thuật của các ngày trước vẫn chưa được cập nhật (bộ nối cung cấp danh sách)
  function renderSot() {
    const m = H.missed || [];
    $('#sotBox').hidden = !m.length;
    $('#sotTitle').textContent = 'Phiếu sót của các ngày trước: ' + m.length + ' thủ thuật chưa cập nhật';
    $('#sotTable').innerHTML = '<thead><tr><th>Ngày chỉ định</th><th>Người bệnh</th><th>Mã BA</th><th>Thủ thuật</th><th>BS chỉ định</th><th>Ghi chú</th></tr></thead><tbody>' +
      (m.length ? '' : '<tr><td colspan="6" class="empty">Không có phiếu sót trong 7 ngày trước ngày chạy.</td></tr>') + m.map(x => `<tr><td>${esc(x.ngay)}</td><td>${esc(x.tenBN)}</td><td>${esc(x.maBA)}</td><td>${esc(x.ten)}</td><td>${esc(x.bs || '')}</td><td>${x.cu ? 'còn giờ cũ' : 'chưa có giờ'}</td></tr>`).join('') + '</tbody>';
  }
  // Đọc danh sách mã máy từ form của HIS cho từng thủ thuật có ca trong ngày. Máy mới được thêm ở trạng thái chưa tích, vì HIS có thể liệt kê cả máy của nơi khác.
  async function runMayFetch() {
    if (App.running || !H.fetchMachines) return;
    const probes = [], seen = new Set();
    WORK.forEach(g => { const key = g.k; if (seen.has(key)) return; const mine = workTickets().filter(x => (groupOf(x.ten) || {}).k === g.k), t = mine.find(x => x.tt !== 3) || mine[0]; if (t) { seen.add(key); probes.push({ mk: key, label: g.label, t }); } });
    App.running = true; App.svMsg = 'Đang đọc danh sách máy từ HIS: app mở form của từng thủ thuật rồi đóng lại, không lưu...'; renderAll();
    let res = {}, err = '';
    try { res = await H.fetchMachines(probes); } catch (e) { err = e.message || String(e); }
    let added = 0;
    Object.keys(res).forEach(mk => { const a = S.may[mk] = S.may[mk] || []; (res[mk] || []).forEach(code => { if (a.indexOf(code) < 0) { a.push(code); if (S.mayOff.indexOf(mk + '|' + code) < 0) S.mayOff.push(mk + '|' + code); added++; } }); a.sort(); });
    App.running = false;
    App.svMsg = err ? 'Không đọc được danh sách máy: ' + err : added ? 'Đã thêm ' + added + ' mã máy từ HIS, đang để chưa tích. Hãy tích những máy khoa thực sự dùng.' : 'HIS không có mã máy nào ngoài các máy đã có trong bảng.';
    log(App.svMsg); if (added) touch(); dirty();
  }
  function renderPerfFilter() { const v = $('#planPerf').value; $('#planPerf').innerHTML = '<option value="">Mọi người làm</option>' + S.staff.map(s => `<option value="${esc(s.id)}">${esc(s.ten)}</option>`).join(''); $('#planPerf').value = v; }
  const SETUP = [['staff', 'Nhân viên và tài khoản HIS'], ['cert', 'Chứng chỉ của từng người'], ['svc', 'Thủ thuật và máy đang dùng'], ['param', 'Giờ làm việc và khoảng nghỉ']];
  function renderSetup() {   // hiện cho tới khi cả bốn mục được đánh dấu xong; sau đó các mục này chỉ còn trong menu Chức năng
    const su = S.setup || {}, box = $('#setupBox'), left = SETUP.filter(x => !su[x[0]]).length;
    box.hidden = !left; if (!left) return;
    const info = { staff: `${S.staff.length} người, ${S.staff.filter(p => !p.user).length} người chưa có tài khoản HIS`, cert: `${S.staff.filter(p => p.cc && Object.keys(p.cc).some(k => p.cc[k] && p.cc[k].co)).length} người đã tích chứng chỉ`,
      svc: `${S.groups.reduce((k, g) => k + (g.skip ? 0 : (machinesOf(g) || []).length), 0)} máy đang tích`, param: `${hm(S.shifts[0][0])}–${hm(S.shifts[0][1])} và ${hm(S.shifts[1][0])}–${hm(S.shifts[1][1])}` };
    box.innerHTML = '<div class="bar"><h3>Thiết lập lần đầu trên máy này</h3><button type="button" class="link" data-setup="all">Ẩn danh sách này</button></div>' +
      SETUP.map(x => `<div class="it${su[x[0]] ? ' done' : ''}"><span>${su[x[0]] ? 'Đã xong: ' : ''}${esc(x[1])} <span class="muted">· ${esc(info[x[0]])}</span></span><span class="row"><button type="button" class="small" data-open="${x[0]}">Mở</button>${su[x[0]] ? '' : `<button type="button" class="small" data-setup="${x[0]}">Đã xong</button>`}</span></div>`).join('');
  }
  function renderAll() { refreshWork(); renderPerfFilter(); renderTiles(); renderSetup(); renderSot(); renderBlocks(); renderWk(); renderBang(); renderTrung(); renderTL(); renderCC(); renderCD(); }

  /* ---------- sự kiện ---------- */
  // Bảng giờ và Lọc trùng mở ra ngay dưới màn chính; các phần còn lại mở thành cửa sổ nổi, mỗi lần một phần.
  const POPS = { cc: 'Chấm công', bk: 'Chặn giờ trong ngày', wk: 'Chặn giờ cố định theo tuần', sot: 'Phiếu sót của các ngày trước', staff: 'Nhân viên', cert: 'Chứng chỉ: ai được làm thủ thuật nào', prio: 'Ưu tiên người làm cho từng thủ thuật', svc: 'Thủ thuật và máy', param: 'Giờ làm việc và khoảng nghỉ', file: 'Chuyển cài đặt sang máy khác' };
  const closeMenu = () => { $('#menu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); };
  function closePop() { $('#pop').hidden = true; App.pop = null; }
  function openThing(k) {
    closeMenu();
    if (k === 'bang' || k === 'trung') { closePop(); const d = $('#tab-' + k); d.open = true; redraw(); try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} return; }
    if (!POPS[k]) { closePop(); return; }
    App.pop = k; $('#popTitle').textContent = POPS[k];
    Array.from($('#pop').querySelectorAll('[data-pop]')).forEach(el => { el.hidden = el.dataset.pop !== k; });
    $('#tab-cc').hidden = k !== 'cc' && k !== 'bk' && k !== 'wk'; $('#tab-cd').hidden = ['staff', 'cert', 'prio', 'svc', 'param', 'file'].indexOf(k) < 0;
    $('#pop').hidden = false;
  }
  function showTab(k) {   // tên thẻ của các bản trước vẫn dùng được
    if (['bn', 'ds', 'lam', 'tl'].indexOf(k) >= 0) k = 'bang';
    if (k === 'cd') k = 'staff';
    openThing(k === 'run' ? '' : k);
  }
  const tid = v => { const t = H.tickets.find(x => String(x.id) === String(v)); return t ? t.id : v; };
  $('#btnGoAll').addEventListener('click', () => { App.goAsk = true; renderTiles(); });   // luôn hỏi lại trước khi ghi vào HIS
  $('#goAsk').addEventListener('click', e => { const v = e.target.dataset.go; if (!v) return; if (v === 'no') { App.goAsk = false; renderTiles(); } else runGoAll(v === '1' ? 1 : 0, v === 're'); });
  $('#btnPlan').addEventListener('click', () => {
    buildPlan(null);
    const fx = fixGreen(), room = makeRoom(fx.back);
    log(`Xếp giờ cả khoa: ${planCount('planned')} ca đã xếp, ${planCount('stuck')} ca kẹt.${fx.moved ? ` Trong đó ${fx.moved} ca đã xanh trên HIS có lỗi được xếp giờ mới, sẽ ghi đè giờ cũ khi điền.` : ''}${keptNote(fx.kept)}${roomNote(room)}`);
    runCheck(true);
  });
  $('#btnFill').addEventListener('click', () => askFill(null));
  $('#fillAsk').addEventListener('click', e => { const v = e.target.dataset.fill; if (!v) return; const a = App.fillAsk || {}; if (v === 'no') { App.fillAsk = null; renderTiles(); } else runFill(a.scope || null, v === '1' ? 1 : 0); });
  $('#btnStop').addEventListener('click', () => { App.stop = true; });
  // Ô tự điền: mặc định không tích; người dùng tích hay bỏ thì nhớ lại cho lần mở sau, app không tự tích lại
  try { $('#autoFill').checked = localStorage.getItem('xg-auto') === '1'; } catch (e) {}
  $('#autoFill').addEventListener('change', e => { try { localStorage.setItem('xg-auto', e.target.checked ? '1' : '0'); } catch (err) {} renderTiles(); });
  $('#btnCheck2').addEventListener('click', () => runCheck()); $('#btnFix2').addEventListener('click', runFix);
  const redraw = () => { if (!S.staff) return; renderBang(); renderTL(); };   // chưa nạp cài đặt thì chưa có gì để vẽ
  $('#planPerf').addEventListener('change', redraw); $('#planSt').addEventListener('change', redraw); $('#bangSearch').addEventListener('input', redraw);
  $('#bangView').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
  // nút và ô số liệu dẫn sang đúng chỗ cần xem: 'cc', 'trung', hoặc 'bang:<trạng thái>'
  $('#tab-run').addEventListener('click', e => {
    const su = e.target.closest('[data-setup]');
    if (su) { const k = su.dataset.setup; SETUP.forEach(x => { if (k === 'all' || k === x[0]) S.setup[x[0]] = true; }); persist(); renderSetup(); return; }
    const b = e.target.closest('[data-goto]'); if (!b) return;
    const a = b.dataset.goto.split(':');
    if (a[0] === 'bang') { $('#planSt').value = a[1] || ''; $('#planPerf').value = ''; $('#bangSearch').value = ''; if (App.view === 'tl') App.view = 'gio'; }
    openThing(a[0]);
  });
  ['#menubar', '#tab-run', '#pop'].forEach(sel => $(sel).addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openThing(b.dataset.open); }));
  $('#menuBtn').addEventListener('click', () => { const m = $('#menu'); m.hidden = !m.hidden; $('#menuBtn').setAttribute('aria-expanded', String(!m.hidden)); });
  document.addEventListener('click', e => { if (!$('#menu').hidden && (e.composedPath ? e.composedPath() : []).indexOf($('#menubar')) < 0) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('#menu').hidden) closeMenu(); else if (!$('#pop').hidden) closePop(); });
  $('#popClose').addEventListener('click', closePop);
  $('#pop').addEventListener('click', e => { if (e.target === $('#pop')) closePop(); });
  ['bang', 'trung'].forEach(k => {   // nhớ phần nào đang mở
    const d = $('#tab-' + k); try { d.open = localStorage.getItem('xg-open-' + k) === '1'; } catch (e) {}
    d.addEventListener('toggle', () => { try { localStorage.setItem('xg-open-' + k, d.open ? '1' : '0'); } catch (e) {} if (d.open && k === 'bang') redraw(); });
  });
  $('#logMore').addEventListener('click', () => { const o = $('#log').classList.toggle('open'); $('#logMore').textContent = o ? 'Thu lại' : 'Xem hết'; $('#log').scrollTop = $('#log').scrollHeight; });
  $('#trungType').addEventListener('change', renderTrung); $('#tlMode').addEventListener('change', renderTL);
  $('#plan').addEventListener('change', e => { const v = e.target.dataset.pin; if (v == null) return; const id = tid(v); if (e.target.value) App.manual.set(id, e.target.value); else App.manual.delete(id); buildPlan(null); runCheck(true); });   // buildPlan tự lưu
  $('#plan').addEventListener('click', e => { const v = e.target.dataset.skip; if (v == null) return; const id = tid(v); if (App.skip.has(id)) App.skip.delete(id); else { App.skip.add(id); App.plan.delete(id); } savePlan(); renderAll(); });
  const wkOf = el => { const c = el.closest('[data-wkid]'); return c ? S.wkBlocks.find(r => r.id === +c.dataset.wkid) : null; };
  $('#wkAdd').addEventListener('click', () => { const a = S.shifts[0][0]; S.wkBlocks.push({ id: ++S.wkSeq, ten: '', s: a, e: a + 30, days: [true, true, true, true, true, false, false], who: [] }); App.delAsk = null; dirty(); const el = $('#wkt_' + S.wkSeq); if (el) el.focus(); });
  $('#wkList').addEventListener('change', e => {
    const r = wkOf(e.target), d = e.target.dataset; if (!r) return;
    if (d.wkf === 'ten') r.ten = e.target.value.trim();
    else if (d.wkf === 's' || d.wkf === 'e') r[d.wkf] = X.toMin(e.target.value);
    else if (d.wkd != null) r.days[+d.wkd] = e.target.checked;
    else if (d.wkw != null) { r.who = r.who.filter(id => id !== d.wkw); if (e.target.checked) r.who.push(d.wkw); }
    else return;
    App.wkKeep = true; dirty();
  });
  $('#wkList').addEventListener('click', e => {
    const d = e.target.dataset, r = wkOf(e.target); if (!r) return;
    if (d.wkdel != null) {
      if (App.delAsk !== 'w:' + r.id) { App.delAsk = 'w:' + r.id; renderWk(); return; }
      App.delAsk = null; S.wkBlocks = S.wkBlocks.filter(x => x !== r); D.wkOff = D.wkOff.filter(id => id !== r.id); dirty(); return;
    }
    if (d.wkset == null) return;
    const k = d.wkset, nhoms = Array.from(new Set(S.staff.map(st => st.nhom).filter(Boolean)));
    if (k === 'd5') r.days = [true, true, true, true, true, false, false];
    else if (k === 'd7') r.days = [true, true, true, true, true, true, true];
    else if (k === 'all') r.who = S.staff.map(st => st.id);
    else if (k === 'none') r.who = [];
    else if (k[0] === 'n') { const n = nhoms[+k.slice(1)]; S.staff.forEach(st => { if (st.nhom === n && r.who.indexOf(st.id) < 0) r.who.push(st.id); }); }
    App.delAsk = null; dirty();
  });
  $('#bkKind').addEventListener('change', renderBlocks);
  $('#bkAdd').addEventListener('click', () => {
    const kind = $('#bkKind').value, s = X.toMin($('#bkS').value), e = kind === 'rv' ? 1440 : X.toMin($('#bkE').value);
    if (!$('#bkWho').value) { log('Chưa thêm được chặn giờ: chưa chọn người.'); return; }
    if (s == null || e == null || e <= s) { log('Chưa thêm được chặn giờ: giờ đến phải sau giờ từ.'); return; }
    D.blocks.push({ id: ++D.bkSeq, kind, who: $('#bkWho').value, s, e, note: kind === 'rv' ? 'Ra viện, xử trí' : kind === 'perf' ? 'Chặn người làm' : 'Chặn người bệnh', auto: false });
    log('Đã thêm chặn giờ. Bấm Kiểm tra trùng để xem ca nào bị đụng.'); dirty();
  });
  $('#blocks').addEventListener('click', e => {
    const w = e.target.dataset.wkoff;
    if (w) { const id = +w; D.wkOff = wkOn({ id }) ? D.wkOff.concat([id]) : D.wkOff.filter(x => x !== id); dirty(); return; }
    const id = e.target.dataset.delbk; if (!id) return; D.blocks = D.blocks.filter(b => b.id !== +id); dirty();
  });
  $('#plan').addEventListener('change', e => { const b = e.target.dataset.selbn; if (!b) return; if (e.target.checked) App.sel.add(b); else App.sel.delete(b); });
  $('#plan').addEventListener('click', e => { const b = e.target.dataset.runbn; if (b) runBn(new Set([b])); });
  $('#btnRunSel').addEventListener('click', () => { if (!App.sel.size) { log('Chưa tích người bệnh nào để chạy riêng.'); showTab('run'); return; } runBn(new Set(App.sel)); });
  $('#tab-cc').addEventListener('change', e => {
    const d = e.target.dataset;
    if (d.on) { D.on[d.on][+d.i] = e.target.checked; D.week[d.on][H.todayIdx] = lvOf(D.on[d.on]); }
    else if (d.wk) { D.week[d.wk][+d.d] = +e.target.value; if (+d.d === H.todayIdx) D.on[d.wk] = onOf(+e.target.value); }
    else if (d.nhom) { staffById(d.nhom).nhom = e.target.value; }
    else return;
    dirty();
  });
  $('#ccEdit').addEventListener('click', () => { App.ccEdit = !App.ccEdit; App.delAsk = null; App.stMsg = ''; renderAll(); });
  ['#tab-cc', '#tab-cd'].forEach(s => { $(s).addEventListener('input', mgrInput); $(s).addEventListener('click', mgrClick); });
  $('#tab-cd').addEventListener('click', cdClick);
  $('#ccAll').addEventListener('click', () => { S.staff.forEach(st => { D.on[st.id] = [true, true]; D.week[st.id][H.todayIdx] = 0; }); dirty(); });
  $('#ccPrev').addEventListener('click', () => { const p = Math.max(0, H.todayIdx - 1); S.staff.forEach(st => { D.week[st.id][H.todayIdx] = D.week[st.id][p]; D.on[st.id] = onOf(D.week[st.id][p]); }); dirty(); });
  $('#tab-cd').addEventListener('change', e => {
    const d = e.target.dataset, st = staffById(d.cg || d.cn || d.cs || d.ch || d.pr);
    if (cdEdit(e)) { dirty(); return; }
    if (d.nhom) staffById(d.nhom).nhom = e.target.value;
    else if (d.cg) { st.cc[d.c].co = e.target.checked; if (e.target.checked) S.groups.filter(g => g.cert === d.c).forEach(g => { st.can[g.k] = true; }); }   // có chứng chỉ thì mặc định làm được mọi thủ thuật của nó
    else if (d.cn) {
      const g = S.groups.find(x => x.k === d.g), cc = st.cc[g.cert];
      if (e.target.checked && !cc.co) { cc.co = true; S.groups.filter(x => x.cert === g.cert).forEach(x => { st.can[x.k] = false; }); }   // tích thủ thuật đầu tiên thì ghi nhận là có chứng chỉ, các thủ thuật khác vẫn để trống
      st.can[d.g] = e.target.checked;
    }
    else if (d.cs) { st.cc[d.c].so = e.target.value; persist(); return; }
    else if (d.ch) st.cc[d.c].han = e.target.value;
    else if (d.pr) st.prio[d.g] = +e.target.value;
    else if (d.may) { const key = d.g + '|' + d.may; if (e.target.checked) S.mayOff = S.mayOff.filter(m => m !== key); else if (S.mayOff.indexOf(key) < 0) S.mayOff.push(key); }
    else if (/^p[A-Z]/.test(e.target.id || '')) {
      const t = id => X.toMin($(id).value), n = id => Math.max(0, +$(id).value || 0);
      const a0 = t('#pA0'), a1 = t('#pA1'), b0 = t('#pB0'), b1 = t('#pB1');
      if (a0 != null && a1 > a0 && b0 >= a1 && b1 > b0) S.shifts = [[a0, a1], [b0, b1]];
      Object.assign(S, { lead: n('#pLead'), gapPerf: n('#pGapPerf'), gapBn: n('#pGapBn'), gapMay: n('#pGapMay'), newBlock: n('#pNew'), spread: $('#pSpread').value === '1' });
      autoBlocks();
    } else return;
    dirty();
  });
  $('#cfgCopy').addEventListener('click', () => { const el = $('#cfgText'); el.select(); const sel = () => { $('#cfgMsg').textContent = 'Đã bôi đen, bấm Ctrl+C để chép.'; }; try { navigator.clipboard.writeText(el.value).then(() => { $('#cfgMsg').textContent = 'Đã sao chép.'; }, sel); } catch (err) { sel(); } });
  $('#cfgLoad').addEventListener('click', () => { try { const o = JSON.parse($('#cfgText').value); if (!o.staff || !o.shifts) throw 0; delete S.mayV; S.setup = null; Object.assign(S, o); normMay(); normWk(); if (!S.setup) S.setup = { staff: true, cert: true, svc: true, param: true }; S.staff.forEach(ensureStaff); $('#cfgMsg').textContent = 'Đã nạp cài đặt.'; autoBlocks(); dirty(); } catch (err) { $('#cfgMsg').textContent = 'Nội dung không phải file cài đặt hợp lệ.'; } });
  const tip = $('#tip');
  $('#tl').addEventListener('pointermove', e => { const b = e.target.closest('[data-tip]'); if (!b) { tip.hidden = true; return; } tip.textContent = b.dataset.tip; tip.hidden = false; tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 330) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; });
  $('#tl').addEventListener('pointerleave', () => { tip.hidden = true; });
  $('#tl').addEventListener('click', e => {
    const b = e.target.closest('[data-tip]'); if (b) { $('#tlInfo').textContent = b.dataset.tip; return; }
    const l = e.target.closest('[data-lane]'); if (l) { $('#planPerf').value = $('#planPerf').value === l.dataset.lane ? '' : l.dataset.lane; redraw(); }
  });

  // boot: gọi khi mở app hoặc khi vừa tải xong danh sách của một ngày
  function boot(keepSettings) {
    if (!keepSettings) defaults(); else S.staff.forEach(ensureStaff);
    try { App.view = localStorage.getItem('xg-view') || 'gio'; } catch (e) { App.view = 'gio'; }
    refreshWork(); resetApp(); if (H.loadFilled) App.filled = new Set(H.loadFilled());   // nhớ các ca app đã điền trong ngày, để không gỡ xanh nhầm
    restorePlan();
    autoBlocks(); renderAll();
  }
  function tick() {
    if (App.replan && !App.running && H.afterFill) { H.afterFill(''); return; }   // lần đọc lại từ HIS trước đó chưa xong: đọc lại rồi mới xếp lại và điền tiếp
    if (!H.canFill || H.noAuto || App.running || App.dirty || App.replan || App.autoStop || !$('#autoFill').checked) return;
    if (fillStat(null).due) runFill(null, 0, true);
  }
  function clock() { App.plan.forEach(r => { r.wait = false; }); renderAll(); if (H.canFill && !H.noAuto && $('#autoFill').checked && !App.dirty) runFill(); }
  return { S, D, App, X, boot, clock, tick, fillStat, changed, dirty, log, groupOf, mayList, staffName, staffById, ensureStaff, renderAll, showTab, cfg, staffEng, blocksEng, curRows, buildPlan, runFill, runGoAll, runCheck, runFix, runBn, autoBlocks, persist };
}


const CSS = "\n/* Bố cục: một cột. Thanh thẻ chọn màn của app ở trên, màn HIS giả luôn nằm dưới cùng; form HIS bật lên trên khi cập nhật. */\n:host {\n  --bg: #f1f5f4; --surface: #ffffff; --sunk: #e8eeec; --ink: #13201d; --muted: #586a65; --line: #d3dcd9;\n  --accent: #0b6e5f; --accent-ink: #ffffff; --accent-soft: #cfe8e2;\n  --xanh-bg: #dcf2e2; --xanh-ink: #1a6431; --vang-bg: #fbefbf; --vang-ink: #735400;\n  --do-bg: #fbe0db; --do-ink: #9c2717; --info-bg: #e0ebfb; --info-ink: #1b4b8c;\n  --font: \"Be Vietnam Pro\", \"Segoe UI\", system-ui, -apple-system, Roboto, Arial, sans-serif;\n  --r: 8px;\n}\n\n\n\n* { box-sizing: border-box; }\n.wrap { max-width: 1180px; margin: 0 auto; padding-block: 16px 40px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 16px; }\nh1 { font-size: 22px; line-height: 1.25; margin: 0; font-weight: 700; text-wrap: balance; }\nh2 { font-size: 16px; margin: 0; font-weight: 600; }\nh3 { font-size: 14px; margin: 0; font-weight: 600; }\np { margin: 0; }\n.muted { color: var(--muted); }\n.top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-end; justify-content: space-between; }\n.top .lead { max-width: 62ch; }\n.fake { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--vang-ink); background: var(--vang-bg); padding: 2px 8px; border-radius: 4px; margin-bottom: 6px; }\n.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }\n.between { justify-content: space-between; }\n.col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }\n.gap8 { gap: 8px; }\n\n.tabs { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--line); }\n.tabs button { border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: none; padding: 8px 9px; white-space: nowrap; color: var(--muted); font-weight: 500; font-size: 13px; }\n.tabs button[aria-selected=\"true\"] { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }\n.cnt { font-size: 11px; background: var(--do-bg); color: var(--do-ink); border-radius: 999px; padding: 0 6px; margin-left: 4px; }\n\n.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); min-width: 0; }\n.panel > header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--line); }\n.panel .body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }\n.his > header { background: var(--sunk); border-radius: var(--r) var(--r) 0 0; }\n\n.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }\n.step { border: 1px solid var(--line); border-radius: var(--r); padding: 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }\n.step-h { display: flex; align-items: center; gap: 8px; }\n.step .n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--ink); font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }\n.bar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; min-width: 0; }\n.sec { display: flex; flex-direction: column; gap: 8px; min-width: 0; }\n.seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--sunk); }\n.seg button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; color: var(--muted); font-size: 13px; }\n.seg button[aria-pressed=\"true\"] { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 0 0 1px var(--line); }\nbutton.link { border: 0; background: none; padding: 6px 2px; color: var(--accent); }\nbutton.link:hover:not(:disabled) { text-decoration: underline; }\ndetails.fold { border: 1px solid var(--line); border-radius: var(--r); min-width: 0; }\ndetails.fold > summary { padding: 10px 14px; font-size: 14px; font-weight: 600; color: var(--ink); }\ndetails.fold[open] > summary { border-bottom: 1px solid var(--line); }\ndetails.fold > .in { padding: 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }\n\nbutton, select, input, textarea { font: inherit; color: inherit; }\nbutton { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 500; }\nbutton:hover:not(:disabled) { border-color: var(--accent); }\nbutton.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }\nbutton.small { padding: 2px 8px; font-size: 12px; }\nbutton:disabled { opacity: .5; cursor: not-allowed; }\nselect, input[type=\"time\"], input[type=\"number\"], input[type=\"text\"], input[type=\"date\"], textarea { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 5px 8px; max-width: 100%; }\ninput[type=\"number\"] { width: 72px; }\ntd select, td input[type=\"text\"], td input[type=\"date\"] { padding: 2px 6px; }\n:is(button, select, input, textarea, tr[tabindex]):focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }\nlabel { display: inline-flex; gap: 6px; align-items: center; }\n\n/* Dải số liệu: các ô dính liền, ngăn nhau bằng nét mảnh; ô nào bấm được thì mở đúng chỗ cần xem */\n.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }\n.tile { background: var(--surface); border: 0; border-radius: 0; padding: 10px 14px; text-align: left; font-weight: 400; }\nbutton.tile:hover:not(:disabled) { background: var(--sunk); }\n.tile b { display: block; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }\n.tile span { font-size: 12px; color: var(--muted); }\n.tile.bad b { color: var(--do-ink); }\n.tile.good b { color: var(--xanh-ink); }\n\n.scroll { overflow: auto; border: 1px solid var(--line); border-radius: 6px; max-height: 460px; }\n.scroll.tall { max-height: none; }\ntable { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }\nth, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }\nthead th { position: sticky; top: 0; background: var(--sunk); font-weight: 600; font-size: 12px; z-index: 1; }\ntr.grp td { background: var(--sunk); font-weight: 600; }\ntr.sum td { color: var(--muted); font-size: 12px; }\ntd.c, th.c { text-align: center; }\ntd.wrapcell { white-space: normal; min-width: 220px; }\ntd.dsname { white-space: normal; min-width: 150px; max-width: 260px; }\ntd.stcell { white-space: normal; min-width: 140px; }\ntd .sub { color: var(--muted); font-size: 12px; margin-left: 6px; }\n.his tbody tr { cursor: pointer; }\n.his tr.xanh td { background: var(--xanh-bg); }\n.his tr.vang td { background: var(--vang-bg); }\n.his tr.sel td { box-shadow: inset 0 2px 0 var(--accent), inset 0 -2px 0 var(--accent); }\n.old { color: var(--muted); font-style: italic; }\n.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }\n.pill.xanh { background: var(--xanh-bg); color: var(--xanh-ink); }\n.pill.vang { background: var(--vang-bg); color: var(--vang-ink); }\n.pill.do { background: var(--do-bg); color: var(--do-ink); }\n.pill.info { background: var(--info-bg); color: var(--info-ink); }\n.his .pill { border: 1px solid currentColor; }\n.tag button { border: 0; background: none; padding: 0 0 0 4px; font-size: 13px; line-height: 1; color: var(--do-ink); }\n.wk { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }\n.wk .who { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; }\n.wk label.ck { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }\ntr.off td { color: var(--muted); }\n.tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; background: var(--surface); }\n.sticky1 td:first-child, .sticky1 th:first-child { position: sticky; left: 0; background: var(--surface); z-index: 1; }\n.sticky1 thead th:first-child { background: var(--sunk); z-index: 2; }\n.empty { padding: 24px 16px; text-align: center; color: var(--muted); white-space: normal; }\n.note { background: var(--accent-soft); border-radius: 6px; padding: 10px 12px; }\n.note.bad { background: var(--do-bg); color: var(--do-ink); }\n.note.good { background: var(--xanh-bg); color: var(--xanh-ink); }\n.note.warn { background: var(--vang-bg); color: var(--vang-ink); }\n.log { font-size: 12px; max-height: 80px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; background: var(--sunk); font-variant-numeric: tabular-nums; }\n.log div { padding: 1px 0; overflow-wrap: anywhere; }\n.log.open { max-height: 420px; }\n/* Thanh trên và menu Chức năng */\n.menubar { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }\n.menubar #ccInfo { flex: 1 1 220px; min-width: 0; font-size: 13px; }\n.menubtn { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }\n.menubtn::before { content: \"\"; width: 14px; height: 10px; border-block: 2px solid currentColor; background: linear-gradient(currentColor, currentColor) center / 100% 2px no-repeat; }\n.menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; width: min(460px, 100%); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: 0 10px 30px rgba(0, 0, 0, .18); padding: 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 4px 12px; }\n.mgrp { display: flex; flex-direction: column; gap: 2px; min-width: 0; }\n.mgrp > span { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); padding: 4px 8px; }\n.mgrp button { border: 0; background: none; text-align: left; padding: 7px 8px; border-radius: 6px; }\n.mgrp button:hover:not(:disabled) { background: var(--sunk); }\ndetails.card { background: var(--surface); }\ndetails.fold > summary .sum { font-weight: 400; color: var(--muted); font-size: 13px; margin-left: 8px; }\n/* Cửa sổ nổi */\n.pop { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, .4); display: flex; align-items: flex-start; justify-content: center; padding: 16px; }\n.popbox { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); width: min(1000px, 100%); max-height: 100%; display: flex; flex-direction: column; box-shadow: 0 16px 48px rgba(0, 0, 0, .28); min-width: 0; }\n.popbox > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }\n.popbody { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 16px; min-height: 0; }\n/* Danh sách thiết lập lần đầu */\n.setup { border: 1px dashed var(--muted); border-radius: var(--r); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }\n.setup .it { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }\n.setup .it.done { color: var(--muted); }\ndetails { font-size: 13px; }\nsummary { cursor: pointer; color: var(--accent); font-weight: 500; }\n.how { margin: 6px 0 0; padding-left: 18px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }\n.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }\n.fields label { flex-direction: column; align-items: stretch; gap: 4px; font-size: 12px; color: var(--muted); }\n.fields label > * { font-size: 14px; color: var(--ink); }\n\n/* Thanh thời gian */\n.tlwrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; }\n.tl { display: grid; grid-template-columns: 132px max-content; font-size: 12px; font-variant-numeric: tabular-nums; }\n.tl .lname { position: sticky; left: 0; background: var(--surface); z-index: 2; padding: 0 8px; display: flex; align-items: center; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.tl .track { position: relative; height: 30px; border-bottom: 1px solid var(--line); background-image: linear-gradient(to right, var(--line) 1px, transparent 1px); }\n.tl .axis { height: 22px; background-image: none; }\n.tl .axis span { position: absolute; top: 3px; transform: translateX(-50%); color: var(--muted); font-size: 11px; }\n.tl .off { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, var(--sunk) 0 4px, transparent 4px 8px); }\n.tl .blk { position: absolute; top: 2px; bottom: 2px; background: repeating-linear-gradient(45deg, var(--muted) 0 2px, transparent 2px 5px); border: 1px solid var(--muted); border-radius: 3px; opacity: .7; }\n.tl .bar { position: absolute; top: 6px; height: 18px; background: var(--accent); color: var(--accent-ink); border-radius: 4px; overflow: hidden; outline: 2px solid var(--surface); cursor: default; }\n.tl .bar span { padding-left: 4px; font-size: 11px; line-height: 18px; font-weight: 600; }\n.tl .bar.plan { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--accent); }\n.tl .bar.bad { outline: 2px solid var(--do-ink); }\n#tip { position: fixed; z-index: 60; pointer-events: none; background: var(--ink); color: var(--bg); padding: 4px 8px; border-radius: 4px; font-size: 12px; max-width: 320px; }\n.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--muted); }\n.legend b { display: inline-block; width: 22px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 4px; }\n\n.modal { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }\n.dlg { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); width: min(560px, 100%); max-height: 100%; overflow: auto; padding: 16px; }\n.dlg > div { display: flex; flex-direction: column; gap: 12px; }\n.err { color: var(--do-ink); background: var(--do-bg); border-radius: 6px; padding: 8px 10px; }\n#cfList { margin: 0; padding-left: 18px; max-height: 160px; overflow: auto; }\n", HTML = "\n  <!-- ===== Thanh trên: menu Chức năng và tóm tắt hôm nay ===== -->\n  <div class=\"menubar\" id=\"menubar\">\n    <button type=\"button\" id=\"menuBtn\" class=\"menubtn\" aria-haspopup=\"true\" aria-expanded=\"false\" aria-controls=\"menu\">Chức năng</button>\n    <p class=\"muted\" id=\"ccInfo\"></p>\n    <div class=\"row\"><button type=\"button\" class=\"link\" data-open=\"cc\">Chấm công</button><button type=\"button\" class=\"link\" data-open=\"bk\">Chặn giờ</button></div>\n    <div class=\"menu\" id=\"menu\" hidden>\n      <div class=\"mgrp\"><span>Hằng ngày</span>\n        <button type=\"button\" data-open=\"bang\">Bảng giờ</button>\n        <button type=\"button\" data-open=\"trung\">Lọc trùng</button>\n        <button type=\"button\" data-open=\"cc\">Chấm công</button>\n        <button type=\"button\" data-open=\"bk\">Chặn giờ</button>\n        <button type=\"button\" data-open=\"sot\">Phiếu sót các ngày trước</button>\n      </div>\n      <div class=\"mgrp\"><span>Thiết lập một lần</span>\n        <button type=\"button\" data-open=\"staff\">Nhân viên</button>\n        <button type=\"button\" data-open=\"cert\">Chứng chỉ</button>\n        <button type=\"button\" data-open=\"prio\">Ưu tiên người làm</button>\n        <button type=\"button\" data-open=\"svc\">Thủ thuật và máy</button>\n        <button type=\"button\" data-open=\"param\">Giờ làm việc và khoảng nghỉ</button>\n        <button type=\"button\" data-open=\"wk\">Chặn giờ cố định theo tuần</button>\n        <button type=\"button\" data-open=\"file\">Chuyển cài đặt sang máy khác</button>\n      </div>\n    </div>\n  </div>\n\n  <!-- ===== Màn chính: chỉ việc hằng ngày ===== -->\n  <section class=\"panel\" id=\"tab-run\">\n    <div class=\"body\">\n      <div class=\"tiles\" id=\"tiles\"></div>\n      <div class=\"note warn\" id=\"dirtyNote\" hidden>Chấm công, chặn giờ hoặc cài đặt đã đổi sau lần xếp gần nhất. Bấm Xếp giờ để tính lại.</div>\n      <div class=\"note\" id=\"roNote\" hidden>Bản này chỉ đọc số liệu từ HIS: xếp giờ và soát trùng được, chưa gỡ xanh và chưa điền vào HIS.</div>\n      <div class=\"setup\" id=\"setupBox\" hidden></div>\n      <div class=\"steps\">\n        <div class=\"step\"><div class=\"step-h\"><span class=\"n\">1</span><h3>Gỡ xanh</h3></div><p class=\"muted\" id=\"goInfo\"></p><div class=\"row\"><button id=\"btnGoAll\" type=\"button\">Gỡ xanh</button></div></div>\n        <div class=\"step\"><div class=\"step-h\"><span class=\"n\">2</span><h3>Xếp giờ</h3></div>\n          <div class=\"row\"><button id=\"btnPlan\" type=\"button\" class=\"primary\">Xếp giờ</button></div>\n          <details><summary>Cách app xếp giờ</summary><ul class=\"how\">\n            <li>App tính giờ, người làm và máy cho cả khoa rồi tự soát trùng. Bước này chưa ghi gì vào HIS.</li>\n            <li>Ca đã xanh trên HIS được giữ nguyên giờ, trừ khi nó có lỗi hoặc phải dời để lấy chỗ cho ca đang kẹt. Ca xanh của người bệnh đã ra viện luôn giữ nguyên.</li>\n            <li>Mỗi phiếu vàng được đặt vào giờ sớm nhất mà người bệnh, người làm và máy đều trống, sau giờ chỉ định 5 phút và trong giờ làm việc.</li>\n            <li>Người làm được chọn trong những người có chứng chỉ và đi làm buổi đó: ưu tiên 1 trước, rồi đến người đang ít ca hơn.</li>\n            <li>Người làm chỉ bận phần trực tiếp làm (ví dụ 5 phút đầu của điện châm). Người bệnh và máy bận cả ca.</li>\n            <li>Mỗi người bệnh có ca ở cả buổi sáng và buổi chiều.</li>\n            <li>Ca không còn chỗ thì app xem lại cả giờ của các ca đã xanh và dời những ca cần dời. Vẫn không xếp được thì ghi rõ lý do ở cột Trạng thái.</li>\n          </ul></details></div>\n        <div class=\"step\"><div class=\"step-h\"><span class=\"n\">3</span><h3>Điền vào HIS</h3></div>\n          <div class=\"row\"><button id=\"btnFill\" type=\"button\" class=\"primary\">Điền vào HIS</button><button id=\"btnStop\" type=\"button\" disabled>Dừng</button>\n            <select id=\"speed\" aria-label=\"Tốc độ điền\"><option value=\"0\">Nhanh</option><option value=\"320\">Chậm, xem từng bước</option></select></div>\n          <label for=\"autoFill\"><input type=\"checkbox\" id=\"autoFill\"> Tự điền tiếp khi ca qua giờ</label>\n          <p class=\"muted\" id=\"autoNote\" hidden></p></div>\n      </div>\n\n      <div class=\"note warn\" id=\"goAsk\" hidden></div>\n      <div class=\"note warn\" id=\"fillAsk\" hidden></div>\n      <div class=\"note bar\" id=\"sotBox\" hidden><span id=\"sotTitle\"></span><button type=\"button\" class=\"small\" data-open=\"sot\">Xem</button></div>\n\n      <div class=\"sec\"><div class=\"bar\"><h3>Nhật ký</h3><button type=\"button\" class=\"link\" id=\"logMore\">Xem hết</button></div><div class=\"log\" id=\"log\" aria-live=\"polite\"></div></div>\n    </div>\n  </section>\n\n  <!-- ===== Bảng giờ: mở ra, thu lại ngay dưới màn chính ===== -->\n  <details class=\"fold card\" id=\"tab-bang\">\n    <summary>Bảng giờ <span class=\"sum\" id=\"bangSum\"></span></summary>\n    <div class=\"in\">\n      <div class=\"bar\">\n        <div class=\"seg\" id=\"bangView\" role=\"group\" aria-label=\"Cách xem\">\n          <button type=\"button\" data-view=\"gio\">Theo giờ</button><button type=\"button\" data-view=\"bn\">Theo người bệnh</button><button type=\"button\" data-view=\"perf\">Theo người làm</button><button type=\"button\" data-view=\"tl\">Thanh thời gian</button>\n        </div>\n        <div class=\"row\">\n          <input type=\"text\" id=\"bangSearch\" placeholder=\"Tìm người bệnh, người làm, thủ thuật\" aria-label=\"Tìm trong bảng giờ\">\n          <select id=\"planSt\" aria-label=\"Lọc theo trạng thái\"><option value=\"\">Mọi trạng thái</option><option value=\"bad\">Cần xem lại</option><option value=\"plan\">Dự kiến, chưa điền</option><option value=\"his\">Đã lưu trên HIS</option><option value=\"none\">Chưa có giờ</option></select>\n          <select id=\"planPerf\" aria-label=\"Lọc theo người làm\"></select>\n        </div>\n      </div>\n      <div class=\"bar\"><p class=\"muted\" id=\"dsInfo\"></p><button id=\"btnRunSel\" type=\"button\" class=\"primary\" hidden>Chạy riêng cho người đã tích</button></div>\n      <div class=\"scroll tall\" id=\"bangTable\"><table id=\"plan\"></table></div>\n      <div class=\"col gap8\" id=\"tlBox\" hidden>\n        <div class=\"bar\">\n          <div class=\"legend\">\n            <span><b style=\"background:var(--accent)\"></b>Đã lưu trên HIS</span>\n            <span><b style=\"background:var(--accent-soft);box-shadow:inset 0 0 0 1.5px var(--accent)\"></b>Dự kiến, chưa điền</span>\n            <span><b style=\"outline:2px solid var(--do-ink)\"></b>Có trùng</span>\n            <span><b style=\"background:repeating-linear-gradient(45deg,var(--muted) 0 2px,transparent 2px 5px)\"></b>Giờ chặn</span>\n          </div>\n          <select id=\"tlMode\" aria-label=\"Mỗi dòng là\"><option value=\"perf\">Mỗi dòng một người làm</option><option value=\"bn\">Mỗi dòng một người bệnh</option><option value=\"may\">Mỗi dòng một máy</option></select>\n        </div>\n        <div class=\"tlwrap\"><div class=\"tl\" id=\"tl\"></div></div>\n        <p class=\"muted\" id=\"tlInfo\">Theo người làm: mỗi ô là quãng người đó trực tiếp làm. Theo người bệnh hoặc máy: mỗi ô là cả ca. Rê chuột hoặc bấm vào ô để xem chi tiết; bấm tên người làm để chỉ xem người đó.</p>\n      </div>\n    </div>\n  </details>\n\n  <!-- ===== Lọc trùng ===== -->\n  <details class=\"fold card\" id=\"tab-trung\">\n    <summary>Lọc trùng <span class=\"cnt\" id=\"cntTrung\" hidden></span></summary>\n    <div class=\"in\">\n      <div class=\"bar\"><div class=\"tiles\" id=\"trungTiles\" style=\"flex:1 1 260px\"></div>\n        <div class=\"row\"><select id=\"trungType\" aria-label=\"Lọc loại lỗi\"></select><button id=\"btnCheck2\" type=\"button\">Kiểm tra trùng</button><button id=\"btnFix2\" type=\"button\" class=\"primary\">Tự sắp xếp lại</button></div></div>\n      <div class=\"scroll\"><table id=\"trungTable\"></table></div>\n    </div>\n  </details>\n\n  <!-- ===== Cửa sổ nổi: chấm công, chặn giờ, phiếu sót và từng mục cài đặt ===== -->\n  <div class=\"pop\" id=\"pop\" hidden>\n    <div class=\"popbox\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"popTitle\">\n      <header><h2 id=\"popTitle\"></h2><button type=\"button\" id=\"popClose\" class=\"primary\">Xong</button></header>\n      <div class=\"popbody\">\n        <div id=\"tab-cc\" class=\"col\">\n          <div class=\"sec\" data-pop=\"cc\">\n            <div class=\"bar\"><h3 id=\"ccTitle\">Chấm công</h3>\n              <div class=\"row\"><button id=\"ccEdit\" type=\"button\">Cập nhật danh sách</button><button id=\"ccAll\" type=\"button\">Tất cả đi làm</button><button id=\"ccPrev\" type=\"button\">Giống hôm qua</button></div></div>\n            <div class=\"col gap8\" id=\"stMgrCC\" hidden></div>\n            <div class=\"scroll tall\"><table id=\"ccDay\"></table></div>\n            <details class=\"fold\" id=\"ccWeekBox\"><summary>Đánh trước cả tuần</summary><div class=\"in\">\n              <p class=\"muted\">Cột ghi \"ngày chạy\" là ngày đang chạy; sửa ở đâu thì bảng trên đổi theo.</p>\n              <div class=\"scroll tall\"><table id=\"ccWeek\" class=\"sticky1\"></table></div></div></details>\n          </div>\n          <div class=\"sec\" data-pop=\"bk\">\n            <p class=\"muted\">Dòng \"tự động\" là bác sĩ khám người bệnh mới vào trong ngày. Dòng \"hằng tuần\" lấy từ bảng chặn giờ cố định. Thêm chặn khi người bệnh đi chẩn đoán hình ảnh, ra viện, hoặc người làm bận việc khác.</p>\n            <div class=\"row\"><button type=\"button\" class=\"small\" data-open=\"wk\">Sửa bảng chặn giờ cố định theo tuần</button></div>\n            <div class=\"scroll tall\"><table id=\"blocks\"></table></div>\n            <div class=\"row\">\n              <select id=\"bkKind\" aria-label=\"Loại chặn\"><option value=\"perf\">Chặn người làm</option><option value=\"bn\">Chặn người bệnh</option><option value=\"rv\">Ra viện, xử trí</option></select>\n              <select id=\"bkWho\" aria-label=\"Người bị chặn\"></select>\n              <label for=\"bkS\">Từ <input type=\"time\" id=\"bkS\" value=\"08:00\"></label>\n              <label for=\"bkE\" id=\"bkELabel\">Đến <input type=\"time\" id=\"bkE\" value=\"08:10\"></label>\n              <button id=\"bkAdd\" type=\"button\">Thêm chặn giờ</button>\n            </div>\n          </div>\n          <div class=\"sec\" data-pop=\"wk\">\n            <p class=\"muted\">Việc lặp lại hằng tuần của nhiều người, ví dụ giao ban, họp khoa, đi buồng. Đặt một lần ở đây; đến đúng thứ đã tích, app tự chặn giờ của những người được tích và không xếp thủ thuật cho họ trong giờ đó. Hôm nào không áp dụng thì vào Chặn giờ trong ngày, bấm \"Bỏ hôm nay\".</p>\n            <div class=\"col gap8\" id=\"wkList\"></div>\n            <div class=\"row\"><button id=\"wkAdd\" type=\"button\">Thêm việc cố định</button><button type=\"button\" class=\"small\" data-open=\"bk\">Xem chặn giờ của ngày đang chạy</button></div>\n            <details class=\"fold\" id=\"wkWeekBox\"><summary>Xem cả tuần theo từng người</summary><div class=\"in\">\n              <div class=\"scroll tall\"><table id=\"wkWeek\" class=\"sticky1\"></table></div></div></details>\n          </div>\n        </div>\n        <div class=\"sec\" data-pop=\"sot\"><div class=\"scroll tall\"><table id=\"sotTable\"></table></div></div>\n        <div id=\"tab-cd\" class=\"col\">\n          <div class=\"sec\" data-pop=\"staff\"><div class=\"col gap8\" id=\"stMgrCD\"></div></div>\n          <div class=\"sec\" data-pop=\"cert\">\n            <p class=\"muted\">Tích ô Có chứng chỉ cho người có chứng chỉ đó, rồi bỏ tích riêng thủ thuật người đó không làm. Chứng chỉ hết hạn trước ngày chạy thì app ngừng xếp nhóm đó.</p>\n            <div class=\"row\" id=\"certMgr\"></div><p class=\"muted\" id=\"certMsg\"></p>\n            <div class=\"scroll tall\"><table id=\"certTable\" class=\"sticky1\"></table></div></div>\n          <div class=\"sec\" data-pop=\"prio\">\n            <p class=\"muted\">1 là ưu tiên, 2 là thường, 3 là dự phòng. Ô trống là người đó không có chứng chỉ.</p>\n            <div class=\"scroll tall\"><table id=\"prioTable\" class=\"sticky1\"></table></div></div>\n          <div class=\"sec\" data-pop=\"svc\">\n            <div class=\"bar\"><p class=\"muted\" id=\"svHelp\" style=\"flex:1 1 320px\"></p><div class=\"row\"><span class=\"muted\" id=\"svStamp\"></span><button id=\"mayFetch\" type=\"button\" hidden>Lấy danh sách máy từ HIS</button><button id=\"svEdit\" type=\"button\">Cập nhật</button></div></div>\n            <div class=\"scroll tall\"><table id=\"svcTable\"></table></div>\n            <div class=\"row\" id=\"svFoot\" hidden><button id=\"svAdd\" type=\"button\">Thêm thủ thuật</button><span class=\"muted\" id=\"svMsg\"></span></div></div>\n          <div class=\"sec\" data-pop=\"param\">\n            <div class=\"fields\">\n              <label for=\"pA0\">Ca sáng từ<input type=\"time\" id=\"pA0\"></label><label for=\"pA1\">Ca sáng đến<input type=\"time\" id=\"pA1\"></label>\n              <label for=\"pB0\">Ca chiều từ<input type=\"time\" id=\"pB0\"></label><label for=\"pB1\">Ca chiều đến<input type=\"time\" id=\"pB1\"></label>\n              <label for=\"pLead\">Sau giờ chỉ định (phút)<input type=\"number\" id=\"pLead\" min=\"0\" max=\"60\"></label>\n              <label for=\"pGapPerf\">Người làm nghỉ giữa hai ca (phút)<input type=\"number\" id=\"pGapPerf\" min=\"0\" max=\"30\"></label>\n              <label for=\"pGapBn\">Người bệnh nghỉ giữa hai ca (phút)<input type=\"number\" id=\"pGapBn\" min=\"0\" max=\"60\"></label>\n              <label for=\"pGapMay\">Máy nghỉ giữa hai ca (phút)<input type=\"number\" id=\"pGapMay\" min=\"0\" max=\"30\"></label>\n              <label for=\"pNew\">Chặn bác sĩ khi có người bệnh mới (phút)<input type=\"number\" id=\"pNew\" min=\"0\" max=\"60\"></label>\n              <label for=\"pSpread\">Chia ca<select id=\"pSpread\"><option value=\"1\">Chia cả sáng và chiều</option><option value=\"0\">Xếp sớm nhất có thể</option></select></label>\n            </div></div>\n          <div class=\"sec\" data-pop=\"file\">\n            <p class=\"muted\">Sao chép đoạn này để chuyển sang máy khác, hoặc dán vào rồi bấm Nạp.</p>\n            <textarea id=\"cfgText\" rows=\"6\" aria-label=\"Nội dung cài đặt\"></textarea>\n            <div class=\"row\"><button id=\"cfgCopy\" type=\"button\">Sao chép</button><button id=\"cfgLoad\" type=\"button\">Nạp</button><span class=\"muted\" id=\"cfgMsg\"></span></div></div>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <div id=\"tip\" hidden></div>\n  ";

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
  G('sa', 'SA', 'Siêu âm', ['siêu âm'], 15, 15, 'phcn'),
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
.ov { transform: translate(0); position: fixed; top: 10px; right: 10px; bottom: 10px; width: min(820px, 50vw); min-width: 420px; max-width: calc(100vw - 20px); z-index: 2147483001; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.35); display: flex; flex-direction: column; overflow: hidden; }
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
    const D = { on: {}, week: {}, note: day.note || {}, blocks: (day.blocks || []).slice(), wkOff: (day.wkOff || []).slice(), bkSeq: (day.blocks || []).reduce((m, b) => Math.max(m, b.id), 0) };
    ((S && S.staff) || []).forEach(p => { D.week[p.id] = weekDates().map(d => (att[d] && att[d][p.id] != null) ? att[d][p.id] : 0); D.on[p.id] = onOf(D.week[p.id][1]); });
    return { S, D };
  },
  saveSettings(S, D) {
    try {
      const st = store(); st.S = S; st.att = st.att || {}; st.days = st.days || {};
      weekDates().forEach((d, i) => { st.att[d] = st.att[d] || {}; S.staff.forEach(p => { st.att[d][p.id] = i === 1 ? lvOf(D.on[p.id] || [true, true]) : (D.week[p.id] || [])[i] || 0; }); });
      st.days[R.date] = Object.assign({}, st.days[R.date], { note: D.note, blocks: D.blocks.filter(b => !b.auto), wkOff: D.wkOff || [] });
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch (e) {}
  },
  /* ----- điền giờ: app mở form "Cập nhật PTTT" của HIS cho từng ca, điền rồi bấm "Lưu đóng", đúng như làm tay ----- */
  fillWarn: 'App mở form "Cập nhật PTTT" của HIS cho từng ca, điền giờ, người làm, mã máy rồi bấm "Lưu đóng". Cảnh báo trùng của HIS được bấm Đồng ý và ghi vào nhật ký. Ca nào HIS từ chối thì app ghi lý do, bỏ qua ca đó và điền tiếp ca sau; 5 ca liên tiếp bị từ chối thì dừng.',
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
  goWarn: 'App chọn từng phiếu trên lưới của HIS rồi bấm mục "Gỡ hoàn thành phiếu", đúng như bạn bấm chuột phải. Mọi phiếu đang xanh của ngày đều bị gỡ (trừ sắc thuốc), kể cả phiếu người khác đã cập nhật đúng, nên chỉ dùng trước khi cập nhật thủ thuật của ngày đó hoặc khi muốn chạy lại cả ngày. Phiếu đã gỡ vẫn giữ giờ và người làm cũ.',
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
    // Không chờ theo số giây cố định: mỗi bước chờ đúng dấu hiệu của HIS rồi đi tiếp ngay.
    const dg = $j('#grdCKChitiet'), dv = String(t.ref.DICHVUKHAMBENHID), item = document.getElementById('GoHoanThanhPhieu');
    const hasDv = () => { const ids = dg.jqGrid('getDataIDs'); for (let i = 0; i < ids.length; i++) if (String(dg.jqGrid('getRowData', ids[i]).DICHVUKHAMBENHID) === dv) return true; return false; };
    const armed = () => { try { const ev = $j._data(item, 'events'); return !!(ev && ev.click && ev.click.length); } catch (e) { return false; } };
    g.jqGrid('setSelection', row, true);                               // chọn dòng phiếu, HIS tự tải dịch vụ của phiếu đó
    // HIS xem lưới dịch vụ khi kiểm tra phiếu đã ký số, nên phải chờ tới khi lưới hiện dịch vụ của đúng phiếu này
    if (!(await waitFor(() => idle('load_grdCKChitiet') && hasDv(), 8000))) return { ok: false, err: 'HIS chưa tải được dịch vụ của phiếu ' + t.soPhieu };
    if (String(g.jqGrid('getGridParam', 'selrow')) !== String(row)) return { ok: false, err: 'không chọn được phiếu ' + t.soPhieu + ' trên lưới của HIS' };
    closeAlert();
    // Sau mỗi lần bấm, HIS tháo mục menu ra khoảng nửa giây rồi mới gắn lại; bấm trong lúc đó là mất. Chờ tới khi mục đã được gắn lại.
    if (!(await waitFor(armed, 2500))) await sleep(600);
    $j(item).trigger('click');                                         // mục "Gỡ hoàn thành phiếu" của menu chuột phải
    await waitFor(() => alertText() !== '', 8000);
    const msg = alertText(); closeAlert();
    if (!/thành công/i.test(msg)) return { ok: false, err: msg ? 'HIS báo: ' + msg : 'HIS không báo kết quả cho phiếu ' + t.soPhieu };
    await waitFor(() => !idle('load_grdCK'), 300);                     // gỡ xong HIS tải lại danh sách: chờ nó bắt đầu, rồi chờ xong
    await waitFor(() => idle('load_grdCK'), 20000);
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
    const raN = Array.from(pats.values()).filter(p => p.ra).length, kinds = {};
    pats.forEach(p => { const k = p.ttkb || 'trống'; kinds[k] = (kinds[k] || 0) + 1; });
    core.log('Trạng thái người bệnh trên HIS: ' + Object.keys(kinds).map(k => '"' + k + '" ' + kinds[k] + ' người').join(', ') + '. ' + (raN ? raN + ' người đã ra viện: ca xanh của họ được giữ nguyên, không tự xếp lại.' : 'App không thấy ai đã ra viện.'));
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
// Người bệnh đã ra viện theo HIS: cột TRANGTHAIKHAMBENH của danh sách phiếu. Mã 9, hoặc chữ "kết thúc", "ra viện" được coi là đã ra viện.
const ttkbOf = v => String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim();
const raVien = v => { const x = fold(ttkbOf(v)); return x === '9' || /ket thuc|ra vien|da ra/.test(x); };
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
          if (!pats.has(bn)) { const v = tk.THOIGIANVAOVIEN || ''; pats.set(bn, { bn, ten: tk.TENBENHNHAN, maBA: tk.MABENHAN, bsId: tk.NGUOITAO || null, vao: v.slice(0, 10) === d ? timeOf(v) : null, ra: raVien(tk.TRANGTHAIKHAMBENH), ttkb: ttkbOf(tk.TRANGTHAIKHAMBENH) }); }
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
    if (t.may) { const key = g.k, a = S.may[key] = S.may[key] || []; if (a.indexOf(t.may) < 0) { a.push(t.may); a.sort(); } }   // thủ thuật có mã máy trên HIS thì coi là cần máy
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
