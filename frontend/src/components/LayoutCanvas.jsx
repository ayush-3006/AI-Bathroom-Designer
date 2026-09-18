import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const FT_TO_MM = 304.8;
const MARGIN_MM = 100;
const DOOR_WIDTH_MM = 700;

// Fallback only used if the shower size somehow wasn't captured in chat -
// normally the user's own showerWidthFt/showerLengthFt answer drives this.
const GENERIC_SHOWER_MM = { width: 900, depth: 900 };

// Faucets mount on the vanity counter rather than having their own floor
// space - this is a small representative rectangle, not a measured footprint.
const FAUCET_MM = { width: 140, depth: 70 };

const ROLE_COLOR = {
  vanity: "#B9C6CE",
  toilet: "#CFD9DE",
  bathtub: "#A9C2CE",
  shower: "#CDE0D6",
  faucet: "#8FAFC4",
};

const ROLE_LABEL = {
  vanity: "Vanity",
  toilet: "Toilet",
  bathtub: "Tub",
  shower: "Shower",
  faucet: "Faucet",
};

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function effectiveSize(f) {
  return f.rotation % 180 === 0 ? { w: f.baseW, h: f.baseH } : { w: f.baseH, h: f.baseW };
}

// Places a fixture against a given wall. `alongFrac` controls where along
// the wall it sits (0 = start, 0.5 = center, 1 = end) - bottom-wall fixtures
// default off-center so they don't sit under the door.
function placeOnWall(wall, alongExt, projExt, roomW, roomL, alongFrac) {
  switch (wall) {
    case "top":
      return { x: clamp((roomW - alongExt) * alongFrac, 0, roomW - alongExt), y: 0, w: alongExt, h: projExt };
    case "bottom":
      return { x: clamp((roomW - alongExt) * alongFrac, 0, roomW - alongExt), y: Math.max(0, roomL - projExt - MARGIN_MM), w: alongExt, h: projExt };
    case "left":
      return { x: 0, y: clamp((roomL - alongExt) * alongFrac, 0, roomL - alongExt), w: projExt, h: alongExt };
    case "right":
    default:
      return { x: Math.max(0, roomW - projExt), y: clamp((roomL - alongExt) * alongFrac, 0, roomL - alongExt), w: projExt, h: alongExt };
  }
}

// Three alternate wall arrangements the user can switch between. Each maps
// every present fixture to a distinct wall so they don't start overlapping.
const LAYOUT_TEMPLATES = [
  { name: "Vanity on back wall", walls: { vanity: "top", toilet: "left", bathtub: "right", shower: "bottom" } },
  { name: "Vanity on left wall", walls: { vanity: "left", toilet: "top", bathtub: "bottom", shower: "right" } },
  { name: "Vanity on right wall", walls: { vanity: "right", toilet: "bottom", bathtub: "top", shower: "left" } },
];

function dimsFor(role, item, showerWidthFt, showerLengthFt) {
  if (role === "vanity") return { along: item.dimensions_mm?.width || 700, proj: item.dimensions_mm?.depth || 500 };
  if (role === "toilet") return { along: item.dimensions_mm?.width || 400, proj: item.dimensions_mm?.depth || 550 };
  if (role === "bathtub") return { along: item.dimensions_mm?.length || 1500, proj: item.dimensions_mm?.width || 700 };
  if (role === "shower") {
    if (showerWidthFt && showerLengthFt) {
      return { along: showerWidthFt * FT_TO_MM, proj: showerLengthFt * FT_TO_MM };
    }
    return { along: GENERIC_SHOWER_MM.width, proj: GENERIC_SHOWER_MM.depth };
  }
  return { along: 400, proj: 400 };
}

