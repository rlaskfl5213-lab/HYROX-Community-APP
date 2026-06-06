// ============================================================
// HYROX Coach Lab — Pace Planner (Statistics-based)
// ============================================================

// --- 스테이션 매핑 ---

var FOOTER_TEXT = 'Made by RUNRUN NARI';
var KAKAO_CHANNEL_URL = 'http://pf.kakao.com/_xbUHGX/friend';
var CTA_TEXT = '무료 HYROX 훈련 자료 받기 →';
var CTA_DESCRIPTION = '목표 로드맵은 훈련 방향을 제시합니다.\n더 자세한 HYROX 훈련 프로그램과 주간 가이드는 아래에서 확인할 수 있습니다.';

var STATION_DISPLAY = [
  { key: '1000m SkiErg',          name: 'SkiErg',            spec: '1,000m' },
  { key: '50m Sled Push',         name: 'Sled Push',         spec: '50m' },
  { key: '50m Sled Pull',         name: 'Sled Pull',         spec: '50m' },
  { key: '80m Burpee Broad Jump', name: 'Burpee Broad Jump', spec: '80m' },
  { key: '1000m Row',             name: 'Rowing',            spec: '1,000m' },
  { key: '200m Farmers Carry',    name: 'Farmers Carry',     spec: '200m' },
  { key: '100m Sandbag Lunges',   name: 'Sandbag Lunges',    spec: '100m' },
  { key: 'Wall Balls',            name: 'Wall Balls',        spec: '100회' }
];

var DISTANCE_PER_ROUND = 1.0875;
var TOTAL_DISTANCE = 8.7;
var ROUNDS = 8;

var FATIGUE_WEIGHTS = [1.00, 1.00, 1.05, 1.05, 1.06, 1.06, 1.06, 1.12];
var FATIGUE_SUM = FATIGUE_WEIGHTS.reduce(function (a, b) { return a + b; }, 0);

// --- 상태 ---

var metaData = null;
var divisionCache = {};
var roadmapData = null;

// --- 유틸리티 ---

function formatTime(totalSeconds) {
  var sec = Math.round(totalSeconds);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) {
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  return m + ':' + String(s).padStart(2, '0');
}

function formatPace(secondsPerKm) {
  var sec = Math.round(secondsPerKm);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function parseTimeInput() {
  var h = parseInt(document.getElementById('input-hours').value) || 0;
  var m = parseInt(document.getElementById('input-minutes').value) || 0;
  var s = parseInt(document.getElementById('input-seconds').value) || 0;
  return h * 3600 + m * 60 + s;
}

// --- 데이터 로드 ---

function loadMeta() {
  return fetch('data/planner_meta.json')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      metaData = data;
      buildDivisionSelect(data.divisions, 'select-division');
      buildDivisionSelect(data.divisions, 'gap-select-division');
    });
}

function loadDivision(slug) {
  if (divisionCache[slug]) {
    return Promise.resolve(divisionCache[slug]);
  }
  return fetch('data/planner_divisions/' + slug + '.json')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      divisionCache[slug] = data;
      return data;
    });
}

// --- 디비전 셀렉트 생성 ---

