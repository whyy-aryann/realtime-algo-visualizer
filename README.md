# Real-Time OS Algorithm Visualizer & Kernel Telemetry

A discrete-event Operating System simulation engine built with Node.js and WebSockets. Features step-by-step CPU scheduling algorithms, Dijkstra's Banker's Algorithm for deadlock avoidance, real-time terminal telemetry, and an unprivileged browser-based rendering canvas.

## Key Architectural Principles
- **Authoritative Kernel Engine**: Pure server-side state evaluation using generator coroutines (`function*`) yielding immutable tick snapshots.
- **Hardware Clock Modeling**: Discrete-event simulation driven by simulated hardware timer interrupts (`setTimeout`), completely decoupled from wall-clock time.
- **Client Decoupling**: Browser operates purely as a rendering terminal over a full-duplex WebSocket event bus.

## Supported Algorithms
- **CPU Scheduling**:
  - First-Come, First-Served (FCFS)
  - Shortest Job First (SJF — Non-Preemptive)
  - Shortest Remaining Time First (SRTF — Preemptive)
  - Round Robin (RR — with configurable quantum)
  - Priority Scheduling with Starvation-Free Aging math
- **Deadlock Avoidance**:
  - Dijkstra's Banker's Algorithm with step-by-step vector matrix verification ($Need_i \le Work$) and safe sequence derivation.

## Tech Stack
- **Runtime & Engine**: Node.js, Express, Socket.io
- **Frontend / Rendering**: Vanilla JavaScript (Canvas & DOM), CSS

## Local Installation & Execution
```bash
# Clone the repository
git clone [https://github.com/whyy-aryann/realtime-algo-visualizer.git](https://github.com/whyy-aryann/realtime-algo-visualizer.git)

# Enter directory
cd realtime-algo-visualizer

# Install dependencies
npm install

# Start the kernel server
node server.js