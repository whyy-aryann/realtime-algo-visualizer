/**
 * engine/bankers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Banker's Algorithm — Deadlock Avoidance (step-by-step generator)
 *
 * Inputs:
 *   allocation  : n×m matrix  (resources currently held by each process)
 *   max         : n×m matrix  (maximum demand of each process)
 *   available   : m-vector    (currently available resources)
 *
 * Derived:
 *   need[i][j]  = max[i][j] - allocation[i][j]
 *
 * The generator yields one Step object per safety-check iteration so the
 * client can animate the algorithm frame-by-frame.
 *
 * Step shape:
 * {
 *   stepIndex       : number,
 *   work            : number[],        // current Work vector
 *   finish          : boolean[],       // Finish[i] for each process
 *   candidatePid    : number | null,   // process being tested this step
 *   candidateNeed   : number[] | null,
 *   needSatisfied   : boolean | null,  // whether Need <= Work
 *   safeSequence    : number[],        // safe sequence so far
 *   message         : string,          // human-readable explanation
 *   phase           : 'init'|'check'|'release'|'skip'|'safe'|'unsafe',
 *   safe            : boolean | null,  // null until final verdict
 *   done            : boolean,
 *   // matrices (always present for rendering)
 *   allocation, max, need, available, numProcesses, numResources,
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Validate and derive the Need matrix.
 * Throws a descriptive error string if inputs are inconsistent.
 */
function deriveNeed(allocation, max, available) {
  const n = allocation.length;
  const m = available.length;

  if (max.length !== n)
    throw new Error(`Max matrix rows (${max.length}) must equal allocation rows (${n}).`);

  for (let i = 0; i < n; i++) {
    if (allocation[i].length !== m)
      throw new Error(`allocation[${i}] has ${allocation[i].length} resources; expected ${m}.`);
    if (max[i].length !== m)
      throw new Error(`max[${i}] has ${max[i].length} resources; expected ${m}.`);
  }

  const need = [];
  for (let i = 0; i < n; i++) {
    need.push([]);
    for (let j = 0; j < m; j++) {
      const v = max[i][j] - allocation[i][j];
      if (v < 0)
        throw new Error(
          `max[${i}][${j}] (${max[i][j]}) < allocation[${i}][${j}] (${allocation[i][j]}). Invalid input.`
        );
      need[i].push(v);
    }
  }
  return need;
}

/**
 * Main generator.
 * Yields Step objects; the final yield has done:true and safe:boolean.
 */