function buildDivisionSelect(divisions, selectId) {
  var select = document.getElementById(selectId);
  select.innerHTML = '';

  var groups = {};
  divisions.forEach(function (div) {
    if (!groups[div.group]) groups[div.group] = [];
    groups[div.group].push(div);
  });

  var groupOrder = ['Single', 'Double', 'Mixed', 'Adaptive'];
  groupOrder.forEach(function (groupName) {
    if (!groups[groupName]) return;
    var optgroup = document.createElement('optgroup');
    optgroup.label = groupName;
    groups[groupName].forEach(function (div) {
      var opt = document.createElement('option');
      opt.value = div.slug;
      opt.textContent = div.label + ' (' + div.total_athletes.toLocaleString() + '명)';
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });
}

// --- bucket 선택 ---

function findBucket(buckets, targetMinutes) {
  for (var i = 0; i < buckets.length; i++) {
    if (targetMinutes >= buckets[i].lo_min && targetMinutes < buckets[i].hi_min) {
      return buckets[i];
    }
  }
  if (targetMinutes < buckets[0].lo_min) {
    return buckets[0];
  }
  return buckets[buckets.length - 1];
}

// --- bucket 보간 ---

function lerpVal(a, b, t) {
  return a + (b - a) * t;
}

function lerpBucket(a, b, t) {
  var result = {
    avg_overall:       lerpVal(a.avg_overall, b.avg_overall, t),
    avg_run_rox:       lerpVal(a.avg_run_rox, b.avg_run_rox, t),
    avg_pace_8_7:      lerpVal(a.avg_pace_8_7, b.avg_pace_8_7, t),
    avg_station_total: lerpVal(a.avg_station_total, b.avg_station_total, t),
    stations: {}
  };
  var keys = Object.keys(a.stations);
  for (var i = 0; i < keys.length; i++) {
    result.stations[keys[i]] = lerpVal(a.stations[keys[i]], b.stations[keys[i]], t);
  }
  return result;
}

function copyBucket(bucket) {
  var result = {
    avg_overall:       bucket.avg_overall,
    avg_run_rox:       bucket.avg_run_rox,
    avg_pace_8_7:      bucket.avg_pace_8_7,
    avg_station_total: bucket.avg_station_total,
    stations: {}
  };
  var keys = Object.keys(bucket.stations);
  for (var i = 0; i < keys.length; i++) {
    result.stations[keys[i]] = bucket.stations[keys[i]];
  }
  return result;
}

function getInterpolatedBucket(buckets, targetMinutes) {
  if (targetMinutes <= buckets[0].lo_min) {
    return copyBucket(buckets[0]);
  }
  if (targetMinutes >= buckets[buckets.length - 1].hi_min) {
    return copyBucket(buckets[buckets.length - 1]);
  }

  var idx = -1;
  for (var i = 0; i < buckets.length; i++) {
    if (targetMinutes >= buckets[i].lo_min && targetMinutes < buckets[i].hi_min) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return copyBucket(buckets[buckets.length - 1]);

  var midA = (buckets[idx].lo_min + buckets[idx].hi_min) / 2;
  var bucketA, bucketB, t;

  if (targetMinutes <= midA && idx > 0) {
    var midPrev = (buckets[idx - 1].lo_min + buckets[idx - 1].hi_min) / 2;
    bucketA = buckets[idx - 1];
    bucketB = buckets[idx];
    t = (targetMinutes - midPrev) / (midA - midPrev);
  } else if (targetMinutes > midA && idx < buckets.length - 1) {
    var midNext = (buckets[idx + 1].lo_min + buckets[idx + 1].hi_min) / 2;
    bucketA = buckets[idx];
    bucketB = buckets[idx + 1];
    t = (targetMinutes - midA) / (midNext - midA);
  } else {
    return copyBucket(buckets[idx]);
  }

  return lerpBucket(bucketA, bucketB, t);
}

// --- 핵심 계산 ---

function calculate() {
  var slug = document.getElementById('select-division').value;
  if (!slug) return;

  var targetSeconds = parseTimeInput();
  if (targetSeconds <= 0) {
    document.getElementById('results').classList.add('hidden');
    return;
  }

  loadDivision(slug).then(function (divData) {
    var targetMinutes = targetSeconds / 60;
    var bucket = getInterpolatedBucket(divData.buckets, targetMinutes);
    var rawBucket = findBucket(divData.buckets, targetMinutes);

    renderResults({
      targetSeconds: targetSeconds,
      targetMinutes: targetMinutes,
      slug: slug,
      bucket: bucket,
      rawBucket: rawBucket,
      totalAthletes: divData.total_athletes
    });
  });
}

// --- 결과 렌더링 ---

function renderResults(data) {
  var bucket = data.bucket;

  // 요약
  document.getElementById('res-target').textContent = formatTime(data.targetSeconds);

  // 백분위 + 순위 (원본 bucket 사용)
  var rawBucket = data.rawBucket;
  var pctData = calculatePercentile(divisionCache[data.slug].buckets, rawBucket, data.targetMinutes, data.totalAthletes);

  document.getElementById('res-percentile').textContent = 'Top ' + pctData.percentile.toFixed(1) + '%';
  document.getElementById('res-rank').textContent = data.totalAthletes.toLocaleString() + '명 중 약 ' + pctData.rank.toLocaleString() + '등';
  document.getElementById('res-bucket-range').textContent = rawBucket.lo_min + '~' + rawBucket.hi_min + '분';

  // 비율 계산 + targetSeconds 스케일링
  var runRoxRatio = bucket.avg_run_rox / bucket.avg_overall;
  var targetRunRox = data.targetSeconds * runRoxRatio;
  var targetStationTotal = data.targetSeconds - targetRunRox;

  // 평균 Run+Roxzone 페이스
  var avgPace = targetRunRox / TOTAL_DISTANCE;
  document.getElementById('res-pace').textContent = formatPace(avgPace) + ' /km';

  // Run+Roxzone 실전 분배 (fatigue model)
  var runBody = document.getElementById('run-table-body');
  runBody.innerHTML = '';
  var runRoxUsed = 0;

  for (var i = 0; i < ROUNDS; i++) {
    var roundTime;
    if (i < ROUNDS - 1) {
      roundTime = targetRunRox * (FATIGUE_WEIGHTS[i] / FATIGUE_SUM);
      runRoxUsed += roundTime;
    } else {
      roundTime = targetRunRox - runRoxUsed;
    }
    var roundPace = roundTime / DISTANCE_PER_ROUND;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>Run ' + (i + 1) + ' + Roxzone</td>' +
      '<td>' + formatTime(roundTime) + '</td>' +
      '<td>' + formatPace(roundPace) + ' /km</td>';
    runBody.appendChild(tr);
  }
  var runSumTr = document.createElement('tr');
  runSumTr.className = 'row-sum';
  runSumTr.innerHTML =
    '<td>합계</td>' +
    '<td>' + formatTime(targetRunRox) + '</td>' +
    '<td>' + formatPace(avgPace) + ' /km</td>';
  runBody.appendChild(runSumTr);

  // 스테이션 테이블 (targetSeconds 스케일링)
  var stBody = document.getElementById('station-table-body');
  stBody.innerHTML = '';
  var stationUsed = 0;

  STATION_DISPLAY.forEach(function (st, idx) {
    var bucketTime = bucket.stations[st.key] || 0;
    var scaledTime;
    if (idx < STATION_DISPLAY.length - 1) {
      scaledTime = targetStationTotal * (bucketTime / bucket.avg_station_total);
      stationUsed += scaledTime;
    } else {
      scaledTime = targetStationTotal - stationUsed;
    }

    var paceCol = '';
    if (st.key === '1000m SkiErg' || st.key === '1000m Row') {
      var pace500 = scaledTime / 2;
      paceCol = '<span class="pace-500">' + formatPace(pace500) + ' /500m</span>';
    }

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (idx + 1) + '. ' + st.name + ' <span class="spec">' + st.spec + '</span></td>' +
      '<td>' + formatTime(scaledTime) + ' ' + paceCol + '</td>';
    stBody.appendChild(tr);
  });

  var stSumTr = document.createElement('tr');
  stSumTr.className = 'row-sum';
  stSumTr.innerHTML =
    '<td>합계</td>' +
    '<td>' + formatTime(targetStationTotal) + '</td>';
  stBody.appendChild(stSumTr);

  // 참고 정보
  document.getElementById('res-bucket-count').textContent = rawBucket.count.toLocaleString() + '명';
  document.getElementById('ref-total-athletes').textContent = data.totalAthletes.toLocaleString() + '명';

  document.getElementById('results').classList.remove('hidden');
}

// --- 백분위 계산 (공통) ---

function calculatePercentile(buckets, bucket, targetMinutes, totalAthletes) {
  var cumulativeBefore = 0;
  for (var i = 0; i < buckets.length; i++) {
    if (buckets[i] === bucket) break;
    cumulativeBefore += buckets[i].count;
  }
  var bucketPosition = (targetMinutes - bucket.lo_min) / (bucket.hi_min - bucket.lo_min);
  var rank = Math.round(cumulativeBefore + bucketPosition * bucket.count);
  var percentile = Math.round((rank / totalAthletes) * 1000) / 10;
  return { rank: rank, percentile: percentile };
}

// --- 탭 전환 ---

function switchTab(tabName) {
  document.querySelectorAll('.tab[data-tab]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(function (sec) {
    sec.classList.toggle('hidden', sec.id !== tabName);
  });
}

// --- Gap Analysis ---

function parseGapTime(prefix) {
  var h = parseInt(document.getElementById(prefix + '-hours').value) || 0;
  var m = parseInt(document.getElementById(prefix + '-minutes').value) || 0;
  var s = parseInt(document.getElementById(prefix + '-seconds').value) || 0;
  return h * 3600 + m * 60 + s;
}

function calculateGap() {
  var slug = document.getElementById('gap-select-division').value;
  if (!slug) return;

  var targetSeconds = parseGapTime('gap-target');
  var currentSeconds = parseGapTime('gap-current');
  if (targetSeconds <= 0 || currentSeconds <= 0) {
    document.getElementById('gap-results').classList.add('hidden');
    return;
  }

  loadDivision(slug).then(function (divData) {
    var targetMinutes = targetSeconds / 60;
    var currentMinutes = currentSeconds / 60;
    var targetBucket = getInterpolatedBucket(divData.buckets, targetMinutes);
    var currentBucket = getInterpolatedBucket(divData.buckets, currentMinutes);
    var rawTargetBucket = findBucket(divData.buckets, targetMinutes);
    var rawCurrentBucket = findBucket(divData.buckets, currentMinutes);

    var runRoxRatio = targetBucket.avg_run_rox / targetBucket.avg_overall;

    var targetRunRox = targetSeconds * runRoxRatio;
    var targetStation = targetSeconds - targetRunRox;
    var currentRunRoxRatio = currentBucket.avg_run_rox / currentBucket.avg_overall;
    var currentRunRox = currentSeconds * currentRunRoxRatio;
    var currentStation = currentSeconds - currentRunRox;

    var totalGap = currentSeconds - targetSeconds;
    var runRoxGap = currentRunRox - targetRunRox;
    var stationGap = currentStation - targetStation;

    var targetPct = calculatePercentile(divData.buckets, rawTargetBucket, targetMinutes, divData.total_athletes);
    var currentPct = calculatePercentile(divData.buckets, rawCurrentBucket, currentMinutes, divData.total_athletes);

    renderGapResults({
      slug: slug,
      totalGap: totalGap,
      runRoxGap: runRoxGap,
      stationGap: stationGap,
      targetSeconds: targetSeconds,
      currentSeconds: currentSeconds,
      currentPct: currentPct.percentile,
      targetPct: targetPct.percentile,
      currentBucket: currentBucket,
      targetBucket: targetBucket
    });
  });
}

var GAP_PACE_ITEMS = [
  { key: 'running', label: 'Running', isPace: true, unit: '/km', extra: false },
  { key: '1000m SkiErg', label: 'SkiErg', div2: true, unit: '/500m', extra: false },
  { key: '50m Sled Push', label: 'Sled Push', unit: '', extra: false },
  { key: '50m Sled Pull', label: 'Sled Pull', unit: '', extra: false },
  { key: '80m Burpee Broad Jump', label: 'Burpee Broad Jump', unit: '', extra: false },
  { key: '1000m Row', label: 'RowErg', div2: true, unit: '/500m', extra: true },
  { key: '200m Farmers Carry', label: 'Farmers Carry', unit: '', extra: true },
  { key: '100m Sandbag Lunges', label: 'Sandbag Lunges', unit: '', extra: true },
  { key: 'Wall Balls', label: 'Wall Balls', unit: '', extra: true }
];

function renderGapResults(data) {
  var isAhead = data.totalGap <= 0;

  // 총 단축
  if (isAhead) {
    document.getElementById('gap-total').textContent = data.totalGap === 0
      ? '이미 목표 달성'
      : '목표보다 ' + formatTime(Math.abs(data.totalGap)) + ' 빠름';
  } else {
    document.getElementById('gap-total').textContent = formatTime(data.totalGap) + ' 단축 필요';
  }
  document.getElementById('gap-current-time').textContent = formatTime(data.currentSeconds);
  document.getElementById('gap-target-time').textContent = formatTime(data.targetSeconds);

  // 백분위
  document.getElementById('gap-current-pct').textContent = 'Top ' + data.currentPct.toFixed(1) + '%';
  document.getElementById('gap-target-pct').textContent = 'Top ' + data.targetPct.toFixed(1) + '%';

  var pctGap = data.currentPct - data.targetPct;
  var pctDiffEl = document.getElementById('gap-pct-diff');
  pctDiffEl.textContent = pctGap > 0 ? '상위권 기준 약 ' + pctGap.toFixed(1) + '%p 상승 필요' : '';

  // 시간 배분 가이드
  if (isAhead) {
    document.getElementById('gap-run-improve').textContent = '목표 이상';
    document.getElementById('gap-station-improve').textContent = '목표 이상';
  } else {
    document.getElementById('gap-run-improve').textContent = '약 ' + formatTime(data.runRoxGap);
    document.getElementById('gap-station-improve').textContent = '약 ' + formatTime(data.stationGap);
  }

  // 세부 페이스 목표 테이블 + 가장 큰 개선 구간 추적
  var tbody = document.getElementById('gap-pace-body');
  tbody.innerHTML = '';
  var biggestRatio = 0;
  var biggestLabel = '-';
  var biggestDeltaText = '-';
  var collectedPaceItems = [];

  GAP_PACE_ITEMS.forEach(function (item) {
    var curVal, tgtVal, curText, tgtText, deltaText;

    if (item.isPace) {
      curVal = data.currentBucket.avg_pace_8_7;
      tgtVal = data.targetBucket.avg_pace_8_7;
      curText = formatPace(curVal) + ' ' + item.unit;
      tgtText = formatPace(tgtVal) + ' ' + item.unit;
      var delta = tgtVal - curVal;
      if (!isAhead && delta >= 0) { tgtVal = curVal; tgtText = curText; }
      deltaText = isAhead ? '목표 이상' : (delta >= 0 ? '유지' : '-' + formatPace(Math.abs(delta)) + ' ' + item.unit);
      if (!isAhead && delta < 0 && curVal > 0) {
        var ratio = Math.abs(delta) / curVal;
        if (ratio > biggestRatio) { biggestRatio = ratio; biggestLabel = item.label; biggestDeltaText = deltaText; }
      }
    } else {
      var rawCur = data.currentBucket.stations[item.key] || 0;
      var rawTgt = data.targetBucket.stations[item.key] || 0;
      if (item.div2) {
        curVal = rawCur / 2;
        tgtVal = rawTgt / 2;
        curText = formatPace(curVal) + ' ' + item.unit;
        tgtText = formatPace(tgtVal) + ' ' + item.unit;
        var d2 = tgtVal - curVal;
        if (!isAhead && d2 >= 0) { tgtVal = curVal; tgtText = curText; }
        deltaText = isAhead ? '목표 이상' : (d2 >= 0 ? '유지' : '-' + formatPace(Math.abs(d2)) + ' ' + item.unit);
        if (!isAhead && d2 < 0 && curVal > 0) {
          var r2 = Math.abs(d2) / curVal;
          if (r2 > biggestRatio) { biggestRatio = r2; biggestLabel = item.label; biggestDeltaText = deltaText; }
        }
      } else {
        curVal = rawCur;
        tgtVal = rawTgt;
        curText = formatTime(curVal);
        tgtText = formatTime(tgtVal);
        var d3 = tgtVal - curVal;
        if (!isAhead && d3 >= 0) { tgtVal = curVal; tgtText = curText; }
        deltaText = isAhead ? '목표 이상' : (d3 >= 0 ? '유지' : '-' + formatTime(Math.abs(d3)));
        if (!isAhead && d3 < 0 && curVal > 0) {
          var r3 = Math.abs(d3) / curVal;
          if (r3 > biggestRatio) { biggestRatio = r3; biggestLabel = item.label; biggestDeltaText = deltaText; }
        }
      }
    }

    collectedPaceItems.push({
      key: item.key || 'running',
      label: item.label,
      curText: curText,
      tgtText: tgtText,
      curVal: curVal,
      tgtVal: tgtVal,
      delta: tgtVal - curVal,
      deltaRatio: (curVal > 0 && (tgtVal - curVal) < 0) ? Math.abs(tgtVal - curVal) / curVal : 0
    });

    var tr = document.createElement('tr');
    if (item.extra) tr.className = 'pace-row-extra hidden';
    var deltaClass = deltaText === '목표 이상' ? '' : 'pace-delta';
    tr.innerHTML =
      '<td>' + item.label + '</td>' +
      '<td>' + curText + '</td>' +
      '<td>→</td>' +
      '<td>' + tgtText + '</td>' +
      '<td class="' + deltaClass + '">' + deltaText + '</td>';
    tbody.appendChild(tr);
  });

  // 더 보기 버튼 초기화
  var moreBtn = document.getElementById('btn-gap-more');
  moreBtn.textContent = '▼ 더 보기';
  moreBtn.classList.remove('hidden');

  // 종합 요약
  if (isAhead) {
    document.getElementById('gap-ov-total').textContent = '이미 목표 달성';
    document.getElementById('gap-ov-rate').textContent = '목표보다 빠름';
    document.getElementById('gap-ov-biggest').textContent = '-';
  } else {
    document.getElementById('gap-ov-total').textContent = formatTime(data.totalGap);
    var paceImprove = Math.round(data.totalGap / data.currentSeconds * 1000) / 10;
    document.getElementById('gap-ov-rate').textContent = paceImprove.toFixed(1) + '%';
    document.getElementById('gap-ov-biggest').innerHTML = biggestLabel + '<br>' + biggestDeltaText;
  }
  document.getElementById('gap-ov-pct').textContent = 'Top ' + data.currentPct.toFixed(1) + '% → Top ' + data.targetPct.toFixed(1) + '%';

  document.getElementById('gap-results').classList.remove('hidden');

  // 로드맵 데이터 수집
  var divLabel = '';
  if (metaData) {
    for (var i = 0; i < metaData.divisions.length; i++) {
      if (metaData.divisions[i].slug === data.slug) {
        divLabel = metaData.divisions[i].label;
        break;
      }
    }
  }
  roadmapData = {
    divisionSlug: data.slug,
    divisionLabel: divLabel,
    currentSeconds: data.currentSeconds,
    targetSeconds: data.targetSeconds,
    totalGap: data.totalGap,
    isAhead: isAhead,
    paceItems: collectedPaceItems
  };
  document.getElementById('btn-go-roadmap').classList.remove('hidden');
}

function toggleGapMore() {
  var rows = document.querySelectorAll('.pace-row-extra');
  var btn = document.getElementById('btn-gap-more');
  var isHidden = rows[0] && rows[0].classList.contains('hidden');
  rows.forEach(function (r) { r.classList.toggle('hidden'); });
  btn.textContent = isHidden ? '▲ 접기' : '▼ 더 보기';
}

// --- 목표 로드맵 ---

var IMPACT_WEIGHTS = {
  'running':              1.00,
  '1000m SkiErg':         0.55,
  '50m Sled Push':        0.75,
  '50m Sled Pull':        0.75,
  '80m Burpee Broad Jump':0.65,
  '1000m Row':            0.55,
  '200m Farmers Carry':   0.45,
  '100m Sandbag Lunges':  0.65,
  'Wall Balls':           0.70
};

var TRAINING_STRUCTURES = {
  3: [
    { day: 'Day 1', type: '러닝 인터벌', desc: '목표 페이스 적응' },
    { day: 'Day 2', type: '근지구력',     desc: '약점 스테이션 반복' },
    { day: 'Day 3', type: 'HYROX 혼합',  desc: 'Run + Station 연결' }
  ],
  4: [
    { day: 'Day 1', type: '러닝 인터벌', desc: '목표 페이스 적응' },
    { day: 'Day 2', type: '근지구력',     desc: '약점 스테이션 반복' },
    { day: 'Day 3', type: 'HYROX 혼합',  desc: 'Run + Station 연결' },
    { day: 'Day 4', type: '롱런',        desc: '유산소 기반 강화' }
  ],
  5: [
    { day: 'Day 1', type: '러닝 인터벌', desc: '목표 페이스 적응' },
    { day: 'Day 2', type: '근지구력 A',  desc: '1순위 약점 스테이션 집중' },
    { day: 'Day 3', type: 'HYROX 혼합',  desc: 'Run + Station 연결' },
    { day: 'Day 4', type: '근지구력 B',  desc: '2~3순위 약점 스테이션' },
    { day: 'Day 5', type: '롱런',        desc: '유산소 기반 강화' }
  ]
};

var PERIOD_PLANS = {
  4: [
    { weeks: '1주',    name: '기준점 잡기',          desc: '현재 페이스와 스테이션 수준을 확인하고 훈련 리듬을 만든다.' },
    { weeks: '2~3주',  name: '기록 새는 구간 막기', desc: '' },
    { weeks: '4주',    name: '컨디션 조절',          desc: '운동량을 줄이고 몸을 가볍게 만들어 대회 당일에 맞춘다.' }
  ],
  8: [
    { weeks: '1~2주',  name: '러닝 엔진 만들기',     desc: '후반까지 무너지지 않는 기본 체력을 만들고 스테이션 동작을 안정화한다.' },
    { weeks: '3~5주',  name: '기록 새는 구간 막기', desc: '' },
    { weeks: '6~7주',  name: '레이스 연결 훈련',     desc: 'Run → Station 전환에 익숙해지고 목표 페이스를 유지하는 연습을 한다.' },
    { weeks: '8주',    name: '컨디션 조절',           desc: '피로를 줄이고 회복에 집중한다.' }
  ],
  12: [
    { weeks: '1~3주',  name: '러닝 엔진 만들기',     desc: '후반까지 무너지지 않는 기본 체력을 만들고 스테이션 동작을 안정화한다.' },
    { weeks: '4~7주',  name: '기록 새는 구간 막기', desc: '' },
    { weeks: '8~10주', name: '레이스 연결 훈련',     desc: 'Run → Station 전환에 익숙해지고 목표 페이스를 유지하는 연습을 한다.' },
    { weeks: '11주',   name: '실전 점검',             desc: '대회 흐름을 짧게 재현하고 목표 기록이 현실적인지 확인한다.' },
    { weeks: '12주',   name: '컨디션 끌어올리기',     desc: '피로는 줄이고 몸 상태는 올려 대회 당일 최고의 컨디션을 준비한다.' }
  ]
};

function getDifficulty(totalGapSeconds, isAhead) {
  if (isAhead) return { label: '유지/보완', level: 0 };
  var gapMin = totalGapSeconds / 60;
  if (gapMin <= 3)  return { label: '쉬움',      level: 1 };
  if (gapMin <= 7)  return { label: '보통',      level: 2 };
  if (gapMin <= 12) return { label: '어려움',    level: 3 };
  return               { label: '매우 어려움', level: 4 };
}

function getTopWeaknesses(paceItems) {
  var candidates = [];
  paceItems.forEach(function (item) {
    if (item.delta >= 0 || item.curVal <= 0) return;
    var dr = item.deltaRatio;
    var weight = IMPACT_WEIGHTS[item.key] || 0.5;
    candidates.push({
      label: item.label,
      curText: item.curText,
      tgtText: item.tgtText,
      deltaRatio: dr,
      impactWeight: weight
    });
  });
  if (candidates.length === 0) return [];

  // 총단축기여도 정규화
  var sumContrib = 0;
  candidates.forEach(function (c) { sumContrib += c.deltaRatio * c.impactWeight; });
  candidates.forEach(function (c) {
    var contrib = sumContrib > 0 ? (c.deltaRatio * c.impactWeight) / sumContrib : 0;
    c.score = c.deltaRatio * 0.7 + contrib * 0.3;
  });
  candidates.sort(function (a, b) { return b.score - a.score; });
  return candidates.slice(0, 3);
}

function renderRoadmap() {
  if (!roadmapData) {
    document.getElementById('roadmap-empty').classList.remove('hidden');
    document.getElementById('roadmap-content').classList.add('hidden');
    return;
  }
  document.getElementById('roadmap-empty').classList.add('hidden');
  document.getElementById('roadmap-content').classList.remove('hidden');

  var period = parseInt(document.querySelector('#rm-period-group .rm-toggle.active').dataset.value);
  var freq = parseInt(document.querySelector('#rm-freq-group .rm-toggle.active').dataset.value);

  // 카드 1: 목표 요약
  document.getElementById('rm-current').textContent = formatTime(roadmapData.currentSeconds);
  document.getElementById('rm-target').textContent = formatTime(roadmapData.targetSeconds);

  if (roadmapData.isAhead) {
    document.getElementById('rm-gap-text').textContent =
      roadmapData.totalGap === 0 ? '이미 목표 달성' : '목표보다 ' + formatTime(Math.abs(roadmapData.totalGap)) + ' 빠름';
  } else {
    document.getElementById('rm-gap-text').textContent = formatTime(roadmapData.totalGap) + ' 단축 필요';
  }

  document.getElementById('rm-division').textContent = roadmapData.divisionLabel;

  var diff = getDifficulty(roadmapData.totalGap, roadmapData.isAhead);
  var diffEl = document.getElementById('rm-difficulty');
  diffEl.textContent = diff.label;
  diffEl.className = 'rm-difficulty-' + diff.level;

  // 카드 2: 우선 개선 항목
  var weaknesses = getTopWeaknesses(roadmapData.paceItems);
  var wList = document.getElementById('rm-weakness-list');
  wList.innerHTML = '';

  if (weaknesses.length === 0) {
    wList.innerHTML = '<div class="rm-balanced-msg">전체적으로 균형 잡힌 수준입니다.</div>';
  } else {
    weaknesses.forEach(function (w, idx) {
      var div = document.createElement('div');
      div.className = 'rm-weakness-item';
      div.innerHTML =
        '<span class="rm-weakness-rank">' + (idx + 1) + '</span>' +
        '<div class="rm-weakness-info">' +
          '<div class="rm-weakness-name">' + w.label + '</div>' +
          '<div class="rm-weakness-detail">현재 ' + w.curText + ' → 목표 ' + w.tgtText + '</div>' +
        '</div>';
      wList.appendChild(div);
    });
  }

  // 약점 이름 목록 (기간별 진행 방향에서 사용)
  var weaknessNames = weaknesses.map(function (w) { return w.label; });
  var weaknessText = weaknessNames.length > 0 ? weaknessNames.slice(0, 2).join(', ') + ' 집중' : '전체 균형 훈련';

  // 카드 3: 추천 훈련 구조
  document.getElementById('rm-structure-title').textContent = '추천 훈련 구조 (주 ' + freq + '회)';
  var sList = document.getElementById('rm-structure-list');
  sList.innerHTML = '';
  var structure = TRAINING_STRUCTURES[freq];
  structure.forEach(function (s) {
    var div = document.createElement('div');
    div.className = 'rm-day-item';
    div.innerHTML =
      '<span class="rm-day-label">' + s.day + '</span>' +
      '<div class="rm-day-info">' +
        '<div class="rm-day-type">' + s.type + '</div>' +
      '</div>';
    sList.appendChild(div);
  });

  // 카드 4: 기간별 진행 방향
  document.getElementById('rm-phase-title').textContent = period + '주 로드맵';
  var pList = document.getElementById('rm-phase-list');
  pList.innerHTML = '';
  var phases = PERIOD_PLANS[period];
  phases.forEach(function (p) {
    var desc = p.desc;
    if (p.desc === '') {
      desc = weaknessText + ', 점진적 강도 증가';
    }
    var div = document.createElement('div');
    div.className = 'rm-phase-item';
    div.innerHTML =
      '<div class="rm-phase-header">' +
        '<span class="rm-phase-weeks">' + p.weeks + '</span>' +
        '<span class="rm-phase-name">' + p.name + '</span>' +
      '</div>' +
      '<div class="rm-phase-desc">' + desc + '</div>';
    pList.appendChild(div);
  });

  // 카드 5: 이번 주 훈련 방향
  var w1List = document.getElementById('rm-week1-list');
  w1List.innerHTML = '';
  var topWeakness = weaknessNames.length > 0 ? weaknessNames[0] : '';

  structure.forEach(function (s) {
    var desc = s.desc;
    // 약점 이름을 동적 삽입
    if (topWeakness) {
      if (desc.indexOf('약점 스테이션') !== -1) {
        desc = desc.replace('약점 스테이션', '약점 스테이션(' + topWeakness + ')');
      }
      if (desc.indexOf('1순위 약점') !== -1) {
        desc = desc.replace('1순위 약점 스테이션', weaknessNames[0] + ' 스테이션');
      }
      if (desc.indexOf('2~3순위 약점') !== -1) {
        var sub = weaknessNames.slice(1).join(', ');
        desc = desc.replace('2~3순위 약점 스테이션', sub ? sub + ' 스테이션' : '보조 스테이션');
      }
    }

    var div = document.createElement('div');
    div.className = 'rm-day-item';
    div.innerHTML =
      '<span class="rm-day-label">' + s.day + '</span>' +
      '<div class="rm-day-info">' +
        '<div class="rm-day-type">' + s.type + '</div>' +
        '<div class="rm-day-desc">' + desc + '</div>' +
      '</div>';
    w1List.appendChild(div);
  });

  // CTA
  var ctaEl = document.getElementById('rm-cta');
  var descLines = CTA_DESCRIPTION.split('\n');
  var descHtml = descLines.map(function (line) { return '<p>' + line + '</p>'; }).join('');
  ctaEl.innerHTML =
    '<div class="rm-cta-desc">' + descHtml + '</div>' +
    '<a class="rm-cta-btn" href="' + KAKAO_CHANNEL_URL + '" target="_blank" rel="noopener noreferrer">' + CTA_TEXT + '</a>';
}

function initRoadmapToggles() {
  ['rm-period-group', 'rm-freq-group'].forEach(function (groupId) {
    var group = document.getElementById(groupId);
    group.querySelectorAll('.rm-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        group.querySelectorAll('.rm-toggle').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderRoadmap();
      });
    });
  });
}

