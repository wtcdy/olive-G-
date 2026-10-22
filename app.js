/* G端动态事件接入看板 · 静态版交互脚本 */
(function () {
  'use strict';

  var D = window.RTT_DATA;
  var M = D.MONTHS;
  var N = M.length;
  var INST = D.institute;
  var C_INST = D.INSTITUTE_COLOR;
  var C_PROV = '#2f5597';
  var C_NO = '#f1f5f9';

  /* ---------- 工具 ---------- */
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function pct(n, b) { return b ? (n / b * 100) : 0; }
  function pctStr(n, b) { return pct(n, b).toFixed(1) + '%'; }
  function shortNum(n) {
    n = Number(n || 0);
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
    return fmt(n);
  }
  function sum(a) { return a.reduce(function (x, y) { return x + (y || 0); }, 0); }
  function labelColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.62 ? '#0f172a' : '#ffffff';
  }
  var TIP = {
    backgroundColor: 'rgba(255,255,255,.98)', borderColor: '#e2e8f0', borderWidth: 1,
    padding: [10, 12], textStyle: { color: '#0f172a', fontSize: 12 },
    extraCssText: 'box-shadow:0 8px 24px -8px rgba(15,23,42,.25);border-radius:8px;'
  };

  /* ---------- 派生数据 ---------- */
  var custs = D.customers.map(function (c) {
    var t = sum(c.monthly);
    return { name: c.name, kind: c.kind, province: c.province, start: c.start, note: c.note, monthly: c.monthly, total: t };
  }).sort(function (a, b) { return b.total - a.total; });

  var provTotal = sum(custs.map(function (c) { return c.total; }));
  var grandTotal = provTotal + INST.total;
  var monthlyTotal = [];
  for (var i = 0; i < N; i++) monthlyTotal.push(sum(custs.map(function (c) { return c.monthly[i]; })));

  var allRows = custs.concat([{
    name: INST.name, kind: 'institute', province: '部级', start: '2026-01 前',
    note: INST.note, total: INST.total, isInst: true, monthly: INST.monthly
  }]);
  allRows.sort(function (a, b) { return b.total - a.total; });

  var statusCount = {};
  D.STATUS_ORDER.forEach(function (k) { statusCount[k] = 0; });
  D.provinces.forEach(function (p) { statusCount[p.status]++; });
  var byGeo = {};
  D.provinces.forEach(function (p) { byGeo[p.geoName] = p; });

  var provOnly = custs.filter(function (c) { return !c.isInst; });

  /* 平台月度总量（全部客户，含道研中心） */
  var grandMonthly = [];
  for (var gi = 0; gi < N; gi++) grandMonthly.push(monthlyTotal[gi] + INST.monthly[gi]);

  /* ---------- 数据异常预警（展示按单周，判定按滚动 14 天，仅看本期，不回溯） ----------
   * ALC = alert        ：展示窗口，本期单周（周一 ~ 周日，7 天），用于卡片上的周期表述
   * DET = alertDetect  ：检测窗口，滚动 14 天，只用于判定
   * 两者解耦的原因：单周窗口会把跨边界的短断流切碎（陕西 10-17~10-19 连续三天为 0，
   * 被本期与下期两个窗口各自切成 2 天和 1 天，两边都判定不了）。 */
  var ALC = D.alert;
  var DET = D.alertDetect || D.alert;
  var DET_DAYS = (DET && DET.days) || [];
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    if (!s.length) return 0;
    var m = Math.floor(s.length / 2);
    return (s.length % 2) ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* 低频客户判定：取该客户最近 3 个「有数据」月份的日均（按月 30 天粗算），
   * 最大值仍 < 20 条/天 → 属低频客户。
   * 低频客户（如吉林高速，月日均约 1 条）零星归零不是断流，只是量级太小，
   * 按用户要求单独归为「量级偏低·关注」，不进断流预警。 */
  function lowVolumeCust(name) {
    var c = null;
    for (var i = 0; i < custs.length; i++) { if (custs[i].name === name) { c = custs[i]; break; } }
    if (!c || !c.monthly) return false;
    var vals = c.monthly.filter(function (v) { return v > 0; }).slice(-3);
    if (!vals.length) return false;
    var mx = 0;
    vals.forEach(function (v) { mx = Math.max(mx, v / 30); });
    return mx < 20;
  }

  /* 找出窗口内所有「连续 ≥3 天为 0」的区段（不再要求落在窗口末尾） */
  function zeroRuns(d) {
    var runs = [], i = 0;
    while (i < d.length) {
      if (d[i] === 0) {
        var j = i;
        while (j + 1 < d.length && d[j + 1] === 0) j++;
        if (j - i + 1 >= 3) runs.push({ from: i, to: j, span: j - i + 1 });
        i = j + 1;
      } else i++;
    }
    return runs;
  }

  var alerts = [];
  if (DET && DET.customers) {
    DET.customers.forEach(function (row) {
      var d = row.daily || [];
      if (d.length < 5) return;
      var runs = zeroRuns(d);
      if (runs.length && lowVolumeCust(row.name)) {
        /* 低频客户：零星归零不算断流，只提示「量级偏小、个别天无数据」 */
        var zeroDays = 0, sum = 0;
        d.forEach(function (v) { if (v === 0) zeroDays++; sum += v; });
        alerts.push({
          name: row.name, kind: 'lowvol',
          zeroDays: zeroDays, avgAll: +(sum / d.length).toFixed(1),
          span: runs[runs.length - 1].span, runs: runs.length, win: d.length
        });
        return;
      }
      if (runs.length) {
        var r = runs[runs.length - 1];                 // 取最近一段
        var after = r.to < d.length - 1 ? d.slice(r.to + 1) : [];
        /* 「已恢复」要求段后每天都 > 0：吉林 10-16~10-18 断流后只有 10-19 的 1 条、
           10-20/10-21 又归零，这种「闪一条又断」不能算恢复。 */
        var recovered = after.length > 0 && after.every(function (v) { return v > 0; });
        alerts.push({
          name: row.name, kind: 'zero',
          span: r.span,
          segFrom: DET_DAYS[r.from] || '', segTo: DET_DAYS[r.to] || '',
          recovered: recovered,
          after: after,
          runs: runs.length,
          win: d.length
        });
        return;                                        // 命中①不再判②
      }
      var last3 = d.slice(-3);
      var base = median(d.slice(0, -3));               // 本期「平时」水平（不含最后 3 天）
      if (base >= 20 && last3.every(function (v) { return v < base * 0.5; })) {
        alerts.push({ name: row.name, kind: 'low', last3: last3, base: base, span: 3, win: d.length });
      }
    });
  }
  /* 严重度排序：断流(未恢复) > 断流(已恢复) > 量级异常 > 量级偏低·关注 */
  function rank(a) {
    if (a.kind === 'zero') return a.recovered ? 1 : 0;
    if (a.kind === 'low') return 2;
    return 3;                                          // lowvol
  }
  alerts.sort(function (a, b) {
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return b.span - a.span;
  });

  /* ---------- 道研中心「月度量级」判定（整月口径，不看单日） ----------
   * 道研中心日级取数受限，改用整月数据量判定：
   *   基线 = 往前 baseWindow 个完整自然月的中位数；比值 = 最新完整月 / 基线
   *   ≤ alertRatio → 预警；≤ watchRatio → 关注；否则正常；末月非完整月自动跳过 */
  var IAL = D.alertInstitute;
  var instAlert = null;
  if (IAL && INST && INST.monthly) {
    var cmpMonths = INST.monthly.slice(0, INST.monthly.length - (IAL.skipLast || 0));
    if (cmpMonths.length >= IAL.baseWindow + 1) {
      var ci = cmpMonths.length - 1;
      var baseMed = median(cmpMonths.slice(ci - IAL.baseWindow, ci));
      var ratio = baseMed > 0 ? cmpMonths[ci] / baseMed : 1;
      var prevRatio = null;
      if (ci >= 1) {
        var pBase = cmpMonths.slice(Math.max(0, ci - 1 - IAL.baseWindow), ci - 1);
        if (pBase.length >= 3) prevRatio = cmpMonths[ci - 1] / median(pBase);
      }
      instAlert = {
        month: M[ci], idx: ci, cur: cmpMonths[ci], base: baseMed, ratio: ratio,
        prevMonth: ci >= 1 ? M[ci - 1] : '', prevVal: ci >= 1 ? cmpMonths[ci - 1] : 0,
        prevRatio: prevRatio,
        mode: ratio <= IAL.alertRatio ? 'alert' : (ratio <= IAL.watchRatio ? 'watch' : 'ok')
      };
    }
  }
  var instIssue = !!(instAlert && instAlert.mode !== 'ok');

  (function renderAlert() {
    var el = document.getElementById('alertPanel');
    if (!el) return;
    var win = (ALC && ALC.window) || { from: '', to: '' };
    var dwin = (DET && DET.window) || win;
    var covered = (ALC && ALC.customers) ? ALC.customers.length : 0;
    var winShort = win.from.slice(5) + '～' + win.to.slice(5);     // 10-12～10-18（本期单周，展示口径）
    var dWinShort = dwin.from.slice(5) + '～' + dwin.to.slice(5);  // 10-08～10-21（滚动 14 天，检测口径）

    var head = '<div class="alert-hd">' +
      '<span class="alert-title"><i class="alert-dot"></i>数据异常预警</span>' +
      '<span class="alert-win">展示周期 ' + winShort + '（本周） · 检测范围 滚动 ' +
      ((DET && DET.customers && DET.customers[0]) ? DET.customers[0].daily.length : 14) +
      ' 天 ' + dWinShort + ' · 仅看本期，不回溯</span>' +
      '</div>';

    var footTxt = '日级规则（仅 ' + covered + ' 家省级 / 城市客户，不含道研中心）：① 检测窗口内出现<b>任意一段连续 ≥3 天为 0</b>即判断流' +
      '（不再要求落在窗口末尾，避免跨周断流被切碎），并标明该段是否已恢复；② 最近 3 天每天都低于本期「平时日均」的 50%' +
      '——<b>低频客户（月日均 < 20 条）的零星归零不算断流</b>，只作「量级偏低·关注」；' +
      '（平时日均取检测窗口前 ' + (DET && DET.customers && DET.customers[0] ? Math.max(1, DET.customers[0].daily.length - 3) : 11) +
      ' 天的中位数，< 20 条/天不参与规则②）。' +
      '月度规则（仅道研中心）：最新完整自然月对比<b>往前 ' + (IAL ? IAL.baseWindow : 6) + ' 个完整月的中位数</b>，' +
      '≤ ' + Math.round((IAL ? IAL.alertRatio : 0.7) * 100) + '% 预警、≤ ' + Math.round((IAL ? IAL.watchRatio : 0.85) * 100) + '% 关注；非完整月不参与判定。' +
      '数据每周一 08:00 更新上一自然周；<b>判定用滚动 14 天、展示按单周</b>，历史数据不参与本期判定。';

    var body;
    if (!alerts.length && !instIssue) {
      el.className = 'card alert-card ok';
      body = '<div class="alert-empty">本期未发现断流、量级异常或整月大幅下滑，' + covered + ' 家省级 / 城市客户及道研中心数据均正常。</div>' +
        '<div class="alert-foot">' + footTxt + '</div>';
    } else {
      el.className = 'card alert-card';
      var rows = alerts.map(function (a) {
        var tag, detail, extra, cls = '';
        if (a.kind === 'zero') {
          tag = a.recovered ? '断流·已恢复' : '断流';
          cls = a.recovered ? ' low' : '';
          detail = '<b>' + a.segFrom + '～' + a.segTo + '</b> 连续 <b>' + a.span + '</b> 天为 0' +
            (a.runs > 1 ? '（窗口内共 ' + a.runs + ' 段）' : '');
          extra = a.recovered
            ? '已恢复，其后各日：' + a.after.join(' / ') + ' 条'
            : (a.after.length
              ? '其后各日：' + a.after.join(' / ') + ' 条，<b>仍未恢复</b>'
              : '至检测窗口末日<b>仍未恢复</b>');
        } else if (a.kind === 'lowvol') {
          tag = '量级偏低·关注';
          cls = ' low';
          detail = '数据量级较小（日均约 <b>' + a.avgAll + '</b> 条），检测窗口 ' + a.win +
            ' 天内有 <b>' + a.zeroDays + '</b> 天无数据';
          extra = '低频客户，个别天无数据属正常波动，仅作关注，非断流';
        } else {
          tag = '量级异常';
          cls = ' low';
          var avg3 = (a.last3[0] + a.last3[1] + a.last3[2]) / 3;
          detail = '最近 3 天日均 <b>' + Math.round(avg3) + '</b>，低于本期平时日均 ' + Math.round(a.base) + ' 的 50%';
          extra = '最后 3 天：' + a.last3.join(' / ');
        }
        return '<div class="alert-item' + cls + '">' +
          '<span class="alert-tag">' + tag + '</span>' +
          '<span class="an">' + a.name + '</span>' +
          '<span class="ad">' + detail + '</span>' +
          '<span class="ab">' + extra + '（检测 ' + dWinShort + '）</span>' +
          '</div>';
      }).join('');

      if (instIssue) {
        var warn = (instAlert.mode === 'alert');
        var dropPct = (1 - instAlert.ratio) * 100;
        var sub = instAlert.prevMonth
          ? '环比：' + instAlert.prevMonth + ' ' + fmt(instAlert.prevVal) +
            (instAlert.prevRatio !== null ? '（当时的比值 ' + (instAlert.prevRatio * 100).toFixed(1) + '%）' : '')
          : '';
        rows += '<div class="alert-item mony' + (warn ? '' : ' low') + '">' +
          '<span class="alert-tag">' + (warn ? '月度量级' : '月度量级·关注') + '</span>' +
          '<span class="an">' + (IAL && IAL.name ? IAL.name : '道研中心') + '</span>' +
          '<span class="ad">' + instAlert.month + ' <b>' + fmt(instAlert.cur) + '</b> 条，为近 ' +
          (IAL ? IAL.baseWindow : 6) + ' 个月常态（' + fmt(Math.round(instAlert.base)) + '）的 <b>' +
          (instAlert.ratio * 100).toFixed(1) + '%</b>，低于常态 ' + dropPct.toFixed(1) + '%' + '</span>' +
          '<span class="ab">' + sub + '</span>' +
          '</div>';
      }

      body = '<div class="alert-body">' + rows + '</div>' +
        '<div class="alert-foot">' + footTxt + '</div>';
    }
    el.innerHTML = head + body;
  })();

  /* ---------- KPI ---------- */
  var top3 = provOnly.slice(0, 3);
  var kpis = [
    { label: '省级 / 城市客户合计', value: fmt(provTotal), sub: custs.length + ' 家客户 · 占总量 ' + pctStr(provTotal, grandTotal), color: C_PROV },
    { label: '道研中心（部级）', value: fmt(INST.total), sub: '占总量 ' + pctStr(INST.total, grandTotal) + ' · 为省级合计的 ' + (INST.total / provTotal).toFixed(2) + ' 倍', color: C_INST, inst: true },
    { label: '平台事件总量', value: fmt(grandTotal), sub: '含道研中心 · 2026-01-01 起' },
    {
      label: '省市级客户 TOP3',
      sub: '占比为占省市级客户合计',
      list: top3.map(function (c, i) {
        return '<div class="kpi-li"><span class="idx">' + (i + 1) + '</span><span class="nm' + (c.isInst ? ' inst' : '') + '">' + c.name +
          '</span><span class="vv">' + fmt(c.total) + '</span><span class="pp">' + pctStr(c.total, provTotal) + '</span></div>';
      }).join('')
    },
    { label: '覆盖天数', value: D.COVER_DAYS + ' 天', sub: '2026-01-01 ~ ' + D.DATA_CUTOFF + ' · 有数据客户 ' + allRows.length + ' 家' }
  ];
  document.getElementById('kpiRow').innerHTML = kpis.map(function (k) {
    if (k.list) {
      return '<div class="card kpi"><div class="label">' + k.label + '</div><div class="kpi-list">' + k.list + '</div>' +
        (k.sub ? '<div class="sub">' + k.sub + '</div>' : '') + '</div>';
    }
    return '<div class="card kpi' + (k.inst ? ' kpi-inst' : '') + '">' +
      '<div class="label">' + k.label + '</div>' +
      '<div class="value"' + (k.color ? ' style="color:' + k.color + '"' : '') + '>' + k.value + '</div>' +
      '<div class="sub">' + k.sub + '</div></div>';
  }).join('');

  /* ---------- 地图 ---------- */
  /* 标签锚点微调：不设 cp 时 ECharts 取「包围盒中心」，以下省份的包围盒中心
     会落到省外（被邻省、空白或海面接管），这里逐个改到本省境内的代表点。
     所有坐标都经过射线法点包含校验，确认只落在本省多边形内。 */
  var CP_TWEAK = {
    '河北省': [115.40, 37.85],       // 包围盒中心 (116.67,39.34) 卡在北京/天津之间 → 下移到石家庄一带
    '甘肃省': [103.83, 36.06],       // 包围盒中心 (100.53,37.69) 落在青海境内（甘肃为弧形，bbox 中心必然偏出）→ 兰州
    '陕西省': [108.95, 35.09],       // 包围盒中心 (108.37,35.65) 偏西压到甘肃 → 铜川
    '海南省': [109.75, 19.20],       // 包围盒含南海诸岛，中心 (113.22,11.99) 掉到海上 → 海南岛中部
    '内蒙古自治区': [114.00, 43.00]  // 包围盒中心 (111.62,45.37) 落在空白（境外）→ 中部锡林郭勒一带
  };
  if (window.CHINA_GEO && window.CHINA_GEO.features) {
    window.CHINA_GEO.features.forEach(function (f) {
      var t = f.properties && CP_TWEAK[f.properties.name];
      if (t) f.properties.cp = t;
    });
  }

  /* ---------- 南海诸岛内嵌（specialAreas 方案）----------
     原始边界数据把「南海诸岛」和海南省管辖的 132 个岛礁多边形一起放在地图里，
     包围盒被拉到 3.4°N，主图只能缩到很小，那些岛礁又只有 1–2px，几乎看不见。
     国家标准地图的做法是：岛礁照画，但把这一块「搬」到右下角的示意框里。
     ECharts 的 specialAreas 正是干这个的——把指定 region 的包围盒
     非均匀重映射到 geo 坐标矩形 {left, top, width, height}（top 是纬度、height 向北延伸）。
     这样九段线与岛礁是**同一 series 的一个 region**，不是另外画的一张图：
     随主图缩放、平移、窗口变化天然联动，不需要任何手工同步。 */
  function geomBBox(geo, skipName) {
    var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < b.x0) b.x0 = c[0];
        if (c[0] > b.x1) b.x1 = c[0];
        if (c[1] < b.y0) b.y0 = c[1];
        if (c[1] > b.y1) b.y1 = c[1];
      } else { c.forEach(walk); }
    }
    (geo.features || []).forEach(function (f) {
      if (skipName && f.properties && f.properties.name === skipName) return;
      walk(f.geometry.coordinates);
    });
    return b;
  }

  var SPLIT = (function (geo) {
    var main = { type: 'FeatureCollection', features: [] };
    var islands = [];                       // 统一收拢所有南海岛礁多边形（含九段线环）
    (geo.features || []).forEach(function (f) {
      var nm = f.properties && f.properties.name;
      if (nm === '南海诸岛') {
        islands = islands.concat(f.geometry.coordinates);
        return;
      }
      if (nm !== '海南省') { main.features.push(f); return; }
      var keep = [], out = [];
      (f.geometry.coordinates || []).forEach(function (poly) {
        var minLat = 90;
        (poly[0] || []).forEach(function (pt) { if (pt[1] < minLat) minLat = pt[1]; });
        (minLat >= 17.5 ? keep : out).push(poly);
      });
      islands = islands.concat(out);
      main.features.push({
        type: 'Feature', properties: f.properties,
        geometry: { type: 'MultiPolygon', coordinates: keep }
      });
    });
    /* 岛礁合成一个 feature 回到主图里，由 specialAreas 搬到右下角示意框 */
    main.features.push({
      type: 'Feature', properties: { name: '南海诸岛' },
      geometry: { type: 'MultiPolygon', coordinates: islands }
    });
    return { main: main, islands: islands };
  })(window.CHINA_GEO);

  /* 示意框的 geo 位置：放在台湾以东的太平洋空白处（经度 126.2–132.8、纬度 18.6 起），
     高度按岛礁真实宽高比换算，配合 aspectScale 0.78 落到屏幕上仍是等比无变形。 */
  var SCS_BB = (function () {
    var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < b.x0) b.x0 = c[0];
        if (c[0] > b.x1) b.x1 = c[0];
        if (c[1] < b.y0) b.y0 = c[1];
        if (c[1] > b.y1) b.y1 = c[1];
      } else { c.forEach(walk); }
    }
    SPLIT.islands.forEach(walk);
    return b;
  })();
  var SCS_W = 7.6;                                          // 示意框 geo 宽度（经度跨度）
  var SCS_H = +(SCS_W * (SCS_BB.y1 - SCS_BB.y0) / (SCS_BB.x1 - SCS_BB.x0)).toFixed(2);
  var SCS_AREA = { left: 126.2, top: 18.6, width: SCS_W, height: SCS_H };

  /* 注册名必须避开 ECharts 内置的 'china'：
     内置 china 地图自带 specialAreas（把九段线摆进经度 126–132°、纬度 18–25° 的示意框），
     用同名 registerMap 覆写后这个隐形 region 仍会保留，在附图左侧多画出一片「幽灵」轮廓。
     换成自定义名后 region 数与 geoJSON 要素数严格一致（35 = 35）。 */
  echarts.registerMap('rttMain', SPLIT.main, SCS_AREA ? { '南海诸岛': SCS_AREA } : undefined);

  /* ---------- 地图自适应尺寸 ----------
     ECharts 地图按「高度」适配，宽度不足时两侧会被裁掉（表现为遮挡 / 出界）。
     主图宽高比由实际包围盒算出（拆掉南海诸岛后约 1.36），
     再按容器宽度反推安全高度：桌面端上限 680px，窄屏自动降高，保证任何宽度都不裁切。 */
  var MAP_BB = geomBBox(SPLIT.main, '南海诸岛');   // 排除岛礁要素，避免 3.4°N 拉高估算高度
  var MAP_WHR = ((MAP_BB.x1 - MAP_BB.x0) * 0.78) / (MAP_BB.y1 - MAP_BB.y0);
  var MAP_MAX_H = 680;        // 桌面端最大高度（原 560）
  var MAP_PAD_V = 12;         // top + bottom
  var MAP_PAD_H = 8;          // 左右各留 4px 余量
  function fitMapHeight() {
    var el = document.getElementById('map');
    if (!el) return MAP_MAX_H;
    var w = el.clientWidth || 900;
    var h = Math.round(Math.min(MAP_MAX_H, Math.max(320, (w - MAP_PAD_H) / MAP_WHR + MAP_PAD_V)));
    el.style.height = h + 'px';
    return h;
  }
  fitMapHeight();
  var mapChart = echarts.init(document.getElementById('map'));
  var mapMode = 'status';
  var chipSel = {};           // 被选中的接入状态

  /* 示意框 / 标注的画布定位：框的四个角就是 specialAreas 矩形的角，
     用 convertToPixel 反算成像素——主图多大、框就多大，天然等比联动。
     框内的岛礁坐标被 specialAreas 线性重映射到矩形里，所以标注按
     「岛礁包围盒内的比例」线性内插即可精确落位。 */
  function scsBoxPx() {
    if (!mapChart.convertToPixel) return null;
    var p1, p2;
    /* 首次渲染时坐标系尚未建立，convertToPixel 内部会直接抛
       TypeError: Cannot read properties of undefined (reading 'queryComponents')，
       不是返回 null——必须 try/catch，否则会中断 renderMap、地图根本渲不出来。 */
    try {
      p1 = mapChart.convertToPixel({ seriesIndex: 0 }, [SCS_AREA.left, SCS_AREA.top]);
      p2 = mapChart.convertToPixel({ seriesIndex: 0 }, [SCS_AREA.left + SCS_AREA.width, SCS_AREA.top + SCS_AREA.height]);
    } catch (e) { return null; }
    if (!p1 || !p2 || isNaN(p1[0]) || isNaN(p2[0])) return null;
    return {
      x0: Math.min(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]),
      x1: Math.max(p1[0], p2[0]), y1: Math.max(p1[1], p2[1])
    };
  }

  /* 虚线示意框 + 「南海诸岛」标题，全部随主图联动。
     框内不再逐个标注东沙 / 西沙 / 中沙 / 南沙群岛与曾母暗沙（用户要求，2026-10-19）。 */
  function scsOverlayGraphics() {
    var bx = scsBoxPx();
    if (!bx) return [];
    var bw = bx.x1 - bx.x0, bh = bx.y1 - bx.y0;
    /* 只保留虚线示意框本身：框下原「南海诸岛」标题已按用户要求去掉（2026-10-19） */
    return [{
      type: 'rect', z: 1, silent: true,
      left: bx.x0, top: bx.y0,
      shape: { width: bw, height: bh },
      style: { fill: '#f8fafc', stroke: '#94a3b8', lineWidth: 1, lineDash: [4, 3] }
    }];
  }

  /* 城市级客户在地图上的独立标注（如「深圳」）：这些城市在地图上属于某个省级
     region，无法单独作为一个 region 着色，但又是我们对接中的重要城市，需要
     单独亮出来。做法：在地图坐标上叠一个黄色圆点 + 城市名文字，用 convertToPixel
     反算像素位置，随主图缩放 / 平移 / resize 联动，始终显示。 */
  var CITY_POINTS = [
    { name: '深圳', lon: 114.06, lat: 22.55, status: 'negotiating' }
  ];
  function cityOverlayGraphics() {
    if (!mapChart.convertToPixel) return [];
    var g = [];
    CITY_POINTS.forEach(function (c) {
      var px;
      try { px = mapChart.convertToPixel({ seriesIndex: 0 }, [c.lon, c.lat]); }
      catch (e) { return; }
      if (!px || isNaN(px[0]) || isNaN(px[1])) return;
      var meta = D.STATUS_META[c.status];
      var x = px[0], y = px[1];
      /* 图例筛选时与省份行为一致：本状态未被选中 → 变灰 */
      var dimmed = anyChip() && !chipSel[c.status];
      var dotColor = dimmed ? '#f1f5f9' : meta.color;
      var txtColor = dimmed ? '#94a3b8' : '#7a5b00';
      /* 黄色实心圆 + 白描边，点上是「深圳」二字（黄底黑字，同图例色系） */
      g.push({
        type: 'circle', z: 5, silent: true,
        shape: { cx: x, cy: y, r: 5 },
        style: { fill: dotColor, stroke: '#fff', lineWidth: 2, shadowBlur: 4, shadowColor: 'rgba(15,23,42,.35)' }
      });
      g.push({
        type: 'text', z: 6, silent: true,
        left: x + 9, top: y - 9,
        style: {
          text: c.name, fill: txtColor,
          font: '600 13px "PingFang SC", "Microsoft YaHei", sans-serif',
          textAlign: 'left', textVerticalAlign: 'middle',
          /* 注意：graphic text 的 textBorder 在本版本会画出一个包围盒矩形框（不是逐字描边），
             靠它提可读性会在地图上多出一个白色空心框——改用 textShadow。 */
          textShadowColor: 'rgba(255,255,255,.95)', textShadowBlur: 4
        }
      });
    });
    return g;
  }

  /* 颜色加深 / 提亮：附图里的岛礁只有 1–2px，浅色填充在白底上看不清，
     用同色加深保持与图例一致，同时把细线与小岛压出可见的实心块。 */
  function shade(hex, k) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return hex;
    var n = parseInt(hex.slice(1), 16);
    function f(v) { return Math.max(0, Math.min(255, Math.round(v * (1 + k)))); }
    var r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  var VOL_PIECES = [
    { min: 200000, label: '≥ 20 万', color: '#0b3a8c' },
    { min: 50000, max: 199999, label: '5 万 – 20 万', color: '#1d4ed8' },
    { min: 10000, max: 49999, label: '1 万 – 5 万', color: '#3b82f6' },
    { min: 1000, max: 9999, label: '1 千 – 1 万', color: '#93c5fd' },
    { min: 1, max: 999, label: '1 – 1 千', color: '#dbeafe' },
    { value: 0, label: '未产数', color: C_NO }
  ];
  function volColor(v) {
    for (var i = 0; i < VOL_PIECES.length; i++) {
      var pc = VOL_PIECES[i];
      if (pc.value !== undefined) { if (v === pc.value) return pc.color; continue; }
      if (v >= pc.min && (pc.max === undefined || v <= pc.max)) return pc.color;
    }
    return C_NO;
  }

  var provVol = {};
  D.provinces.forEach(function (p) {
    var t = custs.filter(function (c) { return c.province === p.name; })
      .reduce(function (s, c) { return s + c.total; }, 0);
    provVol[p.name] = t;
  });
  function volOf(p) {
    if (p.name === '四川') return provVol['四川'];   // 含成都高速
    return provVol[p.name] || 0;
  }

  function anyChip() { return Object.keys(chipSel).some(function (k) { return chipSel[k]; }); }
  function activeGeo(p) { return !anyChip() || chipSel[p.status]; }

  /* 地图标签用简称：北京市→北京、广西壮族自治区→广西、新疆维吾尔自治区→新疆… */
  function shortProv(n) {
    return String(n || '')
      .replace(/维吾尔/g, '').replace(/壮族/g, '').replace(/回族/g, '')
      .replace(/特别行政区$/, '').replace(/自治区$/, '')
      .replace(/省$/, '').replace(/市$/, '');
  }

  var HAINAN = D.provinces.filter(function (p) { return p.geoName === '海南省'; })[0];

  function mapData() {
    var items = D.provinces.map(function (p) {
      var v = volOf(p);
      var item = { name: p.geoName, value: p.status === 'online' || v > 0 ? v : 0, _p: p };
      var base = (mapMode === 'status') ? D.STATUS_META[p.status].color : volColor(v);
      var on = activeGeo(p);
      var color = on ? base : '#f1f5f9';
      item.itemStyle = { areaColor: color };
      /* 状态模式下所有省份都显示简称（含「空白」的西藏）；事件量模式下只标有数据的省份 */
      if (on && (mapMode === 'status' || v > 0)) {
        var lc = labelColor(color);
        item.label = {
          show: true, color: lc, fontSize: 11, fontWeight: 600,
          formatter: function (pa) { return shortProv(pa.name); },
          textShadowColor: lc === '#ffffff' ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.85)', textShadowBlur: 3
        };
      }
      return item;
    });
    /* 南海诸岛是主图 series 里的一个 region：随海南省的接入状态着色（同色加深）。
       事件量模式下 visualMap 会覆盖 data item 的显式颜色，用 value = -1（不落任何区间）
       + visualMap.outOfRange 指定加深色，保证岛礁在白底示意框里始终清晰。 */
    var scsBase = scsInk();
    items.push({
      name: '南海诸岛',
      value: mapMode === 'volume' ? -1 : 0,
      /* 九段线是细长多边形、岛礁只有 1–2px，纯填充会断断续续看不见；
         补一圈同色描边（0.9px）等于整体加粗：线连贯、小岛成实心块。 */
      itemStyle: { areaColor: scsBase, borderColor: scsBase, borderWidth: 0.9 },
      label: { show: false },
      emphasis: { label: { show: false } }
    });
    return items;
  }

  /* 南海诸岛配色：归海南省管辖，随海南当前的接入状态走。
     岛礁与九段线只有 1–2px，浅色填充在浅灰框底上基本看不见，
     统一做「同色加深 50%」——保持与图例同色系，但压得足够深才看得清。 */
  function scsColor() {
    if (!HAINAN) return C_NO;
    if (!activeGeo(HAINAN)) return '#f1f5f9';
    return (mapMode === 'status') ? D.STATUS_META[HAINAN.status].color : C_NO;
  }
  function scsInk() { return shade(scsColor(), -0.5); }

  function renderMap() {
    var opt = {
      tooltip: Object.assign({}, TIP, {
        trigger: 'item',
        formatter: function (pa) {
          if (pa.name === '南海诸岛') {
            return '<div class="tt-h">南海诸岛 <span class="tt-dim">· 隶属海南省</span></div>' +
              '<div class="tt-n">东沙、西沙、中沙、南沙诸岛礁，随海南省一并表示，不单独计入客户统计。</div>';
          }
          var p = byGeo[pa.name];
          if (!p) return pa.name;
          var st = D.STATUS_META[p.status];
          var v = volOf(p);
          var head = '<div class="tt-h">' + p.name +
            ' <span class="tt-dim">· ' + st.label + '</span></div>';
          var body = '<table class="tt">' +
            '<tr><td>客户</td><td class="r">' + p.customers + '</td></tr>' +
            '<tr><td>2026 年事件量</td><td class="r">' + (v > 0 ? '<b>' + fmt(v) + '</b>' : '—') + '</td></tr>' +
            (v > 0 ? '<tr><td>占省级合计</td><td class="r">' + pctStr(v, provTotal) + '</td></tr>' : '') +
            '</table>';
          if (p.status !== 'online') body += '<div class="tt-n">' + st.desc + '</div>';
          return head + body;
        }
      }),
      series: [{
        type: 'map', map: 'rttMain', roam: true, zoom: 1, top: 8, bottom: 4,
        aspectScale: 0.78, selectedMode: false,
        itemStyle: { areaColor: C_NO, borderColor: '#ffffff', borderWidth: 0.7 },
        emphasis: {
          label: {
            show: true, color: '#0f172a', fontSize: 12, fontWeight: 700,
            formatter: function (pa) { return shortProv(pa.name); }
          },
          itemStyle: { areaColor: '#fcd34d', borderColor: '#fff', borderWidth: 1, shadowBlur: 8, shadowColor: 'rgba(15,23,42,.25)' }
        },
        label: { show: false, formatter: function (pa) { return shortProv(pa.name); } },
        data: mapData()
      }],
      graphic: scsOverlayGraphics()
    };
    if (mapMode === 'volume') {
      opt.series[0].itemStyle = { borderColor: '#ffffff', borderWidth: 0.7 };
      opt.visualMap = {
        type: 'piecewise', pieces: VOL_PIECES, seriesIndex: 0,
        outOfRange: { color: scsInk() },   // 南海诸岛 value=-1 专属色
        left: 16, bottom: 10, orient: 'horizontal',
        itemWidth: 14, itemHeight: 10, itemGap: 6, textStyle: { fontSize: 11, color: '#475569' }
      };
    }
    mapChart.setOption(opt, true);
    /* 首次渲染时坐标系尚未建立、convertToPixel 拿不到值，setOption 之后再刷一次覆盖层 */
    var ov = scsOverlayGraphics().concat(cityOverlayGraphics());
    if (ov.length) mapChart.setOption({ graphic: ov });
  }

  /* 拖拽 / 缩放主图后，示意框与标注跟着 geo 坐标重新反算像素位置 */
  mapChart.on('georoam', function () {
    mapChart.setOption({ graphic: scsOverlayGraphics().concat(cityOverlayGraphics()) });
  });

  function renderChips() {
    var el = document.getElementById('mapChips');
    el.innerHTML = D.STATUS_ORDER.map(function (k) {
      var m = D.STATUS_META[k];
      return '<button class="chip-btn' + (chipSel[k] ? ' on' : '') + '" data-status="' + k + '">' +
        '<i style="background:' + m.color + '"></i>' + m.label + '<b>' + statusCount[k] + '</b></button>';
    }).join('') +
      '<span class="cur">当前：' + (anyChip() ? D.STATUS_ORDER.filter(function (k) { return chipSel[k]; }).map(function (k) { return D.STATUS_META[k].label; }).join(' / ') : '全国') + '</span>' +
      '<button class="btn-ghost" id="mapReset">复位</button>';

    Array.prototype.forEach.call(el.querySelectorAll('.chip-btn[data-status]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-status');
        chipSel[k] = !chipSel[k];
        renderChips();
        renderMap();
      });
    });
    document.getElementById('mapReset').addEventListener('click', function () {
      chipSel = {};
      renderChips();
      renderMap();
    });
  }

  function renderMapFoot() {
    var online = D.provinces.filter(function (p) { return p.status === 'online'; });
    var v = sum(online.map(volOf));
    document.getElementById('mapFoot').innerHTML =
      '已上线 ' + online.length + ' 个省级行政区，承载 ' + custs.length + ' 家省级 / 城市客户，2026 年累计 ' + fmt(v) + ' 条。' +
      '道研中心为部级客户（' + fmt(INST.total) + ' 条，占平台总量 ' + pctStr(INST.total, grandTotal) + '），不参与省份着色，在下方对比图中以 <span style="color:' + C_INST + ';font-weight:700;">紫色</span> 单独呈现。';
  }

  var selProvince = null;
  mapChart.on('click', function (pa) {
    var p = byGeo[pa.name];
    if (!p) return;
    selProvince = (selProvince === p.name) ? null : p.name;
    renderMatrix();
  });

  document.getElementById('mapToggle').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    mapMode = b.getAttribute('data-mode');
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    renderMap();
  });

  /* ---------- 接入状态构成 ---------- */
  var donut = echarts.init(document.getElementById('donut'));
  donut.setOption({
    tooltip: Object.assign({}, TIP, {
      trigger: 'item',
      formatter: function (pa) { return pa.name + '：' + pa.value + ' 个省（' + pa.percent + '%）'; }
    }),
    series: [{
      type: 'pie', radius: ['52%', '78%'], center: ['50%', '48%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: 700, formatter: '{b}\n{c} 个省' } },
      data: D.STATUS_ORDER.filter(function (k) { return statusCount[k] > 0; }).map(function (k) {
        return { name: D.STATUS_META[k].label, value: statusCount[k], itemStyle: { color: D.STATUS_META[k].color } };
      })
    }]
  });
  document.getElementById('statusLegend').innerHTML = D.STATUS_ORDER.map(function (k) {
    var m = D.STATUS_META[k];
    return '<div class="legend-row"><span class="swatch" style="background:' + m.color + '"></span>' +
      '<span class="nm">' + m.label + '</span><span class="ct">' + statusCount[k] + '</span>' +
      '<span class="ds">' + m.desc + '</span></div>';
  }).join('');

  /* ---------- 各地接入时间（原「客户事件量排名」与下方条形图重复，已替换） ---------- */
  (function renderTimeline() {
    var el = document.getElementById('timeline');
    if (!el) return;
    function sinceOf(s) {
      var m = /^(\d{4})-(\d{2})/.exec(s || '');
      return m ? m[1] + '-' + m[2] : '2026-01';
    }
    var groups = [], seen = {};
    /* 「对接中」的客户（如深圳交通）尚未接入，没有接入时间，不进时间轴 */
    provOnly.filter(function (c) { return c.start !== '对接中'; }).slice().sort(function (a, b) {
      var sa = sinceOf(a.start), sb = sinceOf(b.start);
      if (sa !== sb) return sa < sb ? -1 : 1;
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return b.total - a.total;
    }).forEach(function (c) {
      var k = sinceOf(c.start);
      if (!seen[k]) { seen[k] = { ym: k, list: [] }; groups.push(seen[k]); }
      seen[k].list.push(c);
    });

    var cum = 0;
    el.innerHTML = groups.map(function (g) {
      cum += g.list.length;
      var fresh = g.ym >= '2026-01';
      return '<div class="tl-row' + (fresh ? ' fresh' : '') + '">' +
        '<div class="tl-date">' + g.ym.replace('-', '.') + '</div>' +
        '<div class="tl-body">' + g.list.map(function (c) {
          return '<span class="tl-chip" title="' + c.start + ' · ' + fmt(c.total) + ' 条">' + c.name + '</span>';
        }).join('') + '</div>' +
        '<div class="tl-n">+' + g.list.length + '<i>/' + cum + '</i></div>' +
        '</div>';
    }).join('');
  })();

  /* ---------- 客户事件量分布（省级/城市，对数横轴） ---------- */
  var barCust = echarts.init(document.getElementById('barCust'));
  var bc = provOnly.slice().reverse();
  barCust.setOption({
    tooltip: Object.assign({}, TIP, {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: function (arr) {
        var c = provOnly.filter(function (x) { return x.name === arr[0].name; })[0];
        return '<div class="tt-h">' + c.name + '</div>' +
          '<div>2026 年累计 <b>' + fmt(c.total) + '</b> 条</div>' +
          '<div class="tt-dim">占省级合计 ' + pctStr(c.total, provTotal) + ' · 接入 ' + c.start + '</div>';
      }
    }),
    grid: { left: 66, right: 92, top: 12, bottom: 26 },
    xAxis: {
      type: 'log', min: 10, logBase: 10,
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: {
        fontSize: 11, color: '#64748b',
        formatter: function (v) {
          if (v >= 10000) return (v / 10000) + '万';
          if (v >= 1000) return (v / 1000) + 'k';
          return String(v);
        }
      }
    },
    yAxis: {
      type: 'category', data: bc.map(function (c) { return c.name; }),
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { fontSize: 12, color: '#334155' }
    },
    series: [{
      type: 'bar', barWidth: '58%',
      itemStyle: {
        borderRadius: [0, 3, 3, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#93b4e0' }, { offset: 1, color: '#2f5597' }
        ])
      },
      label: {
        show: true, position: 'right', fontSize: 11, color: '#475569',
        formatter: function (pa) { return fmt(pa.value) + '（' + pctStr(pa.value, provTotal) + '）'; }
      },
      data: bc.map(function (c) { return c.total; })
    }]
  });

  /* ---------- 道研中心 vs 省级客户（体量对比） ---------- */
  var donutCmp = echarts.init(document.getElementById('donutCmp'));
  donutCmp.setOption({
    tooltip: Object.assign({}, TIP, {
      trigger: 'item',
      formatter: function (pa) { return pa.name + '：' + fmt(pa.value) + ' 条（' + pa.percent + '%）'; }
    }),
    series: [{
      type: 'pie', radius: ['58%', '82%'], center: ['50%', '50%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: {
        show: true, fontSize: 11, color: '#475569',
        formatter: function (pa) { return pa.name + '\n' + shortNum(pa.value) + ' · ' + pa.percent + '%'; }
      },
      labelLine: { length: 8, length2: 8 },
      data: [
        { name: '道研中心', value: INST.total, itemStyle: { color: C_INST } },
        { name: '省级 / 城市客户', value: provTotal, itemStyle: { color: C_PROV } }
      ]
    }]
  });
  document.getElementById('cmpFoot').innerHTML =
    '<div class="cmp-row"><span class="dot" style="background:' + C_INST + '"></span>道研中心（部级）<b>' + fmt(INST.total) + '</b></div>' +
    '<div class="cmp-row"><span class="dot" style="background:' + C_PROV + '"></span>省级 / 城市客户（' + custs.length + ' 家）<b>' + fmt(provTotal) + '</b></div>' +
    '<div class="cmp-row sum">合计<b>' + fmt(grandTotal) + '</b></div>' +
    '<div class="cmp-note">道研中心体量为省级客户合计的 <b>' + (INST.total / provTotal).toFixed(2) + ' 倍</b>，两者需分开分析。</div>';

  /* ---------- 月度趋势：客户事件总数 / 道研中心 / 省级客户（单纵轴） ---------- */
  var lineCmp = echarts.init(document.getElementById('lineCmp'));
  var instShare = M.map(function (_, i) { return pct(INST.monthly[i], grandMonthly[i]); });
  var shareMin = Math.min.apply(null, instShare), shareMax = Math.max.apply(null, instShare);

  lineCmp.setOption({
    tooltip: Object.assign({}, TIP, {
      trigger: 'axis',
      formatter: function (arr) {
        var mi = M.indexOf(arr[0].axisValue);
        var s = '<div class="tt-h">2026 年 ' + arr[0].axisValue + '</div>';
        arr.slice().sort(function (a, b) { return b.value - a.value; }).forEach(function (a) {
          var mark = '';
          if (a.seriesName === '道研中心') {
            if (INST.partial[mi]) mark = ' <span class="tt-dim">非完整月</span>';
            else if (INST.est[mi]) mark = ' <span class="tt-dim">估算</span>';
          }
          s += '<div class="tt-line">' + a.marker + '<span>' + a.seriesName + mark + '</span><b>' + fmt(a.value) + '</b></div>';
        });
        s += '<div class="tt-n">道研中心占客户事件总数 ' + instShare[mi].toFixed(1) + '%</div>';
        return s;
      }
    }),
    legend: { top: 4, right: 8, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12 } },
    grid: { left: 74, right: 30, top: 44, bottom: 30 },
    xAxis: {
      type: 'category', data: M, boundaryGap: false,
      axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { fontSize: 12, color: '#475569' }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value', name: '事件量', min: 0,
      nameTextStyle: { fontSize: 11, color: '#64748b' },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { fontSize: 11, color: '#64748b', formatter: function (v) { return shortNum(v); } }
    },
    series: [
      {
        name: '客户事件总数', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        data: grandMonthly, z: 4,
        lineStyle: { width: 2, color: '#0b3a8c', type: 'dashed' },
        itemStyle: { color: '#0b3a8c' }
      },
      {
        name: '道研中心', type: 'line', smooth: true, symbol: 'circle', symbolSize: 8,
        data: INST.monthly, z: 3,
        lineStyle: { width: 2.6, color: C_INST },
        itemStyle: { color: C_INST, borderColor: '#fff', borderWidth: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(124,58,237,.20)' }, { offset: 1, color: 'rgba(124,58,237,.03)' }
          ])
        }
      },
      {
        name: '省级 / 城市客户合计', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        data: monthlyTotal, z: 2,
        lineStyle: { width: 2.2, color: C_PROV },
        itemStyle: { color: C_PROV, borderColor: '#fff', borderWidth: 1.5 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(47,85,151,.30)' }, { offset: 1, color: 'rgba(47,85,151,.04)' }
          ])
        }
      }
    ]
  });
  document.getElementById('cmpNote').innerHTML =
    '<b>要点</b>：客户事件总数由 1 月 ' + fmt(grandMonthly[0]) + ' 条回落至 6 月 ' + fmt(grandMonthly[5]) + ' 条，7 月反弹至 ' + fmt(grandMonthly[6]) + ' 条，8 月起 ' +
    fmt(grandMonthly[7]) + ' → ' + fmt(grandMonthly[8]) + ' → ' + fmt(grandMonthly[9]) + ' 条（10 月为 1–18 日）持续走低。' +
    '结构上道研中心占比由 1 月的 <b>' + shareMax.toFixed(1) + '%</b> 降至 10 月的 <b>' + shareMin.toFixed(1) + '%</b>，' +
    '而省级 / 城市客户合计在 8 月创出全年新高 ' + fmt(monthlyTotal[7]) + ' 条，占比从不足 7% 提升至近四成——增量主要来自新客户接入。' +
    '<span class="warn">口径：道研中心 10 个月全部为实测 / 公示精确值，<b>无估算</b>（2–8 月为归档表逐段实测，9–10 月为归档 + 在线实测）；10 月为 10/1–10/18 非完整月。</span>';

  /* ---------- 省级客户月度趋势 ---------- */
  var lineTrend = echarts.init(document.getElementById('lineTrend'));
  var PALETTE = ['#2f5597', '#2E9E5B', '#E05A4F', '#E8A33D', '#7C3AED', '#0E9AA7', '#C2410C', '#0369A1',
    '#4D7C0F', '#9D174D', '#1E40AF', '#B45309', '#0F766E', '#7C2D12', '#4338CA', '#065F46', '#A16207'];
  var scope = 'top6', scale = 'linear';

  function renderTrend() {
    var list = (scope === 'top6') ? provOnly.slice(0, 6) : provOnly.slice();
    lineTrend.setOption({
      tooltip: Object.assign({}, TIP, {
        trigger: 'axis',
        formatter: function (arr) {
          var s = '<div class="tt-h">2026 年 ' + arr[0].axisValue + '</div>';
          arr.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); }).forEach(function (a) {
            if (a.value === null || a.value === undefined) return;
            s += '<div class="tt-line">' + a.marker + '<span>' + a.seriesName + '</span><b>' + fmt(a.value) + '</b></div>';
          });
          return s;
        }
      }),
      legend: { top: 4, type: 'scroll', icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12 } },
      grid: { left: 70, right: 26, top: 44, bottom: 30 },
      xAxis: {
        type: 'category', data: M, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { fontSize: 12, color: '#475569' }, axisTick: { show: false }
      },
      yAxis: {
        type: scale === 'log' ? 'log' : 'value',
        logBase: 10, min: scale === 'log' ? 10 : undefined,
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { fontSize: 11, color: '#64748b', formatter: function (v) { return shortNum(v); } }
      },
      series: list.map(function (c, i) {
        var col = PALETTE[i % PALETTE.length];
        return {
          name: c.name, type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
          connectNulls: false,
          data: c.monthly.map(function (v) { return v > 0 ? v : null; }),
          lineStyle: { width: 2, color: col }, itemStyle: { color: col }
        };
      })
    }, true);
  }

  document.getElementById('scopeToggle').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    scope = b.getAttribute('data-scope');
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    renderTrend();
  });
  document.getElementById('scaleToggle').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    scale = b.getAttribute('data-scale');
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    renderTrend();
  });
  document.getElementById('trendNote').innerHTML =
    '<b>接入时点</b>：成都高速 2/10、四川高速 4/19、北京高速 4/29、安徽高速 7/8、江西高速 7/21、上海交通 7/22、贵州高速 7/30、' +
    '山西高速 9/1、天津高速 9/10、山东高速 9 月。接入前无数据（折线断开），不代表业务量下滑。' +
    '<span class="warn">重庆高速 9 月起断流、陕西高速 10/17 起归零，折线归零。</span>';

  /* ---------- 客户月度明细矩阵 ---------- */
  var sortKey = 'total', sortDir = -1;
  var headNames = ['客户'].concat(M).concat(['合计', '占比']);
  document.getElementById('matrixHead').innerHTML = headNames.map(function (n, i) {
    var k = (i === 0) ? 'name' : (i <= N ? 'm' + (i - 1) : (i === N + 1 ? 'total' : 'share'));
    var sortable = (k !== 'share');
    return '<th' + (sortable ? ' data-key="' + k + '"' : '') + (i > 0 ? ' class="r"' : '') + '>' + n + '</th>';
  }).join('');

  function instCells() {
    return INST.monthly.map(function (v, i) {
      var cls = 'r';
      var tag = '';
      if (INST.partial[i]) { cls += ' partial'; tag = '<span class="mg-note">非完整月</span>'; }
      else if (INST.est[i]) { cls += ' est'; tag = '<span class="mg-note">估算</span>'; }
      return '<td class="' + cls + '">' + fmt(v) + tag + '</td>';
    }).join('');
  }

  function renderMatrix() {
    var rows = allRows.slice();
    if (selProvince) rows = rows.filter(function (c) { return c.province === selProvince; });

    rows.sort(function (a, b) {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'zh-CN') * sortDir;
      if (sortKey === 'total') return (a.total - b.total) * sortDir;
      var i = parseInt(sortKey.slice(1), 10);
      var av = a.monthly ? a.monthly[i] : null;
      var bv = b.monthly ? b.monthly[i] : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * sortDir;
    });

    var chip = document.getElementById('matrixChip');
    if (selProvince) {
      chip.style.display = '';
      chip.innerHTML = '筛选：' + selProvince + ' <b id="chipClear" style="cursor:pointer;">×</b>';
      document.getElementById('chipClear').onclick = function () { selProvince = null; renderMatrix(); };
    } else {
      chip.style.display = 'none';
    }

    var total = sum(rows.map(function (c) { return c.total; }));
    document.getElementById('matrixCount').textContent = rows.length + ' 个客户 · 合计 ' + fmt(total) + ' 条';

    document.getElementById('matrixBody').innerHTML = rows.map(function (c) {
      var cls = c.isInst ? ' class="inst-row"' : '';
      var cells = c.isInst
        ? instCells()
        : c.monthly.map(function (v, i) {
          var hot = (i >= 8 && v > 0) ? ' hot' : '';
          return '<td class="r' + hot + '">' + (v > 0 ? fmt(v) : '<span class="zero">—</span>') + '</td>';
        }).join('');
      return '<tr' + cls + '>' +
        '<td class="cname' + (c.isInst ? ' inst' : '') + '">' + c.name +
        '<span class="cstart">' + c.start + '</span></td>' +
        cells +
        '<td class="r total-cell">' + fmt(c.total) + '</td>' +
        '<td class="r">' + pctStr(c.total, grandTotal) + '</td>' +
        '</tr>';
    }).join('');

    /* 合计行 */
    var foot = '<tr><td class="cname">合计</td>';
    for (var i = 0; i < N; i++) {
      if (selProvince) {
        foot += '<td class="r">' + fmt(sum(rows.filter(function (c) { return !c.isInst; }).map(function (c) { return c.monthly[i]; }))) + '</td>';
      } else if (i < 8) {
        foot += '<td class="r">' + fmt(monthlyTotal[i]) + '</td>';
      } else {
        foot += '<td class="r">' + fmt(monthlyTotal[i]) + '</td>';
      }
    }
    foot += '<td class="r total-cell">' + fmt(total) + '</td><td class="r">' + pctStr(total, grandTotal) + '</td></tr>';
    if (!selProvince) {
      foot = '<tr><td class="cname">省级 / 城市客户合计</td>' +
        monthlyTotal.map(function (v) { return '<td class="r">' + fmt(v) + '</td>'; }).join('') +
        '<td class="r total-cell">' + fmt(provTotal) + '</td><td class="r">' + pctStr(provTotal, grandTotal) + '</td></tr>' +
        '<tr class="inst-foot"><td class="cname inst">道研中心</td>' +
        instCells() +
        '<td class="r total-cell">' + fmt(INST.total) + '</td><td class="r">' + pctStr(INST.total, grandTotal) + '</td></tr>' +
        '<tr class="grand-foot"><td class="cname">平台合计</td>' +
        grandMonthly.map(function (v) { return '<td class="r">' + fmt(v) + '</td>'; }).join('') +
        '<td class="r total-cell">' + fmt(provTotal + INST.total) + '</td><td class="r">100.0%</td></tr>';
    }
    document.getElementById('matrixFoot').innerHTML = foot;
  }

  Array.prototype.forEach.call(document.querySelectorAll('#matrixTable thead th[data-key]'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-key');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
      renderMatrix();
    });
  });

  /* ---------- CSV 导出 ---------- */
  document.getElementById('btnCsv').addEventListener('click', function () {
    var head = ['客户'].concat(M).concat(['合计']);
    var lines = [head.join(',')];
    allRows.slice().sort(function (a, b) { return b.total - a.total; }).forEach(function (c) {
      var cells = c.monthly || [];
      lines.push([c.name].concat(cells).concat([c.total]).join(','));
    });
    lines.push(['省级/城市客户合计'].concat(monthlyTotal).concat([provTotal]).join(','));
    lines.push(['平台合计（含道研中心）'].concat(grandMonthly).concat([grandTotal]).join(','));
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'RTT客户月度明细_' + D.DATA_CUTOFF + '.csv';
    a.click();
  });

  /* ---------- 数据说明 ---------- */
  document.getElementById('noteList').innerHTML = D.notes.map(function (t) { return '<li>' + t + '</li>'; }).join('');

  /* ---------- 初始化 ---------- */
  renderMap();
  renderChips();
  renderMapFoot();
  renderTrend();
  renderMatrix();

  window.addEventListener('resize', function () {
    fitMapHeight();
    renderMap();          // 附图尺寸随画布高度联动
    mapChart.resize(); donut.resize(); barCust.resize(); donutCmp.resize(); lineCmp.resize(); lineTrend.resize();
  });
})();
