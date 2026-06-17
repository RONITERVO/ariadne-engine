import {
  getFirebaseIdToken,
  isFirebaseConfigured,
  onFirebaseAuthStateChanged,
  signInWithGoogle,
  signOutFirebase,
  type FirebaseUser
} from './firebase';

export type StoryAtlasOptions = {
  apiBase: string;
};

type StoryMapNodeKind = 'library' | 'repo' | 'branch' | 'turn' | 'scene' | 'entity' | 'thread' | 'fact';
type StoryMapLinkKind = 'contains' | 'timeline' | 'head' | 'fork' | 'state' | 'present' | 'mentions';

type StoryMapNode = {
  id: string;
  kind: StoryMapNodeKind;
  label: string;
  summary?: string;
  parentId?: string | null;
  repoId?: string | null;
  branchId?: string | null;
  turnId?: string | null;
  weight: number;
  tags: string[];
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

type StoryMapLink = {
  id: string;
  source: string;
  target: string;
  kind: StoryMapLinkKind;
  weight: number;
};

type StoryMapRepoSummary = {
  id: string;
  title: string;
  branchCount: number;
  turnCount: number;
  entityCount: number;
  threadCount: number;
  updatedAt: string;
};

type StoryMapResponse = {
  generatedAt: string;
  rootId: string;
  nodes: StoryMapNode[];
  links: StoryMapLink[];
  repos: StoryMapRepoSummary[];
  stats: {
    repos: number;
    branches: number;
    turns: number;
    entities: number;
    threads: number;
    facts: number;
    warnings: number;
    nodes: number;
    links: number;
  };
  warnings: string[];
};

type PositionedNode = StoryMapNode & {
  x: number;
  y: number;
  r: number;
  labelVisible: boolean;
};

type ViewState = {
  cx: number;
  cy: number;
  scale: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE = {
  repoId: 'ariadne.repoId',
  branchId: 'ariadne.branchId'
} as const;

const atlasState: {
  apiBase: string;
  user: FirebaseUser | null;
  graph: StoryMapResponse | null;
  positioned: Map<string, PositionedNode>;
  selectedId: string;
  query: string;
  view: ViewState;
  currentViewBox: { x: number; y: number; width: number; height: number };
} = {
  apiBase: '',
  user: null,
  graph: null,
  positioned: new Map(),
  selectedId: '',
  query: '',
  view: { cx: 0, cy: 0, scale: 0.82 },
  currentViewBox: { x: -600, y: -400, width: 1200, height: 800 }
};

export function startStoryAtlasApp(options: StoryAtlasOptions): void {
  atlasState.apiBase = options.apiBase.replace(/\/$/, '');
  document.title = 'Ariadne Atlas';
  document.body.innerHTML = `
    <main class="atlas-shell" aria-label="Ariadne story atlas">
      <header class="atlas-header">
        <div class="atlas-title-block">
          <p class="eyebrow">Ariadne Atlas</p>
          <h1>Story galaxy</h1>
          <p class="atlas-subtitle">Repos are planets, branches are orbits, turns are stars, and world-state entities are landmarks.</p>
        </div>
        <nav class="atlas-actions" aria-label="Atlas actions">
          <a class="atlas-link" href="/">Return to story</a>
          <button id="atlas-sign-in" type="button">Sign in</button>
          <button id="atlas-sign-out" type="button" hidden>Sign out</button>
          <button id="atlas-refresh" type="button">Refresh</button>
        </nav>
      </header>

      <section class="atlas-toolbar" aria-label="Atlas controls">
        <label class="atlas-search">
          <span>Search atlas</span>
          <input id="atlas-search" type="search" placeholder="Find a story, branch, turn, character, location, fact, or thread" autocomplete="off" />
        </label>
        <div class="atlas-zoom-actions" aria-label="Zoom controls">
          <button id="atlas-zoom-out" type="button" aria-label="Zoom out">−</button>
          <button id="atlas-reset" type="button">Reset</button>
          <button id="atlas-zoom-in" type="button" aria-label="Zoom in">+</button>
        </div>
      </section>

      <section class="atlas-content">
        <section class="atlas-map-panel" aria-label="Interactive story galaxy">
          <div id="atlas-status" class="atlas-status" role="status">Loading atlas…</div>
          <div id="atlas-stats" class="atlas-stats" aria-label="Atlas summary"></div>
          <div id="atlas-map" class="atlas-map"></div>
          <div id="atlas-results" class="atlas-results" aria-live="polite"></div>
        </section>
        <aside id="atlas-detail" class="atlas-detail" aria-label="Selected atlas node"></aside>
      </section>
    </main>
  `;

  const els = atlasEls();
  els.signIn.addEventListener('click', () => void signInWithGoogle().catch(error => setAtlasStatus(messageFrom(error))));
  els.signOut.addEventListener('click', () => void signOutFirebase().catch(error => setAtlasStatus(messageFrom(error))));
  els.refresh.addEventListener('click', () => void loadAtlas());
  els.search.addEventListener('input', () => {
    atlasState.query = els.search.value.trim();
    renderSearchResults();
    updateSearchHighlight();
  });
  els.zoomIn.addEventListener('click', () => zoomAtlas(1.2));
  els.zoomOut.addEventListener('click', () => zoomAtlas(1 / 1.2));
  els.reset.addEventListener('click', () => resetAtlasView());

  if (isFirebaseConfigured()) {
    onFirebaseAuthStateChanged(user => {
      atlasState.user = user;
      renderAuthActions();
      void loadAtlas();
    });
  } else {
    renderAuthActions();
    void loadAtlas();
  }
}

async function loadAtlas(): Promise<void> {
  setAtlasStatus('Loading atlas…');
  try {
    const graph = await atlasFetch<StoryMapResponse>('/v1/story-map');
    atlasState.graph = graph;
    atlasState.positioned = layoutGraph(graph);
    atlasState.selectedId = graph.rootId;
    renderAtlasStats(graph);
    renderAtlasMap(graph);
    renderSearchResults();
    renderDetail(graph.rootId);
    setAtlasStatus(graph.nodes.length ? `Loaded ${graph.nodes.length} nodes.` : 'No saved story graph yet.');
  } catch (error) {
    atlasState.graph = null;
    atlasState.positioned = new Map();
    atlasEls().map.replaceChildren(emptyAtlasState(messageFrom(error)));
    renderAtlasStats(null);
    renderDetail('');
    setAtlasStatus(messageFrom(error));
  }
}

async function atlasFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getFirebaseIdToken().catch(() => '');
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${atlasState.apiBase}${path}`, { method: 'GET', headers });
  const payload = await response.json().catch(() => ({})) as { message?: unknown; error?: unknown };
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `Request failed with ${response.status}`));
  return payload as T;
}

function renderAuthActions(): void {
  const els = atlasEls();
  const configured = isFirebaseConfigured();
  els.signIn.hidden = !configured || Boolean(atlasState.user);
  els.signOut.hidden = !configured || !atlasState.user;
}

function renderAtlasStats(graph: StoryMapResponse | null): void {
  const stats = atlasEls().stats;
  if (!graph) {
    stats.replaceChildren();
    return;
  }
  const items: Array<[string, number]> = [
    ['Repos', graph.stats.repos],
    ['Branches', graph.stats.branches],
    ['Turns', graph.stats.turns],
    ['Entities', graph.stats.entities],
    ['Threads', graph.stats.threads],
    ['Facts', graph.stats.facts]
  ];
  stats.replaceChildren(...items.map(([label, value]) => statPill(label, value)));
}

function statPill(label: string, value: number): HTMLElement {
  const item = document.createElement('div');
  item.className = 'atlas-stat';
  const strong = document.createElement('strong');
  strong.textContent = String(value);
  const span = document.createElement('span');
  span.textContent = label;
  item.append(strong, span);
  return item;
}

function renderAtlasMap(graph: StoryMapResponse): void {
  const map = atlasEls().map;
  map.replaceChildren();
  if (graph.nodes.length <= 1) {
    map.append(emptyAtlasState('No story repos yet. Start a story, then return to the Atlas.'));
    return;
  }

  const svg = svgEl('svg');
  svg.classList.add('atlas-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Interactive map of story repos, branches, turns, and world-state landmarks');

  const linkLayer = svgEl('g');
  linkLayer.classList.add('atlas-link-layer');
  for (const link of graph.links) {
    const source = atlasState.positioned.get(link.source);
    const target = atlasState.positioned.get(link.target);
    if (!source || !target) continue;
    const path = svgEl('path');
    path.classList.add('atlas-edge', `atlas-edge--${link.kind}`);
    path.dataset.source = link.source;
    path.dataset.target = link.target;
    path.setAttribute('d', linkPath(source, target, link.kind));
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    linkLayer.append(path);
  }

  const nodeLayer = svgEl('g');
  nodeLayer.classList.add('atlas-node-layer');
  for (const node of atlasState.positioned.values()) {
    nodeLayer.append(renderNode(node));
  }

  svg.append(linkLayer, nodeLayer);
  map.append(svg);
  wirePanZoom(svg);
  applyAtlasView(svg);
  updateSearchHighlight();
}

function renderNode(node: PositionedNode): SVGGElement {
  const group = svgEl('g');
  group.classList.add('atlas-node', `atlas-node--${node.kind}`);
  group.dataset.nodeId = node.id;
  group.setAttribute('transform', `translate(${round(node.x)} ${round(node.y)})`);
  group.setAttribute('role', 'button');
  group.setAttribute('tabindex', '0');
  group.setAttribute('aria-label', `${node.kind}: ${node.label}`);

  if (node.kind === 'repo') {
    group.append(repoPlanet(node));
  } else if (node.kind === 'library') {
    group.append(starShape(node.r));
  } else {
    const circle = svgEl('circle');
    circle.setAttribute('r', String(node.r));
    circle.classList.add('atlas-node-core');
    group.append(circle);
  }

  const ring = svgEl('circle');
  ring.classList.add('atlas-node-ring');
  ring.setAttribute('r', String(node.r + 5));
  group.append(ring);

  if (node.labelVisible) {
    const text = svgEl('text');
    text.classList.add('atlas-node-label');
    text.setAttribute('y', String(node.r + 18));
    text.setAttribute('text-anchor', 'middle');
    text.textContent = node.label;
    group.append(text);
  }

  group.addEventListener('click', event => {
    event.stopPropagation();
    selectNode(node.id, true);
  });
  group.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(node.id, true);
    }
  });
  return group;
}

function repoPlanet(node: PositionedNode): SVGGElement {
  const group = svgEl('g');
  const ocean = svgEl('circle');
  ocean.classList.add('atlas-node-core');
  ocean.setAttribute('r', String(node.r));
  group.append(ocean);

  const continentCount = 3 + (hashNumber(node.id) % 3);
  for (let i = 0; i < continentCount; i += 1) {
    const continent = svgEl('path');
    continent.classList.add('atlas-continent');
    continent.setAttribute('d', continentPath(node.r, node.id, i));
    group.append(continent);
  }
  return group;
}

function starShape(radius: number): SVGPathElement {
  const points: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 16;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    points.push(`${round(Math.cos(angle) * r)},${round(Math.sin(angle) * r)}`);
  }
  const path = svgEl('path');
  path.classList.add('atlas-node-core', 'atlas-star-core');
  path.setAttribute('d', `M${points.join('L')}Z`);
  return path;
}

function continentPath(radius: number, seed: string, index: number): string {
  const angle = ((hashNumber(`${seed}:${index}`) % 360) * Math.PI) / 180;
  const distance = radius * (0.16 + ((hashNumber(`${seed}:d:${index}`) % 34) / 100));
  const cx = Math.cos(angle) * distance;
  const cy = Math.sin(angle) * distance;
  const size = radius * (0.2 + ((hashNumber(`${seed}:s:${index}`) % 20) / 100));
  const wobble = 0.68 + ((hashNumber(`${seed}:w:${index}`) % 22) / 100);
  const points: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = angle + (i * Math.PI * 2) / 8;
    const r = size * (i % 2 === 0 ? 1 : wobble);
    points.push(`${round(cx + Math.cos(a) * r)},${round(cy + Math.sin(a) * r)}`);
  }
  return `M${points.join('L')}Z`;
}

function linkPath(source: PositionedNode, target: PositionedNode, kind: StoryMapLinkKind): string {
  if (kind === 'timeline') {
    const mx = (source.x + target.x) / 2;
    const my = (source.y + target.y) / 2 - 18;
    return `M${round(source.x)} ${round(source.y)} Q${round(mx)} ${round(my)} ${round(target.x)} ${round(target.y)}`;
  }
  if (kind === 'fork') {
    const mx = (source.x + target.x) / 2 + 28;
    const my = (source.y + target.y) / 2 + 28;
    return `M${round(source.x)} ${round(source.y)} Q${round(mx)} ${round(my)} ${round(target.x)} ${round(target.y)}`;
  }
  return `M${round(source.x)} ${round(source.y)} L${round(target.x)} ${round(target.y)}`;
}

function layoutGraph(graph: StoryMapResponse): Map<string, PositionedNode> {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const positioned = new Map<string, PositionedNode>();
  const root = byId.get(graph.rootId) ?? graph.nodes[0];
  if (root) positioned.set(root.id, withPosition(root, 0, 0, radiusFor(root), true));

  const repos = graph.nodes.filter(node => node.kind === 'repo').sort(sortByUpdatedThenLabel);
  const repoRing = Math.max(260, 170 + repos.length * 46);
  for (let i = 0; i < repos.length; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, repos.length);
    const wobble = 1 + (((hashNumber(repos[i].id) % 17) - 8) / 100);
    positioned.set(repos[i].id, withPosition(repos[i], Math.cos(angle) * repoRing * wobble, Math.sin(angle) * repoRing * wobble, radiusFor(repos[i]), true));
  }

  for (const repo of repos) {
    const repoPos = positioned.get(repo.id);
    if (!repoPos) continue;
    const branches = graph.nodes
      .filter(node => node.kind === 'branch' && node.parentId === repo.id)
      .sort((a, b) => (a.label === 'main' ? -1 : b.label === 'main' ? 1 : sortByUpdatedThenLabel(a, b)));
    const baseAngle = Math.atan2(repoPos.y, repoPos.x);
    const orbit = repoPos.r + 95 + Math.min(60, branches.length * 8);
    for (let i = 0; i < branches.length; i += 1) {
      const spread = branches.length === 1 ? 0 : (i / branches.length) * Math.PI * 2;
      const angle = baseAngle + spread + 0.45;
      const radius = orbit + (i % 2) * 24;
      positioned.set(branches[i].id, withPosition(branches[i], repoPos.x + Math.cos(angle) * radius, repoPos.y + Math.sin(angle) * radius, radiusFor(branches[i]), branches.length <= 8));
    }
  }

  const branches = graph.nodes.filter(node => node.kind === 'branch');
  for (const branch of branches) {
    const branchPos = positioned.get(branch.id);
    if (!branchPos) continue;
    const repoPos = branch.parentId ? positioned.get(branch.parentId) : null;
    const armAngle = repoPos ? Math.atan2(branchPos.y - repoPos.y, branchPos.x - repoPos.x) : hashAngle(branch.id);
    layoutTurns(graph, positioned, branch, branchPos, armAngle);
    layoutStateNodes(graph, positioned, branch, branchPos, armAngle);
  }

  for (const node of graph.nodes) {
    if (!positioned.has(node.id)) {
      const angle = hashAngle(node.id);
      const distance = 420 + (hashNumber(node.id) % 260);
      positioned.set(node.id, withPosition(node, Math.cos(angle) * distance, Math.sin(angle) * distance, radiusFor(node), false));
    }
  }

  return positioned;
}

function layoutTurns(
  graph: StoryMapResponse,
  positioned: Map<string, PositionedNode>,
  branch: StoryMapNode,
  branchPos: PositionedNode,
  armAngle: number
): void {
  const turns = graph.nodes
    .filter(node => node.kind === 'turn' && node.branchId === branch.branchId)
    .sort((a, b) => numberFrom(a.meta?.turnIndex) - numberFrom(b.meta?.turnIndex));
  for (let i = 0; i < turns.length; i += 1) {
    const curve = (i - (turns.length - 1) / 2) * 0.035;
    const distance = 58 + i * 22;
    const angle = armAngle + curve;
    positioned.set(turns[i].id, withPosition(turns[i], branchPos.x + Math.cos(angle) * distance, branchPos.y + Math.sin(angle) * distance, radiusFor(turns[i]), i === turns.length - 1 || turns.length <= 10));
  }
}

function layoutStateNodes(
  graph: StoryMapResponse,
  positioned: Map<string, PositionedNode>,
  branch: StoryMapNode,
  branchPos: PositionedNode,
  armAngle: number
): void {
  const scene = graph.nodes.find(node => node.kind === 'scene' && node.branchId === branch.branchId);
  if (scene) {
    positioned.set(scene.id, withPosition(scene, branchPos.x + Math.cos(armAngle + Math.PI / 2) * 62, branchPos.y + Math.sin(armAngle + Math.PI / 2) * 62, radiusFor(scene), true));
  }

  const stateNodes = graph.nodes
    .filter(node => ['entity', 'thread', 'fact'].includes(node.kind) && node.branchId === branch.branchId)
    .sort((a, b) => stateKindRank(a.kind) - stateKindRank(b.kind) || a.label.localeCompare(b.label));
  const groups = new Map<StoryMapNodeKind, StoryMapNode[]>();
  for (const node of stateNodes) {
    const list = groups.get(node.kind) ?? [];
    list.push(node);
    groups.set(node.kind, list);
  }
  for (const [kind, nodes] of groups) {
    const ring = kind === 'entity' ? 112 : kind === 'thread' ? 154 : 195;
    const offset = kind === 'entity' ? Math.PI / 2 : kind === 'thread' ? -Math.PI / 2 : Math.PI;
    for (let i = 0; i < nodes.length; i += 1) {
      const angle = armAngle + offset + (i * Math.PI * 2) / Math.max(1, nodes.length);
      const distance = ring + (i % 3) * 10;
      positioned.set(nodes[i].id, withPosition(nodes[i], branchPos.x + Math.cos(angle) * distance, branchPos.y + Math.sin(angle) * distance, radiusFor(nodes[i]), nodes.length <= 12));
    }
  }
}

function withPosition(node: StoryMapNode, x: number, y: number, r: number, labelVisible: boolean): PositionedNode {
  return { ...node, x, y, r, labelVisible };
}

function radiusFor(node: StoryMapNode): number {
  const base: Record<StoryMapNodeKind, number> = {
    library: 42,
    repo: 34,
    branch: 18,
    turn: 7,
    scene: 14,
    entity: 11,
    thread: 10,
    fact: 7
  };
  return Math.max(5, base[node.kind] + Math.sqrt(Math.max(1, node.weight)) * 2.2);
}

function selectNode(nodeId: string, center: boolean): void {
  if (!atlasState.graph || !atlasState.positioned.has(nodeId)) return;
  atlasState.selectedId = nodeId;
  document.querySelectorAll<SVGGElement>('.atlas-node.is-selected').forEach(node => node.classList.remove('is-selected'));
  document.querySelector<SVGGElement>(`.atlas-node[data-node-id="${cssEscape(nodeId)}"]`)?.classList.add('is-selected');
  renderDetail(nodeId);
  if (center) centerOnNode(nodeId);
}

function centerOnNode(nodeId: string): void {
  const node = atlasState.positioned.get(nodeId);
  const svg = document.querySelector<SVGSVGElement>('.atlas-svg');
  if (!node || !svg) return;
  atlasState.view.cx = node.x;
  atlasState.view.cy = node.y;
  atlasState.view.scale = Math.max(atlasState.view.scale, node.kind === 'repo' ? 1.1 : 1.55);
  applyAtlasView(svg);
}

function renderDetail(nodeId: string): void {
  const detail = atlasEls().detail;
  const graph = atlasState.graph;
  const node = graph?.nodes.find(item => item.id === nodeId) ?? null;
  if (!graph || !node) {
    detail.replaceChildren(detailEmpty());
    return;
  }

  const header = document.createElement('div');
  header.className = 'atlas-detail-header';
  const kicker = document.createElement('span');
  kicker.textContent = node.kind;
  const title = document.createElement('h2');
  title.textContent = node.label;
  header.append(kicker, title);

  const body = document.createElement('div');
  body.className = 'atlas-detail-body';
  if (node.summary) {
    const summary = document.createElement('p');
    summary.textContent = node.summary;
    body.append(summary);
  }
  if (node.tags.length) body.append(tagList(node.tags));

  const meta = metaList(node);
  if (meta) body.append(meta);

  const continueTarget = continueTargetFor(node, graph);
  if (continueTarget) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'atlas-primary-action';
    action.textContent = 'Continue this branch';
    action.addEventListener('click', () => continueBranch(continueTarget.repoId, continueTarget.branchId));
    body.append(action);
  }

  const neighbors = neighborList(node, graph);
  if (neighbors) body.append(neighbors);

  if (node.kind === 'library' && graph.warnings.length) {
    const warningBlock = document.createElement('details');
    warningBlock.className = 'atlas-warning-list';
    const summary = document.createElement('summary');
    summary.textContent = `${graph.warnings.length} atlas warning${graph.warnings.length === 1 ? '' : 's'}`;
    const list = document.createElement('ul');
    for (const warning of graph.warnings.slice(0, 20)) {
      const item = document.createElement('li');
      item.textContent = warning;
      list.append(item);
    }
    warningBlock.append(summary, list);
    body.append(warningBlock);
  }

  detail.replaceChildren(header, body);
}

function continueTargetFor(node: StoryMapNode, graph: StoryMapResponse): { repoId: string; branchId: string } | null {
  if (node.repoId && node.branchId) return { repoId: node.repoId, branchId: node.branchId };
  if (node.kind === 'repo' && node.repoId) {
    const branch = graph.nodes
      .filter(item => item.kind === 'branch' && item.repoId === node.repoId && item.branchId)
      .sort((a, b) => (a.label === 'main' ? -1 : b.label === 'main' ? 1 : sortByUpdatedThenLabel(a, b)))[0];
    if (branch?.branchId) return { repoId: node.repoId, branchId: branch.branchId };
  }
  return null;
}

function continueBranch(repoId: string, branchId: string): void {
  sessionStorage.setItem(STORAGE.repoId, repoId);
  sessionStorage.setItem(STORAGE.branchId, branchId);
  window.location.href = '/';
}

function tagList(tags: string[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-tags';
  for (const tag of tags.slice(0, 12)) {
    const chip = document.createElement('span');
    chip.textContent = tag;
    wrap.append(chip);
  }
  return wrap;
}

function metaList(node: StoryMapNode): HTMLElement | null {
  const entries = Object.entries(node.meta ?? {}).filter(([, value]) => value !== null && value !== '');
  const timeEntries: Array<[string, string | null | undefined]> = [
    ['Created', node.createdAt],
    ['Updated', node.updatedAt],
    ['Status', node.status ?? undefined]
  ];
  const all = [
    ...timeEntries.filter(([, value]) => value),
    ...entries.map(([key, value]) => [labelize(key), String(value)] as [string, string])
  ].slice(0, 14);
  if (!all.length) return null;
  const list = document.createElement('dl');
  list.className = 'atlas-meta-list';
  for (const [key, value] of all) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = key === 'Created' || key === 'Updated' ? formatDate(value) : String(value);
    list.append(dt, dd);
  }
  return list;
}

function neighborList(node: StoryMapNode, graph: StoryMapResponse): HTMLElement | null {
  const linkedIds = graph.links
    .filter(link => link.source === node.id || link.target === node.id)
    .map(link => link.source === node.id ? link.target : link.source)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 10);
  if (!linkedIds.length) return null;
  const block = document.createElement('section');
  block.className = 'atlas-neighbors';
  const heading = document.createElement('h3');
  heading.textContent = 'Nearby';
  const list = document.createElement('div');
  for (const linkedId of linkedIds) {
    const linked = graph.nodes.find(item => item.id === linkedId);
    if (!linked) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${linked.kind}: ${linked.label}`;
    button.addEventListener('click', () => selectNode(linked.id, true));
    list.append(button);
  }
  block.append(heading, list);
  return block;
}

