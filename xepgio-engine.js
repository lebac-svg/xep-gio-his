// Bộ xếp giờ thủ thuật. File này được tách tự động từ his-mo-phong.html, sửa ở đó rồi tách lại.
const X = (function () {
  const toMin = s => { const m = /(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const toHM = n => n == null ? '' : String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const rank = (st, gk) => (st.prio && st.prio[gk]) || 2;
  const mayKey = m => String(m || '').replace(/[\s.\-_\/\[\]()]/g, '').toLowerCase();   // mã máy bỏ dấu chấm, gạch, ngoặc, khoảng trắng: để nhận ra cùng một máy khi HIS đổi cách viết mã

  // Sổ ghi các khoảng đã bận của người làm (P:), người bệnh (B:), máy (M:). Khoảng chặn không cộng thêm thời gian nghỉ.
  function makeBook(blocks) {
    const book = new Map();
    const get = k => { let v = book.get(k); if (!v) book.set(k, v = []); return v; };
    const bk = {
      // skipWait: không tính các khoảng chặn đang chờ (b.wait), để biết ca kẹt có phải chỉ vì khoảng chặn đó
      clash: (k, s, e, gap, skipWait) => get(k).some(iv => { if (skipWait && iv[3]) return false; const g = iv[2] ? 0 : gap; return s < iv[1] + g && iv[0] < e + g; }),
      add: (k, s, e, isBlock, wait) => { get(k).push([s, e, isBlock ? 1 : 0, wait ? 1 : 0]); },
      wait: new Map()   // người bệnh -> ghi chú của khoảng chặn đang chờ (ví dụ chờ kết quả chẩn đoán hình ảnh)
    };
    (blocks || []).forEach(b => { bk.add((b.kind === 'perf' ? 'P:' : 'B:') + b.who, b.s, b.e, true, b.wait); if (b.wait && b.kind !== 'perf') bk.wait.set(b.who, b.wait); });
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
        if (!relax.bn && bk.clash('B:' + t.bn, s, s + t.dur, cfg.gapBn, relax.wait)) continue;
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
    const w = bk.wait.get(t.bn);
    if (w && can({ wait: true })) return w;   // bỏ riêng khoảng chặn đang chờ thì xếp được: ca kẹt vì khoảng chặn đó
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
        const free = !(k.perf && bk.clash('P:' + k.perf, k.s, be, cfg.gapPerf)) && !bk.clash('B:' + t.bn, k.s, k.e, cfg.gapBn);
        if (t.swapMay) {   // ca chỉ sai hoặc thiếu mã máy: giữ nguyên giờ và người làm, chỉ đổi sang máy đang dùng còn trống; ưu tiên máy cùng mã (chỉ khác dấu chấm, khoảng trắng)
          const frees = free ? (t.machines || []).filter(m => !bk.clash('M:' + m, k.s, k.e, cfg.gapMay)) : [];
          const may = frees.find(m => mayKey(m) === mayKey(k.may)) || frees[0];
          if (may) { put(t, k.perf, k.s, k.e, be, may); out.set(t.id, { s: k.s, e: k.e, may, perf: k.perf || null, status: 'planned', note: '' }); return; }
        } else if (free && !(k.may && bk.clash('M:' + k.may, k.s, k.e, cfg.gapMay))) {
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
      if (r.badMay) add('oldmay', 'err', [r.id], 'mã ' + r.may);   // mã máy trên ca không có trong danh sách máy của thủ thuật (ví dụ mã cũ HIS đã đổi)
      if (r.need && r.e - r.s < r.need) add('dur', 'err', [r.id], 'làm ' + (r.e - r.s) + ' phút, quy định ' + r.need + ' phút');
      (blocks || []).forEach(b => {
        if (b.kind === 'perf' && b.who === r.perf && r.s < b.e && b.s < Math.min(r.e, r.s + r.busy)) add('pblock', 'err', [r.id], b.note);
        if (b.kind === 'bn' && b.who === r.bn && r.s < b.e && b.s < r.e) add('bblock', 'err', [r.id], b.note);
      });
    });
    return out;
  }
  return { toMin, toHM, plan, check, prepare, pass, mayKey };
})();
if (typeof module !== 'undefined') module.exports = X;