// --- 훈련 페이스 계산기 ---

var RUN_ZONES = [
  { name: 'Recovery',      pct: 0.60, purpose: '회복',          desc: '몸을 회복하고 피로를 풀기 위한 페이스',       session: '30~45분 회복 조깅' },
  { name: 'Easy',          pct: 0.66, purpose: '기초 지구력',    desc: '기본 유산소 능력과 심폐지구력 향상',          session: '45~60분 유산소 러닝' },
  { name: 'LSD',           pct: 0.72, purpose: '장거리 지구력',  desc: '오랜 시간 지속하는 지구력 향상',              session: '60~120분 장거리 러닝' },
  { name: 'Steady',        pct: 0.78, purpose: '페이스 안정',    desc: '일정 페이스 유지 능력 향상',                  session: '30~45분 일정 페이스' },
  { name: 'Marathon Pace', pct: 0.83, purpose: '지속 페이스',    desc: '레이스 후반 페이스 유지 능력 향상',            session: '40~60분 마라톤 페이스' },
  { name: 'Tempo',         pct: 0.89, purpose: '젖산 내성',      desc: '높은 강도를 오래 유지하는 능력 향상',          session: '3×10분, 회복 3분' },
  { name: 'Threshold',     pct: 0.93, purpose: '역치 향상',      desc: '젖산역치(LT) 향상으로 기록 개선',             session: '20~30분 지속주' },
  { name: 'VO2 Interval',  pct: 1.02, purpose: '최대산소섭취량',  desc: '최대 산소 섭취 능력 향상',                    session: '5×3분, 회복 2분' },
  { name: 'Repetition',    pct: 1.10, purpose: '러닝 경제성',    desc: '러닝 효율과 스피드 향상',                     session: '8×200m, 회복 200m 조깅' }
];

