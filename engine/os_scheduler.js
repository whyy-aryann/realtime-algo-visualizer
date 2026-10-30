/**
 * engine/os_scheduler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Backend tick-by-tick OS CPU Scheduling simulator.
 * Algorithms: FCFS, SJF (non-preemptive), SRTF (preemptive), Round Robin,
 *             Priority Scheduling with Aging.
 *
 * Each generator yields a TickSnapshot on every CPU tick.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── PCB State constants ───────────────────────────────────────────────────────
const STATE = {
  NEW:        'NEW',
  READY:      'READY',
  RUNNING:    'RUNNING',
  TERMINATED: 'TERMINATED',
};

// ── Colour palette for auto-assignment ───────────────────────────────────────
const COLORS = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b',
  '#10b981', '#3b82f6', '#f97316', '#a855f7',
  '#e11d48', '#0ea5e9',
];

// ── Build Process Control Blocks from raw descriptors ────────────────────────
function buildPCBs(processes) {
  return processes.map((p, i) => ({
    pid:           p.pid          ?? i + 1,
    name:          p.name         ?? `P${i + 1}`,
    arrivalTime:   p.arrivalTime  ?? 0,
    burstTime:     p.burstTime    ?? 1,
    remainingTime: p.burstTime    ?? 1,
    priority:      p.priority     ?? 0,      // lower = higher priority
    color:         p.color        ?? COLORS[i % COLORS.length],
    state:         STATE.NEW,
    startTime:     null,
    finishTime:    null,
    waitingTime:   0,
    turnaroundTime:0,
    responseTime:  null,
    readyAt:       null,           // tick when first entered READY queue
    readyWaitTicks:0,              // ticks spent waiting in READY (for aging)
    effectivePriority: p.priority ?? 0,
  }));
}

// ── Shared Gantt helper ───────────────────────────────────────────────────────
function pushGantt(gantt, pid, name, color, tick) {
  const last = gantt[gantt.length - 1];
  if (last && last.pid === pid) {
    last.end = tick + 1;
  } else {
    gantt.push({ pid, name, color, start: tick, end: tick + 1 });
  }
}

// ── Snapshot builder ─────────────────────────────────────────────────────────
function mkSnap(algo, tick, running, readyQueue, pcbs, completed, gantt, extra, done) {
  const totalBurst   = pcbs.reduce((s, p) => s + p.burstTime, 0);
  const finishedBurst= completed.reduce((s, p) => s + p.burstTime, 0);
  const cpuUtil      = tick > 0 ? ((finishedBurst / tick) * 100).toFixed(1) : '0.0';

  return {
    algorithm: algo,
    currentTick: tick,
    runningProcess: running ? {
      pid:           running.pid,
      name:          running.name,
      remainingTime: running.remainingTime,
      state:         running.state,
      color:         running.color,
      effectivePriority: running.effectivePriority,
    } : null,
    readyQueue: readyQueue.map(p => ({
      pid:           p.pid,
      name:          p.name,
      remainingTime: p.remainingTime,
      burstTime:     p.burstTime,
      priority:      p.priority,
      effectivePriority: p.effectivePriority,
      state:         p.state,
      color:         p.color,
    })),
    allPCBs: pcbs.map(p => ({ ...p })),
    completed: completed.map(p => ({ ...p })),
    gantt: gantt.map(g => ({ ...g })),
    cpuUtilization: cpuUtil,
    throughput: tick > 0 ? (completed.length / tick).toFixed(3) : '0',
    phase: done ? 'done' : 'tick',
    done,
    ...extra,
  };
}

// ── Summary row builder ───────────────────────────────────────────────────────
function buildSummary(completed) {
  return completed.map(p => ({
    pid:           p.pid,
    name:          p.name,
    arrivalTime:   p.arrivalTime,
    burstTime:     p.burstTime,
    priority:      p.priority,
    finishTime:    p.finishTime,
    turnaroundTime:p.turnaroundTime,
    waitingTime:   p.waitingTime,
    responseTime:  p.responseTime,
  }));
}

// ── Safety guard: max ticks = sum of bursts × 4 + max arrival ────────────────
function maxTicks(pcbs) {
  const sumBurst  = pcbs.reduce((s, p) => s + p.burstTime, 0);
  const maxArrival= Math.max(...pcbs.map(p => p.arrivalTime));
  return sumBurst * 4 + maxArrival + 50;
}

// ═════════════════════════════════════════════════════════════════════════════
//  1.  FCFS — First Come First Served (non-preemptive)
// ═════════════════════════════════════════════════════════════════════════════
function* fcfsScheduler(processes) {
  const pcbs       = buildPCBs(processes);
  const readyQueue = [];
  const completed  = [];
  const gantt      = [];
  let   tick       = 0;
  let   running    = null;
  const limit      = maxTicks(pcbs);

  while (completed.length < pcbs.length) {
    // Admit arriving processes (FIFO order by arrival, then pid)
    for (const p of pcbs) {
      if (p.state === STATE.NEW && p.arrivalTime <= tick) {
        p.state   = STATE.READY;
        p.readyAt = tick;
        readyQueue.push(p);
      }
    }

    // Dispatch if CPU idle
    if (!running && readyQueue.length > 0) {
      running = readyQueue.shift();
      running.state = STATE.RUNNING;
      if (running.startTime   === null) running.startTime   = tick;
      if (running.responseTime=== null) running.responseTime= tick - running.arrivalTime;
    }

    if (running) pushGantt(gantt, running.pid, running.name, running.color, tick);
    else         pushGantt(gantt, 'idle', 'Idle', '#374151', tick);

    yield mkSnap('FCFS', tick, running, readyQueue, pcbs, completed, gantt, {}, false);

    // Execute 1 tick
    if (running) {
      running.remainingTime--;
      if (running.remainingTime === 0) {
        running.state          = STATE.TERMINATED;
        running.finishTime     = tick + 1;
        running.turnaroundTime = running.finishTime - running.arrivalTime;
        running.waitingTime    = running.turnaroundTime - running.burstTime;
        completed.push(running);
        running = null;
      }
    }

    tick++;
    if (tick > limit) break;
  }

  yield { ...mkSnap('FCFS', tick, null, [], pcbs, completed, gantt, {}, true), summary: buildSummary(completed) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  2.  SJF — Shortest Job First (non-preemptive)
// ═════════════════════════════════════════════════════════════════════════════
function* sjfScheduler(processes) {
  const pcbs       = buildPCBs(processes);
  const readyQueue = [];
  const completed  = [];
  const gantt      = [];
  let   tick       = 0;
  let   running    = null;
  const limit      = maxTicks(pcbs);

  while (completed.length < pcbs.length) {
    for (const p of pcbs) {
      if (p.state === STATE.NEW && p.arrivalTime <= tick) {
        p.state   = STATE.READY;
        p.readyAt = tick;
        readyQueue.push(p);
      }
    }

    if (!running && readyQueue.length > 0) {
      // Pick shortest burst (tie-break: earlier arrival then pid)
      readyQueue.sort((a, b) =>
        a.burstTime - b.burstTime ||
        a.arrivalTime - b.arrivalTime ||
        a.pid - b.pid
      );
      running = readyQueue.shift();
      running.state = STATE.RUNNING;
      if (running.startTime   === null) running.startTime   = tick;
      if (running.responseTime=== null) running.responseTime= tick - running.arrivalTime;
    }

    if (running) pushGantt(gantt, running.pid, running.name, running.color, tick);
    else         pushGantt(gantt, 'idle', 'Idle', '#374151', tick);

    yield mkSnap('SJF', tick, running, readyQueue, pcbs, completed, gantt, {}, false);

    if (running) {
      running.remainingTime--;
      if (running.remainingTime === 0) {
        running.state          = STATE.TERMINATED;
        running.finishTime     = tick + 1;
        running.turnaroundTime = running.finishTime - running.arrivalTime;
        running.waitingTime    = running.turnaroundTime - running.burstTime;
        completed.push(running);
        running = null;
      }
    }

    tick++;
    if (tick > limit) break;
  }

  yield { ...mkSnap('SJF', tick, null, [], pcbs, completed, gantt, {}, true), summary: buildSummary(completed) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  3.  SRTF — Shortest Remaining Time First (preemptive SJF)
// ═════════════════════════════════════════════════════════════════════════════
function* srtfScheduler(processes) {
  const pcbs       = buildPCBs(processes);
  const readyQueue = [];
  const completed  = [];
  const gantt      = [];
  let   tick       = 0;
  let   running    = null;
  const limit      = maxTicks(pcbs);

  while (completed.length < pcbs.length) {
    // Admit new arrivals
    for (const p of pcbs) {
      if (p.state === STATE.NEW && p.arrivalTime <= tick) {
        p.state   = STATE.READY;
        p.readyAt = tick;
        readyQueue.push(p);
      }
    }

    // Preemption check: if a newly admitted process has shorter remaining time than running
    if (running && readyQueue.length > 0) {
      const shortest = readyQueue.reduce((a, b) =>
        a.remainingTime <= b.remainingTime ? a : b
      );
      if (shortest.remainingTime < running.remainingTime) {
        // Preempt
        running.state = STATE.READY;
        readyQueue.push(running);
        running = null;
      }
    }

    if (!running && readyQueue.length > 0) {
      readyQueue.sort((a, b) =>
        a.remainingTime - b.remainingTime ||
        a.arrivalTime   - b.arrivalTime   ||
        a.pid           - b.pid
      );
      running = readyQueue.shift();
      running.state = STATE.RUNNING;
      if (running.startTime   === null) running.startTime   = tick;
      if (running.responseTime=== null) running.responseTime= tick - running.arrivalTime;
    }

    if (running) pushGantt(gantt, running.pid, running.name, running.color, tick);
    else         pushGantt(gantt, 'idle', 'Idle', '#374151', tick);

    yield mkSnap('SRTF', tick, running, readyQueue, pcbs, completed, gantt, {}, false);

    if (running) {
      running.remainingTime--;
      if (running.remainingTime === 0) {
        running.state          = STATE.TERMINATED;
        running.finishTime     = tick + 1;
        running.turnaroundTime = running.finishTime - running.arrivalTime;
        running.waitingTime    = running.turnaroundTime - running.burstTime;
        completed.push(running);
        running = null;
      }
    }

    tick++;
    if (tick > limit) break;
  }

  yield { ...mkSnap('SRTF', tick, null, [], pcbs, completed, gantt, {}, true), summary: buildSummary(completed) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  4.  Round Robin — with configurable quantum Q
//      Simultaneous arrivals at the same tick are enqueued in pid order.
// ═════════════════════════════════════════════════════════════════════════════
function* roundRobinScheduler(processes, quantum = 2) {
  const pcbs       = buildPCBs(processes);
  const readyQueue = [];
  const completed  = [];
  const gantt      = [];
  let   tick       = 0;
  let   running    = null;
  let   quantumLeft= 0;
  const limit      = maxTicks(pcbs) * 2; // RR may need more ticks

  while (completed.length < pcbs.length) {
    // Admit arrivals (sorted by pid for simultaneous arrivals)
    const newArrivals = pcbs.filter(p => p.state === STATE.NEW && p.arrivalTime <= tick);
    newArrivals.sort((a, b) => a.pid - b.pid);
    for (const p of newArrivals) {
      p.state   = STATE.READY;
      p.readyAt = tick;
      readyQueue.push(p);
    }

    // Quantum expiry: preempt and re-enqueue, then admit new arrivals that came this tick
    if (running && quantumLeft === 0) {
      running.state = STATE.READY;
      // Re-add new arrivals that appeared during this exact tick BEFORE re-queuing the running process? 
      // Standard RR: running goes to end of queue after quantum expires
      readyQueue.push(running);
      running = null;
    }

    if (!running && readyQueue.length > 0) {
      running      = readyQueue.shift();
      running.state= STATE.RUNNING;
      quantumLeft  = quantum;
      if (running.startTime   === null) running.startTime   = tick;
      if (running.responseTime=== null) running.responseTime= tick - running.arrivalTime;
    }

    if (running) pushGantt(gantt, running.pid, running.name, running.color, tick);
    else         pushGantt(gantt, 'idle', 'Idle', '#374151', tick);

    yield mkSnap('RoundRobin', tick, running, readyQueue, pcbs, completed, gantt,
      { quantum, quantumLeft }, false);

    if (running) {
      running.remainingTime--;
      quantumLeft--;

      if (running.remainingTime === 0) {
        running.state          = STATE.TERMINATED;
        running.finishTime     = tick + 1;
        running.turnaroundTime = running.finishTime - running.arrivalTime;
        running.waitingTime    = running.turnaroundTime - running.burstTime;
        completed.push(running);
        running     = null;
        quantumLeft = 0;
      }
    }

    tick++;
    if (tick > limit) break;
  }

  yield { ...mkSnap('RoundRobin', tick, null, [], pcbs, completed, gantt,
    { quantum, quantumLeft: 0 }, true), summary: buildSummary(completed) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  5.  Priority Scheduling with Aging (non-preemptive base, aging prevents starvation)
//
//  EffectivePriority = Math.max(0, priority - Math.floor(readyWaitTicks / agingInterval))
//
//  Lower EffectivePriority = higher CPU priority (same convention as Linux nice).
//  agingInterval: ticks in ready queue before priority improves by 1.
// ═════════════════════════════════════════════════════════════════════════════
function* priorityScheduler(processes, agingInterval = 5) {
  const pcbs       = buildPCBs(processes);
  const readyQueue = [];
  const completed  = [];
  const gantt      = [];
  let   tick       = 0;
  let   running    = null;
  const limit      = maxTicks(pcbs) * 2;

  while (completed.length < pcbs.length) {
    // Admit arrivals
    for (const p of pcbs) {
      if (p.state === STATE.NEW && p.arrivalTime <= tick) {
        p.state           = STATE.READY;
        p.readyAt         = tick;
        p.readyWaitTicks  = 0;
        readyQueue.push(p);
      }
    }

    // Update aging for all READY processes
    for (const p of readyQueue) {
      p.readyWaitTicks++;
      p.effectivePriority = Math.max(
        0,
        p.priority - Math.floor(p.readyWaitTicks / agingInterval)
      );
    }

    // Dispatch: pick lowest effectivePriority (tie: earliest arrival, then pid)
    if (!running && readyQueue.length > 0) {
      readyQueue.sort((a, b) =>
        a.effectivePriority - b.effectivePriority ||
        a.arrivalTime       - b.arrivalTime       ||
        a.pid               - b.pid
      );
      running = readyQueue.shift();
      running.state = STATE.RUNNING;
      if (running.startTime   === null) running.startTime   = tick;
      if (running.responseTime=== null) running.responseTime= tick - running.arrivalTime;
    }

    if (running) pushGantt(gantt, running.pid, running.name, running.color, tick);
    else         pushGantt(gantt, 'idle', 'Idle', '#374151', tick);

    yield mkSnap('Priority+Aging', tick, running, readyQueue, pcbs, completed, gantt,
      { agingInterval }, false);

    if (running) {
      running.remainingTime--;
      if (running.remainingTime === 0) {
        running.state          = STATE.TERMINATED;
        running.finishTime     = tick + 1;
        running.turnaroundTime = running.finishTime - running.arrivalTime;
        running.waitingTime    = running.turnaroundTime - running.burstTime;
        completed.push(running);
        running = null;
      }
    }

    tick++;
    if (tick > limit) break;
  }

  yield { ...mkSnap('Priority+Aging', tick, null, [], pcbs, completed, gantt,
    { agingInterval }, true), summary: buildSummary(completed) };
}

module.exports = {
  fcfsScheduler,
  sjfScheduler,
  srtfScheduler,
  roundRobinScheduler,
  priorityScheduler,
  STATE,
};