function detailEmpty(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'atlas-detail-empty';
  empty.textContent = 'Select a planet, branch, turn, or landmark.';
  return empty;
}

function renderSearchResults(): void {
  const results = atlasEls().results;
  const graph = atlasState.graph;
  const query = atlasState.query.toLowerCase();
  if (!graph || !query) {
    results.replaceChildren();
    return;
  }
  const hits = graph.nodes
    .filter(node => nodeMatches(node, query))
    .sort((a, b) => searchRank(a) - searchRank(b) || a.label.localeCompare(b.label))
    .slice(0, 12);
  if (!hits.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No matches.';
    results.replaceChildren(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'atlas-result-list';
  for (const hit of hits) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector('strong')!.textContent = hit.label;
    button.querySelector('span')!.textContent = hit.kind;
    button.addEventListener('click', () => selectNode(hit.id, true));
    list.append(button);
  }
  results.replaceChildren(list);
}

function updateSearchHighlight(): void {
  const query = atlasState.query.toLowerCase();
  const graph = atlasState.graph;
  const nodes = document.querySelectorAll<SVGGElement>('.atlas-node');
  const edges = document.querySelectorAll<SVGPathElement>('.atlas-edge');
  if (!graph || !query) {
    nodes.forEach(node => node.classList.remove('is-dim', 'is-hit'));
    edges.forEach(edge => edge.classList.remove('is-dim', 'is-hit'));
    selectNode(atlasState.selectedId || graph?.rootId || '', false);
    return;
  }
  const hitIds = new Set(graph.nodes.filter(node => nodeMatches(node, query)).map(node => node.id));
  nodes.forEach(node => {
    const hit = hitIds.has(node.dataset.nodeId ?? '');
    node.classList.toggle('is-hit', hit);
    node.classList.toggle('is-dim', !hit);
  });
  edges.forEach(edge => {
    const hit = hitIds.has(edge.dataset.source ?? '') || hitIds.has(edge.dataset.target ?? '');
    edge.classList.toggle('is-hit', hit);
    edge.classList.toggle('is-dim', !hit);
  });
}

function nodeMatches(node: StoryMapNode, query: string): boolean {
  const haystack = [node.id, node.kind, node.label, node.summary ?? '', node.status ?? '', ...node.tags, ...Object.values(node.meta ?? {}).map(String)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function searchRank(node: StoryMapNode): number {
  const order: Record<StoryMapNodeKind, number> = {
    library: 0,
    repo: 1,
    branch: 2,
    scene: 3,
    entity: 4,
    thread: 5,
    turn: 6,
    fact: 7
  };
  return order[node.kind];
}

function wirePanZoom(svg: SVGSVGElement): void {
  let drag: { pointerId: number; startX: number; startY: number; cx: number; cy: number } | null = null;
  svg.addEventListener('pointerdown', event => {
    if ((event.target as Element).closest('.atlas-node')) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cx: atlasState.view.cx, cy: atlasState.view.cy };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-panning');
  });
  svg.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    atlasState.view.cx = drag.cx - (event.clientX - drag.startX) / atlasState.view.scale;
    atlasState.view.cy = drag.cy - (event.clientY - drag.startY) / atlasState.view.scale;
    applyAtlasView(svg);
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    svg.classList.remove('is-panning');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const before = screenToWorld(svg, event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    atlasState.view.scale = clamp(atlasState.view.scale * factor, 0.22, 4.5);
    applyAtlasView(svg);
    const after = screenToWorld(svg, event.clientX, event.clientY);
    atlasState.view.cx += before.x - after.x;
    atlasState.view.cy += before.y - after.y;
    applyAtlasView(svg);
  }, { passive: false });
  window.addEventListener('resize', () => applyAtlasView(svg));
}

function zoomAtlas(factor: number): void {
  const svg = document.querySelector<SVGSVGElement>('.atlas-svg');
  if (!svg) return;
  atlasState.view.scale = clamp(atlasState.view.scale * factor, 0.22, 4.5);
  applyAtlasView(svg);
}

function resetAtlasView(): void {
  const svg = document.querySelector<SVGSVGElement>('.atlas-svg');
  atlasState.view = { cx: 0, cy: 0, scale: 0.82 };
  if (svg) applyAtlasView(svg);
}

function applyAtlasView(svg: SVGSVGElement): void {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(320, rect.width || 1200);
  const height = Math.max(320, rect.height || 760);
  const viewWidth = width / atlasState.view.scale;
  const viewHeight = height / atlasState.view.scale;
  const box = {
    x: atlasState.view.cx - viewWidth / 2,
    y: atlasState.view.cy - viewHeight / 2,
    width: viewWidth,
    height: viewHeight
  };
  atlasState.currentViewBox = box;
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
}

function screenToWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const box = atlasState.currentViewBox;
  return {
    x: box.x + ((clientX - rect.left) / Math.max(1, rect.width)) * box.width,
    y: box.y + ((clientY - rect.top) / Math.max(1, rect.height)) * box.height
  };
}