var RUN_STRIDES = { name: 'Strides', purpose: '신경 자극', desc: '러닝 동작과 케이던스 활성화', session: '6×100m, 회복 자유', note: '85~95% effort' };

var ERG_ZONES = [
  { name: 'Recovery',   pct: 0.45, purpose: '회복',          desc: '동작을 유지하며 몸을 풀어주는 페이스',    session: '20~30분 가벼운 페이스' },
  { name: 'UT2',        pct: 0.55, purpose: '기초 지구력',    desc: '유산소 기반을 넓히는 장시간 훈련',        session: '30~60분 일정 페이스' },
  { name: 'UT1',        pct: 0.65, purpose: '유산소 발달',    desc: '유산소 역량을 끌어올리는 중강도 훈련',     session: '20~40분 일정 페이스' },
  { name: 'Threshold',  pct: 0.79, purpose: '역치 향상',      desc: '높은 출력을 유지하는 능력 향상',          session: '4×5분, 회복 2분' },
  { name: 'Race Pace',  pct: 0.92, purpose: '레이스 적응',    desc: 'HYROX 실전 강도 적응',                  session: '3×1000m, 회복 3분', highlight: true },
  { name: 'VO2',        pct: 1.00, purpose: '최대산소섭취량',  desc: '최대 유산소 출력 향상',                  session: '6×500m, 회복 2분' },
  { name: 'Sprint',     pct: 1.15, purpose: '파워',           desc: '단거리 폭발적 출력 향상',                session: '8×250m, 회복 충분' }
];