function autoPlace(roomWmm, roomLmm, bundle, templateIndex, showerWidthFt, showerLengthFt) {
  const template = LAYOUT_TEMPLATES[templateIndex].walls;
  const fixtures = [];
  const roles = ["vanity", "toilet", "bathtub", "shower"];
  const showerIsUserSized = Boolean(showerWidthFt && showerLengthFt);

  for (const role of roles) {
    const item = bundle?.roles?.[role];
    if (!item) continue;
    const { along, proj } = dimsFor(role, item, showerWidthFt, showerLengthFt);
    const wall = template[role];
    const alongFrac = wall === "bottom" ? 0.15 : 0.5;
    const rect = placeOnWall(wall, along, proj, roomWmm, roomLmm, alongFrac);
    fixtures.push({
      id: role,
      role,
      label: item.name || item.collection,
      price: item.price_inr,
      note:
        role === "shower"
          ? showerIsUserSized
            ? `${showerWidthFt}ft x ${showerLengthFt}ft, as you specified`
            : "generic footprint - shower size wasn't specified"
          : null,
      baseW: along,
      baseH: proj,
      rotation: wall === "left" || wall === "right" ? 90 : 0,
      x: rect.x,
      y: rect.y,
    });
  }

  // Faucet attaches to whichever wall the vanity ended up on, sitting on
  // the front-center edge of the vanity counter.
  const faucetItem = bundle?.roles?.faucet;
  const vanityFixture = fixtures.find((f) => f.id === "vanity");
  if (faucetItem && vanityFixture) {
    const vanityWall = template.vanity;
    const { w: vw, h: vh } = effectiveSize(vanityFixture);
    const rotation = vanityWall === "left" || vanityWall === "right" ? 90 : 0;
    const { w: fw, h: fh } = rotation % 180 === 0 ? { w: FAUCET_MM.width, h: FAUCET_MM.depth } : { w: FAUCET_MM.depth, h: FAUCET_MM.width };

    let x, y;
    if (vanityWall === "top") {
      x = vanityFixture.x + vw / 2 - fw / 2;
      y = Math.max(0, vh - fh - 15);
    } else if (vanityWall === "bottom") {
      x = vanityFixture.x + vw / 2 - fw / 2;
      y = vanityFixture.y + 15;
    } else if (vanityWall === "left") {
      x = Math.max(0, vw - fw - 15);
      y = vanityFixture.y + vh / 2 - fh / 2;
    } else {
      x = vanityFixture.x + 15;
      y = vanityFixture.y + vh / 2 - fh / 2;
    }

    fixtures.push({
      id: "faucet",
      role: "faucet",
      label: faucetItem.name || faucetItem.collection,
      price: faucetItem.price_inr,
      note: "representative size - mounts on the vanity, not an independent footprint",
      attachedTo: "vanity",
      baseW: FAUCET_MM.width,
      baseH: FAUCET_MM.depth,
      rotation,
      x,
      y,
    });
  }

  return fixtures.map((f) => {
    const { w, h } = effectiveSize(f);
    return { ...f, x: clamp(f.x, 0, Math.max(0, roomWmm - w)), y: clamp(f.y, 0, Math.max(0, roomLmm - h)) };
  });
}

