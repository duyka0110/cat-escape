const CONFIG = {
  cols: 13,
  rows: 15,
  baseColors: ["red", "green", "blue"],
  minCats: 30,
  maxCats: 50,
};

/** Level → cat colors allowed in generated puzzles (spawning uses this pool only). */
const LEVEL_COLOR_POOLS = {
  1: ["red"],
  2: ["red", "green"],
  3: ["red", "green", "blue"],
  4: ["red", "green", "yellow"],
  5: ["red", "green", "yellow", "blue"],
};
const BOX_CATS_COLOR_POOL = ["red", "green", "blue", "yellow", "brown", "purple"];

function getSelectedLevel() {
  const n = Number(levelSelectEl?.value);
  if (n >= 1 && n <= 5) return n;
  return 5;
}

function getRequirementMode() {
  const mode = requirementSelectEl?.value;
  if (mode === "treats") return "treats";
  if (mode === "box-cats-multi") return "box-cats-multi";
  if (mode === "box-cats") return "box-cats";
  return "side-houses";
}

function getActiveColorPool() {
  if (getRequirementMode() === "treats") return LEVEL_COLOR_POOLS[3];
  if (isAnyBoxCatsMode()) return BOX_CATS_COLOR_POOL;
  return LEVEL_COLOR_POOLS[getSelectedLevel()] ?? LEVEL_COLOR_POOLS[5];
}

function isBoxCatsOneColorMode() {
  return getRequirementMode() === "box-cats";
}

function isBoxCatsMultiColorMode() {
  return getRequirementMode() === "box-cats-multi";
}

function isAnyBoxCatsMode() {
  return isBoxCatsOneColorMode() || isBoxCatsMultiColorMode();
}

/** ~50% faster than the current movement speed. */
const GRID_SLIDE_MS_PER_PX = (3.5 / 1.2) / 1.5;
const GRID_SLIDE_MIN_MS = (180 / 1.2) / 1.5;
const BOARD_PADDING = { top: 0.16, right: 0.18, bottom: 0.14, left: 0.18 };

const DIRS = {
  up: { x: 0, y: -1, angle: 0 },
  right: { x: 1, y: 0, angle: 90 },
  down: { x: 0, y: 1, angle: 180 },
  left: { x: -1, y: 0, angle: -90 },
};
/** Counterclockwise 90° (prefer for brown when both turns fit). */
const CCW_DIR = {
  right: "up",
  up: "left",
  left: "down",
  down: "right",
};
/** Clockwise 90°. */
const CW_DIR = {
  right: "down",
  down: "left",
  left: "up",
  up: "right",
};
const OPPOSITE_DIR = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
};

const ORIENTATION_DIRS = {
  horizontal: ["left", "right"],
  vertical: ["up", "down"],
};

const CAT_COLORS = {
  red: "#ff4b5f",
  green: "#2fc760",
  blue: "#4b86f8",
  yellow: "#f5d547",
  brown: "#A2845E",
  purple: "#a855f7",
};
const EXIT_SIDE_BY_DIR = {
  up: "top",
  down: "bottom",
  left: "left",
  right: "right",
};
const HOUSE_ORDER = ["top", "bottom", "left", "right"];
const WAITLIST_MAX = 5;
const HOUSE_REQUIREMENT_SIZE = 2;
const TREAT_TRAY_COUNT = 3;
const TREAT_WAITLIST_MAX = 5;
const TREAT_COLORS = ["red", "green", "blue"];
const BOX_CATS_COUNT = 4;
const BOX_CATS_MIN_REQUIREMENT = 2;
const BOX_CATS_MAX_REQUIREMENT = 4;
const BOX_CATS_WAITLIST_MAX = 5;

const state = {
  cats: [],
  houses: {},
  waitlist: [],
  treats: [],
  treatTrays: [],
  treatWaitlist: [],
  boxCatsBoxes: [],
  boxCatsWaitlist: [],
  /** "won" | "lost" | null — Treats mode end state */
  treatsOutcome: null,
  /** Shared end modal state: { outcome: "won"|"lost", message: string } | null */
  endState: null,
  gameOver: false,
  movingCats: new Set(),
};

const housesEl = document.getElementById("houses");
const boardEl = document.getElementById("grid-board");
const roadLayerEl = document.getElementById("road-layer");
const runnerLayerEl = document.getElementById("runner-layer");
const statusEl = document.getElementById("status");
const regenBtn = document.getElementById("regen-btn");
const levelSelectEl = document.getElementById("level-select");
const requirementSelectEl = document.getElementById("requirement-select");
const gameShellEl = document.getElementById("game-shell");
const appEl = document.getElementById("app");
const treatsModalEl = document.getElementById("treats-modal");
const treatsModalMsgEl = document.getElementById("treats-modal-msg");
const treatsModalBtnEl = document.getElementById("treats-modal-btn");

const random = (n) => Math.floor(Math.random() * n);
const choose = (arr) => arr[random(arr.length)];
const inBounds = (x, y) => x >= 0 && x < CONFIG.cols && y >= 0 && y < CONFIG.rows;
const key = (x, y) => `${x},${y}`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function catLength(cat) {
  if (cat.color === "purple") {
    if (isAnyBoxCatsMode()) return 2;
    return cat.mode === "stretch" ? 2 : 1;
  }
  return 2;
}

function cellsFromTail(tail, dirKey, cat) {
  const dir = DIRS[dirKey];
  const len = catLength(cat);
  const cells = [];
  for (let i = 0; i < len; i++) {
    cells.push({ x: tail.x + dir.x * i, y: tail.y + dir.y * i });
  }
  return cells;
}

function occupiedCells(cat) {
  return cellsFromTail({ x: cat.x, y: cat.y }, cat.dir, cat);
}

function catAtCell(map, x, y) {
  return map.get(key(x, y));
}

function buildOccupancy(cats, excludeId) {
  const map = new Map();
  for (const cat of cats) {
    if (excludeId && cat.id === excludeId) continue;
    for (const cell of occupiedCells(cat)) map.set(key(cell.x, cell.y), cat.id);
  }
  return map;
}

function canPlace(cat, cats) {
  const map = buildOccupancy(cats);
  for (const cell of occupiedCells(cat)) {
    if (!inBounds(cell.x, cell.y)) return false;
    if (map.has(key(cell.x, cell.y))) return false;
  }
  return true;
}

function firstHit(cat, cats) {
  const map = buildOccupancy(cats, cat.id);
  const dir = DIRS[cat.dir];
  const cells = occupiedCells(cat);
  const front = cells[cells.length - 1];
  let x = front.x + dir.x;
  let y = front.y + dir.y;
  while (inBounds(x, y)) {
    const hit = catAtCell(map, x, y);
    if (hit) return hit;
    x += dir.x;
    y += dir.y;
  }
  return null;
}

function hasDirectedCycle(cats) {
  const edges = new Map();
  for (const cat of cats) edges.set(cat.id, firstHit(cat, cats));
  const seen = new Set();
  const stack = new Set();

  function visit(id) {
    if (!id) return false;
    if (stack.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    stack.add(id);
    const next = edges.get(id);
    if (visit(next)) return true;
    stack.delete(id);
    return false;
  }
  for (const cat of cats) if (visit(cat.id)) return true;
  return false;
}

function blockedLine(cats, fromCell, toCell) {
  let dx = Math.sign(toCell.x - fromCell.x);
  let dy = Math.sign(toCell.y - fromCell.y);
  let x = fromCell.x + dx;
  let y = fromCell.y + dy;
  const map = buildOccupancy(cats);
  while (x !== toCell.x || y !== toCell.y) {
    if (map.has(key(x, y))) return true;
    x += dx;
    y += dy;
  }
  return false;
}

function facesOpposite(a, b) {
  if (a.dir === "left" && b.dir === "right") return true;
  if (a.dir === "right" && b.dir === "left") return true;
  if (a.dir === "up" && b.dir === "down") return true;
  if (a.dir === "down" && b.dir === "up") return true;
  return false;
}

function hasFacingConflict(cats) {
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      const a = cats[i];
      const b = cats[j];
      if (!facesOpposite(a, b)) continue;
      const aCells = occupiedCells(a);
      const bCells = occupiedCells(b);
      for (const ac of aCells) {
        for (const bc of bCells) {
          if (ac.y === bc.y || ac.x === bc.x) {
            if (!blockedLine(cats, ac, bc)) return true;
          }
        }
      }
    }
  }
  return false;
}

function hasDirectionalOrderingConflict(cats) {
  // Row rule:
  // - No left-facing cat can be to the right of any right-facing cat in the same row.
  // Column rule:
  // - No up-facing cat can be below any down-facing cat in the same column.
  const rowMaxLeftX = new Map();
  const rowMinRightX = new Map();
  const colMaxUpY = new Map();
  const colMinDownY = new Map();

  for (const cat of cats) {
    const cells = occupiedCells(cat);
    for (const cell of cells) {
      if (cat.dir === "left") {
        const prev = rowMaxLeftX.get(cell.y);
        rowMaxLeftX.set(cell.y, prev === undefined ? cell.x : Math.max(prev, cell.x));
      } else if (cat.dir === "right") {
        const prev = rowMinRightX.get(cell.y);
        rowMinRightX.set(cell.y, prev === undefined ? cell.x : Math.min(prev, cell.x));
      } else if (cat.dir === "up") {
        const prev = colMaxUpY.get(cell.x);
        colMaxUpY.set(cell.x, prev === undefined ? cell.y : Math.max(prev, cell.y));
      } else if (cat.dir === "down") {
        const prev = colMinDownY.get(cell.x);
        colMinDownY.set(cell.x, prev === undefined ? cell.y : Math.min(prev, cell.y));
      }
    }
  }

  for (const [row, maxLeft] of rowMaxLeftX.entries()) {
    const minRight = rowMinRightX.get(row);
    if (minRight !== undefined && maxLeft > minRight) return true;
  }

  for (const [col, maxUp] of colMaxUpY.entries()) {
    const minDown = colMinDownY.get(col);
    if (minDown !== undefined && maxUp > minDown) return true;
  }

  return false;
}

function hasGreenInboundConflict(cats) {
  const greens = cats.filter((c) => c.color === "green");
  if (greens.length === 0) return false;

  for (const green of greens) {
    const greenCells = occupiedCells(green);
    let hasInbound = false;

    for (const other of cats) {
      if (other.id === green.id) continue;
      const otherCells = occupiedCells(other);

      for (const gc of greenCells) {
        for (const oc of otherCells) {
          if (oc.y === gc.y) {
            if (oc.x < gc.x && other.dir === "right") {
              hasInbound = true;
              break;
            }
            if (oc.x > gc.x && other.dir === "left") {
              hasInbound = true;
              break;
            }
          }
          if (oc.x === gc.x) {
            if (oc.y < gc.y && other.dir === "down") {
              hasInbound = true;
              break;
            }
            if (oc.y > gc.y && other.dir === "up") {
              hasInbound = true;
              break;
            }
          }
        }
        if (hasInbound) break;
      }
      if (hasInbound) break;
    }

    if (!hasInbound) return true;
  }

  return false;
}

function hasGreenPurpleAlignmentQuotaConflict(cats, purpleInPool) {
  const greens = cats.filter((c) => c.color === "green");
  if (greens.length === 0) return false;
  if (!purpleInPool) return false;
  const purples = cats.filter((c) => c.color === "purple");
  if (purples.length === 0) return true;

  let alignedCount = 0;
  for (const green of greens) {
    const greenCells = occupiedCells(green);
    let aligned = false;
    for (const purple of purples) {
      const purpleCells = occupiedCells(purple);
      for (const gc of greenCells) {
        for (const pc of purpleCells) {
          if (gc.x === pc.x || gc.y === pc.y) {
            aligned = true;
            break;
          }
        }
        if (aligned) break;
      }
      if (aligned) break;
    }
    if (aligned) alignedCount += 1;
  }

  return alignedCount < Math.ceil(greens.length / 2);
}

