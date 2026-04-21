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

function getSelectedLevel() {
  const n = Number(levelSelectEl?.value);
  if (n >= 1 && n <= 5) return n;
  return 5;
}

function getActiveColorPool() {
  return LEVEL_COLOR_POOLS[getSelectedLevel()] ?? LEVEL_COLOR_POOLS[5];
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

const state = {
  cats: [],
  houses: {},
  waitlist: [],
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
        if (random(2) === 0) {
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
        const extra = {
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
  state.waitlist = [];
  state.houses = {};
  for (const side of HOUSE_ORDER) {
    state.houses[side] = {
      requirement: generateRequirement(side, cats),
      accepted: [],
    };
  }
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
  const availLeft = playfieldRect.width * BOARD_PADDING.left;
  const availRight = playfieldRect.width * (1 - BOARD_PADDING.right);
  const availTop = playfieldRect.height * BOARD_PADDING.top;
  const availBottom = playfieldRect.height * (1 - BOARD_PADDING.bottom);
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
    if (cat.color === "green" && cat.sleeping) {
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

  if (cat.color !== "yellow") {
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

function pathToHouse(exitCell, side) {
  const start = gridCellCenter(exitCell);
  const box = roadBox();
  const target = houseCenter(side);
  const points = [start];

  const edgeBySide = {
    left: { x: box.left, y: start.y },
    right: { x: box.right, y: start.y },
    top: { x: start.x, y: box.top },
    bottom: { x: start.x, y: box.bottom },
  };
  const edge = edgeBySide[side] || start;
  points.push(edge);
  if (side === "top" || side === "bottom") {
    points.push({ x: target.x, y: edge.y });
  } else {
    points.push({ x: edge.x, y: target.y });
  }
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

function handleCatExit(cat) {
  const side = EXIT_SIDE_BY_DIR[cat.dir];
  if (!side) return { outcome: "unknown", side };
  const accepted = consumeHouseRequirement(side, cat.color);
  if (accepted) return { outcome: "accepted", side };
  if (state.waitlist.length >= WAITLIST_MAX) {
    state.gameOver = true;
    return { outcome: "overflow", side };
  }
  state.waitlist.push(cat.color);
  return { outcome: "waitlist", side };
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
  if (cat.color === "green" && cat.sleeping) {
    statusEl.textContent = "Sleeping green cats wake only when bumped.";
    return;
  }
  state.movingCats.add(catId);
  let wokeGreen = false;
  let reversedBlue = false;

  const applyBumpEffects = (blockedIds) => {
    for (const bid of blockedIds || []) {
      const blocker = state.cats.find((c) => c.id === bid);
      if (wakeGreenIfSleeping(blocker)) wokeGreen = true;
      if (blocker && blocker.color === "purple") {
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
    const path = pathToHouse(stop.exitHead, side);
    state.cats = state.cats.filter((c) => c.id !== cat.id);
    syncView();
    state.movingCats.delete(catId);
    animateRunner(cat.color, path).then(() => {
      const result = handleCatExit(cat);
      renderHouses();
      const remaining = state.cats.length;
      if (result.outcome === "overflow") {
        statusEl.textContent = "Waitlist full. One more wrong cat escaped. You lose.";
      } else if (remaining === 0) {
        statusEl.textContent = "All cats exited. You win!";
      } else if (result.outcome === "accepted") {
        statusEl.textContent = `${cat.color} cat entered ${side} house.`;
      } else {
        statusEl.textContent = `${cat.color} cat sent to waitlist.`;
      }
    });
  } else {
    await playMotionSegments(cat.id, stop.segments);
    cat.x = stop.tail.x;
    cat.y = stop.tail.y;
    applyBumpEffects(stop.blockedIds);
    if (cat.color === "brown" && (stop.blockedIds || []).length > 0) {
      const turn = brownRotateOnBump(cat);
      if (turn?.turned) await animateBrownTurn(cat.id, turn.fromDir, turn.toDir);
    }

    if (cat.color === "blue" && (stop.blockedIds || []).length > 0 && !reversedBlue) {
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
          const path = pathToHouse(reverseStop.exitHead, side);
          state.cats = state.cats.filter((c) => c.id !== cat.id);
          syncView();
          state.movingCats.delete(catId);
          animateRunner(cat.color, path).then(() => {
            const result = handleCatExit(cat);
            renderHouses();
            const remaining = state.cats.length;
            if (result.outcome === "overflow") {
              statusEl.textContent = "Waitlist full. One more wrong cat escaped. You lose.";
            } else if (remaining === 0) {
              statusEl.textContent = "All cats exited. You win!";
            } else if (result.outcome === "accepted") {
              statusEl.textContent = `blue cat entered ${side} house.`;
            } else {
              statusEl.textContent = "blue cat routed to waitlist.";
            }
          });
          return;
        }
        cat.x = reverseStop.tail.x;
        cat.y = reverseStop.tail.y;
        applyBumpEffects(reverseStop.blockedIds);
        if (cat.color === "brown" && (reverseStop.blockedIds || []).length > 0) {
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
      statusEl.textContent = "All cats exited. You win!";
    }
  }
}

function newPuzzle() {
  state.cats = generatePuzzle();
  initHouses(state.cats);
  statusEl.textContent = "Send cats to their matching road houses.";
  syncView();
}

regenBtn.addEventListener("click", newPuzzle);
levelSelectEl.addEventListener("change", newPuzzle);
window.addEventListener("resize", syncView);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncView);
}
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(syncView);
});
newPuzzle();
