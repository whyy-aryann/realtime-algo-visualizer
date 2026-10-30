/**
 * server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express + Socket.io server with Kernel-style ASCII Terminal Logging.
 * Manages per-client simulation sessions for:
 *   • OS CPU Schedulers  (FCFS / SJF / SRTF / Round Robin / Priority+Aging)
 *   • Banker's Algorithm (Deadlock Avoidance — step-by-step)
 *
 * All algorithm computation lives on the server.
 * The frontend is a pure state renderer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');

const {
  fcfsScheduler,
  sjfScheduler,
  srtfScheduler,
  roundRobinScheduler,
  priorityScheduler,
} = require('./engine/os_scheduler');

const {
  bankersAlgorithm,
  SAMPLE_SAFE,
  SAMPLE_UNSAFE,
  SAMPLE_SMALL_SAFE,
} = require('./engine/bankers');

// Global process error handlers
process.on('uncaughtException', err => {
  console.error('[KERNEL CRITICAL] Uncaught exception:', err);
});
process.on('unhandledRejection', reason => {
  console.error('[KERNEL CRITICAL] Unhandled rejection:', reason);
});

// ── Express app ───────────────────────────────────────────────────────────────
const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ── Default process set ───────────────────────────────────────────────────────
const DEFAULT_PROCESSES = [
  { pid: 1, name: 'P1', arrivalTime: 0, burstTime: 8,  priority: 3 },
  { pid: 2, name: 'P2', arrivalTime: 1, burstTime: 4,  priority: 1 },
  { pid: 3, name: 'P3', arrivalTime: 2, burstTime: 9,  priority: 4 },
  { pid: 4, name: 'P4', arrivalTime: 3, burstTime: 5,  priority: 2 },
  { pid: 5, name: 'P5', arrivalTime: 4, burstTime: 3,  priority: 1 },
];

const ALGO_NAMES = {
  fcfs:     'First-Come, First-Served (FCFS)',
  sjf:      'Shortest Job First (SJF - Non-Preemptive)',
  srtf:     'Shortest Remaining Time First (SRTF - Preemptive)',
  rr:       'Round Robin (RR)',
  priority: 'Priority Scheduling with Aging',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Kernel-style Terminal ASCII Logging Helpers
// ─────────────────────────────────────────────────────────────────────────────

function logSchedulerStart({ algorithm, processes, quantum, agingInterval }) {
  const name = ALGO_NAMES[algorithm] || algorithm.toUpperCase();
  console.log('\n' + '='.repeat(80));
  console.log(`[KERNEL] INITIALIZING CPU SCHEDULER: ${name.toUpperCase()}`);
  console.log('='.repeat(80));
  console.log(`  Algorithm        : ${name}`);
  if (algorithm === 'rr') {
    console.log(`  Time Quantum (Q) : ${quantum} ticks`);
  } else if (algorithm === 'priority') {
    console.log(`  Aging Interval   : ${agingInterval} ticks (Aging: max(0, prio - wait/interval))`);
  }
  const procList = processes.map(p => `${p.name || ('P' + p.pid)}(BT:${p.burstTime}${p.priority !== undefined ? `,Prio:${p.priority}` : ''})`).join(', ');
  console.log(`  Admitted Procs   : ${processes.length} processes [ ${procList} ]`);
  console.log('-'.repeat(80));
}

function logSchedulerTick(frame) {
  if (!frame) return;
  const tickStr = String(frame.currentTick ?? 0).padStart(3, '0');
  const running = frame.runningProcess;
  const cpuStr = running ? (running.name || `P${running.pid}`) : 'IDLE';
  const remStr = running ? String(running.remainingTime ?? '-') : '-';
  const rqElements = (frame.readyQueue || []).map(p => p.name || `P${p.pid}`);
  const rqContent = rqElements.length > 0 ? ` ${rqElements.join(', ')} ` : ' ';

  console.log(`[TICK ${tickStr}] CPU: ${cpuStr.padEnd(6, ' ')} | Rem: ${remStr.padEnd(2, ' ')} | ReadyQueue: [${rqContent}]`);
}

function logSchedulerComplete(frame, session) {
  console.log('-'.repeat(80));
  console.log('[KERNEL] CPU SCHEDULER EXECUTION COMPLETE — WORKLOAD FINISHED');
  console.log('-'.repeat(80));

  const summary = (frame && frame.summary) || (frame && frame.completed ? frame.completed.map(p => ({
    name: p.name || `P${p.pid}`,
    turnaroundTime: p.turnaroundTime,
    waitingTime: p.waitingTime,
    responseTime: p.responseTime,
  })) : []);

  if (summary && summary.length > 0) {
    const totalWT = summary.reduce((acc, p) => acc + (p.waitingTime || 0), 0);
    const totalTAT = summary.reduce((acc, p) => acc + (p.turnaroundTime || 0), 0);
    const avgWT = (totalWT / summary.length).toFixed(2);
    const avgTAT = (totalTAT / summary.length).toFixed(2);

    console.log(`  Total Ticks Elapsed : ${frame?.currentTick ?? 'N/A'}`);
    console.log(`  Completed Processes : ${summary.length}`);
    console.log(`  CPU Utilization     : ${frame?.cpuUtilization ?? 'N/A'}%`);
    console.log(`  Throughput          : ${frame?.throughput ?? 'N/A'} procs/tick`);
    console.log(`  Average Wait Time   : ${avgWT} ticks`);
    console.log(`  Average Turnaround  : ${avgTAT} ticks`);
  } else {
    console.log(`  Total Ticks Elapsed : ${frame?.currentTick ?? 'N/A'}`);
    console.log(`  CPU Utilization     : ${frame?.cpuUtilization ?? 'N/A'}%`);
  }
  console.log('[KERNEL] Final telemetry & metrics frames emitted to WebSocket client.');
  console.log('='.repeat(80) + '\n');
}

function logBankersStart({ allocation, max, available }) {
  const n = allocation?.length ?? 0;
  const m = available?.length ?? 0;
  console.log('\n' + '='.repeat(80));
  console.log("[KERNEL] INITIALIZING BANKER'S DEADLOCK AVOIDANCE ALGORITHM");
  console.log('='.repeat(80));
  console.log(`  Matrix Dimensions : ${n} Processes × ${m} Resource Types`);
  console.log(`  Available Vector  : [ ${(available || []).join(', ')} ]`);
  console.log(`  Processes Tested  : ${Array.from({ length: n }, (_, i) => `P${i}`).join(', ')}`);
  console.log('-'.repeat(80));
}

function logBankersStep(frame) {
  if (!frame) return;
  const stepIdx = String(frame.stepIndex ?? 0).padStart(2, '0');
  if (frame.phase === 'init') {
    const workStr = frame.work ? frame.work.join(', ') : '';
    console.log(`[BANKER INIT   ] Work = Available = [ ${workStr} ] | Beginning safety algorithm passes...`);
  } else if (frame.phase === 'check') {
    const cNeed = frame.candidateNeed ? frame.candidateNeed.join(', ') : '';
    const workStr = frame.work ? frame.work.join(', ') : '';
    if (frame.needSatisfied) {
      console.log(`[BANKER STEP ${stepIdx}] P${frame.candidatePid}: Need [ ${cNeed} ] <= Work [ ${workStr} ] -> PASSED (Can be allocated)`);
    } else {
      console.log(`[BANKER STEP ${stepIdx}] P${frame.candidatePid}: Need [ ${cNeed} ] > Work [ ${workStr} ] -> FAILED / BLOCKED (Insufficient resources)`);
    }
  } else if (frame.phase === 'release') {
    const allocStr = frame.allocation && frame.candidatePid !== null && frame.allocation[frame.candidatePid] ? frame.allocation[frame.candidatePid].join(', ') : '';
    const workStr = frame.work ? frame.work.join(', ') : '';
    const seqStr = (frame.safeSequence || []).map(x => 'P' + x).join(' -> ');
    console.log(`[BANKER STEP ${stepIdx}] P${frame.candidatePid}: Resources reclaimed (+Alloc [ ${allocStr} ]) -> New Work: [ ${workStr} ] | SafeSeq: [ ${seqStr} ]`);
  }
}

function logBankersComplete(frame) {
  if (!frame) return;
  if (frame.safe) {
    const seqStr = (frame.safeSequence || []).map(x => 'P' + x).join(' -> ');
    console.log('\n' + '='.repeat(80));
    console.log("[KERNEL] BANKER'S ALGORITHM VERDICT: SAFE STATE DETECTED");
    console.log('='.repeat(80));
    console.log(`  Safe Execution Sequence : < ${seqStr} >`);
    console.log('  Deadlock Risk           : NONE (System is provably safe)');
    console.log('='.repeat(80) + '\n');
  } else {
    const deadlocked = (frame.finish || []).map((f, i) => (f ? null : `P${i}`)).filter(Boolean);
    console.log('\n' + '='.repeat(80));
    console.log("[KERNEL] BANKER'S ALGORITHM VERDICT: UNSAFE STATE (DEADLOCK RISK)");
    console.log('='.repeat(80));
    console.log('  Deadlock Warning        : System is in an UNSAFE state. No safe sequence exists.');
    if (deadlocked.length > 0) {
      console.log(`  Deadlocked Processes    : [ ${deadlocked.join(', ')} ]`);
    }
    console.log('='.repeat(80) + '\n');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Session class — isolated per socket
// ─────────────────────────────────────────────────────────────────────────────
class SimSession {
  constructor(id) {
    this.id            = id;
    this.generator     = null;
    this.timer         = null;
    this.paused        = false;
    this.stepMode      = false;
    this.tickIntervalMs= 400;
    this.frameCount    = 0;
    this.startWallTime = null;
    this.mode          = null; // 'os' | 'bankers'
  }

  clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  reset() {
    this.clearTimer();
    this.generator      = null;
    this.paused         = false;
    this.stepMode       = false;
    this.frameCount     = 0;
    this.startWallTime  = null;
    this.mode           = null;
  }
}

const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, new SimSession(id));
  return sessions.get(id);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tick-loop driver
// ─────────────────────────────────────────────────────────────────────────────
function scheduleTick(socket, session) {
  session.clearTimer();
  if (session.paused || session.stepMode || !session.generator) return;
  session.timer = setTimeout(() => advanceTick(socket, session), session.tickIntervalMs);
}

function advanceTick(socket, session) {
  if (!session.generator) return;

  const result = session.generator.next();
  session.frameCount++;

  const frame = result.value || { done: true };
  frame.frameIndex      = session.frameCount;
  frame.serverTimestamp = Date.now();

  // Kernel-style tick tracing
  if (session.mode === 'os') {
    if (!frame.done) {
      logSchedulerTick(frame);
    }
  } else if (session.mode === 'bankers') {
    logBankersStep(frame);
  }

  socket.emit('frame', frame);

  if (result.done || frame.done) {
    if (session.mode === 'os') {
      logSchedulerComplete(frame, session);
    } else if (session.mode === 'bankers') {
      logBankersComplete(frame);
    }

    const wallMs = session.startWallTime ? Date.now() - session.startWallTime : 0;
    socket.emit('simulation_done', { totalFrames: session.frameCount, elapsedWallMs: wallMs });
    session.reset();
    return;
  }

  scheduleTick(socket, session);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Socket.io event handlers
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] Client connected: ${socket.id}`);
  const session = getSession(socket.id);

  // ── START ─────────────────────────────────────────────────────────────────
  socket.on('START', payload => {
    session.reset();
    const { type, algorithm, processes, speed, quantum, agingInterval, stepMode,
            allocation, max, available } = payload || {};

    session.mode           = type;
    session.tickIntervalMs = Math.max(50, Math.min(3000, speed ?? 400));
    session.stepMode       = !!stepMode;
    session.startWallTime  = Date.now();

    // ── OS scheduler ─────────────────────────────────────────────────────
    if (type === 'os') {
      const procs = (Array.isArray(processes) && processes.length) ? processes : DEFAULT_PROCESSES;
      const q     = quantum       ?? 2;
      const ai    = agingInterval ?? 5;

      switch (algorithm) {
        case 'fcfs':     session.generator = fcfsScheduler(procs);          break;
        case 'sjf':      session.generator = sjfScheduler(procs);           break;
        case 'srtf':     session.generator = srtfScheduler(procs);          break;
        case 'rr':       session.generator = roundRobinScheduler(procs, q); break;
        case 'priority': session.generator = priorityScheduler(procs, ai);  break;
        default:         session.generator = fcfsScheduler(procs);
      }
      logSchedulerStart({ algorithm, processes: procs, quantum: q, agingInterval: ai });
      socket.emit('sim_started', { type, algorithm, processes: procs, quantum: q, agingInterval: ai });
    }

    // ── Banker's algorithm ────────────────────────────────────────────────
    else if (type === 'bankers') {
      try {
        session.generator = bankersAlgorithm(allocation, max, available);
        logBankersStart({ allocation, max, available });
        socket.emit('sim_started', { type, numProcesses: allocation.length, numResources: available.length });
      } catch (e) {
        console.error(`[KERNEL ERROR] Banker's Algorithm initialization error: ${e.message}`);
        socket.emit('sim_error', { message: e.message });
        session.reset();
        return;
      }
    }

    if (!session.generator) return;

    if (!session.stepMode) {
      scheduleTick(socket, session);
    } else {
      socket.emit('awaiting_step', { frameIndex: 0 });
    }
  });

  // ── PAUSE ─────────────────────────────────────────────────────────────────
  socket.on('PAUSE', () => {
    session.paused = true;
    session.clearTimer();
    console.log(`[KERNEL] Simulation PAUSED by client (frame: ${session.frameCount})`);
    socket.emit('sim_paused', { frameIndex: session.frameCount });
  });

  // ── RESUME ────────────────────────────────────────────────────────────────
  socket.on('RESUME', () => {
    if (!session.generator) return;
    session.paused   = false;
    session.stepMode = false;
    console.log(`[KERNEL] Simulation RESUMED by client (frame: ${session.frameCount})`);
    scheduleTick(socket, session);
    socket.emit('sim_resumed', { frameIndex: session.frameCount });
  });

  // ── STEP ──────────────────────────────────────────────────────────────────
  socket.on('STEP', () => {
    if (!session.generator) return;
    session.paused   = true;
    session.stepMode = true;
    advanceTick(socket, session);
  });

  // ── SPEED_CHANGE ──────────────────────────────────────────────────────────
  socket.on('SPEED_CHANGE', ({ speed }) => {
    session.tickIntervalMs = Math.max(50, Math.min(3000, speed ?? 400));
    if (!session.paused && !session.stepMode && session.generator) {
      session.clearTimer();
      scheduleTick(socket, session);
    }
    socket.emit('speed_updated', { tickIntervalMs: session.tickIntervalMs });
  });

  // ── RESET ─────────────────────────────────────────────────────────────────
  socket.on('RESET', () => {
    session.reset();
    console.log('[KERNEL] Simulation RESET by client.');
    socket.emit('sim_reset');
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
    const s = sessions.get(socket.id);
    if (s) s.reset();
    sessions.delete(socket.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  REST endpoints
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', sessions: sessions.size, uptime: process.uptime() })
);

app.get('/api/defaults', (_req, res) =>
  res.json({ processes: DEFAULT_PROCESSES })
);

app.get('/api/bankers/samples', (_req, res) =>
  res.json({ safe: SAMPLE_SAFE, unsafe: SAMPLE_UNSAFE, smallSafe: SAMPLE_SMALL_SAFE })
);

// ─────────────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () =>
  console.log(`\n🚀  OS Visualizer Server running  →  http://localhost:${PORT}\n`)
);
