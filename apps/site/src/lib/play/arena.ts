// arena screen: the field on a canvas, the autonomous terminal, keyboard + touch controls.
// the server is the source of truth (20 snapshots a second). your own robot is predicted locally
// with the same driveStep() the server runs and nudged toward the server's answer; everyone else
// is drawn 100ms in the past, interpolated between snapshots, so they move smoothly.
import { driveStep, FIELD, GOALS, PARK, parseProgram, PROGRAM_HELP, PTS, ROBOT_SIZE, TILE, wrap, type ArenaView, type Input, type Team } from "@edwrdq/rooms/arena";

const PROGRAM_KEY = "edwrdq-arena-program";
const DEFAULT_PROGRAM = "# your autonomous. it runs for 15 seconds.\nforward 0.5\nintake\nturn 180\nforward 1\nrelease\n";
const SCALE = 4; // canvas px per inch
const DELAY = 100; // ms others are drawn in the past

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (string | Node)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
const PHASE: Record<ArenaView["phase"], string> = { program: "program your autonomous", auton: "autonomous", driver: "driver control", done: "match over" };
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function mountArena(root: HTMLElement, send: (x: Record<string, unknown>) => void, you: () => number) {
  // ---------- layout
  const bar = el("div", "r-bar");
  const phaseEl = el("p", "label r-phase");
  const scoreEl = el("p", "r-score");
  const timer = el("p", "r-timer");
  bar.append(phaseEl, scoreEl, timer);

  const canvas = el("canvas", "r-field") as HTMLCanvasElement;
  canvas.width = canvas.height = FIELD * SCALE;
  canvas.setAttribute("aria-label", "the field");
  const ctx = canvas.getContext("2d")!;

  const editor = el("div", "r-editor");
  const ta = el("textarea", "field r-code") as HTMLTextAreaElement;
  ta.spellcheck = false;
  ta.rows = 9;
  ta.setAttribute("aria-label", "autonomous program");
  try {
    ta.value = localStorage.getItem(PROGRAM_KEY) ?? DEFAULT_PROGRAM;
  } catch {
    ta.value = DEFAULT_PROGRAM;
  }
  const status = el("p", "r-status");
  const readyBtn = el("button", "btn btn-primary", "READY") as HTMLButtonElement;
  readyBtn.type = "button";
  const readyList = el("p", "r-hint");
  editor.append(
    el("p", "label", "AUTONOMOUS · 15 SECONDS"),
    el("div", "r-term", el("span", "r-prompt", ">"), ta),
    status,
    el("div", "r-row", readyBtn, readyList),
    el("pre", "r-help", PROGRAM_HELP.join("\n")),
  );

  const pad = el("div", "r-pad");
  const stick = el("div", "r-stick", el("div", "r-knob"));
  const actBtn = el("button", "btn btn-primary r-act", "INTAKE / RELEASE") as HTMLButtonElement;
  actBtn.type = "button";
  pad.append(stick, actBtn);
  const keysHint = el("p", "r-hint r-keys", "drive: wasd or arrows · intake / release: space");
  const results = el("div", "r-results");
  root.replaceChildren(bar, canvas, pad, keysHint, editor, results);

  // ---------- program editor
  let ready = false;
  const check = () => {
    const p = parseProgram(ta.value);
    status.textContent = p.ok ? `✓ ${p.cmds.length} command${p.cmds.length === 1 ? "" : "s"}` : `line ${p.line}: ${p.error}`;
    status.classList.toggle("bad", !p.ok);
    readyBtn.disabled = !p.ok && !ready;
    return p.ok;
  };
  ta.addEventListener("input", () => {
    check();
    try {
      localStorage.setItem(PROGRAM_KEY, ta.value);
    } catch {
      /* fine */
    }
    if (ready) setReady(false);
  });
  function setReady(on: boolean) {
    ready = on;
    if (on) send({ a: "prog", text: ta.value });
    send({ a: "ready", on });
    readyBtn.textContent = on ? "EDIT" : "READY";
    readyBtn.classList.toggle("btn-primary", !on);
  }
  readyBtn.addEventListener("click", () => {
    if (!ready && !check()) return;
    setReady(!ready);
  });
  check();

  // ---------- input
  const keys = new Set<string>();
  let stickIn: Input | null = null;
  let lastSent = { th: 0, tu: 0 };
  let lastSendAt = 0;
  const current = (): Input => {
    if (stickIn) return stickIn;
    const th = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const tu = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    return { th, tu };
  };
  const q = (n: number) => Math.round(n * 10) / 10;
  function pushInput(act = false) {
    if (v?.phase !== "driver") return;
    const i = current();
    const now = performance.now();
    const changed = q(i.th) !== lastSent.th || q(i.tu) !== lastSent.tu;
    if (!act && (!changed || now - lastSendAt < 45)) return;
    lastSent = { th: q(i.th), tu: q(i.tu) };
    lastSendAt = now;
    send({ a: "in", th: lastSent.th, tu: lastSent.tu, ...(act ? { act: true } : {}) });
  }
  const typing = () => {
    const a = document.activeElement;
    return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
  };
  const DRIVE = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
  addEventListener("keydown", (e) => {
    if (typing() || v?.phase !== "driver") return;
    const k = e.key.toLowerCase();
    if (DRIVE.has(k)) {
      e.preventDefault();
      keys.add(k);
      pushInput();
    } else if (k === " " || k === "e" || k === "j") {
      e.preventDefault();
      if (!e.repeat) pushInput(true);
    }
  });
  addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
    pushInput();
  });
  addEventListener("blur", () => {
    keys.clear();
    pushInput();
  });
  // virtual joystick: up = forward, sideways = turn
  const knob = stick.firstElementChild as HTMLElement;
  let pid: number | null = null;
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const rad = r.width / 2;
    let dx = (e.clientX - (r.left + rad)) / rad;
    let dy = (e.clientY - (r.top + rad)) / rad;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    knob.style.transform = `translate(${dx * rad * 0.6}px, ${dy * rad * 0.6}px)`;
    const dead = (n: number) => (Math.abs(n) < 0.15 ? 0 : n);
    stickIn = { th: dead(-dy), tu: dead(dx) * 0.8 };
    pushInput();
  };
  stick.addEventListener("pointerdown", (e) => {
    pid = e.pointerId;
    try {
      stick.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    moveStick(e);
  });
  stick.addEventListener("pointermove", (e) => e.pointerId === pid && moveStick(e));
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    pid = null;
    stickIn = { th: 0, tu: 0 };
    knob.style.transform = "";
    pushInput();
    stickIn = null;
  };
  stick.addEventListener("pointerup", endStick);
  stick.addEventListener("pointercancel", endStick);
  actBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pushInput(true);
  });

  // ---------- snapshots, clock, prediction
  let v: ArenaView | null = null;
  const buf: { t: number; bots: ArenaView["bots"] }[] = [];
  const offsets: number[] = [];
  let offset = 0;
  let pred: { x: number; y: number; h: number; v: number } | null = null;
  let rtt = 120;
  let lastFrame = performance.now();
  const serverNow = () => Date.now() + offset;
  const mine = () => v?.robots.find((r) => r.seat === you());

  function onSnap(s: ArenaView) {
    v = s;
    offsets.push(s.now - Date.now());
    if (offsets.length > 30) offsets.shift();
    offset = Math.max(...offsets); // the least-delayed sample is closest to the true offset
    buf.push({ t: s.now, bots: s.bots });
    while (buf.length > 40) buf.shift();
    const me = s.bots.find((b) => b[0] === you());
    if (me && s.phase === "driver") {
      // where the server says we are, run forward by roughly a round trip with what we're pressing now
      const target = { x: me[1], y: me[2], h: me[3], v: me[5] };
      const steps = Math.round(rtt / 50);
      for (let i = 0; i < steps; i++) driveStep(target, current(), 0.05);
      if (!pred || Math.hypot(target.x - pred.x, target.y - pred.y) > 18) pred = target;
      else {
        pred.x += (target.x - pred.x) * 0.25;
        pred.y += (target.y - pred.y) * 0.25;
        pred.h += wrap(target.h - pred.h) * 0.25;
        pred.v = target.v;
      }
    } else pred = null;
    // rtt from the server clock vs ours: rough, but enough to aim the prediction
    const sample = 2 * Math.max(0, offset - (s.now - Date.now()));
    rtt = rtt * 0.9 + Math.min(400, sample + 40) * 0.1;
  }

  /** others at (server time − DELAY), between the two snapshots around it */
  function interp(seat: number): [number, number, number, number] | null {
    const t = serverNow() - DELAY;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i + 1 < buf.length; i++)
      if (buf[i].t <= t && buf[i + 1].t >= t) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
    const ra = a?.bots.find((x) => x[0] === seat), rb = b?.bots.find((x) => x[0] === seat);
    if (!ra || !rb) return null;
    const k = b.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    return [ra[1] + (rb[1] - ra[1]) * k, ra[2] + (rb[2] - ra[2]) * k, ra[3] + wrap(rb[3] - ra[3]) * k, rb[4]];
  }

  // ---------- drawing
  const css = getComputedStyle(document.documentElement);
  const C = (n: string) => css.getPropertyValue(n).trim();
  const col = { bg: C("--surface"), grid: C("--seam-soft"), seam: C("--seam"), acid: C("--acid"), bone: C("--bone"), dim1: C("--dim-1"), dim2: C("--dim-2"), dim3: C("--dim-3"), bgDeep: C("--bg") };
  const teamCol = (t: Team) => (t === "acid" ? col.acid : col.bone);

  function draw() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (pred && v?.phase === "driver") driveStep(pred, current(), dt);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(SCALE, SCALE);
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 0.5;
    for (let i = TILE; i < FIELD; i += TILE) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, FIELD);
      ctx.moveTo(0, i);
      ctx.lineTo(FIELD, i);
      ctx.stroke();
    }
    for (const t of ["acid", "bone"] as Team[]) {
      for (const g of GOALS[t]) {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = teamCol(t);
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = teamCol(t);
        ctx.lineWidth = 0.75;
        ctx.strokeRect(g.x + 0.4, g.y + 0.4, g.w - 0.8, g.h - 0.8);
      }
      const p = PARK[t];
      // the park zone: hatched
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, p.w, p.h);
      ctx.clip();
      ctx.strokeStyle = teamCol(t);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.5;
      for (let k = -p.h; k < p.w; k += 4) {
        ctx.beginPath();
        ctx.moveTo(p.x + k, p.y + p.h);
        ctx.lineTo(p.x + k + p.h, p.y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = teamCol(t);
      ctx.lineWidth = 0.75;
      ctx.strokeRect(p.x + 0.4, p.y + 0.4, p.w - 0.8, p.h - 0.8);
    }
    if (v) {
      ctx.fillStyle = col.dim1;
      for (const [x, y] of v.blocks) ctx.fillRect(x - 3, y - 3, 6, 6);
      for (const r of v.robots) {
        const isMe = r.seat === you();
        const s = isMe && pred ? [pred.x, pred.y, pred.h, v.bots.find((b) => b[0] === r.seat)?.[4] ?? 0] : interp(r.seat);
        if (!s) continue;
        const [x, y, h, held] = s;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(h);
        const half = ROBOT_SIZE / 2;
        ctx.fillStyle = teamCol(r.team);
        ctx.fillRect(-half, -half, ROBOT_SIZE, ROBOT_SIZE);
        ctx.fillStyle = col.bgDeep;
        ctx.fillRect(half - 4, -half + 2, 3, ROBOT_SIZE - 4); // intake on the front
        ctx.fillRect(-half + 2, -half + 2, 4, 3);
        ctx.fillRect(-half + 2, half - 5, 4, 3);
        ctx.fillStyle = col.dim2;
        for (let k = 0; k < held; k++) ctx.fillRect(-3, -5 + k * 6, 5, 4);
        if (isMe) {
          ctx.strokeStyle = col.bone;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(-half - 2, -half - 2, ROBOT_SIZE + 4, ROBOT_SIZE + 4);
        }
        ctx.restore();
        ctx.font = "4px ui-monospace, monospace";
        ctx.fillStyle = isMe ? col.bone : col.dim1;
        ctx.textAlign = "center";
        ctx.fillText(isMe ? "you" : r.nick.slice(0, 14), Math.min(FIELD - 16, Math.max(16, x)), Math.max(5, y - half - 3));
      }
    }
    ctx.restore();
    if (v && v.phase !== "done") timer.textContent = clock(v.ends - serverNow());
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // ---------- panels
  function drawScore(s: ArenaView) {
    scoreEl.replaceChildren(el("span", "acid", `ACID ${s.score.acid}`), " — ", el("span", "bone", `${s.score.bone} BONE`));
  }
  function drawResults(s: ArenaView) {
    if (s.phase !== "done") return results.replaceChildren();
    const me = mine();
    const win = s.score.acid === s.score.bone ? null : s.score.acid > s.score.bone ? "acid" : "bone";
    const head = win === null ? "tie." : me ? (me.team === win ? "you win." : "you lose.") : `${win} wins.`;
    const rows = [...s.robots]
      .sort((a, b) => (a.team === b.team ? b.scored - a.scored : a.team === "acid" ? -1 : 1))
      .map((r) => el("tr", r.seat === you() ? "me" : "", el("td", r.team, r.team), el("td", "", r.nick + (r.bot ? " (bot)" : "")), el("td", "", String(r.scored)), el("td", "", String(r.autonScored))));
    results.replaceChildren(
      el("p", "a-sold", `${head} ${s.score.acid}–${s.score.bone}`),
      el("p", "r-hint", `auton bonus: ${s.autonBonus ?? "nobody (tie)"} · parked: acid ${s.park.acid}, bone ${s.park.bone} · blocks are ${PTS.block}, auton win ${PTS.auton}, park ${PTS.park} each`),
      el("table", "a-table", el("tr", "", ...["team", "robot", "blocks", "in auton"].map((h) => el("th", "", h))), ...rows),
    );
  }

  return {
    update(s: ArenaView) {
      const first = !v;
      const phaseChanged = v?.phase !== s.phase;
      onSnap(s);
      root.dataset.phase = s.phase;
      if (phaseChanged || first) {
        phaseEl.textContent = PHASE[s.phase];
        editor.hidden = s.phase !== "program" || !mine();
        const driving = s.phase === "driver" && !!mine();
        pad.hidden = !driving;
        keysHint.hidden = !driving;
        if (s.phase === "done") timer.textContent = "";
        if (s.phase !== "program") {
          ready = false;
          readyBtn.textContent = "READY";
        }
        drawResults(s);
      }
      drawScore(s);
      if (s.phase === "program") readyList.textContent = `ready: ${s.robots.filter((r) => s.ready.includes(r.seat)).map((r) => (r.seat === you() ? "you" : r.nick)).join(", ") || "nobody yet"}`;
    },
  };
}