export default function LayoutCanvas({ widthFt, lengthFt, bundle, showerWidthFt, showerLengthFt }) {
  const [fixtures, setFixtures] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [removedExtraRoles, setRemovedExtraRoles] = useState(new Set());
  const dragRef = useRef(null); // { id, offXmm, offYmm }
  const svgRef = useRef(null);

  const hasRoom = Boolean(widthFt && lengthFt);
  const roomWmm = hasRoom ? widthFt * FT_TO_MM : 0;
  const roomLmm = hasRoom ? lengthFt * FT_TO_MM : 0;

  // Re-run auto-placement whenever a new bundle arrives, the room/shower size
  // changes, or the user picks a different layout template. This
  // intentionally overwrites manual dragging and any deletions - a new
  // bundle/template means a fresh starting point.
  useEffect(() => {
    if (!hasRoom) {
      setFixtures([]);
      return;
    }
    setFixtures(autoPlace(roomWmm, roomLmm, bundle, templateIndex, showerWidthFt, showerLengthFt));
    setSelectedId(null);
    setRemovedExtraRoles(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, hasRoom, roomWmm, roomLmm, templateIndex, showerWidthFt, showerLengthFt]);

  const getScale = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !roomWmm) return 1;
    return rect.width / roomWmm;
  }, [roomWmm]);

  const toMm = useCallback(
    (clientX, clientY) => {
      const rect = svgRef.current.getBoundingClientRect();
      const scale = getScale();
      return { xMm: (clientX - rect.left) / scale, yMm: (clientY - rect.top) / scale };
    },
    [getScale]
  );

  function onPointerDown(e, fixture) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { xMm, yMm } = toMm(e.clientX, e.clientY);
    dragRef.current = { id: fixture.id, offXmm: xMm - fixture.x, offYmm: yMm - fixture.y };
    setSelectedId(fixture.id);
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const { xMm, yMm } = toMm(e.clientX, e.clientY);
    const { id, offXmm, offYmm } = dragRef.current;
    setFixtures((fs) =>
      fs.map((f) => {
        if (f.id !== id) return f;
        const { w, h } = effectiveSize(f);
        const newX = clamp(xMm - offXmm, 0, Math.max(0, roomWmm - w));
        const newY = clamp(yMm - offYmm, 0, Math.max(0, roomLmm - h));
        return { ...f, x: newX, y: newY };
      })
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function rotateSelected() {
    if (!selectedId) return;
    setFixtures((fs) =>
      fs.map((f) => {
        if (f.id !== selectedId) return f;
        const oldSize = effectiveSize(f);
        const cx = f.x + oldSize.w / 2;
        const cy = f.y + oldSize.h / 2;
        const newRotation = (f.rotation + 90) % 360;
        const newSize = effectiveSize({ ...f, rotation: newRotation });
        const newX = clamp(cx - newSize.w / 2, 0, Math.max(0, roomWmm - newSize.w));
        const newY = clamp(cy - newSize.h / 2, 0, Math.max(0, roomLmm - newSize.h));
        return { ...f, rotation: newRotation, x: newX, y: newY };
      })
    );
  }

  // Deleting a fixture also removes anything mounted on it (e.g. the faucet
  // goes with the vanity) so the plan never shows an orphaned marker.
  function deleteFixture(id) {
    setFixtures((fs) => fs.filter((f) => f.id !== id && f.attachedTo !== id));
    setSelectedId(null);
  }

  function removeExtra(role) {
    setRemovedExtraRoles((prev) => new Set(prev).add(role));
  }

  const overlappingIds = useMemo(() => {
    const bad = new Set();
    for (let i = 0; i < fixtures.length; i++) {
      for (let j = i + 1; j < fixtures.length; j++) {
        const a = fixtures[i], b = fixtures[j];
        // A faucet overlapping the vanity it's mounted on is expected, not a conflict.
        if (a.attachedTo === b.id || b.attachedTo === a.id) continue;
        const aSize = effectiveSize(a), bSize = effectiveSize(b);
        if (rectsOverlap({ x: a.x, y: a.y, ...aSize }, { x: b.x, y: b.y, ...bSize })) {
          bad.add(a.id);
          bad.add(b.id);
        }
      }
    }
    return bad;
  }, [fixtures]);

  function resetLayout() {
    if (!hasRoom) return;
    setFixtures(autoPlace(roomWmm, roomLmm, bundle, templateIndex, showerWidthFt, showerLengthFt));
    setSelectedId(null);
    setRemovedExtraRoles(new Set());
  }

  const selected = fixtures.find((f) => f.id === selectedId);
  const allExtras = bundle ? ["tank", "mirror"].map((role) => ({ role, item: bundle.roles[role] })).filter((e) => e.item) : [];
  const extras = allExtras.filter((e) => !removedExtraRoles.has(e.role));
  const presentRoles = [...new Set(fixtures.map((f) => f.role))];

  const liveTotal = fixtures.reduce((sum, f) => sum + f.price, 0) + extras.reduce((sum, e) => sum + e.item.price_inr, 0);
  const hasChanges = bundle && liveTotal !== bundle.total;

  const svgW = 520;
  const svgH = hasRoom ? (roomLmm / roomWmm) * svgW : 360;

  return (
    <div className="layout-panel">
      <div className="app-header">
        <h2 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 4px" }}>Live floor plan</h2>
        <p style={{ fontSize: "13px", color: "#5A6B7A", margin: "0 0 14px" }}>
          Fixtures appear once the assistant has your room size and recommendation.
          This is just for representative purpose, for actual layouts refer to your builder's plan.
          The setup of the different components can be adjusted accordingly by you AI just places the components in the layout.
        </p>
      </div>

      {!hasRoom && <div className="canvas-placeholder">Tell the assistant your room dimensions to see the plan.</div>}

      {hasRoom && (
        <>
          {bundle && (
            <div className="template-row">
              {LAYOUT_TEMPLATES.map((t, i) => (
                <button
                  key={t.name}
                  className={`template-btn ${i === templateIndex ? "active" : ""}`}
                  onClick={() => setTemplateIndex(i)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {bundle && (
            <div className="bill-summary">
              <span>Current total</span>
              <span className="bill-total">
                ₹{liveTotal.toLocaleString("en-IN")}
                {hasChanges && <span className="bill-original"> (was ₹{bundle.total.toLocaleString("en-IN")})</span>}
              </span>
            </div>
          )}

          <div className="instructions">
            <b>Click</b> a fixture to select it &nbsp;·&nbsp; <b>drag</b> to move &nbsp;·&nbsp; <b>Rotate</b> turns it 90°
            &nbsp;·&nbsp; <b>Remove</b> deletes it and updates the total
          </div>

          <div className="canvas-wrap">
            <svg
              ref={svgRef}
              width={svgW}
              height={svgH}
              viewBox={`0 0 ${roomWmm} ${roomLmm}`}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <defs>
                <pattern id="grid" width="300" height="300" patternUnits="userSpaceOnUse">
                  <path d="M 300 0 L 0 0 0 300" fill="none" stroke="#DCE2E6" strokeWidth="4" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={roomWmm} height={roomLmm} fill="url(#grid)" onClick={() => setSelectedId(null)} />
              <rect x="0" y="0" width={roomWmm} height={roomLmm} fill="none" stroke="#22303F" strokeWidth="16" />
              {/* door gap, fixed on bottom wall */}
              <rect x={roomWmm / 2 - DOOR_WIDTH_MM / 2} y={roomLmm - 10} width={DOOR_WIDTH_MM} height="16" fill="#F6F4EF" />

              {fixtures.map((f) => {
                const { w, h } = effectiveSize(f);
                const isSelected = f.id === selectedId;
                const isOverlapping = overlappingIds.has(f.id);
                return (
                  <g key={f.id} onPointerDown={(e) => onPointerDown(e, f)} style={{ cursor: "grab", touchAction: "none" }}>
                    <rect
                      x={f.x}
                      y={f.y}
                      width={w}
                      height={h}
                      rx="8"
                      fill={ROLE_COLOR[f.role] || "#D7DEE4"}
                      stroke={isOverlapping ? "#B4432F" : isSelected ? "#9C7A3C" : "#22303F"}
                      strokeWidth={isSelected ? "10" : "4"}
                    />
                    <text
                      x={f.x + w / 2}
                      y={f.y + h / 2}
                      textAnchor="middle"
                      fontSize={f.role === "faucet" ? "26" : "40"}
                      fontFamily="'IBM Plex Sans', sans-serif"
                      fontWeight="500"
                      fill="#22303F"
                      style={{ pointerEvents: "none" }}
                    >
                      {ROLE_LABEL[f.role]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="canvas-controls">
            <button className="restart" onClick={resetLayout}>
              Reset layout
            </button>
            {selected && (
              <>
                <button className="restart rotate-btn" onClick={rotateSelected}>
                  ⟳ Rotate {ROLE_LABEL[selected.role]} 90°
                </button>
                <button className="restart delete-btn" onClick={() => deleteFixture(selected.id)}>
                  ✕ Remove {ROLE_LABEL[selected.role]}
                </button>
              </>
            )}
            {overlappingIds.size > 0 && <span className="overlap-warning">Some fixtures overlap - drag to fix</span>}
          </div>

          {presentRoles.length > 0 && (
            <div className="legend">
              {presentRoles.map((role) => (
                <span key={role} className="legend-chip">
                  <span className="legend-swatch" style={{ background: ROLE_COLOR[role] }} />
                  {ROLE_LABEL[role]}
                </span>
              ))}
            </div>
          )}

          {selected && (
            <div className="selection-card">
              <h3>{ROLE_LABEL[selected.role]}</h3>
              <p>{selected.label}</p>
              <p className="price">₹{selected.price.toLocaleString("en-IN")}</p>
              {selected.note && <p style={{ fontSize: "11.5px", color: "#8A99A6" }}>{selected.note}</p>}
            </div>
          )}

          {allExtras.length > 0 && (
            <div className="bundle-card" style={{ marginTop: "14px" }}>
              <h3>Also in this bundle (concealed/wall-mounted, not shown on grid)</h3>
              {allExtras.map(({ role, item }) => {
                const removed = removedExtraRoles.has(role);
                return (
                  <div className={`bundle-row ${removed ? "removed" : ""}`} key={role}>
                    <span className="role">{item.name || item.collection}</span>
                    <span className="price">
                      {removed ? (
                        <span style={{ color: "#8A99A6" }}>removed</span>
                      ) : (
                        <>
                          ₹{item.price_inr.toLocaleString("en-IN")}
                          <button className="extra-remove-btn" onClick={() => removeExtra(role)} title={`Remove ${item.name || item.collection}`}>
                            ✕
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
