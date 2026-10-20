import React, { useEffect, useRef, useState } from "react";

/* =========================================================================
   Flame Probe Simulator — A Level Physics (electric fields & potential)
   Two views:
     1. Flame probe  – measuring potential between parallel plates
     2. Candle only  – a candle flame between charged plates
   Left plate  = 0 V (earthed)
   Right plate = +V  (positive)
   ========================================================================= */

const W = 760;
const H = 500;
const PX_PER_CM = 38;
const PLATE_TOP = 80;
const PLATE_BOTTOM = 350;
const PLATE_W = 16;
const MAX_PD = 5000;

const WIRE_Y = 22;          // supply wires run along here
const ROD = 100;            // metal rod length, tip to handle (fixed)
const HANDLE_H = 36;        // insulating handle, moves with the probe
const handleTop = (tipY) => tipY + 8 + ROD;
const handleBot = (tipY) => tipY + 8 + ROD + HANDLE_H;
const WIRE_LOW = 476;       // the slack lead never hangs below this
const LEAD_Y = 448;         // lead from probe to meter
const RES_X0 = 600, RES_X1 = 644; // series resistor in the lead
const MX = 706;             // meter / electroscope centre x
const VM_Y = 398;           // voltmeter centre y
const TIP_MIN = 135, TIP_MAX = 312, TIP_DEFAULT = 206;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function geometry(sep) {
  const gap = sep * PX_PER_CM;
  return { gap, leftX: W / 2 - gap / 2, rightX: W / 2 + gap / 2 };
}

/* ---------- drawing helpers ---------- */

function drawFlame(ctx, x, y, hgt, w, bend, t, alpha = 1) {
  const flick = 1 + 0.06 * Math.sin(t * 13 + x) + 0.03 * Math.sin(t * 29);
  const h = hgt * flick;
  const tipX = x + bend * h * 0.95;
  const tipY = y - h * (1 - 0.4 * Math.abs(bend));

  ctx.save();
  ctx.globalAlpha = alpha;

  const glow = ctx.createRadialGradient(
    (x + tipX) / 2, (y + tipY) / 2, 2,
    (x + tipX) / 2, (y + tipY) / 2, h * 0.9
  );
  glow.addColorStop(0, "rgba(255,200,80,0.35)");
  glow.addColorStop(1, "rgba(255,200,80,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc((x + tipX) / 2, (y + tipY) / 2, h * 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w * 1.3, y - h * 0.4, tipX - w * 0.4, tipY + h * 0.3, tipX, tipY);
  ctx.bezierCurveTo(tipX + w * 0.4, tipY + h * 0.3, x + w * 1.3, y - h * 0.4, x + w, y);
  ctx.quadraticCurveTo(x, y + w * 0.9, x - w, y);
  const g = ctx.createLinearGradient(x, y + w, tipX, tipY);
  g.addColorStop(0, "rgba(70,120,255,0.95)");
  g.addColorStop(0.18, "rgba(255,240,170,0.95)");
  g.addColorStop(0.55, "rgba(255,170,40,0.9)");
  g.addColorStop(1, "rgba(255,90,20,0.15)");
  ctx.fillStyle = g;
  ctx.fill();

  ctx.beginPath();
  const ix = x + bend * h * 0.35;
  ctx.ellipse(ix, y - h * 0.22, w * 0.45, h * 0.2, bend * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,230,0.75)";
  ctx.fill();
  ctx.restore();
  return { tipX, tipY };
}

function drawEarth(ctx, x, y) {
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y);
  ctx.moveTo(x - 9, y + 5); ctx.lineTo(x + 9, y + 5);
  ctx.moveTo(x - 4, y + 10); ctx.lineTo(x + 4, y + 10);
  ctx.stroke();
}

function arrowHead(ctx, x, y, ang, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 7 * Math.cos(ang), y + 7 * Math.sin(ang));
  ctx.lineTo(x - 6 * Math.cos(ang) + 5 * Math.sin(ang), y - 6 * Math.sin(ang) - 5 * Math.cos(ang));
  ctx.lineTo(x - 6 * Math.cos(ang) - 5 * Math.sin(ang), y - 6 * Math.sin(ang) + 5 * Math.cos(ang));
  ctx.closePath();
  ctx.fill();
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  arrowHead(ctx, (x1 + x2) / 2, (y1 + y2) / 2, Math.atan2(y2 - y1, x2 - x1), color);
}