function emptyAtlasState(message: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'atlas-empty';
  const title = document.createElement('h2');
  title.textContent = 'The galaxy is empty';
  const copy = document.createElement('p');
  copy.textContent = message;
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Start or continue a story';
  empty.append(title, copy, link);
  return empty;
}

function setAtlasStatus(text: string): void {
  atlasEls().status.textContent = text;
}

function atlasEls(): {
  signIn: HTMLButtonElement;
  signOut: HTMLButtonElement;
  refresh: HTMLButtonElement;
  search: HTMLInputElement;
  zoomIn: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  reset: HTMLButtonElement;
  status: HTMLElement;
  stats: HTMLElement;
  map: HTMLElement;
  results: HTMLElement;
  detail: HTMLElement;
} {
  return {
    signIn: byId<HTMLButtonElement>('atlas-sign-in'),
    signOut: byId<HTMLButtonElement>('atlas-sign-out'),
    refresh: byId<HTMLButtonElement>('atlas-refresh'),
    search: byId<HTMLInputElement>('atlas-search'),
    zoomIn: byId<HTMLButtonElement>('atlas-zoom-in'),
    zoomOut: byId<HTMLButtonElement>('atlas-zoom-out'),
    reset: byId<HTMLButtonElement>('atlas-reset'),
    status: byId<HTMLElement>('atlas-status'),
    stats: byId<HTMLElement>('atlas-stats'),
    map: byId<HTMLElement>('atlas-map'),
    results: byId<HTMLElement>('atlas-results'),
    detail: byId<HTMLElement>('atlas-detail')
  };
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function sortByUpdatedThenLabel(a: StoryMapNode, b: StoryMapNode): number {
  return dateValue(b.updatedAt) - dateValue(a.updatedAt) || a.label.localeCompare(b.label);
}

function stateKindRank(kind: StoryMapNodeKind): number {
  if (kind === 'entity') return 0;
  if (kind === 'thread') return 1;
  if (kind === 'fact') return 2;
  return 9;
}

function numberFrom(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) || 0 : 0;
}

function hashAngle(value: string): number {
  return ((hashNumber(value) % 360) * Math.PI) / 180;
}

function hashNumber(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function labelize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/^./, first => first.toUpperCase());
}

function formatDate(value: unknown): string {
  if (!value || typeof value !== 'string') return '-';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message);
  return 'Unexpected error.';
}