var HYROX_PACE_MODEL = {
  version: 1,
  pct: { '5000': 0.88, '10000': 0.90 },
  thresholdPct: 0.93,
  notice: '러닝 기록만 기반으로 한 추정값입니다. 실제 HYROX 페이스는 스테이션 피로도에 따라 달라질 수 있습니다.'
};

function calcVDOT(distMeters, pbSeconds) {
  var t = pbSeconds / 60;
  var v = distMeters / t;
  var vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  var pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t)
                   + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pctMax;
}

function vdotToPace(vdot, zonePct) {
  var targetVO2 = vdot * zonePct;
  var a = 0.000104;
  var b = 0.182258;
  var c = -(4.60 + targetVO2);
  var v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return 1000 / v * 60;
}

function calcHyroxPace(vdot, dist) {
  var pct = HYROX_PACE_MODEL.pct[String(dist)];
  var hyroxPace = vdotToPace(vdot, pct);
  var thresholdPace = vdotToPace(vdot, HYROX_PACE_MODEL.thresholdPct);
  var gap = Math.round(hyroxPace - thresholdPace);
  return {
    pace: hyroxPace,
    gap: gap,
    distLabel: dist === 5000 ? '5km' : '10km'
  };
}

function c2Watts(pb1000Seconds) {
  var split500 = pb1000Seconds / 2;
  var pace = split500 / 500;
  return 2.80 / (pace * pace * pace);
}