function anyEscapable(cats) {
  return cats.some((cat) => !firstHit(cat, cats) || computeStopFor(cat, cats).escaped);
}

function isDirectionValidForOrientation(cat) {
  if (cat.color === "purple" && cat.mode === "loaf") return true;
  const allowed = ORIENTATION_DIRS[cat.orientation] || [];
  return allowed.includes(cat.dir);
}

/** Called when another cat bumps this purple cat: loaf↔stretch along current axis only (no turning). Stretch prefers head-ward space, else tail-ward. */
function togglePurpleMode(cat) {
  if (cat.color !== "purple") return;
  const others = state.cats.filter((c) => c.id !== cat.id);
  const d = cat.dir;
  const orientation = ORIENTATION_DIRS.horizontal.includes(d) ? "horizontal" : "vertical";

  if (cat.mode === "loaf") {
    const headFirst = { ...cat, mode: "stretch", dir: d, orientation, x: cat.x, y: cat.y };
    const tailFirst = {
      ...cat,
      mode: "stretch",
      dir: d,
      orientation,
      x: cat.x - DIRS[d].x,
      y: cat.y - DIRS[d].y,
    };
    if (isDirectionValidForOrientation(headFirst) && canPlace(headFirst, others)) {
      cat.mode = "stretch";
      cat.dir = d;
      cat.orientation = orientation;
    } else if (isDirectionValidForOrientation(tailFirst) && canPlace(tailFirst, others)) {
      cat.mode = "stretch";
      cat.dir = d;
      cat.orientation = orientation;
      cat.x = tailFirst.x;
      cat.y = tailFirst.y;
    }
    return;
  }

  const loafCand = { ...cat, mode: "loaf", orientation: "horizontal" };
  if (canPlace(loafCand, others)) {
    cat.mode = "loaf";
  }
}

/** Brown: after bumping, pivot so new tail = old head; turn 90° CCW or CW depending on space (prefer CCW if both). */
function brownRotateOnBump(cat) {
  if (cat.color !== "brown") return;
  const others = state.cats.filter((c) => c.id !== cat.id);
  const oldDir = cat.dir;
  const step = DIRS[oldDir];
  const oldHead = { x: cat.x + step.x, y: cat.y + step.y };
  const newTail = oldHead;

  const tryDir = (dirKey) => {
    const d = DIRS[dirKey];
    const orientation = ORIENTATION_DIRS.horizontal.includes(dirKey) ? "horizontal" : "vertical";
    const cand = { ...cat, x: newTail.x, y: newTail.y, dir: dirKey, orientation };
    return isDirectionValidForOrientation(cand) && canPlace(cand, others);
  };

  const ccw = CCW_DIR[oldDir];
  const cw = CW_DIR[oldDir];
  const ccwOk = tryDir(ccw);
  const cwOk = tryDir(cw);

  let pick = null;
  if (ccwOk && cwOk) pick = ccw;
  else if (ccwOk) pick = ccw;
  else if (cwOk) pick = cw;

  if (pick) {
    const fromDir = cat.dir;
    cat.x = newTail.x;
    cat.y = newTail.y;
    cat.dir = pick;
    cat.orientation = ORIENTATION_DIRS.horizontal.includes(pick) ? "horizontal" : "vertical";
    return { turned: true, fromDir, toDir: pick };
  }
  return { turned: false };
}

function generatePuzzle() {
  const colorPool = getActiveColorPool();
  const poolHasPurple = colorPool.includes("purple");

  for (let attempt = 0; attempt < 1200; attempt++) {
    const cats = [];
    const target = CONFIG.minCats + random(CONFIG.maxCats - CONFIG.minCats + 1);
    let serial = 1;
    let failures = 0;

    while (cats.length < target && failures < 12000) {
      const color = choose(colorPool);
      let candidate;

      if (color === "purple") {
        if (isAnyBoxCatsMode()) {
          const orientation = choose(["horizontal", "vertical"]);
          const dir = choose(ORIENTATION_DIRS[orientation]);
          candidate = {
            id: `cat-${serial++}`,
            color: "purple",
            mode: "stretch",
            orientation,
            dir,
            x: random(CONFIG.cols),
            y: random(CONFIG.rows),
          };
        } else if (random(2) === 0) {
          candidate = {
            id: `cat-${serial++}`,
            color: "purple",
            mode: "loaf",
            orientation: "horizontal",
            dir: choose(Object.keys(DIRS)),
            x: random(CONFIG.cols),
            y: random(CONFIG.rows),
          };
        } else {
          const orientation = choose(["horizontal", "vertical"]);
          const dir = choose(ORIENTATION_DIRS[orientation]);
          candidate = {
            id: `cat-${serial++}`,
            color: "purple",
            mode: "stretch",
            orientation,
            dir,
            x: random(CONFIG.cols),
            y: random(CONFIG.rows),
          };
        }
      } else {
        const orientation = choose(["horizontal", "vertical"]);
        const dir = choose(ORIENTATION_DIRS[orientation]);
        candidate = {
          id: `cat-${serial++}`,
          color,
          orientation,
          dir,
          x: random(CONFIG.cols),
          y: random(CONFIG.rows),
          sleeping: color === "green",
        };
      }

      if (!isDirectionValidForOrientation(candidate)) {
        failures += 1;
        continue;
      }
      if (!canPlace(candidate, cats)) {
        failures += 1;
        continue;
      }
      cats.push(candidate);
      if (
        hasDirectedCycle(cats) ||
        hasFacingConflict(cats) ||
        hasDirectionalOrderingConflict(cats) ||
        hasGreenInboundConflict(cats)
      ) {
        cats.pop();
        failures += 1;
        continue;
      }
    }

    if (cats.length < CONFIG.minCats) continue;
    if (!anyEscapable(cats)) continue;

    if (poolHasPurple && !cats.some((c) => c.color === "purple")) {
      let placed = false;
      for (let t = 0; t < 400 && !placed; t++) {
        const extra = isAnyBoxCatsMode()
          ? (() => {
              const orientation = choose(["horizontal", "vertical"]);
              const dir = choose(ORIENTATION_DIRS[orientation]);
              return {
                id: `cat-${serial++}`,
                color: "purple",
                mode: "stretch",
                orientation,
                dir,
                x: random(CONFIG.cols),
                y: random(CONFIG.rows),
              };
            })()
          : {
              id: `cat-${serial++}`,
              color: "purple",
              mode: "loaf",
              orientation: "horizontal",
              dir: choose(Object.keys(DIRS)),
              x: random(CONFIG.cols),
              y: random(CONFIG.rows),
            };
        if (!canPlace(extra, cats)) continue;
        cats.push(extra);
        if (
          hasDirectedCycle(cats) ||
          hasFacingConflict(cats) ||
          hasDirectionalOrderingConflict(cats) ||
          hasGreenInboundConflict(cats)
        ) {
          cats.pop();
          continue;
        }
        placed = true;
      }
    }

    if (poolHasPurple && !cats.some((c) => c.color === "purple")) continue;
    if (hasGreenPurpleAlignmentQuotaConflict(cats, poolHasPurple)) continue;

    return cats;
  }
  throw new Error("Could not generate puzzle.");
}

function requirementPoolForSide(side, cats) {
  const dirBySide = { top: "up", bottom: "down", left: "left", right: "right" };
  const dir = dirBySide[side];

  // Primary pool: colors from cats that can currently escape to this exact side.
  const escapablePool = cats
    .filter((c) => c.dir === dir && computeStopFor(c, cats).escaped)
    .map((c) => c.color);
  if (escapablePool.length) return escapablePool;

  // Secondary pool: keep direction-only behavior as a soft fallback.
  const directionalPool = cats.filter((c) => c.dir === dir).map((c) => c.color);
  if (directionalPool.length) return directionalPool;

  // Final fallback: use any color still present on board.
  return cats.map((c) => c.color);
}

function generateRequirement(side, cats) {
  const pool = requirementPoolForSide(side, cats);
  if (!pool.length) return ["red", "blue"];
  const req = [];
  for (let i = 0; i < HOUSE_REQUIREMENT_SIZE; i++) req.push(choose(pool));
  return req;
}

function initHouses(cats) {
  state.gameOver = false;
  state.endState = null;
  state.waitlist = [];
  state.treats = [];
  state.treatTrays = [];
  state.treatWaitlist = [];
  state.boxCatsBoxes = [];
  state.boxCatsWaitlist = [];
  state.treatsOutcome = null;
  state.houses = {};
  for (const side of HOUSE_ORDER) {
    state.houses[side] = {
      requirement: generateRequirement(side, cats),
      accepted: [],
    };
  }
}