function drawIon(ctx, ion) {
  const a = clamp(ion.life < 0.5 ? ion.life / 0.5 : 1, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(ion.x, ion.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = ion.q > 0 ? "#dc2626" : "#2563eb";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ion.q > 0 ? "+" : "−", ion.x, ion.y + 0.5);
  ctx.restore();
}

function haloText(ctx, text, x, y) {
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(248,250,252,0.92)";
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

/* the flexible lead hangs from the bottom of the handle to the resistor.
   It has a fixed length, so it sags more when its ends are closer together. */
function slackCurve(objX, tipY) {
  const x0 = objX, y0 = handleBot(tipY);
  const x3 = RES_X0, y3 = LEAD_Y;
  const slack = clamp((520 - Math.hypot(x3 - x0, y3 - y0)) * 0.45, 18, 90);
  return [
    [x0, y0],
    [x0 + 6, Math.min(y0 + slack, WIRE_LOW)],
    [x3 - 50, Math.min(y3 + slack * 0.5, WIRE_LOW)],
    [x3, y3],
  ];
}
const bez = (c, t) => {
  const u = 1 - t;
  return [0, 1].map((k) =>
    u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]);
};

/* the conducting path from probe tip to the measuring instrument, as a polyline */
function leadPath(objX, tipY, meter) {
  const c = slackCurve(objX, tipY);
  const pts = [[objX, tipY + 8]];
  for (let i = 0; i <= 20; i++) pts.push(bez(c, i / 20));
  return pts.concat(meter === "electroscope"
    ? [[652, LEAD_Y], [652, 340], [MX - 15, 340]]
    : [[MX - 20, LEAD_Y], [MX - 20, VM_Y + 22]]);
}

/* leaf angle (radians) of the electroscope for a given potential */
const leafAngle = (v) => (55 * Math.sqrt(clamp(v / MAX_PD, 0, 1)) * Math.PI) / 180;

/* ---------- main component ---------- */

export default function App() {
  const [mode, setMode] = useState("probe"); // "probe" | "candle"
  const [meter, setMeter] = useState("voltmeter"); // "voltmeter" | "electroscope"
  const [pd, setPd] = useState(2000);
  const [sep, setSep] = useState(10);
  const [pos, setPos] = useState(0.5);
  const [tipY, setTipY] = useState(TIP_DEFAULT);
  const [showEq, setShowEq] = useState(true);
  const [showField, setShowField] = useState(false);
  const [flameOn, setFlameOn] = useState(true);
  const [showTransfer, setShowTransfer] = useState(true);
  const [reading, setReading] = useState(0);
  const [settling, setSettling] = useState(false);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [explainOpen, setExplainOpen] = useState(true);

  const canvasRef = useRef(null);
  const drag = useRef(null); // active drag gesture (see pointer handlers)
  // x of the EHT terminals in canvas units, measured from the HTML panel
  const terms = useRef({ l: W * 0.42, r: W * 0.58 });
  const termL = useRef(null);
  const termR = useRef(null);
  const sim = useRef({
    ions: [], probeV: 0, t: 0, spawnAcc: 0, lastUi: 0,
    capture: [], wireE: [], flashes: [], capAcc: 0, eAcc: 0, flux: 0, dV: 0,
  });
  const params = useRef({});
  params.current = { mode, meter, pd, sep, pos, tipY, showEq, showField, flameOn, showTransfer };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // keep the supply wires lined up with the panel's terminals at any width
    const measure = () => {
      const cr = canvas.getBoundingClientRect();
      if (!cr.width || !termL.current || !termR.current) return;
      const mid = (el) => {
        const r = el.getBoundingClientRect();
        return ((r.left + r.width / 2 - cr.left) / cr.width) * W;
      };
      terms.current = { l: mid(termL.current), r: mid(termR.current) };
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) { ro.observe(canvas); ro.observe(termL.current.parentElement); }
    window.addEventListener("resize", measure);

    let raf;
    let last = performance.now();

    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = params.current;
      const s = sim.current;
      s.t += dt;

      const { gap, leftX, rightX } = geometry(p.sep);
      // normalised field strength: 1 = 1000 V across 10 cm (10 kV/m)
      const e = (p.pd / 1000) / (p.sep / 10);
      const objX = leftX + p.pos * gap;
      const vLocal = p.pd * p.pos;
      const probe = p.mode === "probe";
      const tipY = p.tipY;

      /* ---- flame geometry for this frame ---- */
      const flameOnNow = !probe || p.flameOn;
      const flameBaseY = probe ? tipY + 6 : 292;
      const flameH = probe ? 34 : 70;
      const bendAmt = clamp(e / 5, 0, 1);

      /* ---- spawn ions from the flame ---- */
      if (flameOnNow) {
        s.spawnAcc += (probe ? 16 : 26) * dt;
        while (s.spawnAcc >= 1) {
          s.spawnAcc -= 1;
          s.ions.push({
            x: objX + (Math.random() - 0.5) * 14,
            y: flameBaseY - Math.random() * flameH * 0.7,
            q: Math.random() < 0.5 ? 1 : -1,
            life: 2.2 + Math.random(),
          });
        }
      }

      /* ---- move ions: F = qE, field points from + (right) to − (left) ---- */
      const vPos = -Math.min(30 * e, 260);
      const vNeg = Math.min(55 * e, 420);
      s.ions.forEach((ion) => {
        const vx = ion.q > 0 ? vPos : vNeg;
        ion.x += (vx + (Math.random() - 0.5) * 30) * dt;
        ion.y += (-28 + (Math.random() - 0.5) * 20) * dt;
        ion.life -= dt * (p.pd < 1 ? 0.8 : 0.15);
      });
      s.ions = s.ions.filter(
        (i) => i.life > 0 && i.x > leftX + 7 && i.x < rightX - 7 && i.y > PLATE_TOP - 10
      );

      /* ---- probe potential relaxes to local potential (only if flame lit) ---- */
      if (probe && p.flameOn) {
        s.probeV += (vLocal - s.probeV) * (1 - Math.exp(-dt * 1.8));
      }

      /* ---- charge transfer between flame and probe ---- */
      const dV = vLocal - s.probeV;
      s.dV = dV;
      const sign = dV > 0 ? 1 : -1;       // +1: + ions arrive, -1: − charges arrive
      const tipX = objX, tipCY = tipY;
      const flux = probe && p.flameOn && p.showTransfer
        ? clamp(Math.abs(dV) / (0.12 * Math.max(p.pd, 500)), 0, 1)
        : 0;
      s.flux = flux;
      const flowing = flux > 0.03;
      if (flowing) {
        s.capAcc += flux * 32 * dt;
        while (s.capAcc >= 1) {
          s.capAcc -= 1;
          const a = -Math.PI * (-0.15 + 1.3 * Math.random());
          const r = 32 + Math.random() * 18;
          s.capture.push({
            x: tipX + r * Math.cos(a),
            y: tipCY - 10 + r * Math.sin(a) * 0.8,
            q: sign,
            life: 1,
          });
        }
        s.eAcc += flux * 16 * dt;
        while (s.eAcc >= 1) {
          s.eAcc -= 1;
          // u = 0 at probe tip, 1 at instrument
          s.wireE.push({ u: sign > 0 ? 1 : 0, fade: 1 });
        }
      }
      s.capture.forEach((c) => {
        const dx = tipX - c.x, dy = tipCY - c.y;
        const d = Math.hypot(dx, dy) || 1;
        if (c.q === sign || !flowing) {
          // attracted onto the tip
          const v = 120 * dt;
          c.x += (dx / d) * Math.min(v, d);
          c.y += (dy / d) * Math.min(v, d);
          if (d < 6) { c.life = 0; s.flashes.push({ x: tipX, y: tipCY, t: 0.3, q: c.q }); }
        } else {
          // probe has overshot: this sign is now repelled
          c.x -= (dx / d) * 60 * dt;
          c.y -= (dy / d) * 60 * dt;
          c.life -= dt * 2.5;
        }
      });
      s.capture = s.capture.filter((c) => c.life > 0 && probe);

      // every electron in the lead drifts the SAME way: set by the current sign
      // now, so electrons already en route reverse if the flow reverses.
      const drift = (sign > 0 ? -1 : 1) * (0.2 + 0.5 * flux);
      s.wireE.forEach((el) => {
        el.u += drift * dt;
        if (!flowing) el.fade -= dt * 1.5; // flow stopped: drift dies away
      });
      s.wireE = s.wireE.filter((el) => el.u >= 0 && el.u <= 1 && el.fade > 0 && probe);
      s.flashes.forEach((f) => { f.t -= dt; });
      s.flashes = s.flashes.filter((f) => f.t > 0);

      /* ================= DRAW ================= */
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, W, H);

      // supply wires from the EHT terminals (panel sits just above the canvas)
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const { l: TERM_L, r: TERM_R } = terms.current;
      ctx.moveTo(TERM_L, 0); ctx.lineTo(TERM_L, WIRE_Y);
      ctx.lineTo(leftX - PLATE_W / 2, WIRE_Y); ctx.lineTo(leftX - PLATE_W / 2, PLATE_TOP);
      ctx.moveTo(TERM_R, 0); ctx.lineTo(TERM_R, WIRE_Y);
      ctx.lineTo(rightX + PLATE_W / 2, WIRE_Y); ctx.lineTo(rightX + PLATE_W / 2, PLATE_TOP);
      ctx.stroke();

      // earth on the 0 V plate
      ctx.beginPath();
      ctx.moveTo(leftX - PLATE_W / 2, PLATE_BOTTOM);
      ctx.lineTo(leftX - PLATE_W / 2, 440);
      ctx.stroke();
      drawEarth(ctx, leftX - PLATE_W / 2, 440);

      // field lines: uniform in the middle, bulging outward at the edges
      if (p.showField && p.pd > 0) {
        const col = "rgba(100,116,139,0.6)";
        const y0 = PLATE_TOP + 42, y1 = PLATE_BOTTOM - 20;
        for (let i = 0; i < 7; i++) {
          const y = y0 + (i * (y1 - y0)) / 6;
          drawArrow(ctx, rightX - 4, y, leftX + 4, y, col);
        }
        const c = Math.min(0.05 * gap, 14); // gentle outward bulge
        [[PLATE_TOP + 6, -1], [PLATE_BOTTOM - 6, 1]].forEach(([ye, dir]) => {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(rightX - 2, ye);
          ctx.bezierCurveTo(rightX - 0.15 * gap, ye + dir * c * 1.6, leftX + 0.15 * gap, ye + dir * c * 1.6, leftX + 2, ye);
          ctx.stroke();
          arrowHead(ctx, W / 2, ye + dir * c * 1.2, Math.PI, col);
        });
      }

      // equipotentials (labels along the top, inside the gap)
      if (p.showEq) {
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.2;
        for (let k = 1; k <= 4; k++) {
          const x = leftX + (k / 5) * gap;
          ctx.strokeStyle = "rgba(22,163,74,0.6)";
          ctx.beginPath();
          ctx.moveTo(x, PLATE_TOP);
          ctx.lineTo(x, PLATE_BOTTOM);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = "10.5px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const stagger = gap / 5 < 50;
        for (let k = 1; k <= 4; k++) {
          const x = leftX + (k / 5) * gap;
          const y = PLATE_TOP + 12 + (stagger && k % 2 === 0 ? 15 : 0);
          const label = `${Math.round((p.pd * k) / 5)} V`;
          const tw = ctx.measureText(label).width + 8;
          ctx.fillStyle = "rgba(240,253,244,0.95)";
          ctx.beginPath();
          ctx.roundRect(x - tw / 2, y - 7, tw, 14, 4);
          ctx.fill();
          ctx.fillStyle = "#15803d";
          ctx.fillText(label, x, y + 0.5);
        }
      }

      // plates
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(leftX - PLATE_W, PLATE_TOP, PLATE_W, PLATE_BOTTOM - PLATE_TOP);
      ctx.fillStyle = "#b91c1c";
      ctx.fillRect(rightX, PLATE_TOP, PLATE_W, PLATE_BOTTOM - PLATE_TOP);

      // plate charges (+Q on the + plate, induced −Q on the earthed plate)
      const n = p.pd > 0 ? Math.round(2 + (11 * p.pd) / MAX_PD) : 0;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < n; i++) {
        const y = PLATE_TOP + ((i + 0.5) * (PLATE_BOTTOM - PLATE_TOP)) / n;
        ctx.fillText("−", leftX - PLATE_W / 2, y);
        ctx.fillText("+", rightX + PLATE_W / 2, y);
      }

      // plate labels
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillStyle = "#1d4ed8";
      ctx.textAlign = "right";
      ctx.fillText("0 V", leftX - PLATE_W - 6, PLATE_TOP + 10);
      ctx.fillText("(earthed)", leftX - PLATE_W - 6, PLATE_TOP + 26);
      ctx.fillStyle = "#b91c1c";
      ctx.textAlign = "left";
      ctx.fillText(`+${p.pd} V`, rightX + PLATE_W + 6, PLATE_TOP + 10);

      // separation marker along the very bottom
      {
        const yM = 486;
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftX, yM); ctx.lineTo(rightX, yM);
        ctx.moveTo(leftX, yM - 6); ctx.lineTo(leftX, yM + 6);
        ctx.moveTo(rightX, yM - 6); ctx.lineTo(rightX, yM + 6);
        ctx.stroke();
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        const label = `d = ${p.sep} cm`;
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(W / 2 - tw / 2, yM - 8, tw, 16);
        ctx.fillStyle = "#475569";
        ctx.fillText(label, W / 2, yM + 0.5);
      }

      // guide line while a drag is locked to one axis
      const lock = drag.current && drag.current.lock;
      if (probe && (lock === "x" || lock === "y")) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "rgba(15,23,42,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (lock === "x") { ctx.moveTo(leftX + 2, tipY); ctx.lineTo(rightX - 2, tipY); }
        else { ctx.moveTo(objX, PLATE_TOP + 2); ctx.lineTo(objX, PLATE_BOTTOM - 2); }
        ctx.stroke();
        ctx.restore();
      }

      let splitLabels = null;
      if (probe) {
        /* ---- flame probe ---- */
        const path = leadPath(objX, tipY, p.meter);

        // lead (drawn under everything else)
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        const sc = slackCurve(objX, tipY);
        ctx.moveTo(sc[0][0], sc[0][1]);
        ctx.bezierCurveTo(sc[1][0], sc[1][1], sc[2][0], sc[2][1], sc[3][0], sc[3][1]);
        for (let i = 22; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
        ctx.stroke();
        const hT = handleTop(tipY), hB = handleBot(tipY);

        // series resistor in the lead
        ctx.fillStyle = "#fff";
        ctx.fillRect(RES_X0, LEAD_Y - 7, RES_X1 - RES_X0, 14);
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 2;
        ctx.strokeRect(RES_X0, LEAD_Y - 7, RES_X1 - RES_X0, 14);
        ctx.fillStyle = "#334155";
        ctx.font = "10.5px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("high R", (RES_X0 + RES_X1) / 2, LEAD_Y - 15);

        // metal rod + insulating handle: one rigid piece that moves together
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(objX, tipY + 8);
        ctx.lineTo(objX, hT);
        ctx.stroke();
        ctx.fillStyle = "#334155";
        ctx.beginPath();
        ctx.roundRect(objX - 6, hT, 12, hB - hT, 3);
        ctx.fill();
        // gas jet nozzle
        ctx.fillStyle = "#64748b";
        ctx.fillRect(objX - 4, tipY + 4, 8, 6);

        if (p.flameOn) drawFlame(ctx, objX, flameBaseY, flameH, 7, 0, s.t);

        ctx.fillStyle = "#334155";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("probe tip", objX + 10, tipY + 16);

        // move glyph beside the handle: four small arrows
        {
          const gx = objX + 22, gy = (hT + hB) / 2;
          ctx.fillStyle = "rgba(15,23,42,0.5)";
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ux, uy]) => {
            const bx = gx + ux * 5, by = gy + uy * 5;
            ctx.beginPath();
            ctx.moveTo(bx + ux * 6, by + uy * 6);
            ctx.lineTo(bx - uy * 4, by + ux * 4);
            ctx.lineTo(bx + uy * 4, by - ux * 4);
            ctx.closePath();
            ctx.fill();
          });
        }

        if (p.meter === "voltmeter") {
          // earth terminal
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(MX + 20, VM_Y + 22);
          ctx.lineTo(MX + 20, LEAD_Y + 2);
          ctx.stroke();
          drawEarth(ctx, MX + 20, LEAD_Y + 2);
          // dial
          ctx.beginPath();
          ctx.arc(MX, VM_Y, 30, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 2;
          ctx.stroke();
          const a0 = Math.PI * 1.2, a1 = Math.PI * 1.8;
          ctx.beginPath();
          ctx.arc(MX, VM_Y, 23, a0, a1);
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 3;
          ctx.stroke();
          const ang = a0 + clamp(s.probeV / MAX_PD, 0, 1) * (a1 - a0);
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(MX, VM_Y);
          ctx.lineTo(MX + 23 * Math.cos(ang), VM_Y + 23 * Math.sin(ang));
          ctx.stroke();
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`${Math.round(s.probeV)} V`, MX, VM_Y + 13);
          ctx.font = "10.5px system-ui, sans-serif";
          ctx.fillStyle = "#475569";
          ctx.fillText("high-R voltmeter", MX, VM_Y - 42);
        } else {
          /* ---- gold-leaf electroscope ---- */
          const caseT = 360, caseB = 440;
          // earthed case
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(MX + 24, caseB);
          ctx.lineTo(MX + 24, caseB + 10);
          ctx.stroke();
          drawEarth(ctx, MX + 24, caseB + 10);
          ctx.fillStyle = "#e2e8f0";
          ctx.strokeStyle = "#475569";
          ctx.beginPath();
          ctx.roundRect(MX - 34, caseT, 68, caseB - caseT, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#f8fafc"; // glass window
          ctx.beginPath();
          ctx.roundRect(MX - 27, caseT + 8, 54, caseB - caseT - 16, 3);
          ctx.fill();
          // insulating bung, stem, cap
          ctx.fillStyle = "#334155";
          ctx.fillRect(MX - 6, caseT - 4, 12, 9);
          ctx.strokeStyle = "#a16207";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(MX, 342);
          ctx.lineTo(MX, 418); // stem + fixed plate
          ctx.stroke();
          ctx.fillStyle = "#a16207";
          ctx.beginPath();
          ctx.roundRect(MX - 15, 336, 30, 7, 2);
          ctx.fill();
          // gold leaf hinged near the bottom of the stem
          const th = leafAngle(s.probeV);
          const hx = MX + 1.5, hy = 384, L = 32;
          ctx.strokeStyle = "#eab308";
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx + L * Math.sin(th), hy + L * Math.cos(th));
          ctx.stroke();
          // like charges on stem and leaf
          const nq = Math.round(4 * clamp(s.probeV / MAX_PD, 0, 1) + (s.probeV > 60 ? 1 : 0));
          ctx.fillStyle = "#dc2626";
          ctx.font = "bold 10px system-ui, sans-serif";
          ctx.textAlign = "center";
          for (let i = 0; i < nq; i++) {
            const f = (i + 0.7) / (nq + 0.4);
            ctx.fillText("+", MX - 7, hy + f * 30);
            ctx.fillText("+", hx + (f * L) * Math.sin(th) + 6 * Math.cos(th), hy + f * L * Math.cos(th) - 6 * Math.sin(th));
          }
          ctx.font = "10.5px system-ui, sans-serif";
          ctx.fillStyle = "#475569";
          ctx.textAlign = "right";
          ctx.fillText("gold-leaf electroscope", W - 8, 326);
        }
      } else {
        /* ---- candle only ---- */
        ctx.fillStyle = "#fef3c7";
        ctx.strokeStyle = "#d6b46a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(objX - 15, 300, 30, 138, 3);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#1f2937";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(objX, 300);
        ctx.lineTo(objX, 288);
        ctx.stroke();

        // main lobe pulled toward − plate; at high field a distinct second
        // lobe peels off towards the + plate
        const split = clamp((bendAmt - 0.45) / 0.4, 0, 1);
        if (split > 0) {
          // two separate tongues from the wick, with a clear V-shaped gap
          const second = drawFlame(
            ctx, objX + 5 + 6 * split, flameBaseY, flameH * (0.55 + 0.3 * split),
            8 + 3 * split, 0.45 + 0.3 * split, s.t + 1.3
          );
          const main = drawFlame(
            ctx, objX - 4 - 6 * split, flameBaseY, flameH * (1.15 - 0.05 * split),
            17, -0.55 - 0.25 * split, s.t
          );
          if (split > 0.15) {
            splitLabels = { a: clamp((split - 0.15) / 0.3, 0, 1), main, second };
          }
        } else {
          drawFlame(ctx, objX - 1, flameBaseY, flameH * (1 - 0.1 * bendAmt), 13, -0.95 * bendAmt, s.t);
        }

        ctx.fillStyle = "#334155";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("candle", objX, 458);

        // ◀ ▶ drag handle on the candle
        ctx.fillStyle = "rgba(15,23,42,0.5)";
        const hy = 420, off = 22;
        ctx.beginPath();
        ctx.moveTo(objX - off - 9, hy); ctx.lineTo(objX - off, hy - 7); ctx.lineTo(objX - off, hy + 7);
        ctx.closePath();
        ctx.moveTo(objX + off + 9, hy); ctx.lineTo(objX + off, hy - 7); ctx.lineTo(objX + off, hy + 7);
        ctx.closePath();
        ctx.fill();
      }

      // ions on top
      s.ions.forEach((ion) => drawIon(ctx, ion));

      // labels for the split candle flame (drawn above the ions)
      if (splitLabels) {
        const { a, main, second } = splitLabels;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = "bold 11.5px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        const ly = flameBaseY - flameH - 34;
        const t1 = "larger part → − plate", t2 = "smaller part → + plate";
        const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
        const x1 = clamp(objX - 10, leftX + 8 + w1, W);
        const x2 = clamp(objX + 10, 0, rightX - 8 - w2);
        const y1 = x2 < x1 + 6 ? ly - 16 : ly; // stack if squeezed against a plate
        // leader lines from each label to its tongue
        ctx.strokeStyle = "rgba(29,78,216,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1 - w1 / 2, y1 + 8); ctx.lineTo(main.tipX + 4, main.tipY - 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(185,28,28,0.6)";
        ctx.beginPath();
        ctx.moveTo(x2 + w2 / 2, ly + 8); ctx.lineTo(second.tipX - 2, second.tipY - 2);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillStyle = "#1d4ed8";
        haloText(ctx, t1, x1, y1);
        ctx.textAlign = "left";
        ctx.fillStyle = "#b91c1c";
        haloText(ctx, t2, x2, ly);
        ctx.restore();
      }

      /* ---- charge transfer visuals (probe mode) ---- */
      if (probe) {
        s.capture.forEach((c) => {
          drawIon(ctx, { ...c, life: c.life });
          if (c.q !== sign && flowing) return;
          ctx.strokeStyle = c.q > 0 ? "rgba(220,38,38,0.35)" : "rgba(37,99,235,0.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(objX, tipY);
          ctx.stroke();
          ctx.setLineDash([]);
        });
        s.flashes.forEach((f) => {
          ctx.beginPath();
          ctx.arc(f.x, f.y, 6 + (0.3 - f.t) * 40, 0, Math.PI * 2);
          ctx.strokeStyle = f.q > 0 ? `rgba(220,38,38,${f.t * 2})` : `rgba(37,99,235,${f.t * 2})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        });

        // electrons along the lead
        const path = leadPath(objX, tipY, p.meter);
        const segs = [];
        let total = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const L = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
          segs.push(L); total += L;
        }
        const at = (u) => {
          let d = u * total;
          for (let i = 0; i < segs.length; i++) {
            if (d <= segs[i] || i === segs.length - 1) {
              const f = segs[i] ? d / segs[i] : 0;
              return [path[i][0] + f * (path[i + 1][0] - path[i][0]), path[i][1] + f * (path[i + 1][1] - path[i][1])];
            }
            d -= segs[i];
          }
          return path[0];
        };
        s.wireE.forEach((el) => {
          const [ex, ey] = at(el.u);
          ctx.save();
          ctx.globalAlpha = clamp(el.fade, 0, 1);
          ctx.beginPath();
          ctx.arc(ex, ey, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
          ctx.fillStyle = "#1f2937";
          ctx.font = "bold 10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("−", ex, ey + 0.5);
          ctx.restore();
        });

        if (flowing) {
          const lx = clamp(objX, leftX + 95, rightX - 95);
          const ly = tipY > 200 ? tipY - 72 : tipY + 66;
          ctx.font = "bold 12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = sign > 0 ? "#b91c1c" : "#1d4ed8";
          haloText(ctx, sign > 0 ? "+ ions drawn onto probe tip" : "− charges drawn onto probe tip", lx, ly);
          ctx.fillStyle = "#b45309";
          ctx.font = "11px system-ui, sans-serif";
          // label the lead flow beside the rod, so it moves with the probe
          const l1 = "electrons in lead";
          const l2 = sign > 0 ? "flow up to probe ↑" : "flow to meter ↓";
          const ry = (tipY + 8 + handleTop(tipY)) / 2;
          const tw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
          const onLeft = objX - 12 - tw > leftX + 4;
          ctx.textAlign = onLeft ? "right" : "left";
          const rx = onLeft ? objX - 12 : objX + 12;
          haloText(ctx, l1, rx, ry + 4);
          haloText(ctx, l2, rx, ry + 18);
        }
      }

      /* ---- push readings to React UI ~10 Hz ---- */
      if (now - s.lastUi > 100) {
        s.lastUi = now;
        setReading(s.probeV);
        setSettling(probe && p.flameOn && Math.abs(vLocal - s.probeV) > Math.max(5, 0.01 * p.pd));
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* ---------- dragging the probe / candle ----------
     Soft axis lock, following the directional-lock convention used by touch
     scroll views (e.g. iOS) and drag libraries (use-gesture, GSAP Draggable):
       • wait for a few pixels of movement before deciding;
       • clearly horizontal start → lock to x; clearly vertical → lock to y;
         diagonal start → free 2-D movement;
       • the lock is light: perpendicular motion is damped rather than blocked,
         and a deliberate sideways pull breaks it into free movement.
     The candle only moves left/right. */
  const DEAD_ZONE = 6;      // px before the direction is decided
  const LOCK_ANGLE = 25;    // within 25° of an axis counts as "along" it
  const DAMP = 0.2;         // fraction of perpendicular motion allowed while locked
  const BREAK = 36;         // px of perpendicular pull that releases the lock

  const toCanvas = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { cx: ((e.clientX - r.left) / r.width) * W, cy: ((e.clientY - r.top) / r.height) * H };
  };
  const objNow = () => {
    const pc = params.current;
    const { gap, leftX } = geometry(pc.sep);
    return { x: leftX + pc.pos * gap, y: pc.tipY };
  };
  const nearObject = (cx, cy) => {
    const { x, y } = objNow();
    if (params.current.mode === "candle") return Math.abs(cx - x) < 30 && cy > 200 && cy < 442;
    return Math.abs(cx - x) < 26 && cy > y - 45 && cy < handleBot(y) + 4;
  };
  const place = (x, y) => {
    const { gap, leftX } = geometry(params.current.sep);
    setPos(Math.round(clamp((x - leftX) / gap, 0.05, 0.95) * 1000) / 1000);
    if (params.current.mode === "probe") setTipY(Math.round(clamp(y, TIP_MIN, TIP_MAX)));
  };
  const onPointerDown = (e) => {
    const { cx, cy } = toCanvas(e);
    const { leftX, rightX } = geometry(params.current.sep);
    let start = null;
    if (nearObject(cx, cy)) {
      start = objNow();
    } else if (cx > leftX && cx < rightX && cy > PLATE_TOP && cy < PLATE_BOTTOM) {
      // click in the gap: jump there, then carry on dragging
      const { y } = objNow();
      const ty = params.current.mode === "probe" ? clamp(cy, TIP_MIN, TIP_MAX) : y;
      place(cx, ty);
      start = { x: cx, y: ty };
    }
    if (!start) return;
    drag.current = { sx: cx, sy: cy, ox: start.x, oy: start.y, lock: "pending" };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const { cx, cy } = toCanvas(e);
    const d = drag.current;
    if (!d) { setHover(nearObject(cx, cy)); return; }
    const dx = cx - d.sx, dy = cy - d.sy;
    if (params.current.mode === "candle") { place(d.ox + dx, d.oy); return; }

    if (d.lock === "pending") {
      if (Math.hypot(dx, dy) < DEAD_ZONE) return;
      const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
      d.lock = ang < LOCK_ANGLE ? "x" : ang > 90 - LOCK_ANGLE ? "y" : "free";
    }
    if (d.lock === "x" && Math.abs(dy) > BREAK) {
      d.oy += DAMP * dy - dy; d.lock = "free"; // re-base so nothing jumps
    } else if (d.lock === "y" && Math.abs(dx) > BREAK) {
      d.ox += DAMP * dx - dx; d.lock = "free";
    }
    const mx = d.lock === "y" ? DAMP * dx : dx;
    const my = d.lock === "x" ? DAMP * dy : dy;
    place(d.ox + mx, d.oy + my);
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };
  const onKeyDown = (e) => {
    const big = e.shiftKey;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = (big ? 0.1 : 0.01) * (e.key === "ArrowLeft" ? -1 : 1);
      setPos((p) => Math.round(clamp(p + step, 0.05, 0.95) * 1000) / 1000);
    }
    if (mode === "probe" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const step = (big ? 20 : 4) * (e.key === "ArrowUp" ? -1 : 1);
      setTipY((y) => clamp(y + step, TIP_MIN, TIP_MAX));
    }
  };
  const nudgeX = (d) => setPos((p) => Math.round(clamp(p + d, 0.05, 0.95) * 1000) / 1000);
  const nudgeY = (d) => setTipY((y) => clamp(y + d, TIP_MIN, TIP_MAX));

  /* direction pad: one step on press; hold to move continuously after a short pause */
  const hold = useRef(null);
  const step = (dir, fine) => {
    const k = fine ? 0.3 : 1; // continuous movement uses smaller, frequent steps
    if (dir === "left") nudgeX(-0.02 * k);
    if (dir === "right") nudgeX(0.02 * k);
    if (dir === "up") nudgeY(-8 * k);
    if (dir === "down") nudgeY(8 * k);
  };
  const stopHold = () => {
    if (hold.current) { clearTimeout(hold.current.t); clearInterval(hold.current.i); hold.current = null; }
  };
  const startHold = (dir) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    stopHold();
    step(dir, false);
    const h = { i: null };
    h.t = setTimeout(() => { h.i = setInterval(() => step(dir, true), 30); }, 400);
    hold.current = h;
  };
  useEffect(() => stopHold, []);
  const padBtn = (dir, label, glyph, disabled) => (
    <button
      className={`pad-${dir}`}
      aria-label={label}
      disabled={disabled}
      onPointerDown={startHold(dir)}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); step(dir, e.repeat); } }}
    >
      {glyph}
    </button>
  );

  /* ---------- derived values ---------- */
  const E = pd / (sep / 100); // V/m
  const x = pos * sep;        // cm from earthed plate
  const vLocal = pd * pos;
  const leafDeg = Math.round((leafAngle(reading) * 180) / Math.PI);
  const status = !flameOn ? "no flame – reading stuck" : settling ? "charge flowing…" : "equilibrium";

  return (
    <div className="fp-app">
      <style>{css}</style>
      <header>
        <h1>The Flame Probe</h1>
        <p className="sub">Investigating electric potential between parallel plates</p>
      </header>

      <div className="tabs">
        <button className={mode === "probe" ? "on" : ""} onClick={() => setMode("probe")}>
          Flame probe
        </button>
        <button className={mode === "candle" ? "on" : ""} onClick={() => setMode("candle")}>
          Candle between plates
        </button>
      </div>

      <div className="layout">
        <div className="left">
          <div className="rig">
            <div className="eht">
              <div className="eht-head">
                <b>EHT SUPPLY</b>
                <span className={pd > 0 ? "led on" : "led"} title={pd > 0 ? "output on" : "output off"} />
              </div>
              <div className="eht-face">
                <div className="lcd" aria-live="polite">
                  {(pd / 1000).toFixed(2)}<small>kV</small>
                </div>
                <div className="eht-spec">0–5 kV d.c.<br />50 MΩ limiting R<br />max 0.1 mA</div>
              </div>
              <label className="eht-slider">
                <span>OUTPUT</span>
                <input type="range" min="0" max={MAX_PD} step="100" value={pd}
                  onChange={(e) => setPd(+e.target.value)} aria-label={`EHT output p.d., ${pd} volts`} />
              </label>
              <span ref={termL} className="term neg" title="negative terminal (earthed)">−</span>
              <span ref={termR} className="term pos" title="positive terminal">+</span>
            </div>
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label={mode === "probe"
                ? "Diagram: drag the probe in any direction, or use the arrow keys"
                : "Diagram: drag the candle left or right, or use the arrow keys"}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setHover(false)}
              onKeyDown={onKeyDown}
              style={{
                width: "100%",
                aspectRatio: `${W} / ${H}`,
                cursor: dragging ? "grabbing" : hover ? "grab" : "default",
                touchAction: "none",
              }}
            />
          </div>
          <div className="move-row">
            <div className="pad" role="group" aria-label="Move the probe">
              {padBtn("up", "Move up", "▲", mode !== "probe")}
              {padBtn("left", "Move left", "◀", false)}
              {padBtn("right", "Move right", "▶", false)}
              {padBtn("down", "Move down", "▼", mode !== "probe")}
            </div>
            <span>
              {mode === "probe"
                ? "Drag the probe anywhere between the plates. A mainly sideways or up-down drag stays on that line; drag diagonally to move freely."
                : "Drag the candle left or right."}{" "}
              Or hold a button on the pad, or click the diagram and use the arrow keys.
            </span>
          </div>

          <div className="controls">
            <label>
              <span>Plate separation d: <b>{sep} cm</b></span>
              <input className="sep-slider" type="range" min="5" max="12" step="1" value={sep}
                onChange={(e) => setSep(+e.target.value)} />
            </label>
            {mode === "probe" && (
              <div className="seg" role="group" aria-label="Measuring instrument">
                <span>Measure with:</span>
                <button className={meter === "voltmeter" ? "on" : ""} onClick={() => setMeter("voltmeter")}>
                  High-R voltmeter
                </button>
                <button className={meter === "electroscope" ? "on" : ""} onClick={() => setMeter("electroscope")}>
                  Gold-leaf electroscope
                </button>
              </div>
            )}
            <div className="toggles">
              <label className="chk">
                <input type="checkbox" checked={showEq} onChange={(e) => setShowEq(e.target.checked)} />
                Equipotentials
              </label>
              <label className="chk">
                <input type="checkbox" checked={showField} onChange={(e) => setShowField(e.target.checked)} />
                Field lines (E points from + to −)
              </label>
              {mode === "probe" && (
                <label className="chk">
                  <input type="checkbox" checked={flameOn} onChange={(e) => setFlameOn(e.target.checked)} />
                  Flame lit
                </label>
              )}
              {mode === "probe" && (
                <label className="chk">
                  <input type="checkbox" checked={showTransfer} onChange={(e) => setShowTransfer(e.target.checked)} />
                  Show charge transfer
                </label>
              )}
            </div>
            {mode === "probe" && (
              <div className="disturb">
                <span>Disturb the probe and watch it recover:</span>
                <button onClick={() => { sim.current.probeV = 0; }}>Discharge probe to 0 V</button>
                <button onClick={() => { sim.current.probeV = MAX_PD; }}>Overcharge probe to +{MAX_PD} V</button>
              </div>
            )}
          </div>

          <div className="readouts">
            <div><small>Field strength E = V/d</small><b>{Math.round(E).toLocaleString()} V m⁻¹</b></div>
            <div><small>Distance from earthed plate</small><b>x = {x.toFixed(1)} cm</b></div>
            {mode === "probe" ? (
              <>
                <div><small>Potential at probe position</small><b>{Math.round(vLocal)} V</b></div>
                {meter === "voltmeter" ? (
                  <div>
                    <small>Voltmeter reading</small>
                    <b>{Math.round(reading)} V</b>
                    <em className={settling ? "warn" : flameOn ? "ok" : "off"}>{status}</em>
                  </div>
                ) : (
                  <div>
                    <small>Electroscope leaf divergence</small>
                    <b>{leafDeg}°</b>
                    <em className={settling ? "warn" : flameOn ? "ok" : "off"}>{status}</em>
                  </div>
                )}
              </>
            ) : (
              <div><small>Force on an ion</small><b>F = qE</b></div>
            )}
          </div>

        </div>

        <aside className="right">
          <section className={explainOpen ? "explain" : "explain min"}>
            <div className="explain-bar">
              <span>Explanation</span>
              <button
                className="min-btn"
                onClick={() => setExplainOpen((o) => !o)}
                aria-expanded={explainOpen}
                aria-label={explainOpen ? "Minimise explanation" : "Expand explanation"}
                title={explainOpen ? "Minimise" : "Expand"}
              >
                {explainOpen ? "−" : "+"}
              </button>
            </div>
            {explainOpen && (mode === "probe" ? <ProbeText meter={meter} /> : <CandleText />)}
            <div className="key">
            <span><i className="dot pos">+</i> positive ion</span>
            <span><i className="dot neg">−</i> negative ion / electron</span>
              {mode === "probe" && <span><i className="dot el">−</i> electron in metal lead</span>}
            </div>
          </section>

          {mode === "probe" && (
            <Graph pd={pd} sep={sep} x={x} reading={reading} meter={meter} />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------- V against x graph ---------- */
function Graph({ pd, sep, x, reading, meter }) {
  const gw = 340, gh = 200, ox = 48, oy = 170, pw = 270, ph = 140;
  const sx = (cm) => ox + (cm / 12) * pw;
  const sy = (v) => oy - (v / MAX_PD) * ph;
  return (
    <div className="graph">
      <h3>Potential V against distance x from the earthed plate</h3>
      <svg viewBox={`0 0 ${gw} ${gh}`}>
        {[0, 1000, 2000, 3000, 4000, 5000].map((v) => (
          <g key={v}>
            <line x1={ox} x2={ox + pw} y1={sy(v)} y2={sy(v)} stroke="#e2e8f0" />
            <text x={ox - 6} y={sy(v) + 4} textAnchor="end" fontSize="10" fill="#64748b">{v}</text>
          </g>
        ))}
        {[0, 2, 4, 6, 8, 10, 12].map((c) => (
          <text key={c} x={sx(c)} y={oy + 14} textAnchor="middle" fontSize="10" fill="#64748b">{c}</text>
        ))}
        <line x1={ox} y1={oy} x2={ox + pw} y2={oy} stroke="#334155" />
        <line x1={ox} y1={oy} x2={ox} y2={oy - ph} stroke="#334155" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(sep)} y2={sy(pd)} stroke="#16a34a" strokeWidth="2" />
        <line x1={sx(sep)} y1={oy} x2={sx(sep)} y2={oy - ph} stroke="#b91c1c" strokeDasharray="3 3" />
        <text x={sx(sep)} y={oy - ph - 4} textAnchor="middle" fontSize="9" fill="#b91c1c">+ plate</text>
        <circle cx={sx(x)} cy={sy(reading)} r="5" fill="#dc2626" />
        <text x={ox + pw / 2} y={gh - 4} textAnchor="middle" fontSize="11" fill="#334155">x / cm</text>
        <text x="12" y={oy - ph / 2} textAnchor="middle" fontSize="11" fill="#334155"
          transform={`rotate(-90 12 ${oy - ph / 2})`}>V / V</text>
      </svg>
      <p className="note">
        Gradient = potential gradient = {Math.round(pd / (sep / 100)).toLocaleString()} V m⁻¹.
        A straight line means a <b>uniform field</b>: E = −dV/dx.
        {meter === "electroscope" && " (An electroscope needs calibrating against known p.d.s before it can give values.)"}
      </p>
    </div>
  );
}

/* ---------- explanation text ---------- */
function ProbeText({ meter }) {
  return (
    <>
      <h2>How the flame probe works</h2>
      <ol>
        <li>
          <b>The flame ionises the air.</b> The hot gas around the probe tip contains
          positive ions and negative ions / electrons, so the air right at the tip
          becomes a conductor.
        </li>
        <li>
          <b>Charge flows until the tip matches its surroundings.</b> If the tip is at a
          different potential from the local field, ions are driven onto or off the probe.
          This stops when the probe reaches the <em>same potential</em> as the point where
          the flame sits.
        </li>
        <li>
          <b>A high-resistance voltmeter</b> (or electrometer, or a gold-leaf electroscope)
          measures the probe's potential relative to earth. It must draw almost no current,
          so it doesn't disturb the reading.
        </li>
        <li>
          <b>Turn the flame off</b> and move the probe: the reading no longer follows. Without
          ions the air is an insulator, so charge can't flow to the probe.
        </li>
      </ol>
      <h2>Where does the charge actually go?</h2>
      <p>
        The probe, its lead and the {meter === "electroscope" ? "electroscope's stem and leaf" : "voltmeter's input"} form
        one <b>isolated conductor</b>. Its potential only changes if charge is added to it or taken away.
      </p>
      <ul>
        <li>
          <b>Probe below the local potential:</b> <span className="pos-t">+ ions</span> from the
          flame are attracted onto the tip. Each one picks up an electron from the metal, so{" "}
          <span className="e-t">electrons in the lead drift towards the tip</span>. The conductor
          loses electrons and its potential rises.
        </li>
        <li>
          <b>Probe above the local potential:</b> <span className="neg-t">− charges</span> are
          attracted onto the tip instead. The extra electrons spread through the lead towards the
          meter, and the potential falls.
        </li>
        <li>
          Move the probe back and forth and watch the electrons in the lead: they all drift the
          same way at any instant, and reverse together when the flow reverses.
        </li>
        <li>
          Only a tiny charge is needed (picocoulombs), because the probe has a small capacitance:
          Q = CV. Once the probe matches the local potential there is no net flow.
        </li>
        <li>
          <b>The resistor in the lead</b> limits the current if the probe touches the + plate,
          protecting the meter (and you). At equilibrium no current flows through it, so there is
          no p.d. across it and it doesn't change the reading.
        </li>
        {meter === "electroscope" ? (
          <li>
            <b>Gold-leaf electroscope:</b> charge reaching the stem spreads onto the leaf. The leaf
            and stem carry like charges and repel, so the leaf rises. The case is earthed, so the
            divergence shows the potential of the stem relative to earth. It leaks almost no
            charge, which makes it well suited to a flame probe, but it must be calibrated to give
            values in volts.
          </li>
        ) : (
          <li>
            A real voltmeter leaks a little current, so a small flow continues to top up the probe.
            This is why the meter must have a <b>very high resistance</b>. A low-resistance meter
            would drain charge faster than the flame can supply it, and the reading would be too low.
          </li>
        )}
      </ul>
      <h2>What the results show</h2>
      <ul>
        <li>V increases <b>linearly</b> with distance from the earthed plate.</li>
        <li>So the potential gradient is constant: the field between the plates is uniform, with E = V/d.</li>
        <li>
          Move the probe <b>up and down</b>: the reading stays the same, because the probe stays on
          one equipotential. (Very close to the plate edges the field fringes and this breaks down;
          that is not modelled here.)
        </li>
        <li>Equipotentials are parallel to the plates; field lines are perpendicular to them.</li>
        <li>
          The earthed plate is at 0 V but still carries a <b>negative charge</b>, equal and opposite
          to the charge on the + plate. Electrons are drawn up from earth by the + plate. Earthing
          fixes the potential, not the charge, and the field lines need these charges to end on.
        </li>
        <li>Doubling V or halving d doubles E — try it with the controls.</li>
      </ul>
    </>
  );
}

function CandleText() {
  return (
    <>
      <h2>A candle flame between charged plates</h2>
      <ol>
        <li>
          <b>A flame contains charge carriers.</b> The high temperature ionises gas
          molecules, producing positive ions and electrons (some of which attach to form
          negative ions).
        </li>
        <li>
          <b>The field exerts a force F = qE.</b> Positive ions are pushed towards the
          <span className="neg-t"> negative plate</span>; negative charges are pushed towards the
          <span className="pos-t"> positive plate</span>.
        </li>
        <li>
          <b>The flame bends towards the negative plate.</b> The positive ions are far more
          massive than electrons. As they drift they collide with neutral gas molecules and
          drag the hot gas with them (an "ionic wind").
        </li>
        <li>
          <b>At high p.d. the flame splits</b>: a larger part is pulled towards the negative
          plate and a smaller part towards the positive plate. Try it above about 2500 V at d = 10 cm.
        </li>
      </ol>
      <h2>Things to try</h2>
      <ul>
        <li>Set the p.d. to 0 V — the flame stands upright and ions just rise and recombine.</li>
        <li>Increase the p.d. and watch the deflection grow, then the split appear.</li>
        <li>Reduce d at a fixed p.d. — E = V/d increases, so the effect is stronger.</li>
      </ul>
      <p className="safety">
        This shows that a flame contains both positive and negative charges, which is
        exactly why it makes the probe tip conducting.
      </p>
    </>
  );
}

/* ---------- styles ---------- */
const css = `
.fp-app { font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #0f172a;
  background: #f1f5f9; min-height: 100vh; padding: 16px; box-sizing: border-box; }
.fp-app * { box-sizing: border-box; }
.fp-app header h1 { margin: 0; font-size: 24px; }
.fp-app .sub { margin: 2px 0 12px; color: #475569; }
.fp-app .tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.fp-app .tabs button { border: 1px solid #cbd5e1; background: #fff; padding: 8px 16px;
  border-radius: 999px; font-size: 14px; cursor: pointer; }
.fp-app .tabs button.on { background: #0f172a; color: #fff; border-color: #0f172a; }
.fp-app .layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 16px; }
@media (max-width: 900px) { .fp-app .layout { grid-template-columns: 1fr; } }

.fp-app .rig { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding-top: 10px; overflow: hidden; }
.fp-app .eht { position: relative; width: 30%; min-width: 196px; max-width: 250px; margin: 0 auto;
  background: linear-gradient(#fdba74, #f97316 60%, #ea580c); border: 1px solid #9a3412;
  border-radius: 7px; padding: 5px 8px 13px; color: #1c1917;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 3px 0 #9a3412, 0 4px 8px rgba(0,0,0,0.15); }
.fp-app .eht-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.fp-app .eht-head b { font-size: 11.5px; letter-spacing: 0.12em; }
.fp-app .led { width: 8px; height: 8px; border-radius: 50%; background: #7f1d1d; border: 1px solid #450a0a; }
.fp-app .led.on { background: #ef4444; box-shadow: 0 0 6px #f87171; }
.fp-app .eht-face { display: flex; gap: 7px; align-items: stretch; background: #e7e5e4; border: 1px solid #a8a29e;
  border-radius: 4px; padding: 4px; }
.fp-app .lcd { flex: none; background: #1c1917; color: #86efac; border-radius: 3px; padding: 2px 7px;
  font: 600 18px/1.3 ui-monospace, Menlo, Consolas, monospace; display: flex; align-items: baseline; gap: 3px;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); }
.fp-app .lcd small { font-size: 10px; color: #4ade80; }
.fp-app .eht-spec { font-size: 9.5px; line-height: 1.25; color: #44403c; align-self: center; }
.fp-app .eht-slider { display: flex !important; align-items: center; gap: 6px; margin-top: 5px; font-size: 9.5px;
  font-weight: 700; letter-spacing: 0.08em; }
.fp-app .eht-slider input { flex: 1; min-width: 0; accent-color: #292524; }
.fp-app .term { position: absolute; bottom: -9px; width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px;
  color: #fff; line-height: 1; box-shadow: inset 0 0 0 3px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.4); }
.fp-app .term.neg { right: 30%; transform: translateX(50%); background: #262626; }
.fp-app .term.pos { right: 11%; transform: translateX(50%); background: #dc2626; }
.fp-app canvas { display: block; background: #f8fafc; }
.fp-app canvas:focus-visible { outline: 3px solid #93c5fd; outline-offset: -3px; }

.fp-app .move-row { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-size: 13px; color: #475569; }
.fp-app .move-row span { flex: 1; text-align: left; }
.fp-app .pad { flex: none; display: grid; grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(3, 30px);
  gap: 2px; grid-template-areas: ". up ." "left . right" ". down ."; }
.fp-app .pad button { border: 1px solid #cbd5e1; background: #fff; border-radius: 7px; font-size: 13px;
  cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; color: #334155; }
.fp-app .pad button:hover:not(:disabled) { background: #e2e8f0; }
.fp-app .pad button:active:not(:disabled) { background: #cbd5e1; }
.fp-app .pad button:disabled { opacity: 0.35; cursor: default; }
.fp-app .pad-up { grid-area: up; } .fp-app .pad-down { grid-area: down; }
.fp-app .pad-left { grid-area: left; } .fp-app .pad-right { grid-area: right; }
.fp-app .controls { background: #fff; border-radius: 12px; padding: 12px 16px; margin-top: 12px;
  border: 1px solid #e2e8f0; display: grid; gap: 10px; }
.fp-app .controls label { display: grid; gap: 4px; font-size: 14px; }
.fp-app .controls input[type=range] { width: 100%; }
.fp-app .controls input.sep-slider { width: 40%; min-width: 140px; }
.fp-app .seg { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; }
.fp-app .seg span { margin-right: 4px; }
.fp-app .seg button { border: 1px solid #cbd5e1; background: #fff; padding: 6px 12px; border-radius: 999px;
  font-size: 13px; cursor: pointer; }
.fp-app .seg button.on { background: #a16207; border-color: #a16207; color: #fff; }
.fp-app .toggles { display: flex; gap: 18px; flex-wrap: wrap; }
.fp-app .chk { display: flex !important; align-items: center; gap: 6px; grid-template-columns: none; }
.fp-app .readouts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px; margin-top: 12px; }
.fp-app .readouts > div { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 10px 12px; display: grid; gap: 2px; }
.fp-app .readouts small { color: #64748b; font-size: 12px; }
.fp-app .readouts b { font-size: 20px; }
.fp-app .readouts em { font-style: normal; font-size: 12px; }
.fp-app em.ok { color: #16a34a; } .fp-app em.warn { color: #d97706; } .fp-app em.off { color: #64748b; }
.fp-app .graph { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin-top: 12px; }
.fp-app .graph h3 { margin: 0 0 6px; font-size: 14px; }
.fp-app .graph svg { width: 100%; max-width: 460px; display: block; }
.fp-app .note { font-size: 13px; color: #334155; margin: 6px 0 0; }
.fp-app .right { display: grid; gap: 12px; align-content: start; min-width: 0; }
.fp-app .right .graph { margin-top: 0; }
.fp-app .explain { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 18px 16px;
  font-size: 14.5px; line-height: 1.5; }
.fp-app .explain.min { padding-bottom: 12px; }
.fp-app .explain-bar { display: flex; justify-content: space-between; align-items: center; margin: 0 -8px 6px 0;
  font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.fp-app .min-btn { width: 30px; height: 26px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px;
  font-size: 18px; line-height: 1; cursor: pointer; color: #334155; }
.fp-app .min-btn:hover { background: #e2e8f0; }
.fp-app .explain.min .key { margin-top: 2px; }
.fp-app .explain h2 { font-size: 17px; margin: 0 0 8px; }
.fp-app .explain h2 + ol, .fp-app .explain h2 + ul { margin-top: 0; }
.fp-app .explain ol, .fp-app .explain ul { padding-left: 20px; }
.fp-app .explain li { margin-bottom: 8px; }
.fp-app .explain p { margin: 0 0 8px; }
.fp-app .safety { background: #fef9c3; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.fp-app .key { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: #334155; margin-top: 10px; }
.fp-app .dot { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; color: #fff;
  font-style: normal; font-weight: bold; align-items: center; justify-content: center; margin-right: 4px; font-size: 13px; }
.fp-app .dot.el { background: #f59e0b; color: #1f2937; width: 14px; height: 14px; font-size: 11px; }
.fp-app .dot.pos { background: #dc2626; } .fp-app .dot.neg { background: #2563eb; }
.fp-app .e-t { color: #b45309; font-weight: 600; }
.fp-app .pos-t { color: #b91c1c; font-weight: 600; } .fp-app .neg-t { color: #1d4ed8; font-weight: 600; }
.fp-app .disturb { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
.fp-app .disturb button { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 6px 10px;
  font-size: 13px; cursor: pointer; }
.fp-app .disturb button:hover { background: #e2e8f0; }
`;