function wattsToSplit500(watts) {
  var pace = Math.pow(2.80 / watts, 1 / 3);
  return pace * 500;
}

function renderErgZones(prefix, resultId, label) {
  var resultEl = document.getElementById(resultId);
  if (!resultEl) return;

  var minEl = document.getElementById('tp-' + prefix + '-min');
  var secEl = document.getElementById('tp-' + prefix + '-sec');
  if (!minEl || !secEl) return;

  var minVal = parseInt(minEl.value);
  var secVal = parseInt(secEl.value);
  if (isNaN(minVal) && isNaN(secVal)) {
    resultEl.classList.add('hidden');
    return;
  }
  var pb = (minVal || 0) * 60 + (secVal || 0);
  if (pb <= 0) {
    resultEl.classList.add('hidden');
    return;
  }

  var refW = c2Watts(pb);
  var pbMin = Math.floor(pb / 60);
  var pbSec = pb % 60;
  var pbText = pbMin + ':' + String(pbSec).padStart(2, '0');
  var html = '<div class="card"><h2 class="card-title">' + label + ' 훈련 페이스</h2>' +
    '<div class="tp-erg-ref">기준 PB: ' + pbText + ' · 기준 출력: ' + Math.round(refW) + 'W</div>';

  ERG_ZONES.forEach(function (z) {
    var zw = refW * z.pct;
    var split = wattsToSplit500(zw);
    if (z.highlight) html += '<div class="tp-zone-divider"></div>';
    var cls = z.highlight ? ' tp-zone-highlight' : '';
    html += '<div class="tp-zone-row' + cls + '">' +
      '<span class="tp-zone-name">' + z.name +
        '<span class="tp-zone-purpose">' + z.purpose + '</span>' +
        '<span class="tp-zone-desc">' + z.desc + '</span>' +
        '<span class="tp-zone-session">' + z.session + '</span></span>' +
      '<span class="tp-zone-value">' + formatPace(split) + ' /500m' +
        '<span class="tp-zone-watts">' + Math.round(zw) + 'W</span></span></div>';
  });

  html += '</div>';
  resultEl.innerHTML = html;
  resultEl.classList.remove('hidden');
}

