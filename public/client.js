/**
 * public/client.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure DOM renderer. Zero algorithm logic.
 * Sends control events to server via Socket.io.
 * Renders incoming TickSnapshot / BankersStep frames onto the DOM.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket'] });

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

// ── App state (render-side only) ──────────────────────────────────────────────
const S = {
  activeTab:    'scheduler',
  osRunning:    false,
  osPaused:     false,
  bkRunning:    false,
  bkPaused:     false,
  hudFrames:    0,
  fpsCount:     0,
  wallStart:    null,
  wallTimer:    null,
  bkData:       null,   // current banker's dataset
  bkStepIndex:  0,
};

// ── Default process table data ────────────────────────────────────────────────
const DEFAULT_PROCS = [
  { pid:1, name:'P1', arrival:0, burst:8,  priority:3 },
  { pid:2, name:'P2', arrival:1, burst:4,  priority:1 },
  { pid:3, name:'P3', arrival:2, burst:9,  priority:4 },
  { pid:4, name:'P4', arrival:3, burst:5,  priority:2 },
  { pid:5, name:'P5', arrival:4, burst:3,  priority:1 },
];
const PROC_COLORS = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#10b981','#3b82f6','#f97316','#a855f7'];

// ─────────────────────────────────────────────────────────────────────────────
//  Tabs
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    S.activeTab = btn.dataset.tab;
    $(`tab-${S.activeTab}`).classList.add('active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  WS log + status
// ─────────────────────────────────────────────────────────────────────────────
function logWS(msg, cls = 'wl-recv') {
  const log   = $('ws-log');
  const entry = el('div', `wl-entry ${cls} wl-new`, `[${new Date().toLocaleTimeString()}] ${msg}`);
  log.prepend(entry);
  setTimeout(() => entry.classList.remove('wl-new'), 400);
  while (log.children.length > 40) log.removeChild(log.lastChild);
}
function setWsStatus(ok) {
  $('ws-dot').className = 'ws-dot' + (ok ? ' connected' : '');
  $('ws-label').textContent = ok ? 'Connected' : 'Disconnected';
}

// FPS counter
setInterval(() => {
  $('hud-fps').textContent = S.fpsCount;
  const pct = Math.min(100, (S.fpsCount / 20) * 100);
  $('tp-fill').style.width = pct + '%';
  S.fpsCount = 0;
}, 1000);

// Wall clock
function startWall() {
  S.wallStart = Date.now();
  if (S.wallTimer) clearInterval(S.wallTimer);
  S.wallTimer = setInterval(() => { $('hud-wall').textContent = Date.now() - S.wallStart; }, 100);
}
function stopWall() { if (S.wallTimer) { clearInterval(S.wallTimer); S.wallTimer = null; } }

// ─────────────────────────────────────────────────────────────────────────────
//  Algorithm selector toggles
// ─────────────────────────────────────────────────────────────────────────────
$('os-algo').addEventListener('change', () => {
  const v = $('os-algo').value;
  $('rr-q-grp').style.display      = v === 'rr'       ? 'flex' : 'none';
  $('aging-grp').style.display     = v === 'priority'  ? 'flex' : 'none';
  $('priority-col-hd').style.display = (v === 'priority') ? '' : 'none';
  $('proc-algo-tag').textContent   = v.toUpperCase();
  // Show/hide priority input column in process editor
  document.querySelectorAll('.prio-cell').forEach(c => {
    c.style.display = (v === 'priority') ? '' : 'none';
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Speed sliders
// ─────────────────────────────────────────────────────────────────────────────
$('os-speed').addEventListener('input', function() {
  $('os-speed-val').textContent = `${this.value}ms`;
  if (S.osRunning) { socket.emit('SPEED_CHANGE', { speed: +this.value }); logWS(`SPEED→${this.value}ms`,'wl-ctrl'); }
});
$('bk-speed').addEventListener('input', function() {
  $('bk-speed-val').textContent = `${this.value}ms`;
  if (S.bkRunning) { socket.emit('SPEED_CHANGE', { speed: +this.value }); logWS(`SPEED→${this.value}ms`,'wl-ctrl'); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Process table editor
// ─────────────────────────────────────────────────────────────────────────────
let procRows = DEFAULT_PROCS.map(p => ({ ...p }));

function renderProcTable() {
  const tbody  = $('proc-input-tbody');
  const isPrio = $('os-algo').value === 'priority';
  tbody.innerHTML = '';
  procRows.forEach((p, i) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td><span class="pid-badge" style="background:${PROC_COLORS[i%PROC_COLORS.length]};">${p.pid}</span></td>
      <td><input type="text"   value="${p.name}"    data-i="${i}" data-f="name"    style="width:55px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-family:var(--mono);font-size:0.8rem;" /></td>
      <td><input type="number" value="${p.arrival}" data-i="${i}" data-f="arrival" style="width:55px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-family:var(--mono);font-size:0.8rem;" min="0"/></td>
      <td><input type="number" value="${p.burst}"   data-i="${i}" data-f="burst"   style="width:55px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-family:var(--mono);font-size:0.8rem;" min="1"/></td>
      <td class="prio-cell" style="display:${isPrio?'':'none'};"><input type="number" value="${p.priority}" data-i="${i}" data-f="priority" style="width:55px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-family:var(--mono);font-size:0.8rem;" min="0"/></td>
      <td><button class="btn btn-danger" style="padding:3px 8px;font-size:0.72rem;" data-del="${i}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = +inp.dataset.i, field = inp.dataset.f;
      procRows[idx][field] = field === 'name' ? inp.value : +inp.value;
    });
  });
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      procRows.splice(+btn.dataset.del, 1);
      procRows.forEach((p, i) => p.pid = i + 1);
      renderProcTable();
    });
  });
}

$('add-proc-btn').addEventListener('click', () => {
  const pid = procRows.length + 1;
  procRows.push({ pid, name:`P${pid}`, arrival:0, burst:5, priority:1 });
  renderProcTable();
});

$('load-sample-btn').addEventListener('click', () => {
  procRows = DEFAULT_PROCS.map((p, i) => ({ ...p, pid: i+1 }));
  renderProcTable();
});

function getProcessList() {
  return procRows.map((p, i) => ({
    pid: i + 1, name: p.name,
    arrivalTime: p.arrival, burstTime: p.burst, priority: p.priority,
    color: PROC_COLORS[i % PROC_COLORS.length],
  }));
}

renderProcTable();

// ─────────────────────────────────────────────────────────────────────────────
//  OS Scheduler controls
// ─────────────────────────────────────────────────────────────────────────────
function setOsBtns() {
  const r = S.osRunning, p = S.osPaused;
  $('os-start').disabled  = r;
  $('os-pause').disabled  = !r || p;
  $('os-resume').disabled = !r || !p;
  $('os-step').disabled   = !r;
  $('os-reset').disabled  = !r;
}

$('os-start').addEventListener('click', () => {
  const algo    = $('os-algo').value;
  const speed   = +$('os-speed').value;
  const quantum = +$('rr-quantum').value || 2;
  const aging   = +$('aging-interval').value || 5;
  socket.emit('START', {
    type: 'os', algorithm: algo, processes: getProcessList(),
    speed, quantum, agingInterval: aging,
  });
  logWS(`START→os/${algo}`, 'wl-emit');
  S.osRunning = true; S.osPaused = false;
  setOsBtns(); startWall();
  S.hudFrames = 0; $('hud-frames').textContent = '0';
  // Show algorithm-specific notes
  $('quantum-note').style.display = algo === 'rr'       ? 'block' : 'none';
  $('aging-note').style.display   = algo === 'priority'  ? 'block' : 'none';
  if (algo === 'rr') { $('q-val').textContent = quantum; }
  if (algo === 'priority') { $('aging-interval-note').textContent = aging; }
});
$('os-pause').addEventListener('click', () => {
  socket.emit('PAUSE'); logWS('PAUSE','wl-ctrl');
  S.osPaused = true; setOsBtns(); stopWall();
});
$('os-resume').addEventListener('click', () => {
  socket.emit('RESUME'); logWS('RESUME','wl-ctrl');
  S.osPaused = false; setOsBtns(); startWall();
});
$('os-step').addEventListener('click', () => {
  socket.emit('STEP'); logWS('STEP','wl-ctrl');
  S.osPaused = true; setOsBtns();
});
$('os-reset').addEventListener('click', () => {
  socket.emit('RESET'); logWS('RESET','wl-ctrl');
  S.osRunning = false; S.osPaused = false; setOsBtns(); stopWall();
  clearOsCanvas(); resetHud();
});

function clearOsCanvas() {
  $('tick-n').textContent = '0';
  $('cpu-name').innerHTML = '<span class="cpu-idle-txt">Idle</span>';
  $('cpu-meta').textContent = 'No process running';
  $('cpu-icon').className = 'cpu-icon';
  $('cpu-icon').textContent = '💤';
  $('rq-list').innerHTML = '<div class="rq-empty">Queue is empty</div>';
  $('pcb-tbody').innerHTML = '<tr><td colspan="10" class="placeholder-msg">Start a simulation to see PCB data</td></tr>';
  $('gantt-chart').innerHTML = '<div class="placeholder-msg" style="padding:12px;">Gantt chart will appear here</div>';
  $('metrics-tbody').innerHTML = '<tr><td colspan="8" class="placeholder-msg">Metrics appear upon completion</td></tr>';
  ['kpi-ticks','kpi-util','kpi-tp','kpi-awt','kpi-atat'].forEach(id => {
    $(id).textContent = id.includes('util') ? '0%' : id === 'kpi-ticks' ? '0' : '—';
  });
  $('quantum-note').style.display = 'none';
  $('aging-note').style.display   = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Banker's Algorithm controls & sample loading
// ─────────────────────────────────────────────────────────────────────────────
let bkSamples = null;

// Fetch samples from REST endpoint
fetch('/api/bankers/samples')
  .then(r => r.json())
  .then(d => { bkSamples = d; loadBkDataset(d.safe); })
  .catch(() => {});

function loadBkDataset(ds) {
  S.bkData = ds;
  renderBkMatrices(ds, null);
  clearBkLog();
  hideBkVerdict();
  $('bk-seq-wrap').style.display = 'none';
  resetFinishWork(ds.allocation.length, ds.available.length);
}

$('bk-sample-safe').addEventListener('click',   () => { if (bkSamples) loadBkDataset(bkSamples.safe);      });
$('bk-sample-unsafe').addEventListener('click', () => { if (bkSamples) loadBkDataset(bkSamples.unsafe);    });
$('bk-sample-small').addEventListener('click',  () => { if (bkSamples) loadBkDataset(bkSamples.smallSafe); });

function setBkBtns() {
  const r = S.bkRunning, p = S.bkPaused;
  $('bk-start').disabled  = r;
  $('bk-pause').disabled  = !r || p;
  $('bk-resume').disabled = !r || !p;
  $('bk-step').disabled   = !r;
  $('bk-reset').disabled  = !r;
}

$('bk-start').addEventListener('click', () => {
  if (!S.bkData) { alert('Load a sample dataset first.'); return; }
  const ds = S.bkData;
  socket.emit('START', {
    type: 'bankers',
    allocation: ds.allocation,
    max:        ds.max,
    available:  ds.available,
    speed:      +$('bk-speed').value,
  });
  logWS(`START→bankers (${ds.allocation.length}P × ${ds.available.length}R)`, 'wl-emit');
  S.bkRunning = true; S.bkPaused = false;
  setBkBtns(); startWall();
  S.hudFrames = 0; $('hud-frames').textContent = '0';
  clearBkLog(); hideBkVerdict();
  $('bk-seq-wrap').style.display = 'none';
  S.bkStepIndex = 0;
});
$('bk-pause').addEventListener('click', () => {
  socket.emit('PAUSE'); logWS('PAUSE','wl-ctrl');
  S.bkPaused = true; setBkBtns(); stopWall();
});
$('bk-resume').addEventListener('click', () => {
  socket.emit('RESUME'); logWS('RESUME','wl-ctrl');
  S.bkPaused = false; setBkBtns(); startWall();
});
$('bk-step').addEventListener('click', () => {
  socket.emit('STEP'); logWS('STEP','wl-ctrl');
  S.bkPaused = true; setBkBtns();
});
$('bk-reset').addEventListener('click', () => {
  socket.emit('RESET'); logWS('RESET','wl-ctrl');
  S.bkRunning = false; S.bkPaused = false; setBkBtns(); stopWall();
  if (S.bkData) loadBkDataset(S.bkData);
  resetHud();
});

// ─────────────────────────────────────────────────────────────────────────────
//  HUD reset
// ─────────────────────────────────────────────────────────────────────────────
function resetHud() {
  ['hud-frames','hud-fps','hud-ticks'].forEach(id => $(id).textContent = '0');
  $('hud-wall').textContent = '0';
  $('hud-util').textContent = '0%';
  $('hud-tp').textContent   = '0';
  $('hud-awt').textContent  = '—';
  $('hud-atat').textContent = '—';
  $('tp-fill').style.width  = '0%';
}

// ─────────────────────────────────────────────────────────────────────────────
//  OS frame renderer
// ─────────────────────────────────────────────────────────────────────────────
function renderOsFrame(f) {
  // Tick
  $('tick-n').textContent = f.currentTick ?? 0;
  $('kpi-ticks').textContent = f.currentTick ?? 0;
  $('hud-ticks').textContent = f.currentTick ?? '—';

  // CPU Utilization & Throughput
  const util = f.cpuUtilization ?? '0.0';
  const tp   = f.throughput ?? '0';
  $('kpi-util').textContent  = util + '%';
  $('kpi-tp').textContent    = tp;
  $('hud-util').textContent  = util + '%';
  $('hud-tp').textContent    = tp;

  // CPU state
  const icon = $('cpu-icon');
  const nm   = $('cpu-name');
  const mt   = $('cpu-meta');
  if (f.runningProcess) {
    const p = f.runningProcess;
    icon.className   = 'cpu-icon running';
    icon.textContent = '⚙️';
    icon.style.borderColor = p.color || 'var(--green)';
    nm.innerHTML = `<span style="color:${p.color || 'var(--accent)'}">${p.name}</span>`;
    mt.textContent = `PID ${p.pid} · Remaining: ${p.remainingTime} tick(s)`;
  } else {
    icon.className   = 'cpu-icon';
    icon.textContent = '💤';
    icon.style.borderColor = 'var(--border)';
    nm.innerHTML = '<span class="cpu-idle-txt">Idle</span>';
    mt.textContent = 'CPU is idle';
  }

  // Quantum left (RR)
  if (f.algorithm === 'RoundRobin') {
    $('quantum-note').style.display = 'block';
    $('quantum-left').textContent   = f.quantumLeft ?? '—';
  }

  // Ready queue
  const rqEl = $('rq-list');
  const rq   = f.readyQueue || [];
  if (!rq.length) {
    rqEl.innerHTML = '<div class="rq-empty">Queue is empty</div>';
  } else {
    const isPrio = f.algorithm === 'Priority+Aging';
    rqEl.innerHTML = rq.map((p, idx) => `
      <div class="rq-item">
        <span style="font-size:.65rem;color:var(--text-muted);">#${idx+1}</span>
        <span class="pid-badge" style="background:${p.color||'#6366f1'}">${p.name}</span>
        BT:${p.burstTime} RT:${p.remainingTime}
        ${isPrio ? `<span style="color:var(--yellow);font-size:.7rem;">Ep:${p.effectivePriority}</span>` : ''}
        <span class="rq-rem">⏳${p.remainingTime}</span>
      </div>`).join('');
  }

  // PCB table
  const pcbs = f.allPCBs || [];
  const showPrio = ['Priority+Aging','FCFS'].includes(f.algorithm) || true; // always show
  $('pcb-tbody').innerHTML = pcbs.map(p => `
    <tr>
      <td><span class="pid-badge" style="background:${p.color||'#6366f1'}">${p.pid}</span></td>
      <td style="color:${p.color||'var(--text)'};">${p.name}</td>
      <td>${p.arrivalTime}</td>
      <td>${p.burstTime}</td>
      <td><strong>${p.remainingTime}</strong></td>
      <td>${p.priority}</td>
      <td style="color:var(--yellow);">${p.effectivePriority ?? p.priority}</td>
      <td><span class="state-pill s-${p.state}">${p.state}</span></td>
      <td>${p.waitingTime ?? '—'}</td>
      <td>${p.turnaroundTime || '—'}</td>
    </tr>`).join('');

  // Gantt
  renderGantt(f.gantt || []);

  // Metrics (on completion)
  if (f.done && f.summary) renderMetrics(f.summary, f.currentTick);
}

function renderGantt(gantt) {
  if (!gantt.length) return;
  const el2 = $('gantt-chart');
  // merge consecutive same-pid
  const merged = [];
  for (const b of gantt) {
    const last = merged[merged.length-1];
    if (last && last.pid === b.pid && last.end === b.start) { last.end = b.end; }
    else merged.push({...b});
  }
  const total = merged[merged.length-1]?.end || 1;
  el2.innerHTML = merged.map(b => {
    const w  = Math.max(.8, ((b.end - b.start) / total) * 100);
    const bg = b.pid === 'idle'
      ? 'linear-gradient(135deg,#1f2535,#2a3045)'
      : `linear-gradient(135deg,${b.color}bb,${b.color})`;
    return `<div class="g-block" style="background:${bg};flex:${w.toFixed(2)}">${b.name}<span class="g-tick">${b.start}→${b.end}</span></div>`;
  }).join('');
}

function renderMetrics(summary, ticks) {
  let sumWT = 0, sumTAT = 0, n = summary.length;
  $('metrics-tbody').innerHTML = summary.map(p => {
    sumWT  += p.waitingTime    || 0;
    sumTAT += p.turnaroundTime || 0;
    return `<tr>
      <td>${p.name}</td><td>${p.arrivalTime}</td><td>${p.burstTime}</td>
      <td>${p.priority}</td><td>${p.finishTime}</td>
      <td style="color:var(--accent2);">${p.turnaroundTime}</td>
      <td style="color:var(--yellow);">${p.waitingTime}</td>
      <td>${p.responseTime ?? '—'}</td>
    </tr>`;
  }).join('') + `<tr class="avg-row">
    <td>Average</td><td>—</td><td>—</td><td>—</td><td>—</td>
    <td>${(sumTAT/n).toFixed(2)}</td>
    <td>${(sumWT/n).toFixed(2)}</td><td>—</td>
  </tr>`;

  const awt  = (sumWT  / n).toFixed(2);
  const atat = (sumTAT / n).toFixed(2);
  $('kpi-awt').textContent   = awt;
  $('kpi-atat').textContent  = atat;
  $('hud-awt').textContent   = awt;
  $('hud-atat').textContent  = atat;

  // throughput = completed / ticks
  if (ticks > 0) {
    const tp = (n / ticks).toFixed(3);
    $('kpi-tp').textContent = tp;
    $('hud-tp').textContent  = tp;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Banker's frame renderer
// ─────────────────────────────────────────────────────────────────────────────
function renderBkFrame(f) {
  const ds   = f;       // frame IS the step snapshot
  const n    = f.numProcesses;
  const m    = f.numResources;
  const procs = f.allocation.map((_, i) => `P${i}`);
  const res   = Array.from({length:m}, (_,j) => `R${j}`);

  // Re-render matrices with highlighting
  renderBkMatrices({
    processes:  procs,
    resources:  res,
    allocation: f.allocation,
    max:        f.max,
    available:  f.available,
  }, f);

  // Work vector
  renderVectorChips('work-chips', f.work, 'var(--accent2)', res);

  // Finish vector
  renderFinishChips(f.finish, procs);

  // Step log entry
  appendStepLog(f);

  // Safe sequence (so far)
  if (f.safeSequence && f.safeSequence.length > 0) {
    $('bk-seq-wrap').style.display = 'block';
    renderSeqChips(f.safeSequence, procs);
  }

  // Verdict
  if (f.done) {
    showBkVerdict(f.safe, f.message, f.safeSequence, procs);
  }
}

function renderBkMatrices(ds, frame) {
  const procs = ds.processes || ds.allocation.map((_,i) => `P${i}`);
  const res   = ds.resources  || Array.from({length:ds.available.length},(_,j)=>`R${j}`);
  const need  = ds.allocation.map((row, i) => row.map((v, j) => ds.max[i][j] - v));

  renderMatrix('mat-alloc', procs, res, ds.allocation, frame, 'alloc');
  renderMatrix('mat-max',   procs, res, ds.max,        frame, 'max');
  renderMatrix('mat-need',  procs, res, need,          frame, 'need');

  // Available + work row
  const avail = $('mat-avail');
  const tbody = avail.querySelector('tbody') || (avail.innerHTML = '<tbody></tbody>', avail.querySelector('tbody'));

  // Header
  avail.innerHTML = `<thead><tr><th class="proc-col">Vector</th>${res.map(r=>`<th>${r}</th>`).join('')}</tr></thead>
    <tbody>
      <tr class="avail-row"><td class="proc-col">Available</td>${ds.available.map(v=>`<td>${v}</td>`).join('')}</tr>
      ${frame ? `<tr style="color:var(--green);font-weight:700;"><td class="proc-col">Work (cur)</td>${frame.work.map(v=>`<td>${v}</td>`).join('')}</tr>` : ''}
    </tbody>`;
}

function renderMatrix(tableId, procs, res, data, frame, which) {
  const tbl  = $(tableId);
  const cPid = frame ? frame.candidatePid : null;

  let html = `<thead><tr><th class="proc-col">Proc</th>${res.map(r=>`<th>${r}</th>`).join('')}</tr></thead><tbody>`;
  data.forEach((row, i) => {
    const isCandidate = (i === cPid);
    const rowBg = isCandidate ? 'background:var(--bg-hover);' : '';
    html += `<tr style="${rowBg}"><td class="proc-col"><span class="pid-badge" style="background:${PROC_COLORS[i%PROC_COLORS.length]}">${procs[i]}</span></td>`;
    row.forEach((v, j) => {
      let cls = '';
      if (which === 'need' && isCandidate && frame) {
        cls = (frame.needSatisfied === true)  ? 'cell-ok'
            : (frame.needSatisfied === false) ? 'cell-fail'
            : '';
      }
      html += `<td class="${cls}">${v}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;
}

function renderVectorChips(containerId, vec, color, labels) {
  const el2 = $(containerId);
  if (!vec || !vec.length) { el2.innerHTML = '<span class="placeholder-msg" style="padding:0;">—</span>'; return; }
  el2.innerHTML = vec.map((v, j) => `
    <span style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;
      padding:5px 10px;font-family:var(--mono);font-size:0.82rem;color:${color};">
      ${labels ? labels[j]+': ' : ''}${v}
    </span>`).join('');
}

function renderFinishChips(finish, procs) {
  const el2 = $('finish-chips');
  if (!finish || !finish.length) { el2.innerHTML = '<span class="placeholder-msg" style="padding:0;">—</span>'; return; }
  el2.innerHTML = finish.map((done, i) => `
    <span style="background:${done ? '#065f46' : 'var(--bg-card)'};
      border:1px solid ${done ? '#10b981' : 'var(--border)'};border-radius:6px;
      padding:5px 10px;font-family:var(--mono);font-size:0.8rem;
      color:${done ? '#34d399' : 'var(--text-muted)'};">
      ${procs[i]} ${done ? '✓' : '…'}
    </span>`).join('');
}

function resetFinishWork(n, m) {
  const procs = Array.from({length:n},(_,i)=>`P${i}`);
  const res   = Array.from({length:m},(_,j)=>`R${j}`);
  renderFinishChips(new Array(n).fill(false), procs);
  renderVectorChips('work-chips', new Array(m).fill('—'), 'var(--text-muted)', res);
}

function renderSeqChips(seq, procs) {
  const el2 = $('bk-seq-chips');
  el2.innerHTML = seq.map((idx, i) =>
    `${i > 0 ? '<span class="seq-arrow">→</span>' : ''}<span class="seq-chip">${procs[idx]}</span>`
  ).join('');
}

function appendStepLog(f) {
  const log   = $('step-log');
  const entry = el('div', `step-entry step-${f.phase} step-new`, f.message);
  log.appendChild(entry);
  setTimeout(() => entry.classList.remove('step-new'), 400);
  log.scrollTop = log.scrollHeight;
}
function clearBkLog() {
  $('step-log').innerHTML = '<div class="step-entry step-init">Waiting for simulation…</div>';
}

function showBkVerdict(safe, msg, seq, procs) {
  const vEl = $('bk-verdict');
  vEl.className = 'verdict-banner ' + (safe ? 'verdict-safe' : 'verdict-unsafe');
  vEl.textContent = safe
    ? `✅ SAFE STATE — Safe Sequence: ${seq.map(i => procs[i]).join(' → ')}`
    : `❌ UNSAFE STATE — Deadlock possible. No safe sequence exists.`;
}
function hideBkVerdict() {
  const vEl = $('bk-verdict');
  vEl.className = 'verdict-banner';
  vEl.textContent = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Socket.io event listeners
// ─────────────────────────────────────────────────────────────────────────────
socket.on('connect',    () => { setWsStatus(true);  logWS('Connected',    'wl-recv'); });
socket.on('disconnect', () => {
  setWsStatus(false); logWS('Disconnected', 'wl-err');
  S.osRunning = S.bkRunning = false;
  S.osPaused  = S.bkPaused  = false;
  setOsBtns(); setBkBtns(); stopWall();
});

socket.on('sim_started',  d => logWS(`sim_started ← ${d.type||''}/${d.algorithm||'bankers'}`, 'wl-recv'));
socket.on('sim_paused',   d => logWS(`paused @frame${d.frameIndex}`, 'wl-recv'));
socket.on('sim_resumed',  d => logWS(`resumed @frame${d.frameIndex}`, 'wl-recv'));
socket.on('sim_reset',    () => logWS('reset ←', 'wl-recv'));
socket.on('speed_updated',d => logWS(`speed←${d.tickIntervalMs}ms`, 'wl-recv'));
socket.on('sim_error',    d => { logWS(`ERROR: ${d.message}`, 'wl-err'); alert(d.message); });

socket.on('frame', f => {
  S.hudFrames++;
  S.fpsCount++;
  $('hud-frames').textContent = S.hudFrames;

  if (f.algorithm) {
    // OS scheduler frame
    renderOsFrame(f);
    if (f.done) {
      S.osRunning = false; S.osPaused = false;
      setOsBtns(); stopWall();
      logWS(`OS done. ${f.currentTick} ticks`, 'wl-recv');
    }
  } else {
    // Banker's step
    renderBkFrame(f);
    $('hud-ticks').textContent = f.stepIndex ?? '—';
    if (f.done) {
      S.bkRunning = false; S.bkPaused = false;
      setBkBtns(); stopWall();
      logWS(`Banker done. Safe=${f.safe}`, 'wl-recv');
    }
  }
});

socket.on('simulation_done', d => {
  logWS(`done ← ${d.totalFrames} frames, ${d.elapsedWallMs}ms`, 'wl-recv');
  $('hud-wall').textContent = d.elapsedWallMs;
});

// ─────────────────────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────────────────────
setOsBtns();
setBkBtns();