function multisetFromArray(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

function roadTreatColorCounts() {
  const m = new Map();
  for (const t of state.treats) {
    if (!t.taken) m.set(t.color, (m.get(t.color) || 0) + 1);
  }
  return m;
}

function treatWaitlistColorCounts() {
  const m = new Map();
  for (const c of state.treatWaitlist) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

function canSatisfyTreatRequirement(req) {
  if (!req.length) return true;
  const need = multisetFromArray(req);
  const road = roadTreatColorCounts();
  const wait = treatWaitlistColorCounts();
  for (const [c, k] of need) {
    const avail = (road.get(c) || 0) + (wait.get(c) || 0);
    if (avail < k) return false;
  }
  return true;
}

function generateNewTreatRequirement() {
  const R = state.treats.filter((t) => !t.taken).length;
  const W = state.treatWaitlist.length;
  const maxSlots = Math.min(2, R + W);
  if (maxSlots < 1) return [];
  const targetN = maxSlots === 1 ? 1 : random(2) + 1;
  const n = Math.min(targetN, maxSlots);
  for (let attempt = 0; attempt < 120; attempt++) {
    const req = [];
    for (let i = 0; i < n; i++) req.push(choose(TREAT_COLORS));
    if (canSatisfyTreatRequirement(req)) return req;
  }
  for (const c of TREAT_COLORS) {
    if (canSatisfyTreatRequirement([c])) return [c];
  }
  return [];
}

function laneForSideFromCat(cat, side) {
  if (side === "left" || side === "right") return cat.y;
  if (side === "top" || side === "bottom") return cat.x;
  return 0;
}

function generateTreats(cats) {
  return cats.map((cat, idx) => {
    const side = EXIT_SIDE_BY_DIR[cat.dir];
    const lane = laneForSideFromCat(cat, side);
    const color = TREAT_COLORS.includes(cat.color) ? cat.color : choose(TREAT_COLORS);
    return { id: `treat-${idx + 1}`, side, lane, color, taken: false };
  });
}

function initTreats(cats) {
  state.gameOver = false;
  state.endState = null;
  state.waitlist = [];
  state.houses = {};
  state.boxCatsBoxes = [];
  state.boxCatsWaitlist = [];
  state.treatWaitlist = [];
  state.treatsOutcome = null;
  state.treats = generateTreats(cats);
  state.treatTrays = Array.from({ length: TREAT_TRAY_COUNT }, () => ({
    requirement: generateNewTreatRequirement(),
    accepted: [],
  }));
  settleTreatWaitlistToTrays();
}

function unresolvedBoxNeeds(excludeIndex = -1) {
  const needed = {};
  for (let i = 0; i < state.boxCatsBoxes.length; i++) {
    if (i === excludeIndex) continue;
    const box = state.boxCatsBoxes[i];
    const openByColor = boxNeedsByColor(box);
    for (const [color, openSlots] of openByColor.entries()) {
      if (!openSlots) continue;
      needed[color] = (needed[color] || 0) + openSlots;
    }
  }
  return needed;
}

function boardColorCounts() {
  const counts = {};
  for (const cat of state.cats) counts[cat.color] = (counts[cat.color] || 0) + 1;
  return counts;
}

function boxRequirementColors(box) {
  if (!box) return [];
  if (Array.isArray(box.requirementColors)) return box.requirementColors.slice();
  if (box.color && box.requirement > 0) return Array.from({ length: box.requirement }, () => box.color);
  return [];
}

function boxNeedsByColor(box) {
  const req = colorCountsFromList(boxRequirementColors(box));
  const accepted = colorCountsFromList(box?.accepted || []);
  const open = new Map();
  for (const [color, needed] of req.entries()) {
    const remain = needed - (accepted.get(color) || 0);
    if (remain > 0) open.set(color, remain);
  }
  return open;
}

function boxCanAcceptColor(box, color) {
  return (boxNeedsByColor(box).get(color) || 0) > 0;
}

function emptyBoxRequirement() {
  return { color: null, requirement: 0, requirementColors: [], accepted: [] };
}

function boxRequirementPool(excludeIndex = -1) {
  const boardCounts = boardColorCounts();
  const waitCountsMap = colorCountsFromList(state.boxCatsWaitlist);
  const waitCounts = {};
  for (const [color, n] of waitCountsMap.entries()) waitCounts[color] = n;
  const reserved = unresolvedBoxNeeds(excludeIndex);
  const allColors = new Set([...Object.keys(boardCounts), ...Object.keys(waitCounts)]);

  const pool = [];
  for (const color of allColors) {
    const reservedNeed = reserved[color] || 0;
    let boardRemaining = boardCounts[color] || 0;
    let waitRemaining = waitCounts[color] || 0;

    // Active boxes consume capacity from board first, then waitlist.
    const fromBoard = Math.min(boardRemaining, reservedNeed);
    boardRemaining -= fromBoard;
    const fromWait = Math.min(waitRemaining, Math.max(0, reservedNeed - fromBoard));
    waitRemaining -= fromWait;

    const remaining = boardRemaining + waitRemaining;
    if (remaining > 0) {
      pool.push({ color, remaining, boardRemaining, waitRemaining });
    }
  }
  return pool;
}

function generateBoxCatsRequirementOneColor(excludeIndex = -1) {
  const pool = boxRequirementPool(excludeIndex);
  if (!pool.length) return null;
  // Lower priority for waitlist: prefer colors with board supply first.
  const boardFirst = pool.filter((p) => p.boardRemaining > 0);
  const fallbackAll = pool;
  const sourcePool = boardFirst.length ? boardFirst : fallbackAll;
  const strictPool = sourcePool.filter((p) => p.remaining >= BOX_CATS_MIN_REQUIREMENT);
  const fallbackPool = sourcePool.filter((p) => p.remaining >= 1);
  const source = strictPool.length ? strictPool : fallbackPool;
  if (!source.length) return null;
  const pick = choose(source);
  const maxN = Math.min(BOX_CATS_MAX_REQUIREMENT, pick.remaining);
  const minN = strictPool.length ? BOX_CATS_MIN_REQUIREMENT : 1;
  if (maxN < minN) return null;
  const span = maxN - minN + 1;
  const requirement = minN + random(span);
  return {
    color: pick.color,
    requirement,
    requirementColors: Array.from({ length: requirement }, () => pick.color),
    accepted: [],
  };
}

function generateBoxCatsRequirementMultiColor(excludeIndex = -1) {
  const pool = boxRequirementPool(excludeIndex);
  if (!pool.length) return null;
  const bag = [];
  for (const entry of pool) {
    for (let i = 0; i < entry.remaining; i++) bag.push(entry.color);
  }
  if (bag.length < BOX_CATS_MIN_REQUIREMENT) return null;

  const maxN = Math.min(BOX_CATS_MAX_REQUIREMENT, bag.length);
  const n = BOX_CATS_MIN_REQUIREMENT + random(maxN - BOX_CATS_MIN_REQUIREMENT + 1);
  const picked = [];
  const bagCopy = bag.slice();
  for (let i = 0; i < n && bagCopy.length; i++) {
    const idx = random(bagCopy.length);
    picked.push(bagCopy[idx]);
    bagCopy.splice(idx, 1);
  }
  if (picked.length < BOX_CATS_MIN_REQUIREMENT) return null;
  return {
    color: null,
    requirement: picked.length,
    requirementColors: picked,
    accepted: [],
  };
}

function fillOneBoxFromColor(color) {
  for (let i = 0; i < state.boxCatsBoxes.length; i++) {
    const box = state.boxCatsBoxes[i];
    if (!boxCanAcceptColor(box, color)) continue;
    box.accepted.push(color);
    return i;
  }
  return -1;
}

function settleBoxCatsWaitlist() {
  let moved = false;
  for (let loops = 0; loops < 80; loops++) {
    let progressed = false;
    for (let i = 0; i < state.boxCatsWaitlist.length; i++) {
      const color = state.boxCatsWaitlist[i];
      const idx = fillOneBoxFromColor(color);
      if (idx >= 0) {
        state.boxCatsWaitlist.splice(i, 1);
        i -= 1;
        progressed = true;
        moved = true;
      }
    }
    if (!progressed) break;
  }
  return moved;
}

function colorCountsFromList(colors) {
  const m = new Map();
  for (const c of colors) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

function boxCatsNeededColorCounts() {
  const m = new Map();
  for (const box of state.boxCatsBoxes) {
    const openByColor = boxNeedsByColor(box);
    for (const [color, open] of openByColor.entries()) {
      if (!open) continue;
      m.set(color, (m.get(color) || 0) + open);
    }
  }
  return m;
}

function boxCatsExitableColorCounts() {
  const m = new Map();
  for (const cat of state.cats) {
    const stop = computeStopFor(cat, state.cats);
    if (!stop.escaped) continue;
    m.set(cat.color, (m.get(cat.color) || 0) + 1);
  }
  return m;
}

function hasAnyColorOverlap(need, supply) {
  for (const [color, n] of need.entries()) {
    if (n <= 0) continue;
    if ((supply.get(color) || 0) > 0) return true;
  }
  return false;
}

function evaluateBoxCatsEndState() {
  if (!isAnyBoxCatsMode()) return null;
  if (state.cats.length === 0) {
    state.gameOver = true;
    state.endState = {
      outcome: "won",
      message: "All cats exited the board. You win!",
    };
    return { outcome: "won" };
  }

  if (state.boxCatsWaitlist.length < BOX_CATS_WAITLIST_MAX) return null;
  const need = boxCatsNeededColorCounts();
  if (need.size === 0) return null;

  const waitSupply = colorCountsFromList(state.boxCatsWaitlist);
  if (hasAnyColorOverlap(need, waitSupply)) return null;

  const exitableSupply = boxCatsExitableColorCounts();
  if (hasAnyColorOverlap(need, exitableSupply)) return null;

  state.gameOver = true;
  state.endState = {
    outcome: "lost",
    message: "Waitlist is full and no waitlist/exitable cats can fill current boxes. You lose.",
  };
  return { outcome: "lost", reason: "deadlock-full-waitlist" };
}

function initBoxCats(cats) {
  state.gameOver = false;
  state.endState = null;
  state.waitlist = [];
  state.houses = {};
  state.treats = [];
  state.treatTrays = [];
  state.treatWaitlist = [];
  state.treatsOutcome = null;
  state.boxCatsWaitlist = [];
  state.boxCatsBoxes = [];
  const generator = isBoxCatsMultiColorMode()
    ? generateBoxCatsRequirementMultiColor
    : generateBoxCatsRequirementOneColor;
  for (let i = 0; i < BOX_CATS_COUNT; i++) {
    state.boxCatsBoxes.push(generator(i) || emptyBoxRequirement());
  }
}

function peekApplyColorToTreatTrays(color) {
  for (let trayIndex = 0; trayIndex < state.treatTrays.length; trayIndex++) {
    const tray = state.treatTrays[trayIndex];
    if (!tray.requirement.length) continue;
    const need = multisetFromArray(tray.requirement);
    const got = multisetFromArray(tray.accepted);
    if ((got.get(color) || 0) >= (need.get(color) || 0)) continue;
    return { trayIndex };
  }
  return null;
}

function applyColorToTreatTrays(color) {
  for (let trayIndex = 0; trayIndex < state.treatTrays.length; trayIndex++) {
    const tray = state.treatTrays[trayIndex];
    if (!tray.requirement.length) continue;
    const need = multisetFromArray(tray.requirement);
    const got = multisetFromArray(tray.accepted);
    if ((got.get(color) || 0) >= (need.get(color) || 0)) continue;
    tray.accepted.push(color);
    let completedTray = false;
    if (tray.accepted.length >= tray.requirement.length) {
      completedTray = true;
      tray.requirement = generateNewTreatRequirement();
      tray.accepted = [];
    }
    return { trayIndex, completedTray };
  }
  return null;
}

function settleTreatWaitlistToTrays() {
  for (let g = 0; g < 80; g++) {
    let moved = false;
    for (let i = 0; i < state.treatWaitlist.length; i++) {
      const c = state.treatWaitlist[i];
      if (applyColorToTreatTrays(c)) {
        state.treatWaitlist.splice(i, 1);
        i -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function laneForExit(side, exitCell) {
  if (side === "left" || side === "right") return exitCell.y;
  return exitCell.x;
}

function findTreatForExit(cat, side, exitCell) {
  if (!exitCell || !TREAT_COLORS.includes(cat.color)) return null;
  const lane = laneForExit(side, exitCell);
  return (
    state.treats.find(
      (t) => !t.taken && t.side === side && t.lane === lane && t.color === cat.color
    ) || null
  );
}

function maybeTreatsWinAfterMove() {
  if (state.treats.some((t) => !t.taken)) return;
  if (state.treatWaitlist.length) return;
  const ok = state.treatTrays.every(
    (t) => !t.requirement.length || t.accepted.length >= t.requirement.length
  );
  if (ok) {
    state.gameOver = true;
    state.treatsOutcome = "won";
    state.endState = {
      outcome: "won",
      message: "All treats collected and delivered. You win!",
    };
  }
}

function tryCollectTreat(cat, side, exitCell) {
  const treat = findTreatForExit(cat, side, exitCell);
  if (!treat) return { outcome: "no-treat" };
  treat.taken = true;
  const applied = applyColorToTreatTrays(treat.color);
  if (applied) {
    settleTreatWaitlistToTrays();
    maybeTreatsWinAfterMove();
    return {
      outcome: applied.completedTray ? "tray-complete" : "delivered",
      color: treat.color,
      trayIndex: applied.trayIndex,
    };
  }
  if (state.treatWaitlist.length >= TREAT_WAITLIST_MAX) {
    state.gameOver = true;
    state.treatsOutcome = "lost";
    state.endState = {
      outcome: "lost",
      message: "Treat waitlist is full. You lose.",
    };
    return { outcome: "waitlist-full", color: treat.color };
  }
  state.treatWaitlist.push(treat.color);
  settleTreatWaitlistToTrays();
  maybeTreatsWinAfterMove();
  return { outcome: "waitlist", color: treat.color };
}

function consumeHouseRequirement(side, color) {
  return consumeHouseRequirementWithOptions(side, color, { allowWaitlistAutoFill: true });
}

function consumeHouseRequirementWithOptions(side, color, options = {}) {
  const { allowWaitlistAutoFill = true } = options;
  const house = state.houses[side];
  if (!house) return false;
  const req = house.requirement;
  const accepted = house.accepted;
  const needed = {};
  const got = {};
  for (const c of req) needed[c] = (needed[c] || 0) + 1;
  for (const c of accepted) got[c] = (got[c] || 0) + 1;
  if ((got[color] || 0) >= (needed[color] || 0)) return false;
  accepted.push(color);
  if (accepted.length >= HOUSE_REQUIREMENT_SIZE) {
    house.requirement = generateRequirement(side, state.cats);
    house.accepted = [];
    if (allowWaitlistAutoFill) {
      settleWaitlistToHouses();
    }
  }
  return true;
}

function settleWaitlistToHouses() {
  let progressed = false;
  let movedAny;
  do {
    movedAny = false;
    for (let i = 0; i < state.waitlist.length; i++) {
      const color = state.waitlist[i];
      let moved = false;
      for (const side of HOUSE_ORDER) {
        if (consumeHouseRequirementWithOptions(side, color, { allowWaitlistAutoFill: false })) {
          state.waitlist.splice(i, 1);
          i -= 1;
          moved = true;
          movedAny = true;
          progressed = true;
          break;
        }
      }
      if (moved) continue;
    }
  } while (movedAny);
  return progressed;
}

function renderHouses() {
  housesEl.innerHTML = "";
  if (getRequirementMode() === "treats") {
    renderTreatsOverlay();
    updateTreatsEndModal();
    return;
  }
  if (isAnyBoxCatsMode()) {
    renderBoxCatsOverlay();
    updateTreatsEndModal();
    return;
  }
  const boardRect = boardEl.getBoundingClientRect();
  const playRect = housesEl.getBoundingClientRect();
  const boardLeft = boardRect.left - playRect.left;
  const boardRight = boardRect.right - playRect.left;
  const boardTop = boardRect.top - playRect.top;
  const boardBottom = boardRect.bottom - playRect.top;
  const sideGap = 10;
  const waitNode = document.createElement("div");
  waitNode.className = "waitlist";
  waitNode.innerHTML = `<div class="wait-title">Waitlist (${state.waitlist.length}/${WAITLIST_MAX})</div>`;
  const waitPills = document.createElement("div");
  waitPills.className = "wait-pills";
  for (let i = 0; i < WAITLIST_MAX; i++) {
    const slot = document.createElement("span");
    if (state.waitlist[i]) {
      slot.className = "wait-slot filled";
      slot.style.background = CAT_COLORS[state.waitlist[i]] || "#fff";
    } else {
      slot.className = "wait-slot";
    }
    waitPills.appendChild(slot);
  }
  waitNode.appendChild(waitPills);
  housesEl.appendChild(waitNode);

  for (const side of HOUSE_ORDER) {
    const house = state.houses[side];
    if (!house) continue;
    const flowLabel = {
      top: "flow: right -> left",
      bottom: "flow: left -> right",
      left: "flow: top -> bottom",
      right: "flow: bottom -> right",
    }[side];
    const node = document.createElement("div");
    node.className = `house side-${side}`;
    node.innerHTML = `<div class="house-name">${side} house</div><div class="house-count">needs 2 cats | ${flowLabel}</div>`;
    if (side === "top") {
      node.style.left = `${(boardLeft + boardRight) / 2}px`;
      node.style.top = `${Math.max(2, boardTop - sideGap)}px`;
      node.style.transform = "translate(-50%, -100%)";
    } else if (side === "bottom") {
      node.style.left = `${(boardLeft + boardRight) / 2}px`;
      node.style.top = `${Math.min(playRect.height - 2, boardBottom + sideGap)}px`;
      node.style.transform = "translate(-50%, 0)";
    } else if (side === "left") {
      node.style.left = `${Math.max(2, boardLeft - sideGap)}px`;
      node.style.top = `${(boardTop + boardBottom) / 2}px`;
      node.style.transform = "translate(-100%, -50%)";
    } else if (side === "right") {
      node.style.left = `${Math.min(playRect.width - 2, boardRight + sideGap)}px`;
      node.style.top = `${(boardTop + boardBottom) / 2}px`;
      node.style.transform = "translate(0, -50%)";
    }
    const pills = document.createElement("div");
    pills.className = "req-pills";
    for (let i = 0; i < HOUSE_REQUIREMENT_SIZE; i++) {
      const color = house.requirement[i];
      const pill = document.createElement("span");
      pill.className = "req-pill";
      pill.style.background = CAT_COLORS[color] || "#fff";
      if (i < house.accepted.length) pill.classList.add("dimmed");
      pills.appendChild(pill);
    }
    node.appendChild(pills);
    housesEl.appendChild(node);
  }
  updateTreatsEndModal();
}

function renderBoxCatsOverlay() {
  const topStack = document.createElement("div");
  topStack.className = "boxcats-top-stack";

  const strip = document.createElement("div");
  strip.className = "boxcats-strip";
  state.boxCatsBoxes.forEach((box, idx) => {
    const node = document.createElement("div");
    node.className = "boxcat-box";
    node.dataset.boxIndex = String(idx);
    if (box.departing) node.classList.add("departing");
    const requirementColors = boxRequirementColors(box);
    if (!requirementColors.length) {
      node.innerHTML = '<div class="boxcat-box-label">No box</div>';
      strip.appendChild(node);
      return;
    }
    const isMulti = isBoxCatsMultiColorMode();
    if (!isMulti && box.color) {
      node.style.borderColor = CAT_COLORS[box.color] || "rgb(255 255 255 / 16%)";
      node.innerHTML = `<div class="boxcat-box-label">${box.color}</div>`;
    } else {
      node.innerHTML = `<div class="boxcat-box-label">Box ${idx + 1}</div>`;
    }
    const row = document.createElement("div");
    row.className = "boxcat-pill-row";
    const acceptedCounts = multisetFromArray(box.accepted || []);
    const usedCounts = new Map();
    for (let i = 0; i < requirementColors.length; i++) {
      const color = requirementColors[i];
      const pill = document.createElement("span");
      pill.className = "boxcat-pill";
      pill.style.borderColor = CAT_COLORS[color] || "#fff";
      const used = usedCounts.get(color) || 0;
      const have = acceptedCounts.get(color) || 0;
      if (used < have) {
        usedCounts.set(color, used + 1);
        pill.classList.add("filled");
        pill.style.background = CAT_COLORS[color] || "#fff";
      }
      row.appendChild(pill);
    }
    node.appendChild(row);
    strip.appendChild(node);
  });
  topStack.appendChild(strip);

  const waitRow = document.createElement("div");
  waitRow.id = "boxcat-waitlist-row";
  waitRow.className = "boxcat-waitlist-row";
  waitRow.innerHTML = `<div class="boxcat-waitlist-title">Waitlist (${state.boxCatsWaitlist.length}/${BOX_CATS_WAITLIST_MAX})</div>`;
  const waitPills = document.createElement("div");
  waitPills.className = "boxcat-wait-pills";
  for (let i = 0; i < BOX_CATS_WAITLIST_MAX; i++) {
    const slot = document.createElement("span");
    if (state.boxCatsWaitlist[i]) {
      slot.className = "boxcat-wait-slot filled";
      slot.style.background = CAT_COLORS[state.boxCatsWaitlist[i]] || "#fff";
    } else {
      slot.className = "boxcat-wait-slot";
    }
    waitPills.appendChild(slot);
  }
  waitRow.appendChild(waitPills);
  topStack.appendChild(waitRow);
  housesEl.appendChild(topStack);
}

function treatPosition(side, lane, boardRect, playRect) {
  const margin = 18;
  const boardLeft = boardRect.left - playRect.left;
  const boardTop = boardRect.top - playRect.top;
  const cellW = boardRect.width / CONFIG.cols;
  const cellH = boardRect.height / CONFIG.rows;
  if (side === "left") {
    return { x: boardLeft - margin, y: boardTop + (lane + 0.5) * cellH };
  }
  if (side === "right") {
    return { x: boardLeft + boardRect.width + margin, y: boardTop + (lane + 0.5) * cellH };
  }
  if (side === "top") {
    return { x: boardLeft + (lane + 0.5) * cellW, y: boardTop - margin };
  }
  return { x: boardLeft + (lane + 0.5) * cellW, y: boardTop + boardRect.height + margin };
}

function renderTreatsOverlay() {
  const boardRect = boardEl.getBoundingClientRect();
  const playRect = housesEl.getBoundingClientRect();

  const topStack = document.createElement("div");
  topStack.className = "treats-top-stack";

  const trayStrip = document.createElement("div");
  trayStrip.className = "tray-strip";
  state.treatTrays.forEach((tray, idx) => {
    const trayNode = document.createElement("div");
    trayNode.className = "tray";
    trayNode.dataset.trayIndex = String(idx);
    trayNode.innerHTML = `<div class="tray-title">Tray ${idx + 1}</div>`;
    const pills = document.createElement("div");
    pills.className = "treat-tray-pills";
    const acceptedCounts = multisetFromArray(tray.accepted);
    const usedCounts = new Map();
    const reqLen = tray.requirement.length;
    for (let i = 0; i < reqLen; i++) {
      const color = tray.requirement[i];
      const slot = document.createElement("span");
      slot.className = "treat-pill-slot";
      const pill = document.createElement("span");
      pill.className = "treat-pill";
      pill.style.background = CAT_COLORS[color] || "#fff";
      slot.appendChild(pill);
      const used = usedCounts.get(color) || 0;
      const have = acceptedCounts.get(color) || 0;
      const filled = used < have;
      if (filled) {
        usedCounts.set(color, used + 1);
        slot.classList.add("filled");
        const mark = document.createElement("span");
        mark.className = "treat-check";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "✓";
        slot.appendChild(mark);
      }
      pills.appendChild(slot);
    }
    trayNode.appendChild(pills);
    trayStrip.appendChild(trayNode);
  });
  topStack.appendChild(trayStrip);

  const waitRow = document.createElement("div");
  waitRow.id = "treat-waitlist-row";
  waitRow.className = "treat-waitlist-row";
  waitRow.innerHTML = `<div class="treat-waitlist-title">Waitlist (${state.treatWaitlist.length}/${TREAT_WAITLIST_MAX})</div>`;
  const waitPills = document.createElement("div");
  waitPills.className = "treat-waitlist-pills";
  for (let i = 0; i < TREAT_WAITLIST_MAX; i++) {
    const slot = document.createElement("span");
    if (state.treatWaitlist[i]) {
      slot.className = "treat-wait-slot filled";
      slot.style.background = CAT_COLORS[state.treatWaitlist[i]] || "#fff";
    } else {
      slot.className = "treat-wait-slot";
    }
    waitPills.appendChild(slot);
  }
  waitRow.appendChild(waitPills);
  topStack.appendChild(waitRow);
  housesEl.appendChild(topStack);

  for (const treat of state.treats) {
    const node = document.createElement("span");
    node.className = "treat-node";
    if (treat.taken) node.classList.add("taken");
    node.style.background = CAT_COLORS[treat.color] || "#fff";
    const pos = treatPosition(treat.side, treat.lane, boardRect, playRect);
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
    housesEl.appendChild(node);
  }

  updateTreatsEndModal();
}

function updateTreatsEndModal() {
  if (!treatsModalEl) return;
  if (!state.endState) {
    treatsModalEl.hidden = true;
    return;
  }
  treatsModalEl.hidden = false;
  treatsModalMsgEl.textContent = state.endState.message;
  if (state.endState.outcome === "won") {
    treatsModalBtnEl.textContent = "New Game";
  } else {
    treatsModalBtnEl.textContent = "Retry";
  }
}

function distPointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  let t = ab2 < 1e-8 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return { x: cx, y: cy, t, dist: Math.hypot(p.x - cx, p.y - cy) };
}

function perimeterLengthFromBox(box) {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  return 2 * w + 2 * h;
}

function projectToSOnRoad(box, p) {
  const { left, right, top, bottom } = box;
  const w = right - left;
  const h = bottom - top;
  const segs = [
    { a: { x: right, y: top }, b: { x: left, y: top }, s0: 0, len: w },
    { a: { x: left, y: top }, b: { x: left, y: bottom }, s0: w, len: h },
    { a: { x: left, y: bottom }, b: { x: right, y: bottom }, s0: w + h, len: w },
    { a: { x: right, y: bottom }, b: { x: right, y: top }, s0: 2 * w + h, len: h },
  ];
  let bestS = 0;
  let bestD = Infinity;
  for (const sg of segs) {
    const r = distPointToSegment(p, sg.a, sg.b);
    const s = sg.s0 + r.t * sg.len;
    if (r.dist < bestD) {
      bestD = r.dist;
      bestS = s;
    }
  }
  return bestS;
}

function pointAtSOnRoad(box, s) {
  const { left, right, top, bottom } = box;
  const w = right - left;
  const h = bottom - top;
  const L = 2 * w + 2 * h;
  s = ((s % L) + L) % L;
  if (s <= w) return { x: right - s, y: top };
  s -= w;
  if (s <= h) return { x: left, y: top + s };
  s -= h;
  if (s <= w) return { x: left + s, y: bottom };
  s -= w;
  return { x: right, y: bottom - s };
}

/** Shortest route along the road rectangle (either direction on the perimeter). */
function shortestPathAlongRoad(box, from, to) {
  const L = perimeterLengthFromBox(box);
  let s0 = projectToSOnRoad(box, from);
  let s1 = projectToSOnRoad(box, to);
  s0 = ((s0 % L) + L) % L;
  s1 = ((s1 % L) + L) % L;
  const distForward = s1 >= s0 ? s1 - s0 : s1 + L - s0;
  const distBackward = L - distForward;
  if (distForward < 1e-6) return [pointAtSOnRoad(box, s0)];

  const useForward = distForward <= distBackward;
  const dist = useForward ? distForward : distBackward;
  const steps = Math.max(2, Math.ceil(dist / 14));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const s = useForward ? s0 + distForward * u : s0 - distBackward * u;
    pts.push(pointAtSOnRoad(box, s));
  }
  return pts;
}

function roadApproachPoint(box, dest) {
  const { left, right, top, bottom } = box;
  if (dest.y < top) return { x: Math.max(left, Math.min(right, dest.x)), y: top };
  if (dest.y > bottom) return { x: Math.max(left, Math.min(right, dest.x)), y: bottom };
  if (dest.x < left) return { x: left, y: Math.max(top, Math.min(bottom, dest.y)) };
  if (dest.x > right) return { x: right, y: Math.max(top, Math.min(bottom, dest.y)) };
  return {
    x: Math.max(left, Math.min(right, dest.x)),
    y: Math.max(top, Math.min(bottom, dest.y)),
  };
}

/**
 * @returns {{ points: {x:number,y:number}[], treatPickupEndIndex: number }}
 * `treatPickupEndIndex` is the path index when the cat reaches the road treat (-1 if none).
 */
function buildTreatExitPath(cat, side, exitCell) {
  const playRect = boardEl.parentElement.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  const box = roadBox();
  const start = gridCellCenter(exitCell);
  const edgeBySide = {
    left: { x: box.left, y: start.y },
    right: { x: box.right, y: start.y },
    top: { x: start.x, y: box.top },
    bottom: { x: start.x, y: box.bottom },
  };
  const edge = edgeBySide[side] || start;
  const treat = findTreatForExit(cat, side, exitCell);

  const points = [];
  const pushPt = (p) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.8) points.push(p);
  };

  pushPt(start);
  if (Math.hypot(edge.x - start.x, edge.y - start.y) > 1) pushPt(edge);

  if (!treat) return { points, treatPickupEndIndex: -1 };

  const treatPt = treatPosition(treat.side, treat.lane, boardRect, playRect);
  let cur = edge;
  const appendAlongRoad = (target) => {
    const seg = shortestPathAlongRoad(box, cur, target);
    for (const p of seg) pushPt(p);
    cur = target;
  };

  appendAlongRoad(treatPt);
  const treatPickupEndIndex = points.length - 1;

  const peek = peekApplyColorToTreatTrays(treat.color);
  let dest = null;
  if (peek) {
    const trayEl = housesEl.querySelector(`.tray[data-tray-index="${peek.trayIndex}"]`);
    if (trayEl) {
      const r = trayEl.getBoundingClientRect();
      dest = { x: r.left - playRect.left + r.width / 2, y: r.top - playRect.top + r.height / 2 };
    }
  } else {
    const wl = document.getElementById("treat-waitlist-row");
    if (wl) {
      const r = wl.getBoundingClientRect();
      dest = { x: r.left - playRect.left + r.width / 2, y: r.top - playRect.top + r.height / 2 };
    }
  }

  if (dest) {
    const approach = roadApproachPoint(box, dest);
    if (Math.hypot(approach.x - cur.x, approach.y - cur.y) > 2) appendAlongRoad(approach);
    if (Math.hypot(dest.x - points[points.length - 1].x, dest.y - points[points.length - 1].y) > 2) {
      pushPt(dest);
    }
  }

  return { points, treatPickupEndIndex };
}

/** Screen-space movement → same convention as DIRS.*.angle (0° = up, 90° = right). */
function movementAngleDeg(dx, dy) {
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

function applyRunnerFacing(node, angleDeg, baseAngleDeg = 0) {
  if (angleDeg == null) return;
  const relativeAngle = angleDeg - baseAngleDeg;
  node.style.transform = `translate(-50%, -50%) rotate(${relativeAngle}deg)`;
  const arrow = node.querySelector(".cat-arrow");
  if (arrow) {
    arrow.style.transform = "";
  }
}

/** Exit animation in treats mode: face along path, collect treat on the road before animating to tray/waitlist. */
async function animateTreatModeExit(cat, catId, exitCell, side) {
  const node = boardEl.querySelector(`.cat[data-id="${catId}"]`);
  const playRect = boardEl.parentElement.getBoundingClientRect();
  if (!node) {
    return tryCollectTreat(cat, side, exitCell);
  }
  let { points, treatPickupEndIndex } = buildTreatExitPath(cat, side, exitCell);
  points = points.slice();
  const br = node.getBoundingClientRect();
  if (points.length) {
    points[0] = {
      x: br.left - playRect.left + br.width / 2,
      y: br.top - playRect.top + br.height / 2,
    };
  }
  runnerLayerEl.appendChild(node);
  node.style.position = "absolute";
  node.style.width = `${br.width}px`;
  node.style.height = `${br.height}px`;
  node.style.left = `${points[0].x}px`;
  node.style.top = `${points[0].y}px`;
  node.style.transform = "translate(-50%, -50%)";
  node.style.zIndex = "6";

  let result;
  const hasPickup = treatPickupEndIndex >= 0;
  const roadEntry = points.length >= 2 ? points.slice(0, 2) : points.slice();
  const afterEntry = points.length > 2 ? points.slice(1) : [];
  const entryAngle = DIRS[cat.dir]?.angle ?? null;
  const baseAngle = DIRS[cat.dir]?.angle ?? 0;

  if (roadEntry.length >= 2) {
    await animateCatAlongPath(node, roadEntry, { fixedAngleDeg: entryAngle, baseAngleDeg: baseAngle });
  }

  const pickupAfterEntry = hasPickup ? Math.max(0, treatPickupEndIndex - 1) : -1;
  const toPickupAfterEntry = hasPickup ? afterEntry.slice(0, pickupAfterEntry + 1) : [];
  const fromPickupAfterEntry = hasPickup ? afterEntry.slice(pickupAfterEntry) : [];

  if (hasPickup && toPickupAfterEntry.length >= 2) {
    await animateCatAlongPath(node, toPickupAfterEntry, { baseAngleDeg: baseAngle });
    result = tryCollectTreat(cat, side, exitCell);
    renderHouses();
    if (fromPickupAfterEntry.length >= 2) {
      await animateCatAlongPath(node, fromPickupAfterEntry, { baseAngleDeg: baseAngle });
    }
  } else if (!hasPickup && afterEntry.length >= 2) {
    await animateCatAlongPath(node, afterEntry, { baseAngleDeg: baseAngle });
    result = tryCollectTreat(cat, side, exitCell);
  } else if (hasPickup && toPickupAfterEntry.length <= 1) {
    result = tryCollectTreat(cat, side, exitCell);
    renderHouses();
    if (fromPickupAfterEntry.length >= 2) {
      await animateCatAlongPath(node, fromPickupAfterEntry, { baseAngleDeg: baseAngle });
    }
  } else {
    result = tryCollectTreat(cat, side, exitCell);
  }

  node.remove();
  return result;
}

function animateCatAlongPath(node, points, options = {}) {
  return new Promise((resolve) => {
    if (!node || points.length < 2) {
      resolve();
      return;
    }
    const { fixedAngleDeg = null, baseAngleDeg = 0 } = options;
    const segments = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.hypot(dx, dy);
      segments.push({ from: points[i], to: points[i + 1], len, dx, dy });
      total += len;
    }
    const duration = Math.max(480, total * 2.05);
    const start = performance.now();
    let prevAngle =
      fixedAngleDeg == null ? movementAngleDeg(segments[0].dx, segments[0].dy) : fixedAngleDeg;
    applyRunnerFacing(node, prevAngle, baseAngleDeg);

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const distance = t * total;
      let traveled = 0;
      let x = points[0].x;
      let y = points[0].y;
      let activeSeg = segments[0];
      for (const seg of segments) {
        if (traveled + seg.len >= distance) {
          const local = seg.len === 0 ? 0 : (distance - traveled) / seg.len;
          x = seg.from.x + (seg.to.x - seg.from.x) * local;
          y = seg.from.y + (seg.to.y - seg.from.y) * local;
          activeSeg = seg;
          break;
        }
        traveled += seg.len;
        x = seg.to.x;
        y = seg.to.y;
        activeSeg = seg;
      }
      if (fixedAngleDeg == null) {
        const a = movementAngleDeg(activeSeg.to.x - activeSeg.from.x, activeSeg.to.y - activeSeg.from.y);
        if (a != null) prevAngle = a;
      } else {
        prevAngle = fixedAngleDeg;
      }
      applyRunnerFacing(node, prevAngle, baseAngleDeg);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function drawGridLines() {
  let background = boardEl.querySelector(".grid-lines");
  if (!background) {
    background = document.createElement("canvas");
    background.className = "grid-lines";
    boardEl.appendChild(background);
  }
  const rect = boardEl.getBoundingClientRect();
  background.width = rect.width * devicePixelRatio;
  background.height = rect.height * devicePixelRatio;
  background.style.width = `${rect.width}px`;
  background.style.height = `${rect.height}px`;
  const ctx = background.getContext("2d");
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--grid-line");
  ctx.lineWidth = 1;
  const cellW = rect.width / CONFIG.cols;
  const cellH = rect.height / CONFIG.rows;
  for (let x = 1; x < CONFIG.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellW, 0);
    ctx.lineTo(x * cellW, rect.height);
    ctx.stroke();
  }
  for (let y = 1; y < CONFIG.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellH);
    ctx.lineTo(rect.width, y * cellH);
    ctx.stroke();
  }
}

function layoutBoard() {
  const playfieldRect = boardEl.parentElement.getBoundingClientRect();
  const treatsWide = getRequirementMode() === "treats";
  const boxMode = isAnyBoxCatsMode();
  const compactTopUi = treatsWide || boxMode;
  const padL = treatsWide ? 0.02 : BOARD_PADDING.left;
  const padR = treatsWide ? 0.02 : BOARD_PADDING.right;
  /** Reserve top band for requirement strips so they do not overlap the grid. */
  const padT = compactTopUi ? (treatsWide ? 0.27 : 0.235) : BOARD_PADDING.top;
  const padB = compactTopUi ? BOARD_PADDING.bottom * 0.9 : BOARD_PADDING.bottom;
  const availLeft = playfieldRect.width * padL;
  const availRight = playfieldRect.width * (1 - padR);
  const availTop = playfieldRect.height * padT;
  const availBottom = playfieldRect.height * (1 - padB);
  const availWidth = Math.max(0, availRight - availLeft);
  const availHeight = Math.max(0, availBottom - availTop);
  if (availWidth < 1 || availHeight < 1) return;

  const targetRatio = CONFIG.cols / CONFIG.rows;
  let boardWidth = availWidth;
  let boardHeight = boardWidth / targetRatio;
  if (boardHeight > availHeight) {
    boardHeight = availHeight;
    boardWidth = boardHeight * targetRatio;
  }

  const left = availLeft + (availWidth - boardWidth) / 2;
  const top = availTop + (availHeight - boardHeight) / 2;
  boardEl.style.left = `${left}px`;
  boardEl.style.top = `${top}px`;
  boardEl.style.width = `${boardWidth}px`;
  boardEl.style.height = `${boardHeight}px`;
}

function cellSize() {
  const rect = boardEl.getBoundingClientRect();
  return { w: rect.width / CONFIG.cols, h: rect.height / CONFIG.rows };
}

function catFootprint(cat) {
  const dir = DIRS[cat.dir];
  const len = catLength(cat);
  return {
    widthCells: dir.x === 0 ? 1 : len,
    heightCells: dir.y === 0 ? 1 : len,
  };
}

function catAnchorCellFromTail(tailCell, dirKey, cat) {
  const dir = DIRS[dirKey];
  const len = catLength(cat);
  const frontX = tailCell.x + dir.x * (len - 1);
  const frontY = tailCell.y + dir.y * (len - 1);
  return {
    x: Math.min(tailCell.x, frontX),
    y: Math.min(tailCell.y, frontY),
  };
}

function catPixelPosition(tailCell, dirKey, cat) {
  const { w, h } = cellSize();
  const anchor = catAnchorCellFromTail(tailCell, dirKey, cat);
  return { left: anchor.x * w, top: anchor.y * h };
}

function renderCats() {
  for (const existing of boardEl.querySelectorAll(".cat")) existing.remove();
  const { w, h } = cellSize();
  for (const cat of state.cats) {
    const dir = DIRS[cat.dir];
    const footprint = catFootprint(cat);
    const node = document.createElement("button");
    node.type = "button";
    node.className = `cat ${cat.color}`;
    node.dataset.id = cat.id;
    const pixel = catPixelPosition({ x: cat.x, y: cat.y }, cat.dir, cat);
    node.style.left = `${pixel.left}px`;
    node.style.top = `${pixel.top}px`;
    node.style.width = `${w * footprint.widthCells}px`;
    node.style.height = `${h * footprint.heightCells}px`;
    if (cat.color === "purple" && cat.mode === "loaf") {
      node.classList.add("cat-loaf");
    }
    if (!isAnyBoxCatsMode() && cat.color === "green" && cat.sleeping) {
      node.classList.add("cat-sleeping");
      node.disabled = true;
      node.innerHTML = '<span class="cat-sleep-label">zzz</span>';
    } else {
      node.innerHTML = `<span class="cat-arrow" style="transform:rotate(${dir.angle}deg)">▲</span>`;
    }
    node.addEventListener("click", () => moveCat(cat.id));
    boardEl.appendChild(node);
  }
}

function renderRoad() {
  const boardRect = boardEl.getBoundingClientRect();
  /** Use playfield (board parent), not the SVG node: inline SVG can under-report height so clampY pulls roads into the grid. */
  const playRect = boardEl.parentElement.getBoundingClientRect();
  const edgePad = 6;
  const clampX = (v) => Math.max(edgePad, Math.min(playRect.width - edgePad, v));
  const clampY = (v) => Math.max(edgePad, Math.min(playRect.height - edgePad, v));
  const toPctX = (x) => (x / playRect.width) * 100;
  const toPctY = (y) => (y / playRect.height) * 100;

  const left = boardRect.left - playRect.left;
  const right = boardRect.right - playRect.left;
  const top = boardRect.top - playRect.top;
  const bottom = boardRect.bottom - playRect.top;
  const margin = 18;
  const cellW = (right - left) / CONFIG.cols;
  const cellH = (bottom - top) / CONFIG.rows;
  /** Extend past board width (10 cols) / height (15 rows) so roads sit outside the grid, not as one closed frame. */
  const hOverhang = cellW * 0.42;
  const vOverhang = cellH * 0.42;

  const roadTopY = clampY(top - margin);
  const roadBottomY = clampY(bottom + margin);
  const roadLeftX = clampX(left - margin);
  const roadRightX = clampX(right + margin);
  const topBottomX0 = clampX(left - margin - hOverhang);
  const topBottomX1 = clampX(right + margin + hOverhang);
  const leftRightY0 = clampY(top - margin - vOverhang);
  const leftRightY1 = clampY(bottom + margin + vOverhang);

  const segments = [
    `M ${toPctX(topBottomX0)} ${toPctY(roadTopY)} L ${toPctX(topBottomX1)} ${toPctY(roadTopY)}`,
    `M ${toPctX(topBottomX0)} ${toPctY(roadBottomY)} L ${toPctX(topBottomX1)} ${toPctY(roadBottomY)}`,
    `M ${toPctX(roadLeftX)} ${toPctY(leftRightY0)} L ${toPctX(roadLeftX)} ${toPctY(leftRightY1)}`,
    `M ${toPctX(roadRightX)} ${toPctY(leftRightY0)} L ${toPctX(roadRightX)} ${toPctY(leftRightY1)}`,
  ];
  roadLayerEl.innerHTML = `<path class="road-stroke" d="${segments.join(" ")}" />`;
}

function syncView() {
  layoutBoard();
  drawGridLines();
  renderHouses();
  renderRoad();
  renderCats();
  updateTreatsEndModal();
}

function pushSlideSegment(segments, fromTail, toTail) {
  if (fromTail.x === toTail.x && fromTail.y === toTail.y) return;
  segments.push({ kind: "slide", fromTail: { ...fromTail }, toTail: { ...toTail } });
}

/** For a jump that leaves the board: pick the most forward on-grid foot for the runner; else last full on-grid pose. */
function exitCellsAfterJumpEscape(dirKey, preTail, preHead, landTail, landHead) {
  const dir = DIRS[dirKey];
  const score = (c) => c.x * dir.x + c.y * dir.y;
  const tIn = inBounds(landTail.x, landTail.y);
  const hIn = inBounds(landHead.x, landHead.y);
  const cand = [];
  if (tIn) cand.push(landTail);
  if (hIn) cand.push(landHead);
  if (cand.length === 0) {
    return { exitHead: { ...preHead }, exitTail: { ...preTail } };
  }
  cand.sort((a, b) => score(b) - score(a));
  const best = cand[0];
  return { exitHead: best, exitTail: best };
}

/**
 * Full motion for one tap: final cells, escape flag, blockers for purple toggles, and animation segments.
 */
function computeStopFor(cat, cats) {
  const map = buildOccupancy(cats, cat.id);
  const dir = DIRS[cat.dir];
  const segments = [];

  if (cat.color !== "yellow" || isAnyBoxCatsMode()) {
    let tail = { x: cat.x, y: cat.y };
    const start = { x: tail.x, y: tail.y };
    while (true) {
      const nextTail = { x: tail.x + dir.x, y: tail.y + dir.y };
      const nextCells = cellsFromTail(nextTail, cat.dir, cat);
      const outCount = nextCells.filter((c) => !inBounds(c.x, c.y)).length;
      const currentCells = cellsFromTail(tail, cat.dir, cat);
      const front = currentCells[currentCells.length - 1];

      if (outCount === nextCells.length) {
        pushSlideSegment(segments, start, tail);
        return { escaped: true, exitHead: front, exitTail: tail, blockedIds: [], segments };
      }
      if (outCount > 0) {
        pushSlideSegment(segments, start, tail);
        return { escaped: true, exitHead: front, exitTail: tail, blockedIds: [], segments };
      }

      const blocked = new Set();
      for (const c of nextCells) {
        const bid = map.get(key(c.x, c.y));
        if (bid) blocked.add(bid);
      }
      if (blocked.size > 0) {
        pushSlideSegment(segments, start, tail);
        const blockedIds = [...blocked];
        const head = front;
        return { escaped: false, tail, head, blockedIds, segments };
      }
      tail = nextTail;
    }
  }

  let tail = { x: cat.x, y: cat.y };
  let slideStart = { x: tail.x, y: tail.y };
  const maxJump = CONFIG.cols + CONFIG.rows + 4;

  while (true) {
    const currentCells = cellsFromTail(tail, cat.dir, cat);
    const front = currentCells[currentCells.length - 1];
    const nextTail = { x: tail.x + dir.x, y: tail.y + dir.y };
    const nextCells = cellsFromTail(nextTail, cat.dir, cat);
    const outCount = nextCells.filter((c) => !inBounds(c.x, c.y)).length;

    if (outCount === nextCells.length) {
      pushSlideSegment(segments, slideStart, tail);
      return { escaped: true, exitHead: front, exitTail: tail, blockedIds: [], segments };
    }
    if (outCount > 0) {
      pushSlideSegment(segments, slideStart, tail);
      return { escaped: true, exitHead: front, exitTail: tail, blockedIds: [], segments };
    }

    const nextBlocked = [];
    for (const c of nextCells) {
      const bid = map.get(key(c.x, c.y));
      if (bid) nextBlocked.push(bid);
    }
    if (nextBlocked.length === 0) {
      tail = nextTail;
      continue;
    }

    const blockerIds = new Set();
    for (const bid of nextBlocked) blockerIds.add(bid);

    if (blockerIds.size !== 1) {
      pushSlideSegment(segments, slideStart, tail);
      const blockedIds = [...blockerIds];
      const head = front;
      return { escaped: false, tail, head, blockedIds, segments };
    }

    const bid = [...blockerIds][0];
    let foundM = 0;
    let jumpEndsEscape = false;

    function jumpMidOk(m) {
      for (let k = 1; k < m; k++) {
        const stepTail = { x: tail.x + k * dir.x, y: tail.y + k * dir.y };
        const stepCells = cellsFromTail(stepTail, cat.dir, cat);
        const stepIds = new Set();
        for (const c of stepCells) {
          if (!inBounds(c.x, c.y)) continue;
          const sid = map.get(key(c.x, c.y));
          if (sid) stepIds.add(sid);
        }
        for (const sid of stepIds) {
          if (sid !== bid) return false;
        }
      }
      return true;
    }

    for (let m = 2; m <= maxJump; m++) {
      if (!jumpMidOk(m)) continue;
      const landTail = { x: tail.x + m * dir.x, y: tail.y + m * dir.y };
      const landCells = cellsFromTail(landTail, cat.dir, cat);
      const allIn = landCells.every((c) => inBounds(c.x, c.y));
      const anyBlocked = landCells.some((c) => map.has(key(c.x, c.y)));
      if (allIn && !anyBlocked) {
        foundM = m;
        jumpEndsEscape = false;
        break;
      }
    }

    if (!foundM) {
      for (let m = 2; m <= maxJump; m++) {
        if (!jumpMidOk(m)) continue;
        const landTail = { x: tail.x + m * dir.x, y: tail.y + m * dir.y };
        const landCells = cellsFromTail(landTail, cat.dir, cat);
        const inCells = landCells.filter((c) => inBounds(c.x, c.y));
        const allIn = inCells.length === landCells.length;

        if (allIn) continue;

        if (inCells.length === 0) {
          foundM = m;
          jumpEndsEscape = true;
          break;
        }

        if (inCells.some((c) => map.has(key(c.x, c.y)))) continue;

        foundM = m;
        jumpEndsEscape = true;
        break;
      }
    }

    if (!foundM) {
      pushSlideSegment(segments, slideStart, tail);
      const blockedIds = [...blockerIds];
      const head = front;
      return { escaped: false, tail, head, blockedIds, segments };
    }

    pushSlideSegment(segments, slideStart, tail);
    const landTail = { x: tail.x + foundM * dir.x, y: tail.y + foundM * dir.y };
    const preCells = cellsFromTail(tail, cat.dir, cat);
    const preHead = preCells[preCells.length - 1];
    const landCells = cellsFromTail(landTail, cat.dir, cat);
    const landHead = landCells[landCells.length - 1];
    segments.push({ kind: "jump", fromTail: { x: tail.x, y: tail.y }, toTail: { ...landTail } });

    if (jumpEndsEscape) {
      const exits = exitCellsAfterJumpEscape(cat.dir, tail, preHead, landTail, landHead);
      return {
        escaped: true,
        exitHead: exits.exitHead,
        exitTail: exits.exitTail,
        blockedIds: [],
        segments,
      };
    }

    tail = landTail;
    slideStart = { x: tail.x, y: tail.y };
  }
}

function animateGridSlide(catId, fromTail, toTail) {
  return new Promise((resolve) => {
    const node = boardEl.querySelector(`.cat[data-id="${catId}"]`);
    if (!node) {
      resolve();
      return;
    }
    const liveCat = state.cats.find((c) => c.id === catId);
    if (!liveCat) {
      resolve();
      return;
    }
    const from = catPixelPosition(fromTail, liveCat.dir, liveCat);
    const to = catPixelPosition(toTail, liveCat.dir, liveCat);
    const distance = Math.hypot(to.left - from.left, to.top - from.top);
    if (distance < 0.1) {
      resolve();
      return;
    }
    const duration = Math.max(GRID_SLIDE_MIN_MS, distance * GRID_SLIDE_MS_PER_PX);
    const start = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const left = from.left + (to.left - from.left) * t;
      const top = from.top + (to.top - from.top) * t;
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function animateGridJump(catId, fromTail, toTail) {
  return new Promise((resolve) => {
    const node = boardEl.querySelector(`.cat[data-id="${catId}"]`);
    if (!node) {
      resolve();
      return;
    }
    const liveCat = state.cats.find((c) => c.id === catId);
    if (!liveCat) {
      resolve();
      return;
    }
    const from = catPixelPosition(fromTail, liveCat.dir, liveCat);
    const to = catPixelPosition(toTail, liveCat.dir, liveCat);
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.1) {
      resolve();
      return;
    }
    const { w, h } = cellSize();
    const len = distance || 1;
    const px = (-dy / len) * Math.min(w, h) * 0.55;
    const py = (dx / len) * Math.min(w, h) * 0.55;
    const duration = Math.max(GRID_SLIDE_MIN_MS * 1.05, distance * GRID_SLIDE_MS_PER_PX * 1.05);
    const start = performance.now();
    const prevTransition = node.style.transition;
    node.style.transition = "none";
    node.classList.add("cat-jumping");

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const arc = Math.sin(Math.PI * t);
      const left = from.left + dx * t + px * arc;
      const top = from.top + dy * t + py * arc;
      const pop = 1 + 0.1 * arc;
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.transform = `scale(${pop})`;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        node.style.left = `${to.left}px`;
        node.style.top = `${to.top}px`;
        node.style.transform = "";
        node.style.transition = prevTransition;
        node.classList.remove("cat-jumping");
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function normalizeAngleDelta(fromDeg, toDeg) {
  let delta = toDeg - fromDeg;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function animateBrownTurn(catId, fromDir, toDir) {
  return new Promise((resolve) => {
    if (!fromDir || !toDir || fromDir === toDir) {
      resolve();
      return;
    }
    const node = boardEl.querySelector(`.cat[data-id="${catId}"]`);
    if (!node) {
      resolve();
      return;
    }
    const fromAngle = DIRS[fromDir]?.angle ?? 0;
    const toAngle = DIRS[toDir]?.angle ?? fromAngle;
    const delta = normalizeAngleDelta(fromAngle, toAngle);
    const duration = 170;
    const start = performance.now();
    const prevTransition = node.style.transition;
    node.style.transition = "none";

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      node.style.transform = `rotate(${delta * t}deg)`;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        node.style.transform = "";
        node.style.transition = prevTransition;
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

async function playMotionSegments(catId, segments) {
  for (const seg of segments) {
    if (seg.kind === "jump") {
      await animateGridJump(catId, seg.fromTail, seg.toTail);
    } else {
      await animateGridSlide(catId, seg.fromTail, seg.toTail);
    }
  }
}

function gridCellCenter(cell) {
  const boardRect = boardEl.getBoundingClientRect();
  const playRect = boardEl.parentElement.getBoundingClientRect();
  const { w, h } = cellSize();
  return {
    x: boardRect.left - playRect.left + (cell.x + 0.5) * w,
    y: boardRect.top - playRect.top + (cell.y + 0.5) * h,
  };
}

function roadBox() {
  const boardRect = boardEl.getBoundingClientRect();
  const playRect = boardEl.parentElement.getBoundingClientRect();
  const margin = 18;
  return {
    left: boardRect.left - playRect.left - margin,
    right: boardRect.right - playRect.left + margin,
    top: boardRect.top - playRect.top - margin,
    bottom: boardRect.bottom - playRect.top + margin,
  };
}

function houseCenter(side) {
  const node = housesEl.querySelector(`.house.side-${side}`);
  if (!node) {
    return { x: 0, y: 0 };
  }
  const rect = node.getBoundingClientRect();
  const playRect = boardEl.parentElement.getBoundingClientRect();
  return {
    x: rect.left - playRect.left + rect.width / 2,
    y: rect.top - playRect.top + rect.height / 2,
  };
}

function boxCenter(index) {
  const node = housesEl.querySelector(`.boxcat-box[data-box-index="${index}"]`);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  const playRect = boardEl.parentElement.getBoundingClientRect();
  return {
    x: rect.left - playRect.left + rect.width / 2,
    y: rect.top - playRect.top + rect.height / 2,
  };
}

function pathToHouse(exitCell, side) {
  const start = gridCellCenter(exitCell);
  const box = roadBox();
  const points = [start];

  const edgeBySide = {
    left: { x: box.left, y: start.y },
    right: { x: box.right, y: start.y },
    top: { x: start.x, y: box.top },
    bottom: { x: start.x, y: box.bottom },
  };
  const edge = edgeBySide[side] || start;
  points.push(edge);
  if (getRequirementMode() === "treats") return points;
  const target = houseCenter(side);
  if (side === "top" || side === "bottom") {
    points.push({ x: target.x, y: edge.y });
  } else {
    points.push({ x: edge.x, y: target.y });
  }
  points.push(target);
  return points;
}

function pathToBox(exitCell, side, boxIndex) {
  const start = gridCellCenter(exitCell);
  const box = roadBox();
  const points = [start];
  const edgeBySide = {
    left: { x: box.left, y: start.y },
    right: { x: box.right, y: start.y },
    top: { x: start.x, y: box.top },
    bottom: { x: start.x, y: box.bottom },
  };
  const edge = edgeBySide[side] || start;
  points.push(edge);
  const target = boxCenter(boxIndex);
  if (!target) return points;
  points.push({ x: target.x, y: edge.y });
  points.push(target);
  return points;
}

function animateRunner(color, points) {
  return new Promise((resolve) => {
    const dot = document.createElement("div");
    dot.className = `cat-runner ${color}`;
    dot.style.background = CAT_COLORS[color] || "#ffffff";
    runnerLayerEl.appendChild(dot);

    const segments = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.hypot(dx, dy);
      segments.push({ from: points[i], to: points[i + 1], len });
      total += len;
    }
    const duration = Math.max(250, total * 2.3);
    const start = performance.now();
    const size = 22;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const distance = t * total;
      let traveled = 0;
      let x = points[0].x;
      let y = points[0].y;

      for (const seg of segments) {
        if (traveled + seg.len >= distance) {
          const local = seg.len === 0 ? 0 : (distance - traveled) / seg.len;
          x = seg.from.x + (seg.to.x - seg.from.x) * local;
          y = seg.from.y + (seg.to.y - seg.from.y) * local;
          break;
        }
        traveled += seg.len;
        x = seg.to.x;
        y = seg.to.y;
      }

      dot.style.left = `${x - size / 2}px`;
      dot.style.top = `${y - size / 2}px`;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        dot.remove();
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function handleCatExit(cat, exitCell) {
  const side = EXIT_SIDE_BY_DIR[cat.dir];
  if (!side) return { outcome: "unknown", side };
  if (getRequirementMode() === "treats") {
    return tryCollectTreat(cat, side, exitCell);
  }
  const accepted = consumeHouseRequirement(side, cat.color);
  if (accepted) return { outcome: "accepted", side };
  if (state.waitlist.length >= WAITLIST_MAX) {
    state.gameOver = true;
    state.endState = {
      outcome: "lost",
      message: "Waitlist full. One more wrong cat escaped. You lose.",
    };
    return { outcome: "overflow", side };
  }
  state.waitlist.push(cat.color);
  return { outcome: "waitlist", side };
}

function findEligibleBoxIndex(color) {
  for (let i = 0; i < state.boxCatsBoxes.length; i++) {
    const box = state.boxCatsBoxes[i];
    if (!boxCanAcceptColor(box, color)) continue;
    return i;
  }
  return -1;
}

async function refillBoxCatsBox(index) {
  const old = state.boxCatsBoxes[index];
  if (!old) return;
  old.departing = true;
  renderHouses();
  await new Promise((resolve) => setTimeout(resolve, 320));
  state.boxCatsBoxes[index] = isBoxCatsMultiColorMode()
    ? generateBoxCatsRequirementMultiColor(index) || emptyBoxRequirement()
    : generateBoxCatsRequirementOneColor(index) || emptyBoxRequirement();
  settleBoxCatsWaitlist();
  renderHouses();
}

async function processCompletedBoxCatsBoxes() {
  for (let i = 0; i < state.boxCatsBoxes.length; i++) {
    const box = state.boxCatsBoxes[i];
    const required = boxRequirementColors(box).length;
    if (!required) continue;
    if ((box.accepted || []).length >= required) {
      await refillBoxCatsBox(i);
      i = -1;
    }
  }
}

async function handleBoxCatsExit(cat, exitCell) {
  const side = EXIT_SIDE_BY_DIR[cat.dir];
  const boxIndex = findEligibleBoxIndex(cat.color);
  const path = boxIndex >= 0 ? pathToBox(exitCell, side, boxIndex) : null;
  if (path && path.length > 1) {
    await animateRunner(cat.color, path);
    const idx = fillOneBoxFromColor(cat.color);
    if (idx >= 0) {
      renderHouses();
      const before = state.boxCatsBoxes[idx];
      if (before && before.accepted.length >= before.requirement) {
        await processCompletedBoxCatsBoxes();
        return evaluateBoxCatsEndState() || { outcome: "box-complete", boxIndex: idx };
      }
      return evaluateBoxCatsEndState() || { outcome: "boxed", boxIndex: idx };
    }
  }
  if (state.boxCatsWaitlist.length >= BOX_CATS_WAITLIST_MAX) {
    return evaluateBoxCatsEndState() || { outcome: "waitlist-full" };
  }
  state.boxCatsWaitlist.push(cat.color);
  settleBoxCatsWaitlist();
  await processCompletedBoxCatsBoxes();
  renderHouses();
  return evaluateBoxCatsEndState() || { outcome: "waitlist" };
}

function wakeGreenIfSleeping(cat) {
  if (!cat || cat.color !== "green" || !cat.sleeping) return false;
  cat.sleeping = false;
  return true;
}

async function moveCat(catId) {
  if (state.movingCats.has(catId)) return;
  const cat = state.cats.find((c) => c.id === catId);
  if (!cat) return;
  if (state.gameOver) return;
  if (!isAnyBoxCatsMode() && cat.color === "green" && cat.sleeping) {
    statusEl.textContent = "Sleeping green cats wake only when bumped.";
    return;
  }
  state.movingCats.add(catId);
  let wokeGreen = false;
  let reversedBlue = false;

  const applyBumpEffects = (blockedIds) => {
    for (const bid of blockedIds || []) {
      const blocker = state.cats.find((c) => c.id === bid);
      if (!isAnyBoxCatsMode() && wakeGreenIfSleeping(blocker)) wokeGreen = true;
      if (!isAnyBoxCatsMode() && blocker && blocker.color === "purple") {
        togglePurpleMode(blocker);
      }
    }
  };

  let stop = computeStopFor(cat, state.cats);
  const yellowJumped =
    cat.color === "yellow" && Array.isArray(stop.segments) && stop.segments.some((seg) => seg.kind === "jump");
  if (stop.escaped) {
    await playMotionSegments(cat.id, stop.segments);
    const side = EXIT_SIDE_BY_DIR[cat.dir];

    if (getRequirementMode() === "treats") {
      const result = await animateTreatModeExit(cat, catId, stop.exitHead, side);
      state.cats = state.cats.filter((c) => c.id !== cat.id);
      syncView();
      state.movingCats.delete(catId);
      const remaining = state.cats.length;
      if (state.treatsOutcome === "won") {
        statusEl.textContent = "You win! All treats delivered.";
      } else if (state.treatsOutcome === "lost") {
        statusEl.textContent = "Treat waitlist full. You lose.";
      } else if (remaining === 0) {
        statusEl.textContent = "All cats exited.";
      } else if (result.outcome === "tray-complete") {
        statusEl.textContent = `Tray ${result.trayIndex + 1} filled. New treats needed.`;
      } else if (result.outcome === "delivered") {
        statusEl.textContent = `${result.color} treat dropped on tray ${result.trayIndex + 1}.`;
      } else if (result.outcome === "waitlist") {
        statusEl.textContent = `${result.color} treat sent to waitlist.`;
      } else if (result.outcome === "waitlist-full") {
        statusEl.textContent = "Waitlist is full.";
      } else {
        statusEl.textContent = `${cat.color} cat exited (no matching road treat).`;
      }
    } else if (isAnyBoxCatsMode()) {
      state.cats = state.cats.filter((c) => c.id !== cat.id);
      syncView();
      state.movingCats.delete(catId);
      const result = await handleBoxCatsExit(cat, stop.exitHead);
      const remaining = state.cats.length;
      if (result.outcome === "won" || remaining === 0) {
        statusEl.textContent = "All cats exited the board. You win!";
      } else if (result.outcome === "lost" || result.outcome === "waitlist-full") {
        statusEl.textContent =
          "Waitlist is full and no waitlist/exitable cats can fill current boxes. You lose.";
      } else if (result.outcome === "box-complete") {
        statusEl.textContent = "Box filled and replaced with a new requirement.";
      } else if (result.outcome === "boxed") {
        statusEl.textContent = `${cat.color} cat filled a box slot.`;
      } else {
        statusEl.textContent = `${cat.color} cat routed to box waitlist.`;
      }
    } else {
      const path = pathToHouse(stop.exitHead, side);
      state.cats = state.cats.filter((c) => c.id !== cat.id);
      syncView();
      state.movingCats.delete(catId);
      animateRunner(cat.color, path).then(() => {
        const result = handleCatExit(cat, stop.exitHead);
        renderHouses();
        const remaining = state.cats.length;
        if (result.outcome === "overflow") {
          statusEl.textContent = "Waitlist full. One more wrong cat escaped. You lose.";
        } else if (remaining === 0) {
                state.gameOver = true;
                state.endState = {
                  outcome: "won",
                  message: "All cats exited. You win!",
                };
          statusEl.textContent = "All cats exited. You win!";
        } else if (result.outcome === "accepted") {
          statusEl.textContent = `${cat.color} cat entered ${side} house.`;
        } else {
          statusEl.textContent = `${cat.color} cat sent to waitlist.`;
        }
      });
    }
  } else {
    await playMotionSegments(cat.id, stop.segments);
    cat.x = stop.tail.x;
    cat.y = stop.tail.y;
    applyBumpEffects(stop.blockedIds);
    if (!isAnyBoxCatsMode() && cat.color === "brown" && (stop.blockedIds || []).length > 0) {
      const turn = brownRotateOnBump(cat);
      if (turn?.turned) await animateBrownTurn(cat.id, turn.fromDir, turn.toDir);
    }

    if (!isAnyBoxCatsMode() && cat.color === "blue" && (stop.blockedIds || []).length > 0 && !reversedBlue) {
      const reverseDir = OPPOSITE_DIR[cat.dir];
      if (reverseDir) {
        // Keep the same occupied cells when flipping direction (head/tail swap),
        // then attempt the reverse movement from that valid footprint.
        const len = catLength(cat);
        const prevDir = DIRS[cat.dir];
        cat.x += prevDir.x * (len - 1);
        cat.y += prevDir.y * (len - 1);
        cat.dir = reverseDir;
        reversedBlue = true;
        const reverseStop = computeStopFor(cat, state.cats);
        await playMotionSegments(cat.id, reverseStop.segments);
        if (reverseStop.escaped) {
          const side = EXIT_SIDE_BY_DIR[cat.dir];

          if (getRequirementMode() === "treats") {
            const result = await animateTreatModeExit(cat, catId, reverseStop.exitHead, side);
            state.cats = state.cats.filter((c) => c.id !== cat.id);
            syncView();
            state.movingCats.delete(catId);
            const remaining = state.cats.length;
            if (state.treatsOutcome === "won") {
              statusEl.textContent = "You win! All treats delivered.";
            } else if (state.treatsOutcome === "lost") {
              statusEl.textContent = "Treat waitlist full. You lose.";
            } else if (remaining === 0) {
              statusEl.textContent = "All cats exited.";
            } else if (result.outcome === "tray-complete") {
              statusEl.textContent = `Tray ${result.trayIndex + 1} filled. New treats needed.`;
            } else if (result.outcome === "delivered") {
              statusEl.textContent = `${result.color} treat dropped on tray ${result.trayIndex + 1}.`;
            } else if (result.outcome === "waitlist") {
              statusEl.textContent = `${result.color} treat sent to waitlist.`;
            } else if (result.outcome === "waitlist-full") {
              statusEl.textContent = "Waitlist is full.";
            } else {
              statusEl.textContent = "blue cat exited (no matching road treat).";
            }
          } else if (isAnyBoxCatsMode()) {
            state.cats = state.cats.filter((c) => c.id !== cat.id);
            syncView();
            state.movingCats.delete(catId);
            const result = await handleBoxCatsExit(cat, reverseStop.exitHead);
            const remaining = state.cats.length;
            if (result.outcome === "won" || remaining === 0) {
              statusEl.textContent = "All cats exited the board. You win!";
            } else if (result.outcome === "lost" || result.outcome === "waitlist-full") {
              statusEl.textContent =
                "Waitlist is full and no waitlist/exitable cats can fill current boxes. You lose.";
            } else if (result.outcome === "box-complete") {
              statusEl.textContent = "Box filled and replaced with a new requirement.";
            } else if (result.outcome === "boxed") {
              statusEl.textContent = `${cat.color} cat filled a box slot.`;
            } else {
              statusEl.textContent = `${cat.color} cat routed to box waitlist.`;
            }
          } else {
            const path = pathToHouse(reverseStop.exitHead, side);
            state.cats = state.cats.filter((c) => c.id !== cat.id);
            syncView();
            state.movingCats.delete(catId);
            animateRunner(cat.color, path).then(() => {
              const result = handleCatExit(cat, reverseStop.exitHead);
              renderHouses();
              const remaining = state.cats.length;
              if (result.outcome === "overflow") {
                statusEl.textContent = "Waitlist full. One more wrong cat escaped. You lose.";
              } else if (remaining === 0) {
                state.gameOver = true;
                state.endState = {
                  outcome: "won",
                  message: "All cats exited. You win!",
                };
                statusEl.textContent = "All cats exited. You win!";
              } else if (result.outcome === "accepted") {
                statusEl.textContent = `blue cat entered ${side} house.`;
              } else {
                statusEl.textContent = "blue cat routed to waitlist.";
              }
            });
          }
          return;
        }
        cat.x = reverseStop.tail.x;
        cat.y = reverseStop.tail.y;
        applyBumpEffects(reverseStop.blockedIds);
        if (!isAnyBoxCatsMode() && cat.color === "brown" && (reverseStop.blockedIds || []).length > 0) {
          const turn = brownRotateOnBump(cat);
          if (turn?.turned) await animateBrownTurn(cat.id, turn.fromDir, turn.toDir);
        }
        stop = reverseStop;
      }
    }

    renderCats();
    if (wokeGreen) {
      statusEl.textContent = reversedBlue
        ? "A green cat woke up. blue cat reversed and stopped."
        : `${cat.color} cat moved and woke a green cat.`;
    } else {
      statusEl.textContent = reversedBlue
        ? "blue cat reversed direction and moved."
        : yellowJumped
          ? "yellow cat jumped forward."
          : `${cat.color} cat moved and stopped by another cat.`;
    }
    state.movingCats.delete(catId);
  }

  if (!stop.escaped) {
    const remaining = state.cats.length;
    if (remaining === 0) {
      state.gameOver = true;
      state.endState = {
        outcome: "won",
        message: "All cats exited. You win!",
      };
      statusEl.textContent = "All cats exited. You win!";
    }
  }
}

function newPuzzle() {
  state.cats = generatePuzzle();
  if (getRequirementMode() === "treats") {
    initTreats(state.cats);
    statusEl.textContent = "Collect road treats to satisfy all trays.";
  } else if (isAnyBoxCatsMode()) {
    initBoxCats(state.cats);
    statusEl.textContent = isBoxCatsMultiColorMode()
      ? "Fill multi-color box slots; extras wait in queue."
      : "Fill same-color boxes from exiting cats.";
  } else {
    initHouses(state.cats);
    statusEl.textContent = "Send cats to their matching road houses.";
  }
  syncView();
}

function syncRequirementControls() {
  const mode = getRequirementMode();
  const treats = mode === "treats";
  if (gameShellEl) gameShellEl.classList.toggle("treats-mode", treats);
  if (appEl) appEl.classList.toggle("treats-mode", treats);
  if (mode === "treats" || mode === "box-cats" || mode === "box-cats-multi") {
    levelSelectEl.value = "3";
    levelSelectEl.disabled = true;
  } else {
    levelSelectEl.disabled = false;
  }
}

regenBtn.addEventListener("click", newPuzzle);
levelSelectEl.addEventListener("change", () => {
  syncRequirementControls();
  newPuzzle();
});
requirementSelectEl.addEventListener("change", () => {
  syncRequirementControls();
  newPuzzle();
});
window.addEventListener("resize", syncView);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncView);
}
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(syncView);
});
syncRequirementControls();
treatsModalBtnEl?.addEventListener("click", () => newPuzzle());
newPuzzle();