function renderRunZones() {
  var resultEl = document.getElementById('tp-run-result');
  if (!resultEl) return;

  var minEl = document.getElementById('tp-run-min');
  var secEl = document.getElementById('tp-run-sec');
  if (!minEl || !secEl) return;

  var minVal = parseInt(minEl.value);
  var secVal = parseInt(secEl.value);
  var hyroxEl = document.getElementById('tp-hyrox-result');
  if (isNaN(minVal) && isNaN(secVal)) {
    resultEl.classList.add('hidden');
    if (hyroxEl) hyroxEl.classList.add('hidden');
    return;
  }
  var pb = (minVal || 0) * 60 + (secVal || 0);
  if (pb <= 0) {
    resultEl.classList.add('hidden');
    if (hyroxEl) hyroxEl.classList.add('hidden');
    return;
  }

  var distToggle = document.querySelector('#tp-run-dist-group .rm-toggle.active');
  if (!distToggle) return;
  var dist = parseInt(distToggle.dataset.value);
  var distLabel = dist === 5000 ? '5km' : '10km';
  var vdot = calcVDOT(dist, pb);

  var html = '<div class="card"><h2 class="card-title">러닝 훈련 페이스' +
    '<span class="tp-vdot">VDOT ' + vdot.toFixed(1) + '</span></h2>';

  RUN_ZONES.forEach(function (z) {
    var pace = vdotToPace(vdot, z.pct);
    html += '<div class="tp-zone-row">' +
      '<span class="tp-zone-name">' + z.name +
        '<span class="tp-zone-purpose">' + z.purpose + '</span>' +
        '<span class="tp-zone-desc">' + z.desc + '</span>' +
        '<span class="tp-zone-session">' + z.session + '</span></span>' +
      '<span class="tp-zone-value">' + formatPace(pace) + ' /km</span></div>';
  });

  // Strides (페이스 계산 없이 참고 문구)
  html += '<div class="tp-zone-row">' +
    '<span class="tp-zone-name">' + RUN_STRIDES.name +
      '<span class="tp-zone-purpose">' + RUN_STRIDES.purpose + '</span>' +
      '<span class="tp-zone-desc">' + RUN_STRIDES.desc + '</span>' +
      '<span class="tp-zone-session">' + RUN_STRIDES.session + '</span></span>' +
    '<span class="tp-zone-value tp-zone-note">' + RUN_STRIDES.note + '</span></div>';

  html += '</div>';
  resultEl.innerHTML = html;
  resultEl.classList.remove('hidden');

  // HYROX 예상 런 페이스 (별도 카드)
  renderHyroxPace(vdot, dist, pb);
}