function* bankersAlgorithm(allocation, max, available) {
  // ── Validation ────────────────────────────────────────────────────────────
  let need;
  try {
    need = deriveNeed(allocation, max, available);
  } catch (e) {
    yield {
      stepIndex: 0, work: [...available], finish: [], candidatePid: null,
      candidateNeed: null, needSatisfied: null, safeSequence: [],
      message: `Input error: ${e.message}`,
      phase: 'unsafe', safe: false, done: true,
      allocation, max, need: [], available,
      numProcesses: allocation.length, numResources: available.length,
    };
    return;
  }

  const n = allocation.length;
  const m = available.length;

  // ── Initialise ────────────────────────────────────────────────────────────
  const work        = [...available];
  const finish      = new Array(n).fill(false);
  const safeSeq     = [];
  let   stepIndex   = 0;
  let   foundInPass = true;

  // Helper: check Need[i] <= Work
  function canSatisfy(i) {
    for (let j = 0; j < m; j++) {
      if (need[i][j] > work[j]) return false;
    }
    return true;
  }

  // Helper snapshot builder
  function snap(extra) {
    return {
      stepIndex,
      work:          [...work],
      finish:        [...finish],
      safeSequence:  [...safeSeq],
      safe:          null,
      done:          false,
      allocation:    allocation.map(r => [...r]),
      max:           max.map(r => [...r]),
      need:          need.map(r => [...r]),
      available:     [...available],
      numProcesses:  n,
      numResources:  m,
      candidatePid:  null,
      candidateNeed: null,
      needSatisfied: null,
      ...extra,
    };
  }

  // ── Yield initial state ───────────────────────────────────────────────────
  yield snap({
    phase:   'init',
    message: `Initialised: Work = Available = [${work}]. Need matrix computed. Starting safety test.`,
  });
  stepIndex++;

  // ── Safety algorithm main loop ────────────────────────────────────────────
  while (foundInPass) {
    foundInPass = false;

    for (let i = 0; i < n; i++) {
      if (finish[i]) {
        yield snap({
          phase:        'skip',
          candidatePid: i,
          message:      `P${i}: already finished — skip.`,
        });
        stepIndex++;
        continue;
      }

      const candidateNeed  = [...need[i]];
      const needSatisfied  = canSatisfy(i);

      // Yield the "check" step before deciding
      yield snap({
        phase:         'check',
        candidatePid:  i,
        candidateNeed,
        needSatisfied,
        message: needSatisfied
          ? `P${i}: Need [${candidateNeed}] ≤ Work [${work}]  ✓ — can be allocated.`
          : `P${i}: Need [${candidateNeed}] > Work [${work}]  ✗ — must wait.`,
      });
      stepIndex++;

      if (needSatisfied) {
        // Simulate resource release: Work = Work + Allocation[i]
        const workBefore = [...work];
        for (let j = 0; j < m; j++) work[j] += allocation[i][j];
        finish[i]    = true;
        foundInPass  = true;
        safeSeq.push(i);

        yield snap({
          phase:         'release',
          candidatePid:  i,
          candidateNeed,
          needSatisfied: true,
          message: `P${i}: Resources released. Work: [${workBefore}] + Allocation[${i}] [${allocation[i]}] → [${work}]. Safe sequence so far: [${safeSeq.map(x => 'P'+x).join(' → ')}]`,
        });
        stepIndex++;
      }
    }
  }

  // ── Final verdict ─────────────────────────────────────────────────────────
  const allFinished = finish.every(Boolean);
  if (allFinished) {
    yield snap({
      phase:   'safe',
      safe:    true,
      done:    true,
      message: `✅ SAFE STATE detected. Safe execution sequence: ${safeSeq.map(x => 'P'+x).join(' → ')}`,
    });
  } else {
    const deadlocked = finish.map((f, i) => (f ? null : `P${i}`)).filter(Boolean);
    yield snap({
      phase:   'unsafe',
      safe:    false,
      done:    true,
      message: `❌ UNSAFE STATE — system may deadlock. Processes that cannot proceed: ${deadlocked.join(', ')}. No safe sequence exists.`,
    });
  }
}

// ── Built-in sample datasets ──────────────────────────────────────────────────

/** Classic textbook safe-state example (5 processes, 3 resource types A/B/C) */
const SAMPLE_SAFE = {
  label: 'Classic Safe State (5 proc, 3 res)',
  processes: ['P0','P1','P2','P3','P4'],
  resources: ['A','B','C'],
  allocation: [
    [0, 1, 0],
    [2, 0, 0],
    [3, 0, 2],
    [2, 1, 1],
    [0, 0, 2],
  ],
  max: [
    [7, 5, 3],
    [3, 2, 2],
    [9, 0, 2],
    [2, 2, 2],
    [4, 3, 3],
  ],
  available: [3, 3, 2],
};

/** Modified version that leads to an unsafe state */
const SAMPLE_UNSAFE = {
  label: 'Unsafe State Example (5 proc, 3 res)',
  processes: ['P0','P1','P2','P3','P4'],
  resources: ['A','B','C'],
  allocation: [
    [0, 1, 0],
    [2, 0, 0],
    [3, 0, 2],
    [2, 1, 1],
    [0, 0, 2],
  ],
  max: [
    [7, 5, 3],
    [3, 2, 2],
    [9, 0, 2],
    [2, 2, 2],
    [4, 3, 3],
  ],
  available: [1, 0, 0],  // drastically reduced — no safe sequence
};

/** Smaller 4-process example */
const SAMPLE_SMALL_SAFE = {
  label: 'Small Safe State (4 proc, 3 res)',
  processes: ['P0','P1','P2','P3'],
  resources: ['R1','R2','R3'],
  allocation: [
    [1, 0, 2],
    [1, 1, 0],
    [1, 1, 1],
    [2, 0, 0],
  ],
  max: [
    [3, 2, 2],
    [2, 2, 1],
    [3, 1, 2],
    [4, 2, 1],
  ],
  available: [1, 1, 0],
};

module.exports = {
  bankersAlgorithm,
  SAMPLE_SAFE,
  SAMPLE_UNSAFE,
  SAMPLE_SMALL_SAFE,
};