function renderHyroxPace(vdot, dist, pb) {
  var el = document.getElementById('tp-hyrox-result');
  if (!el) return;

  var result = calcHyroxPace(vdot, dist);
  var pbMin = Math.floor(pb / 60);
  var pbSec = pb % 60;
  var pbText = result.distLabel + ' PB ' + pbMin + ':' + String(pbSec).padStart(2, '0');

  var html = '<div class="card tp-hyrox-card">' +
    '<h2 class="card-title">HYROX 예상 런 페이스</h2>' +
    '<div class="tp-hyrox-pace">' + formatPace(result.pace) + ' /km</div>' +
    '<div class="tp-hyrox-meta">' +
      '<span>Threshold 대비 +' + result.gap + '초/km</span>' +
      '<span>' + pbText + ' 기준</span>' +
    '</div>' +
    '<p class="tp-hyrox-notice">' + HYROX_PACE_MODEL.notice + '</p>' +
    '</div>';

  el.innerHTML = html;
  el.classList.remove('hidden');
}

function initPaceCalc() {
  var minEl = document.getElementById('tp-run-min');
  var secEl = document.getElementById('tp-run-sec');
  var distGroup = document.getElementById('tp-run-dist-group');
  if (!minEl || !secEl || !distGroup) return;

  minEl.addEventListener('input', renderRunZones);
  secEl.addEventListener('input', renderRunZones);

  distGroup.querySelectorAll('.rm-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      distGroup.querySelectorAll('.rm-toggle').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderRunZones();
    });
  });

  // RowErg
  var rowMin = document.getElementById('tp-row-min');
  var rowSec = document.getElementById('tp-row-sec');
  if (rowMin && rowSec) {
    rowMin.addEventListener('input', function () { renderErgZones('row', 'tp-row-result', 'RowErg'); });
    rowSec.addEventListener('input', function () { renderErgZones('row', 'tp-row-result', 'RowErg'); });
  }

  // SkiErg
  var skiMin = document.getElementById('tp-ski-min');
  var skiSec = document.getElementById('tp-ski-sec');
  if (skiMin && skiSec) {
    skiMin.addEventListener('input', function () { renderErgZones('ski', 'tp-ski-result', 'SkiErg'); });
    skiSec.addEventListener('input', function () { renderErgZones('ski', 'tp-ski-result', 'SkiErg'); });
  }
}

// --- 초기화 ---

document.addEventListener('DOMContentLoaded', function () {
  // Footer
  var footerEl = document.getElementById('footer-credit');
  footerEl.textContent = FOOTER_TEXT;

  // 시간 입력 2자리 표시 (분/초)
  document.querySelectorAll('.time-input').forEach(function (input) {
    if (input.id.indexOf('hours') === -1 && input.id.indexOf('tp-') === -1) {
      input.value = String(parseInt(input.value) || 0).padStart(2, '0');
      input.addEventListener('blur', function () {
        input.value = String(parseInt(input.value) || 0).padStart(2, '0');
      });
    }
  });

  // 탭 전환
  document.querySelectorAll('.tab[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTab(btn.dataset.tab);
    });
  });

  loadMeta().then(function () {
    // Pace Planner 이벤트
    document.getElementById('select-division').addEventListener('change', function () {
      if (!document.getElementById('results').classList.contains('hidden')) {
        calculate();
      }
    });

    document.getElementById('btn-calculate').addEventListener('click', calculate);

    document.querySelectorAll('#tab-planner .time-input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') calculate();
      });
    });

    // Gap Analysis 이벤트
    document.getElementById('btn-gap-analyze').addEventListener('click', calculateGap);
    document.getElementById('btn-gap-more').addEventListener('click', toggleGapMore);

    document.querySelectorAll('#tab-gap .time-input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') calculateGap();
      });
    });

    // 로드맵 이벤트
    document.getElementById('btn-go-roadmap').addEventListener('click', function () {
      switchTab('tab-roadmap');
      renderRoadmap();
    });

    document.getElementById('btn-goto-gap').addEventListener('click', function () {
      switchTab('tab-gap');
    });

    initRoadmapToggles();
    initPaceCalc();

    // 로드맵 탭 직접 진입 시 상태 체크
    document.querySelectorAll('.tab[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.tab === 'tab-roadmap') {
          renderRoadmap();
        }
      });
    });
  });
});
