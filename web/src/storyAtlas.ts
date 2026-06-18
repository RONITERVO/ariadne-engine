import * as THREE from 'three';

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

type PublicConfig = {
  defaultStoryTitle: string;
  defaultStoryStyle: string;
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

type TimelineTurn = {
  id: string;
  turnIndex?: number;
  userTranscript?: string;
  assistantTranscript?: string;
  createdAt?: string;
  committedAt?: string | null;
  stateStatus?: string;
};

type BranchTimelineResponse = {
  branchId: string;
  timeline: TimelineTurn[];
  state?: unknown;
};

type ForkBranchResponse = {
  branch: {
    id: string;
    repoId: string;
    name: string;
    headTurnId?: string | null;
  };
};

type CreateRepoResponse = {
  repo: { id: string };
  branch: { id: string };
};

type StorySearchResult = {
  id: string;
  kind: StoryMapNodeKind;
  repoId: string;
  repoTitle: string;
  branchId?: string;
  branchName?: string;
  turnId?: string;
  turnIndex?: number;
  label: string;
  excerpt: string;
  score: number;
  matchedTerms: string[];
  rewindMode: 'before' | 'at';
  forkSourceTurnId?: string | null;
  forkLabel?: string;
  createdAt?: string | null;
};

type StorySearchResponse = {
  query: string;
  generatedAt: string;
  results: StorySearchResult[];
};

type TimelineTurnSummary = {
  id: string;
  turnIndex: number;
  userTranscript: string;
  assistantTranscript: string;
  stateStatus: string;
  parentTurnId?: string | null;
  createdAt: string;
};

type BranchCompareResponse = {
  generatedAt: string;
  repoId: string;
  commonAncestorTurnId: string | null;
  commonAncestorTurnIndex: number | null;
  left: {
    branch: { id: string; name: string; headTurnId?: string | null };
    totalTurns: number;
    uniqueTurns: TimelineTurnSummary[];
    sceneSummary?: string | null;
  };
  right: {
    branch: { id: string; name: string; headTurnId?: string | null };
    totalTurns: number;
    uniqueTurns: TimelineTurnSummary[];
    sceneSummary?: string | null;
  };
  stateDiff: {
    sceneChanged: boolean;
    entities: { leftOnly: string[]; rightOnly: string[]; changed: Array<{ id: string }> };
    facts: { leftOnly: unknown[]; rightOnly: unknown[] };
    threads: { leftOnly: unknown[]; rightOnly: unknown[]; changed: Array<{ id: string }> };
  };
};

type CanonDebugResponse = {
  generatedAt: string;
  branch: { id: string; name: string; headTurnId?: string | null };
  state: {
    scene?: { summary?: string; locationId?: string; presentEntityIds?: string[]; tone?: string };
    entities?: Record<string, unknown>;
    facts?: unknown[];
    threads?: Array<{ threadId?: string; status?: string; summary?: string; priority?: number }>;
    contextBudget?: { mode?: string; estimatedTokens?: number; safeBudgetTokens?: number; remainingTurnBudget?: number };
  } | null;
  latestTurn: TimelineTurnSummary | null;
  stats: {
    turns: number;
    entities: number;
    facts: number;
    threads: number;
    openThreads: number;
    resolvedThreads: number;
    audioAssets: number;
  };
  openThreads: Array<{ threadId?: string; status?: string; summary?: string; priority?: number }>;
  audioAssets: unknown[];
};

type CosmicScaleKey = 'observable' | 'supercluster' | 'galactic' | 'stellar' | 'landmark';
type AtlasFilterKey = 'all' | 'current-branch' | 'heads' | 'open-threads' | 'canon';

type CosmicScale = {
  key: CosmicScaleKey;
  label: string;
  eyebrow: string;
  hint: string;
  distance: number;
  rank: number;
  kinds: StoryMapNodeKind[];
};

type PositionedNode = StoryMapNode & {
  x: number;
  y: number;
  z: number;
  r: number;
  baseR: number;
  labelVisible: boolean;
  angle: number;
  orbitSpeed: number;
  scale: CosmicScaleKey;
  scaleRank: number;
};

type OrbitRing = {
  cx: number;
  cy: number;
  cz: number;
  r: number;
  kind: CosmicScaleKey;
  tilt: number;
  spin: number;
};

type ViewState = {
  cx: number;
  cy: number;
  cz: number;
  distance: number;
  yaw: number;
  pitch: number;
};

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type ActivePointer = {
  pointerId: number;
  pointerType: string;
  button: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

type CameraGesture = {
  mode: 'orbit' | 'pan' | 'pinch';
  pointerId: number | null;
  startView: ViewState;
  startX: number;
  startY: number;
  startDistance: number;
  startAngle: number;
  moved: boolean;
  lastYaw: number;
  lastPitch: number;
  lastFocus: Vec3;
};

const COSMIC_SCALES: CosmicScale[] = [
  {
    key: 'observable',
    label: 'Observable Universe',
    eyebrow: 'All story space',
    hint: 'Every repo as one navigable universe.',
    distance: 2300,
    rank: 0,
    kinds: ['library']
  },
  {
    key: 'supercluster',
    label: 'Superclusters & Filaments',
    eyebrow: 'Story worlds',
    hint: 'Repos become luminous superclusters connected by canon filaments.',
    distance: 1350,
    rank: 1,
    kinds: ['repo']
  },
  {
    key: 'galactic',
    label: 'Galaxies & Local',
    eyebrow: 'Branches',
    hint: 'Branch timelines become galaxies and local groups.',
    distance: 720,
    rank: 2,
    kinds: ['branch']
  },
  {
    key: 'stellar',
    label: 'Solar Systems & Stars',
    eyebrow: 'Turns',
    hint: 'Committed turns glow as stars along each timeline arm.',
    distance: 380,
    rank: 3,
    kinds: ['turn', 'scene']
  },
  {
    key: 'landmark',
    label: 'Planets, Moons & Signals',
    eyebrow: 'Canon detail',
    hint: 'Scenes, entities, threads, and facts become inspectable worlds.',
    distance: 190,
    rank: 4,
    kinds: ['entity', 'thread', 'fact']
  }
];

const ATLAS_FILTERS: Array<{ key: AtlasFilterKey; label: string; hint: string }> = [
  { key: 'all', label: 'All', hint: 'Show the whole story universe.' },
  { key: 'current-branch', label: 'Current branch', hint: 'Highlight the active branch route and its canon.' },
  { key: 'heads', label: 'Branch heads', hint: 'Highlight each live branch endpoint.' },
  { key: 'open-threads', label: 'Open threads', hint: 'Highlight unresolved signals and their branches.' },
  { key: 'canon', label: 'Canon', hint: 'Highlight scenes, entities, facts, and story threads.' }
];

const STORAGE = {
  repoId: 'ariadne.repoId',
  branchId: 'ariadne.branchId'
} as const;

const DEFAULT_VIEW: ViewState = {
  cx: 0,
  cy: 0,
  cz: 0,
  distance: COSMIC_SCALES[0].distance,
  yaw: -0.62,
  pitch: 0.54
};

const CAMERA = {
  minDistance: 92,
  maxDistance: 5200,
  minPitch: -1.22,
  maxPitch: 1.24,
  dragYaw: 0.0048,
  dragPitch: 0.003,
  pan: 0.00155,
  zoom: 0.00105
} as const;

const atlasState: {
  apiBase: string;
  user: FirebaseUser | null;
  graph: StoryMapResponse | null;
  positioned: Map<string, PositionedNode>;
  orbits: OrbitRing[];
  selectedId: string;
  hoveredId: string | null;
  query: string;
  simulated: boolean;
  view: ViewState;
  targetView: ViewState;
  hitSet: Set<string>;
  filterSet: Set<string>;
  filter: AtlasFilterKey;
  scale: CosmicScaleKey;
} = {
  apiBase: '',
  user: null,
  graph: null,
  positioned: new Map(),
  orbits: [],
  selectedId: '',
  hoveredId: null,
  query: '',
  simulated: false,
  view: copyView(DEFAULT_VIEW),
  targetView: copyView(DEFAULT_VIEW),
  hitSet: new Set(),
  filterSet: new Set(),
  filter: 'all',
  scale: 'observable'
};

let renderer: GalaxyRenderer | null = null;
let scaleRenderSignature = '';
let replayTimerId: number | null = null;
let atlasLoadPromise: Promise<void> | null = null;
let atlasAutoRefreshInstalled = false;
let lastAtlasLoadStartedAtMs = 0;

const ATLAS_AUTO_REFRESH_MIN_MS = 15_000;

export function startStoryAtlasApp(options: StoryAtlasOptions): void {
  atlasState.apiBase = options.apiBase.replace(/\/$/, '');
  atlasState.simulated = shouldUseSimulatedAtlas();
  document.title = 'Ariadne Atlas';
  document.body.classList.add('atlas-body');
  document.body.innerHTML = `
    <main class="atlas-shell" aria-label="Ariadne cosmic story map">
      <section class="atlas-map-panel" aria-label="Interactive Google Galaxy style story universe">
        <div id="atlas-map" class="atlas-map">
          <canvas id="atlas-canvas" aria-hidden="true"></canvas>
          <nav id="atlas-a11y" class="atlas-a11y sr-only" aria-label="Map nodes"></nav>
        </div>
      </section>

      <section class="atlas-ui-layer">
        <header class="atlas-header">
          <div class="atlas-title-block">
            <p class="eyebrow">Ariadne Atlas / Galaxy mode</p>
            <h1>Observable Universe</h1>
            <p class="atlas-subtitle">Zoom from superclusters and filaments into galaxies, local branches, solar-system turns, and canon landmarks.</p>
          </div>
          <nav class="atlas-actions" aria-label="Atlas actions">
            <a class="atlas-link" href="/">Return</a>
            <button id="atlas-sign-in" type="button">Sign in</button>
          </nav>
        </header>

        <div class="atlas-controls-left">
          <nav id="atlas-scale-nav" class="atlas-scale-nav" aria-label="Cosmic zoom scale"></nav>
          <form id="atlas-search-form" class="atlas-search" role="search">
            <label for="atlas-search">Search universe</label>
            <div class="atlas-search-row">
              <input id="atlas-search" type="search" placeholder="Find a story world, galaxy, star, character, location, fact, or thread" autocomplete="off" />
              <button id="atlas-rewind-search" type="submit" aria-label="Find semantic rewind point">Find rewind point</button>
            </div>
            <div id="atlas-rewind-results" class="atlas-rewind-results" aria-live="polite"></div>
          </form>
          <nav id="atlas-filter-nav" class="atlas-filter-nav" aria-label="Atlas story filters"></nav>
          <div id="atlas-results" class="atlas-results" aria-live="polite"></div>
        </div>

        <aside id="atlas-detail" class="atlas-detail" aria-label="Selected atlas node"></aside>
        <aside id="atlas-legend" class="atlas-legend" aria-label="Galaxy legend"></aside>
      </section>

      <div id="atlas-status" class="atlas-status" role="status">Loading atlas...</div>
      <div id="atlas-stats" class="atlas-stats" aria-label="Atlas summary"></div>
    </main>
  `;

  const els = atlasEls();
  renderer?.destroy();
  renderer = new GalaxyRenderer(byId<HTMLCanvasElement>('atlas-canvas'));

  els.signIn.addEventListener('click', () => {
    const action = atlasState.user ? signOutFirebase : signInWithGoogle;
    void action().catch(error => setAtlasStatus(messageFrom(error)));
  });
  renderScaleNav();
  renderFilterNav();
  renderLegend();
  window.addEventListener('keydown', handleAtlasKeydown);
  installAtlasAutoRefresh();
  els.search.addEventListener('input', () => {
    atlasState.query = els.search.value.trim().toLowerCase();
    updateSearchHighlight();
    renderSearchResults();
    els.rewindResults.replaceChildren();
  });
  els.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    void runTimeMachineSearch();
  });
  if (isFirebaseConfigured() && !atlasState.simulated) {
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

function installAtlasAutoRefresh(): void {
  if (atlasAutoRefreshInstalled) return;
  atlasAutoRefreshInstalled = true;
  window.addEventListener('focus', refreshAtlasIfStale);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAtlasIfStale();
  });
}

function refreshAtlasIfStale(): void {
  if (atlasState.simulated || document.hidden) return;
  if (Date.now() - lastAtlasLoadStartedAtMs < ATLAS_AUTO_REFRESH_MIN_MS) return;
  void loadAtlas({ quiet: true });
}

async function loadAtlas(options: { quiet?: boolean } = {}): Promise<void> {
  atlasLoadPromise ??= loadAtlasInternal(options).finally(() => {
    atlasLoadPromise = null;
  });
  return atlasLoadPromise;
}

async function loadAtlasInternal(options: { quiet?: boolean } = {}): Promise<void> {
  lastAtlasLoadStartedAtMs = Date.now();
  if (!options.quiet) setAtlasStatus(atlasState.simulated ? 'Loading simulated cluster...' : 'Loading atlas...');
  try {
    const graph = atlasState.simulated ? simulatedStoryMap() : await atlasFetch<StoryMapResponse>('/v1/story-map');
    document.querySelector('.atlas-empty')?.remove();
    const layout = layoutGraph(graph);
    atlasState.graph = graph;
    atlasState.positioned = layout.positioned;
    atlasState.orbits = layout.orbits;
    atlasState.selectedId = graph.rootId;
    atlasState.hoveredId = null;
    atlasState.hitSet.clear();
    atlasState.filterSet.clear();
    atlasState.query = atlasEls().search.value.trim().toLowerCase();
    atlasState.filter = 'all';
    atlasState.scale = 'observable';
    updateSearchHighlight();
    updateFilterHighlight();
    renderAtlasStats(graph);
    renderScaleNav(true);
    renderFilterNav(true);
    renderLegend();
    renderA11yLayer(graph);
    renderSearchResults();
    renderDetail(graph.rootId);
    resetAtlasView(true);
    renderer?.start();
    setAtlasStatus(graph.nodes.length ? `${atlasState.simulated ? 'Simulating' : 'Tracking'} ${graph.nodes.length} celestial bodies.` : 'No saved story graph yet.');
  } catch (error) {
    atlasState.graph = null;
    atlasState.positioned = new Map();
    atlasState.orbits = [];
    atlasEls().map.append(emptyAtlasState(messageFrom(error)));
    renderAtlasStats(null);
    renderA11yLayer(null);
    renderDetail('');
    renderer?.stop();
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

async function atlasPost<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = await getFirebaseIdToken().catch(() => '');
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${atlasState.apiBase}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as { message?: unknown; error?: unknown };
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `Request failed with ${response.status}`));
  return payload as T;
}

async function atlasDelete<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getFirebaseIdToken().catch(() => '');
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${atlasState.apiBase}${path}`, { method: 'DELETE', headers });
  const payload = await response.json().catch(() => ({})) as { message?: unknown; error?: unknown };
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `Request failed with ${response.status}`));
  return payload as T;
}

async function atlasDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  const token = await getFirebaseIdToken().catch(() => '');
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${atlasState.apiBase}${path}`, { method: 'GET', headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: unknown; error?: unknown };
    throw new Error(String(payload.message ?? payload.error ?? `Request failed with ${response.status}`));
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  return { blob: await response.blob(), filename: filenameFromDisposition(disposition) ?? 'ariadne-story-archive' };
}

class GalaxyRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 1, 12000);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly backgroundGroup = new THREE.Group();
  private readonly graphGroup = new THREE.Group();
  private readonly events = new AbortController();
  private readonly pointers = new Map<number, ActivePointer>();
  private readonly nodeObjects = new Map<string, THREE.Group>();
  private readonly nodeHitTargets: THREE.Object3D[] = [];
  private readonly labels = new Map<string, THREE.Sprite>();
  private animationFrameId = 0;
  private graphRef: StoryMapResponse | null = null;
  private gesture: CameraGesture | null = null;
  private time = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private panVelocity: Vec3 = { x: 0, y: 0, z: 0 };

  private readonly colors: Record<StoryMapNodeKind, { core: number; fill: number; glow: number; ring: number }> = {
    library: { core: 0xfff7d4, fill: 0xf1ead0, glow: 0xfff1b0, ring: 0x8bb8c7 },
    repo: { core: 0x9ec2c8, fill: 0x17313b, glow: 0x88aab1, ring: 0x88aab1 },
    branch: { core: 0x88b3bf, fill: 0x1b2830, glow: 0x7ea0ad, ring: 0x7ea0ad },
    turn: { core: 0xfffdf0, fill: 0xd7d7d0, glow: 0xd7d7d0, ring: 0xd7d7d0 },
    scene: { core: 0xaec088, fill: 0x27311e, glow: 0x9ca97d, ring: 0x9ca97d },
    entity: { core: 0xb6a7d6, fill: 0x2b2435, glow: 0xa69ac2, ring: 0xa69ac2 },
    thread: { core: 0xd1a783, fill: 0x35261e, glow: 0xba997e, ring: 0xba997e },
    fact: { core: 0xb4beb9, fill: 0x222525, glow: 0x9fa8a4, ring: 0x9fa8a4 }
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x010207, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x010207);
    this.scene.fog = new THREE.FogExp2(0x020408, 0.00026);
    this.backgroundGroup.name = 'observable-universe-backdrop';
    this.graphGroup.name = 'story-galaxy';
    this.scene.add(this.backgroundGroup);
    this.scene.add(this.graphGroup);
    this.scene.add(new THREE.AmbientLight(0xcad9d4, 0.36));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(420, 620, 760);
    this.scene.add(key);
    this.handleResize = this.handleResize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.initStarfield();
    this.initNebulae();
    this.wireEvents();
  }

  start(): void {
    if (!this.animationFrameId) this.loop();
  }

  stop(): void {
    if (!this.animationFrameId) return;
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = 0;
  }

  destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.events.abort();
    this.clearGraph();
    while (this.backgroundGroup.children.length) {
      const child = this.backgroundGroup.children.pop();
      if (child) disposeObject(child);
    }
    this.renderer.dispose();
  }

  private handleResize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const width = Math.max(320, rect?.width ?? 1200);
    const height = Math.max(320, rect?.height ?? 760);
    this.renderer.setPixelRatio(Math.max(1, Math.min(2, window.devicePixelRatio || 1)));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private initStarfield(): void {
    this.backgroundGroup.add(this.createStarfieldLayer('near', 2400, 900, 4300, 4.8, 0.76, 0.62));
    this.backgroundGroup.add(this.createStarfieldLayer('deep', 3600, 2600, 8200, 6.2, 0.42, 0.86));
  }

  private createStarfieldLayer(name: string, count: number, minRadius: number, maxRadius: number, size: number, opacity: number, verticalScale: number): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    const radiusSpan = Math.max(1, maxRadius - minRadius);
    for (let i = 0; i < count; i += 1) {
      const radius = minRadius + (hashNumber(`star:${name}:r:${i}`) % radiusSpan);
      const theta = hashAngle(`star:${name}:t:${i}`);
      const phi = Math.acos(((hashNumber(`star:${name}:p:${i}`) % 2000) / 1000) - 1);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(phi) * radius * verticalScale;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      const warmth = (hashNumber(`star:${name}:w:${i}`) % 100) / 100;
      const lightness = name === 'deep' ? 0.42 + warmth * 0.22 : 0.58 + warmth * 0.28;
      color.setHSL(0.56 + warmth * 0.14, 0.2 + warmth * 0.22, lightness);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(geometry, material);
    stars.name = `atlas-starfield-${name}`;
    return stars;
  }

  private initNebulae(): void {
    const nebulae: Array<[string, number, number, number, number, number, number]> = [
      ['orion-memory', -1800, 520, -2200, 2200, 0x5f7fb8, 0.13],
      ['veil-thread', 1600, -420, 1900, 2600, 0x8b6db5, 0.1],
      ['green-reef', 600, 980, -3100, 1900, 0x4f9c91, 0.1],
      ['amber-fog', -2600, -720, 1800, 2300, 0xb38a5f, 0.085]
    ];
    for (const [name, x, y, z, size, color, opacity] of nebulae) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nebulaTexture(name),
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      sprite.name = `atlas-nebula-${name}`;
      sprite.position.set(x, y, z);
      sprite.scale.set(size, size * 0.62, 1);
      this.backgroundGroup.add(sprite);
    }
  }

  private wireEvents(): void {
    const signal = this.events.signal;
    this.canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    this.canvas.addEventListener('pointerdown', event => this.handlePointerDown(event), { signal });
    this.canvas.addEventListener('pointermove', event => this.handlePointerMove(event), { signal });
    this.canvas.addEventListener('pointerup', event => this.handlePointerEnd(event), { signal });
    this.canvas.addEventListener('pointercancel', event => this.handlePointerEnd(event), { signal });
    this.canvas.addEventListener('pointerleave', event => {
      if (!this.pointers.size) this.updateHover(event.clientX, event.clientY);
    }, { signal });
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const next = copyView(atlasState.targetView);
      next.distance = clamp(next.distance * Math.exp(event.deltaY * CAMERA.zoom), CAMERA.minDistance, CAMERA.maxDistance);
      atlasState.targetView = next;
      atlasState.scale = scaleForDistance(next.distance);
      renderScaleNav();
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
      this.panVelocity = { x: 0, y: 0, z: 0 };
    }, { passive: false, signal });
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button > 2) return;
    event.preventDefault();
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.panVelocity = { x: 0, y: 0, z: 0 };
    const pointer: ActivePointer = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY
    };
    this.pointers.set(event.pointerId, pointer);
    this.canvas.setPointerCapture(event.pointerId);
    if (this.pointers.size >= 2) this.beginPinchGesture();
    else this.beginSinglePointerGesture(pointer);
    this.canvas.classList.add('is-panning');
  }

  private handlePointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      this.updateHover(event.clientX, event.clientY);
      return;
    }
    event.preventDefault();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.pointers.size >= 2) {
      if (this.gesture?.mode !== 'pinch') this.beginPinchGesture();
      this.updatePinchGesture();
      return;
    }
    if (this.gesture?.pointerId === event.pointerId) this.updateSinglePointerGesture(pointer);
  }

  private handlePointerEnd(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    const wasClick = Boolean(pointer && this.gesture?.pointerId === event.pointerId && !this.gesture.moved);
    const wasPinch = this.gesture?.mode === 'pinch';
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (this.pointers.size >= 2) {
      this.beginPinchGesture();
    } else if (this.pointers.size === 1) {
      this.beginSinglePointerGesture([...this.pointers.values()][0], wasPinch);
    } else {
      this.gesture = null;
      this.canvas.classList.remove('is-panning');
      this.updateHover(event.clientX, event.clientY);
      if (wasClick && atlasState.hoveredId) selectNode(atlasState.hoveredId, true);
    }
  }

  private beginSinglePointerGesture(pointer: ActivePointer, suppressClick = false): void {
    this.gesture = {
      mode: pointer.pointerType === 'mouse' && pointer.button !== 0 ? 'pan' : 'orbit',
      pointerId: pointer.pointerId,
      startView: copyView(atlasState.targetView),
      startX: pointer.x,
      startY: pointer.y,
      startDistance: 0,
      startAngle: 0,
      moved: suppressClick,
      lastYaw: atlasState.targetView.yaw,
      lastPitch: atlasState.targetView.pitch,
      lastFocus: viewFocus(atlasState.targetView)
    };
  }

  private beginPinchGesture(): void {
    const points = [...this.pointers.values()].slice(0, 2);
    if (points.length < 2) return;
    const center = midpoint(points[0], points[1]);
    this.gesture = {
      mode: 'pinch',
      pointerId: null,
      startView: copyView(atlasState.targetView),
      startX: center.x,
      startY: center.y,
      startDistance: Math.max(1, distanceBetween(points[0], points[1])),
      startAngle: Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x),
      moved: false,
      lastYaw: atlasState.targetView.yaw,
      lastPitch: atlasState.targetView.pitch,
      lastFocus: viewFocus(atlasState.targetView)
    };
  }

  private updateSinglePointerGesture(pointer: ActivePointer): void {
    if (!this.gesture) return;
    const dx = pointer.x - this.gesture.startX;
    const dy = pointer.y - this.gesture.startY;
    this.gesture.moved ||= Math.hypot(dx, dy) > 4;
    const next = copyView(this.gesture.startView);
    if (this.gesture.mode === 'orbit') {
      next.yaw = normalizeAngle(this.gesture.startView.yaw - dx * CAMERA.dragYaw);
      next.pitch = clamp(this.gesture.startView.pitch - dy * CAMERA.dragPitch, CAMERA.minPitch, CAMERA.maxPitch);
    } else {
      this.panView(next, dx, dy);
    }
    this.yawVelocity = angleDelta(next.yaw, this.gesture.lastYaw) * 0.72;
    this.pitchVelocity = (next.pitch - this.gesture.lastPitch) * 0.56;
    const focus = viewFocus(next);
    this.panVelocity = {
      x: (focus.x - this.gesture.lastFocus.x) * 0.2,
      y: (focus.y - this.gesture.lastFocus.y) * 0.2,
      z: (focus.z - this.gesture.lastFocus.z) * 0.2
    };
    this.gesture.lastYaw = next.yaw;
    this.gesture.lastPitch = next.pitch;
    this.gesture.lastFocus = focus;
    atlasState.targetView = next;
  }

  private updatePinchGesture(): void {
    if (!this.gesture) return;
    const points = [...this.pointers.values()].slice(0, 2);
    if (points.length < 2) return;
    const center = midpoint(points[0], points[1]);
    const distance = Math.max(1, distanceBetween(points[0], points[1]));
    const angle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
    const dx = center.x - this.gesture.startX;
    const dy = center.y - this.gesture.startY;
    this.gesture.moved ||= Math.hypot(dx, dy) > 4 || Math.abs(distance - this.gesture.startDistance) > 4;
    const next = copyView(this.gesture.startView);
    next.distance = clamp(next.distance * (this.gesture.startDistance / distance), CAMERA.minDistance, CAMERA.maxDistance);
    next.yaw = normalizeAngle(next.yaw - angleDelta(angle, this.gesture.startAngle));
    this.panView(next, dx, dy);
    this.yawVelocity = angleDelta(next.yaw, this.gesture.lastYaw) * 0.55;
    const focus = viewFocus(next);
    this.panVelocity = {
      x: (focus.x - this.gesture.lastFocus.x) * 0.18,
      y: (focus.y - this.gesture.lastFocus.y) * 0.18,
      z: (focus.z - this.gesture.lastFocus.z) * 0.18
    };
    this.gesture.lastYaw = next.yaw;
    this.gesture.lastFocus = focus;
    atlasState.targetView = next;
  }

  private panView(view: ViewState, dx: number, dy: number): void {
    const { right, up } = cameraBasis(view);
    const amount = view.distance * CAMERA.pan;
    view.cx -= (right.x * dx - up.x * dy) * amount;
    view.cy -= (right.y * dx - up.y * dy) * amount;
    view.cz -= (right.z * dx - up.z * dy) * amount;
  }

  private loop(): void {
    this.time += 0.016;
    if (this.graphRef !== atlasState.graph) this.rebuildGraph();
    this.updateCamera();
    this.updateSceneState();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private updateCamera(): void {
    if (!this.gesture) {
      atlasState.targetView.yaw = normalizeAngle(atlasState.targetView.yaw + this.yawVelocity);
      atlasState.targetView.pitch = clamp(atlasState.targetView.pitch + this.pitchVelocity, CAMERA.minPitch, CAMERA.maxPitch);
      atlasState.targetView.cx += this.panVelocity.x;
      atlasState.targetView.cy += this.panVelocity.y;
      atlasState.targetView.cz += this.panVelocity.z;
      this.yawVelocity *= 0.9;
      this.pitchVelocity *= 0.82;
      this.panVelocity.x *= 0.86;
      this.panVelocity.y *= 0.86;
      this.panVelocity.z *= 0.86;
      if (Math.abs(this.yawVelocity) < 0.00006) this.yawVelocity = 0;
      if (Math.abs(this.pitchVelocity) < 0.00006) this.pitchVelocity = 0;
      if (Math.hypot(this.panVelocity.x, this.panVelocity.y, this.panVelocity.z) < 0.004) this.panVelocity = { x: 0, y: 0, z: 0 };
    }

    atlasState.view.cx += (atlasState.targetView.cx - atlasState.view.cx) * 0.12;
    atlasState.view.cy += (atlasState.targetView.cy - atlasState.view.cy) * 0.12;
    atlasState.view.cz += (atlasState.targetView.cz - atlasState.view.cz) * 0.12;
    atlasState.view.distance += (atlasState.targetView.distance - atlasState.view.distance) * 0.12;
    atlasState.view.yaw = normalizeAngle(atlasState.view.yaw + angleDelta(atlasState.targetView.yaw, atlasState.view.yaw) * 0.14);
    atlasState.view.pitch += (atlasState.targetView.pitch - atlasState.view.pitch) * 0.12;

    const focus = new THREE.Vector3(atlasState.view.cx, atlasState.view.cy, atlasState.view.cz);
    const offset = cameraOffset(atlasState.view);
    this.camera.position.set(focus.x + offset.x, focus.y + offset.y, focus.z + offset.z);
    this.camera.lookAt(focus);

    const nextScale = scaleForDistance(atlasState.view.distance);
    if (nextScale !== atlasState.scale) {
      atlasState.scale = nextScale;
      renderScaleNav();
    }
  }

  private updateSceneState(): void {
    const graph = atlasState.graph;
    if (!graph) return;
    const connected = connectedNodeIds();
    const hasInteraction = Boolean(atlasState.hoveredId);
    const isSearching = atlasState.query.length > 0;
    const isFiltering = atlasState.filter !== 'all';

    for (const node of atlasState.positioned.values()) {
      const group = this.nodeObjects.get(node.id);
      if (!group) continue;
      const selected = atlasState.selectedId === node.id;
      const hovered = atlasState.hoveredId === node.id;
      const active = selected || hovered || connected.has(node.id);
      const hit = isSearching && atlasState.hitSet.has(node.id);
      const filterHit = isFiltering && atlasState.filterSet.has(node.id);
      const dim = (isSearching && !hit) || (isFiltering && !filterHit) || (hasInteraction && !active);
      const pulse = 1 + Math.sin(this.time * node.orbitSpeed + node.angle) * 0.035;
      group.scale.setScalar((selected || hovered || hit ? 1.12 : 1) * pulse);

      for (const child of group.children) {
        if (child.userData.role === 'selection') child.visible = selected || hovered || hit || filterHit;
        if (child.userData.role === 'spiral') child.rotation.z += (child.userData.spin as number | undefined ?? 0.0025);
        if (child.userData.role === 'halo') {
          child.rotation.x += 0.0012;
          child.rotation.z -= 0.0016;
        }
        if (child.userData.role === 'shell') {
          child.rotation.y += 0.0009;
          child.rotation.z += 0.0004;
        }
        if (child.userData.role === 'beacon') {
          child.rotation.y = this.time * 0.45;
        }
        if (child.userData.role === 'glow') {
          const material = (child as THREE.Sprite).material as THREE.SpriteMaterial;
          material.opacity = dim ? 0.08 : selected || hovered || hit || filterHit ? 0.9 : 0.38;
        }
        if (child.userData.role === 'body') {
          const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          material.opacity = dim ? 0.22 : 1;
          material.emissiveIntensity = selected || hovered || hit || filterHit ? 1.2 : node.kind === 'library' ? 0.9 : 0.34;
        }
      }

      const label = this.labels.get(node.id);
      if (label) {
        const primary = node.kind === 'library' || node.kind === 'repo';
        const structural = node.kind === 'branch' || node.kind === 'scene';
        const labelWorldPosition = new THREE.Vector3();
        label.getWorldPosition(labelWorldPosition);
        const distanceToCamera = labelWorldPosition.distanceTo(this.camera.position);
        const texture = (label.material as THREE.SpriteMaterial).map;
        const image = texture?.image as HTMLCanvasElement | undefined;
        const aspect = image ? image.width / image.height : 3;
        const labelHeight = clamp(distanceToCamera * 0.026, 9, selected || hovered || hit || filterHit ? 22 : 18);
        label.scale.set(labelHeight * aspect, labelHeight, 1);
        label.position.y = node.r + labelHeight * 1.15;
        label.visible = selected
          || hovered
          || hit
          || filterHit
          || primary
          || (structural && node.labelVisible && atlasState.view.distance < 760)
          || (node.labelVisible && atlasState.view.distance < 420);
        const material = label.material as THREE.SpriteMaterial;
        material.opacity = dim ? 0.22 : 1;
      }
    }

    for (const child of this.graphGroup.children) {
      if (child.userData.kind !== 'link') continue;
      const source = child.userData.source as string;
      const target = child.userData.target as string;
      const material = (child as THREE.Line).material as THREE.LineBasicMaterial;
      const active = hasInteraction && (source === atlasState.hoveredId || target === atlasState.hoveredId);
      const hit = isSearching && (atlasState.hitSet.has(source) || atlasState.hitSet.has(target));
      const filterHit = isFiltering && atlasState.filterSet.has(source) && atlasState.filterSet.has(target);
      material.opacity = (isSearching && !hit) || (isFiltering && !filterHit) || (hasInteraction && !active && !connected.has(source) && !connected.has(target))
        ? 0.08
        : active || hit || filterHit
          ? 0.9
          : 0.38;
    }
  }

  private updateHover(clientX: number, clientY: number): void {
    const id = this.pickNode(clientX, clientY);
    atlasState.hoveredId = id;
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
  }

  private pickNode(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodeHitTargets, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (typeof object.userData.nodeId === 'string') return object.userData.nodeId;
        object = object.parent;
      }
    }
    return null;
  }

  private rebuildGraph(): void {
    this.clearGraph();
    this.graphRef = atlasState.graph;
    if (!atlasState.graph) return;

    for (const filament of this.createCosmicWeb()) this.graphGroup.add(filament);
    for (const orbit of atlasState.orbits) this.graphGroup.add(this.createOrbit(orbit));
    for (const link of atlasState.graph.links) {
      const source = atlasState.positioned.get(link.source);
      const target = atlasState.positioned.get(link.target);
      if (source && target) this.graphGroup.add(this.createLink(link, source, target));
    }
    for (const node of atlasState.positioned.values()) {
      const group = this.createNode(node);
      this.nodeObjects.set(node.id, group);
      this.graphGroup.add(group);
    }
  }

  private clearGraph(): void {
    this.nodeObjects.clear();
    this.nodeHitTargets.length = 0;
    this.labels.clear();
    while (this.graphGroup.children.length) {
      const child = this.graphGroup.children.pop();
      if (child) disposeObject(child);
    }
  }

  private createCosmicWeb(): THREE.Line[] {
    const lines: THREE.Line[] = [];
    const repos = [...atlasState.positioned.values()].filter(node => node.kind === 'repo').sort(sortByUpdatedThenLabel);
    const root = atlasState.graph ? atlasState.positioned.get(atlasState.graph.rootId) : null;
    for (let i = 0; i < repos.length; i += 1) {
      if (root) lines.push(this.createFilament(root, repos[i], 0.18, 0x7fb7c7));
      if (i > 0) lines.push(this.createFilament(repos[i - 1], repos[i], 0.12, 0x6b6fa8));
    }
    for (const repo of repos) {
      const branches = [...atlasState.positioned.values()]
        .filter(node => node.kind === 'branch' && node.parentId === repo.id)
        .sort(sortByUpdatedThenLabel);
      for (let i = 1; i < branches.length; i += 1) lines.push(this.createFilament(branches[i - 1], branches[i], 0.1, 0x9c87bd));
    }
    return lines;
  }

  private createFilament(source: PositionedNode, target: PositionedNode, opacity: number, color: number): THREE.Line {
    const start = nodeVector(source);
    const end = nodeVector(target);
    const midpoint = start.clone().lerp(end, 0.5);
    const bow = Math.max(40, start.distanceTo(end) * 0.12);
    midpoint.x += Math.cos(source.angle + target.angle) * bow;
    midpoint.y += Math.sin(source.angle - target.angle) * bow * 0.6;
    midpoint.z += Math.sin(source.angle * 1.9) * bow;
    const curve = new THREE.CatmullRomCurve3([start, midpoint, end]);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(36));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const line = new THREE.Line(geometry, material);
    line.userData.kind = 'filament';
    return line;
  }

  private createOrbit(orbit: OrbitRing): THREE.LineLoop {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 192; i += 1) {
      const angle = (i / 192) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * orbit.r,
        Math.sin(angle) * orbit.r * Math.cos(orbit.tilt),
        Math.sin(angle) * orbit.r * Math.sin(orbit.tilt) * 0.52
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: scaleColorHex(orbit.kind),
      transparent: true,
      opacity: orbit.kind === 'observable' ? 0.22 : orbit.kind === 'supercluster' ? 0.14 : 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const line = new THREE.LineLoop(geometry, material);
    line.position.set(orbit.cx, orbit.cy, orbit.cz);
    line.rotation.z = orbit.spin;
    line.userData.kind = 'orbit';
    line.userData.scale = orbit.kind;
    return line;
  }

  private createLink(link: StoryMapLink, source: PositionedNode, target: PositionedNode): THREE.Line {
    const start = nodeVector(source);
    const end = nodeVector(target);
    const mid = start.clone().lerp(end, 0.5);
    const lift = link.kind === 'fork' ? 80 : link.kind === 'timeline' || link.kind === 'head' ? 30 : 14;
    mid.z += lift + Math.sin(source.angle + target.angle) * 26;
    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    const material = new THREE.LineBasicMaterial({
      color: edgeColorHex(link.kind),
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const line = new THREE.Line(geometry, material);
    line.userData = { kind: 'link', source: link.source, target: link.target };
    return line;
  }

  private createNode(node: PositionedNode): THREE.Group {
    const group = new THREE.Group();
    group.position.set(node.x, node.y, node.z);
    group.userData.nodeId = node.id;
    const style = this.colors[node.kind];

    if (node.kind === 'library') {
      group.add(this.createObservableShell(node, style));
      group.add(this.createSpiralField(node, style.glow, node.r * 6.4, 520, 4, 0.46));
    } else if (node.kind === 'repo') {
      group.add(this.createSpiralField(node, style.glow, node.r * 4.8, 340, 3, 0.55));
      group.add(this.createHalo(node.r * 2.8, style.ring, 0.3));
    } else if (node.kind === 'branch') {
      group.add(this.createSpiralField(node, style.glow, node.r * 4.2, 160, 2, 0.44));
    } else if (node.kind === 'scene') {
      group.add(this.createHalo(node.r * 2.4, style.ring, 0.26));
    } else if (node.kind === 'thread') {
      group.add(this.createBeacon(node.r * 2.2, style.ring));
    }

    const geometry = node.kind === 'turn' || node.kind === 'fact'
      ? new THREE.IcosahedronGeometry(node.r, node.kind === 'turn' ? 1 : 0)
      : new THREE.SphereGeometry(node.r, node.kind === 'library' ? 48 : 32, node.kind === 'library' ? 28 : 20);
    const material = new THREE.MeshStandardMaterial({
      color: style.fill,
      emissive: style.core,
      emissiveIntensity: node.kind === 'library' ? 1.1 : node.kind === 'turn' ? 0.8 : 0.34,
      roughness: node.kind === 'turn' ? 0.18 : 0.44,
      metalness: node.kind === 'repo' ? 0.2 : node.kind === 'fact' ? 0.28 : 0.08,
      transparent: true
    });
    const body = new THREE.Mesh(geometry, material);
    body.userData = { nodeId: node.id, role: 'body' };
    group.add(body);
    this.nodeHitTargets.push(body);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: style.glow,
      transparent: true,
      opacity: node.kind === 'library' ? 0.82 : node.kind === 'turn' ? 0.62 : 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow.userData.role = 'glow';
    glow.scale.setScalar(node.r * (node.kind === 'library' ? 9.4 : node.kind === 'turn' ? 6.2 : 4.6));
    group.add(glow);

    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints(node.r * 1.68, 112)),
      new THREE.LineBasicMaterial({ color: style.ring, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.userData.role = 'selection';
    ring.visible = false;
    group.add(ring);

    if (node.kind === 'library') {
      const light = new THREE.PointLight(0xfff3bf, 3.3, 2400, 1.15);
      light.position.set(0, 0, 0);
      group.add(light);
    }

    if (node.kind === 'turn') {
      const light = new THREE.PointLight(style.core, 0.45, node.r * 16, 1.8);
      group.add(light);
    }

    const label = this.createLabel(node);
    this.labels.set(node.id, label);
    group.add(label);
    return group;
  }

  private createObservableShell(node: PositionedNode, style: { core: number; fill: number; glow: number; ring: number }): THREE.Group {
    const shell = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(node.r * 4.6, 64, 32),
      new THREE.MeshBasicMaterial({
        color: style.glow,
        transparent: true,
        opacity: 0.045,
        wireframe: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    sphere.userData.role = 'shell';
    shell.add(sphere);
    const equator = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints(node.r * 4.9, 192)),
      new THREE.LineBasicMaterial({ color: style.ring, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    equator.userData.role = 'shell';
    shell.add(equator);
    shell.userData.role = 'shell';
    return shell;
  }

  private createSpiralField(node: PositionedNode, color: number, radius: number, count: number, arms: number, opacity: number): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const base = new THREE.Color(color);
    const tint = new THREE.Color(0xffffff);
    for (let i = 0; i < count; i += 1) {
      const progress = i / Math.max(1, count - 1);
      const arm = i % arms;
      const hash = hashNumber(`${node.id}:spiral:${i}`);
      const jitter = ((hash % 1000) / 1000 - 0.5) * 0.72;
      const angle = arm * (Math.PI * 2 / arms) + progress * Math.PI * 5.2 + jitter;
      const distance = Math.sqrt(progress) * radius * (0.22 + (hash % 47) / 64);
      const yLift = ((hashNumber(`${node.id}:spiral:y:${i}`) % 1000) / 1000 - 0.5) * radius * 0.16;
      positions[i * 3] = Math.cos(angle) * distance;
      positions[i * 3 + 1] = yLift;
      positions[i * 3 + 2] = Math.sin(angle) * distance * 0.76;
      tint.copy(base).lerp(new THREE.Color(0xffffff), 0.18 + (hash % 100) / 500);
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: node.kind === 'library' ? 4.8 : node.kind === 'repo' ? 3.4 : 2.5,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.rotation.x = node.kind === 'library' ? 0.54 : 1.05;
    points.rotation.z = node.angle * 0.4;
    points.userData.role = 'spiral';
    points.userData.spin = node.kind === 'library' ? 0.00045 : node.kind === 'repo' ? 0.0011 : 0.0018;
    return points;
  }

  private createHalo(radius: number, color: number, opacity: number): THREE.Group {
    const halo = new THREE.Group();
    const outer = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints(radius, 160)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    outer.rotation.x = 1.1;
    halo.add(outer);
    const inner = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints(radius * 0.68, 128)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.58, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    inner.rotation.x = 0.66;
    inner.rotation.z = 0.72;
    halo.add(inner);
    halo.userData.role = 'halo';
    return halo;
  }

  private createBeacon(radius: number, color: number): THREE.Group {
    const beacon = new THREE.Group();
    const vertical = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -radius, 0), new THREE.Vector3(0, radius, 0)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    beacon.add(vertical);
    const horizontal = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints(radius * 0.55, 80)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    horizontal.rotation.x = Math.PI / 2;
    beacon.add(horizontal);
    beacon.userData.role = 'beacon';
    return beacon;
  }

  private createLabel(node: PositionedNode): THREE.Sprite {
    const texture = labelTexture(node.label, cosmicNounForKind(node.kind));
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, node.r + 26, 0);
    sprite.scale.set(texture.image.width * 0.08, texture.image.height * 0.08, 1);
    sprite.renderOrder = 10;
    sprite.userData.role = 'label';
    return sprite;
  }
}


function edgeColorHex(kind: StoryMapLinkKind): number {
  if (kind === 'contains' || kind === 'head') return 0x7f9c9d;
  if (kind === 'fork') return 0xb08a6a;
  if (kind === 'present') return 0x9fc58f;
  if (kind === 'mentions') return 0xa69ac2;
  return 0x556f71;
}

function scaleColorHex(kind: CosmicScaleKey): number {
  if (kind === 'observable') return 0xfff1b0;
  if (kind === 'supercluster') return 0x8bb8c7;
  if (kind === 'galactic') return 0xa69ac2;
  if (kind === 'stellar') return 0xfffdf0;
  return 0x9fc58f;
}

function nodeVector(node: PositionedNode): THREE.Vector3 {
  return new THREE.Vector3(node.x, node.y, node.z);
}

function ringPoints(radius: number, segments: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return points;
}

function cameraOffset(view: ViewState): Vec3 {
  const cosPitch = Math.cos(view.pitch);
  return {
    x: Math.sin(view.yaw) * cosPitch * view.distance,
    y: Math.sin(view.pitch) * view.distance,
    z: Math.cos(view.yaw) * cosPitch * view.distance
  };
}

function cameraBasis(view: ViewState): { right: Vec3; up: Vec3 } {
  const offset = cameraOffset(view);
  const forward = normalizeVec({ x: -offset.x, y: -offset.y, z: -offset.z });
  const worldUp = { x: 0, y: 1, z: 0 };
  const right = normalizeVec(cross(forward, worldUp));
  const up = normalizeVec(cross(right, forward));
  return { right, up };
}

function viewFocus(view: ViewState): Vec3 {
  return { x: view.cx, y: view.cy, z: view.cz };
}

function normalizeVec(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

let cachedGlowTexture: THREE.CanvasTexture | null = null;

function glowTexture(): THREE.CanvasTexture {
  if (cachedGlowTexture) return cachedGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas labels are not available.');
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.24, 'rgba(255,255,255,0.38)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  cachedGlowTexture = new THREE.CanvasTexture(canvas);
  cachedGlowTexture.colorSpace = THREE.SRGBColorSpace;
  return cachedGlowTexture;
}

function labelTexture(text: string, subtext = ''): THREE.CanvasTexture {
  const fontSize = 42;
  const subFontSize = 20;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas labels are not available.');
  ctx.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  ctx.font = `800 ${subFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  const subtextWidth = subtext ? ctx.measureText(subtext).width : 0;
  const width = Math.ceil(Math.max(textWidth, subtextWidth) + 52);
  const height = subtext ? 104 : 78;
  canvas.width = width;
  canvas.height = height;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.strokeText(text, width / 2, subtext ? height / 2 - 12 : height / 2);
  ctx.fillStyle = '#f3f8f6';
  ctx.fillText(text, width / 2, subtext ? height / 2 - 12 : height / 2);

  if (subtext) {
    ctx.font = `900 ${subFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.86)';
    ctx.strokeText(subtext.toUpperCase(), width / 2, height / 2 + 28);
    ctx.fillStyle = '#9fb8be';
    ctx.fillText(subtext.toUpperCase(), width / 2, height / 2 + 28);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

const cachedNebulaTextures = new Map<string, THREE.CanvasTexture>();

function nebulaTexture(seed: string): THREE.CanvasTexture {
  const cached = cachedNebulaTextures.get(seed);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas textures are not available.');
  ctx.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 18; i += 1) {
    const x = 156 + (hashNumber(`${seed}:x:${i}`) % 210);
    const y = 156 + (hashNumber(`${seed}:y:${i}`) % 210);
    const radius = 70 + (hashNumber(`${seed}:r:${i}`) % 160);
    const alpha = 0.032 + (hashNumber(`${seed}:a:${i}`) % 80) / 2000;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.42, `rgba(255,255,255,${alpha * 0.48})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  cachedNebulaTextures.set(seed, texture);
  return texture;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    if (Array.isArray(material)) {
      for (const item of material) disposeMaterial(item);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  const maybeMap = material as THREE.Material & { map?: THREE.Texture | null };
  if (maybeMap.map && maybeMap.map !== cachedGlowTexture && ![...cachedNebulaTextures.values()].includes(maybeMap.map as THREE.CanvasTexture)) {
    maybeMap.map.dispose();
  }
  material.dispose();
}

function connectedNodeIds(): Set<string> {
  const connected = new Set<string>();
  const hovered = atlasState.hoveredId;
  if (!hovered || !atlasState.graph) return connected;
  connected.add(hovered);
  for (const link of atlasState.graph.links) {
    if (link.source === hovered) connected.add(link.target);
    if (link.target === hovered) connected.add(link.source);
  }
  return connected;
}

function layoutGraph(graph: StoryMapResponse): { positioned: Map<string, PositionedNode>; orbits: OrbitRing[] } {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const positioned = new Map<string, PositionedNode>();
  const orbits: OrbitRing[] = [];
  const root = byId.get(graph.rootId) ?? graph.nodes[0];
  if (root) positioned.set(root.id, withPosition(root, 0, 0, radiusFor(root), true, 0, 0));

  const repos = graph.nodes.filter(node => node.kind === 'repo').sort(sortByUpdatedThenLabel);
  const goldenAngle = (137.5 * Math.PI) / 180;
  for (let i = 0; i < repos.length; i += 1) {
    const angle = i * goldenAngle - Math.PI / 2;
    const distance = 360 + Math.sqrt(i + 1) * 190;
    const z = Math.sin(angle * 1.35) * 260 + (i - (repos.length - 1) / 2) * 130;
    orbits.push({ cx: 0, cy: 0, cz: 0, r: distance, kind: 'observable', tilt: 0.18 + (i % 3) * 0.18, spin: angle * 0.08 });
    positioned.set(repos[i].id, withPosition(repos[i], Math.cos(angle) * distance, Math.sin(angle) * distance, radiusFor(repos[i]), true, angle, z));
  }

  for (const repo of repos) {
    const repoPos = positioned.get(repo.id);
    if (!repoPos) continue;
    const branches = graph.nodes
      .filter(node => node.kind === 'branch' && node.parentId === repo.id)
      .sort((a, b) => (a.label === 'main' ? -1 : b.label === 'main' ? 1 : sortByUpdatedThenLabel(a, b)));
    const orbitRadius = repoPos.r * 3.1 + 88;
    if (branches.length) orbits.push({ cx: repoPos.x, cy: repoPos.y, cz: repoPos.z, r: orbitRadius, kind: 'supercluster', tilt: 0.72, spin: repoPos.angle * 0.35 });
    for (let i = 0; i < branches.length; i += 1) {
      const angle = (i / Math.max(1, branches.length)) * Math.PI * 2 + Math.atan2(repoPos.y, repoPos.x) + 0.35;
      const x = repoPos.x + Math.cos(angle) * orbitRadius;
      const y = repoPos.y + Math.sin(angle) * orbitRadius;
      const z = repoPos.z + Math.sin(angle * 1.7) * 82;
      positioned.set(branches[i].id, withPosition(branches[i], x, y, radiusFor(branches[i]), branches.length <= 8, angle, z));
    }
  }

  for (const branch of graph.nodes.filter(node => node.kind === 'branch')) {
    const branchPos = positioned.get(branch.id);
    if (!branchPos) continue;
    const repoPos = branch.parentId ? positioned.get(branch.parentId) : null;
    const armAngle = repoPos ? Math.atan2(branchPos.y - repoPos.y, branchPos.x - repoPos.x) : hashAngle(branch.id);
    orbits.push({ cx: branchPos.x, cy: branchPos.y, cz: branchPos.z, r: 132, kind: 'galactic', tilt: 0.86, spin: branchPos.angle * 0.45 });
    layoutTurns(graph, positioned, branch, branchPos, armAngle);
    layoutStateNodes(graph, positioned, branch, branchPos, armAngle);
  }

  for (const node of graph.nodes) {
    if (!positioned.has(node.id)) {
      const angle = hashAngle(node.id);
      const distance = 540 + (hashNumber(node.id) % 340);
      const z = ((hashNumber(`${node.id}:z`) % 520) - 260);
      positioned.set(node.id, withPosition(node, Math.cos(angle) * distance, Math.sin(angle) * distance, radiusFor(node), false, angle, z));
    }
  }

  return { positioned, orbits };
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
    const distance = 58 + Math.sqrt(i + 1) * 42 + i * 9;
    const angle = armAngle + i * 0.52 - turns.length * 0.13;
    const z = branchPos.z + Math.sin(i * 0.82 + armAngle) * 56 + (i - (turns.length - 1) / 2) * 8;
    const labelVisible = i === turns.length - 1 || i === 0 || turns.length <= 12;
    positioned.set(turns[i].id, withPosition(turns[i], branchPos.x + Math.cos(angle) * distance, branchPos.y + Math.sin(angle) * distance, radiusFor(turns[i]), labelVisible, angle, z));
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
    positioned.set(scene.id, withPosition(scene, branchPos.x + Math.cos(armAngle + Math.PI / 2) * 68, branchPos.y + Math.sin(armAngle + Math.PI / 2) * 68, radiusFor(scene), true, armAngle, branchPos.z + 64));
  }

  const stateNodes = graph.nodes
    .filter(node => ['entity', 'thread', 'fact'].includes(node.kind) && node.branchId === branch.branchId)
    .sort((a, b) => stateKindRank(a.kind) - stateKindRank(b.kind) || a.label.localeCompare(b.label));
  for (let i = 0; i < stateNodes.length; i += 1) {
    const ringRadius = 126 + Math.floor(i / 9) * 42;
    const angle = armAngle + Math.PI + (i * Math.PI * 2) / Math.min(9, Math.max(1, stateNodes.length));
    const z = branchPos.z + Math.cos(angle * 1.2) * 82 + Math.floor(i / 4) * 22;
    positioned.set(stateNodes[i].id, withPosition(stateNodes[i], branchPos.x + Math.cos(angle) * ringRadius, branchPos.y + Math.sin(angle) * ringRadius, radiusFor(stateNodes[i]), stateNodes.length <= 14, angle, z));
  }
}

function withPosition(node: StoryMapNode, x: number, y: number, r: number, labelVisible: boolean, angle = 0, z = 0): PositionedNode {
  return {
    ...node,
    x,
    y,
    z,
    r,
    baseR: r,
    labelVisible,
    angle,
    orbitSpeed: 0.5 + (hashNumber(node.id) % 100) / 220,
    scale: cosmicScaleForKind(node.kind),
    scaleRank: cosmicScaleRank(cosmicScaleForKind(node.kind))
  };
}

function radiusFor(node: StoryMapNode): number {
  const base: Record<StoryMapNodeKind, number> = {
    library: 68,
    repo: 48,
    branch: 24,
    turn: 8,
    scene: 17,
    entity: 12,
    thread: 12,
    fact: 8
  };
  return Math.max(5, base[node.kind] + Math.sqrt(Math.max(1, node.weight)) * 2.2);
}

function selectNode(nodeId: string, center: boolean): void {
  const node = atlasState.positioned.get(nodeId);
  if (!atlasState.graph || !node) return;
  atlasState.selectedId = nodeId;
  atlasState.scale = node.scale;
  if (atlasState.filter === 'current-branch') updateFilterHighlight();
  renderScaleNav();
  renderFilterNav();
  renderDetail(nodeId);
  if (center) centerOnNode(nodeId);
}

function centerOnNode(nodeId: string, snap = false): void {
  const node = atlasState.positioned.get(nodeId);
  if (!node) return;
  atlasState.targetView.cx = node.x;
  atlasState.targetView.cy = node.y;
  atlasState.targetView.cz = node.z;
  const desiredDistance = cosmicScaleForKind(node.kind) === 'observable' ? COSMIC_SCALES[0].distance : scaleByKey(node.scale).distance;
  atlasState.targetView.distance = clamp(desiredDistance, CAMERA.minDistance, CAMERA.maxDistance);
  atlasState.scale = node.scale;
  renderScaleNav();
  if (snap) {
    atlasState.view = copyView(atlasState.targetView);
  }
}

function zoomAtlas(factor: number): void {
  atlasState.targetView.distance = clamp(atlasState.targetView.distance / factor, CAMERA.minDistance, CAMERA.maxDistance);
  atlasState.scale = scaleForDistance(atlasState.targetView.distance);
  renderScaleNav();
}

function resetAtlasView(snap = false): void {
  if (!atlasState.positioned.size) {
    atlasState.targetView = copyView(DEFAULT_VIEW);
  } else {
    const nodes = [...atlasState.positioned.values()];
    const minX = Math.min(...nodes.map(node => node.x - node.r));
    const maxX = Math.max(...nodes.map(node => node.x + node.r));
    const minY = Math.min(...nodes.map(node => node.y - node.r));
    const maxY = Math.max(...nodes.map(node => node.y + node.r));
    const minZ = Math.min(...nodes.map(node => node.z - node.r));
    const maxZ = Math.max(...nodes.map(node => node.z + node.r));
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    atlasState.targetView = {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
      distance: clamp(span * 1.1 + 820, COSMIC_SCALES[0].distance, CAMERA.maxDistance),
      yaw: DEFAULT_VIEW.yaw,
      pitch: DEFAULT_VIEW.pitch
    };
  }
  atlasState.scale = 'observable';
  renderScaleNav();
  if (snap) {
    atlasState.view = copyView(atlasState.targetView);
  }
}

function scaleByKey(key: CosmicScaleKey): CosmicScale {
  return COSMIC_SCALES.find(scale => scale.key === key) ?? COSMIC_SCALES[0];
}

function cosmicScaleForKind(kind: StoryMapNodeKind): CosmicScaleKey {
  if (kind === 'library') return 'observable';
  if (kind === 'repo') return 'supercluster';
  if (kind === 'branch') return 'galactic';
  if (kind === 'turn' || kind === 'scene') return 'stellar';
  return 'landmark';
}

function cosmicScaleRank(key: CosmicScaleKey): number {
  return scaleByKey(key).rank;
}

function scaleForDistance(distance: number): CosmicScaleKey {
  if (distance >= 1650) return 'observable';
  if (distance >= 960) return 'supercluster';
  if (distance >= 520) return 'galactic';
  if (distance >= 260) return 'stellar';
  return 'landmark';
}

function cosmicNounForKind(kind: StoryMapNodeKind): string {
  const labels: Record<StoryMapNodeKind, string> = {
    library: 'observable universe',
    repo: 'supercluster',
    branch: 'galaxy',
    turn: 'star',
    scene: 'solar system',
    entity: 'planet',
    thread: 'signal',
    fact: 'moon'
  };
  return labels[kind];
}

function focusCosmicScale(key: CosmicScaleKey, snap = false): void {
  const scale = scaleByKey(key);
  atlasState.scale = scale.key;
  const node = focusNodeForScale(scale);
  if (!node || scale.key === 'observable') {
    resetAtlasView(snap);
    atlasState.scale = scale.key;
    atlasState.targetView.distance = scale.distance;
    if (atlasState.graph?.rootId) atlasState.selectedId = atlasState.graph.rootId;
    renderDetail(atlasState.selectedId);
    renderScaleNav();
    return;
  }
  atlasState.selectedId = node.id;
  renderDetail(node.id);
  atlasState.targetView.cx = node.x;
  atlasState.targetView.cy = node.y;
  atlasState.targetView.cz = node.z;
  atlasState.targetView.distance = clamp(scale.distance, CAMERA.minDistance, CAMERA.maxDistance);
  atlasState.targetView.yaw = normalizeAngle(DEFAULT_VIEW.yaw - scale.rank * 0.18 + node.angle * 0.08);
  atlasState.targetView.pitch = clamp(DEFAULT_VIEW.pitch - scale.rank * 0.04, CAMERA.minPitch, CAMERA.maxPitch);
  if (snap) atlasState.view = copyView(atlasState.targetView);
  renderScaleNav();
}

function focusNodeForScale(scale: CosmicScale): PositionedNode | null {
  const graph = atlasState.graph;
  if (!graph) return null;
  const selected = atlasState.positioned.get(atlasState.selectedId) ?? null;
  const candidates = [...atlasState.positioned.values()]
    .filter(node => scale.kinds.includes(node.kind))
    .sort(sortByUpdatedThenLabel);
  if (!candidates.length) return selected ?? atlasState.positioned.get(graph.rootId) ?? null;
  if (selected && scale.kinds.includes(selected.kind)) return selected;
  if (selected?.branchId) {
    const branchPeer = candidates.find(node => node.branchId === selected.branchId);
    if (branchPeer) return branchPeer;
  }
  if (selected?.repoId) {
    const repoPeer = candidates.find(node => node.repoId === selected.repoId);
    if (repoPeer) return repoPeer;
  }
  return candidates[0];
}

function renderScaleNav(force = false): void {
  const nav = document.getElementById('atlas-scale-nav');
  if (!nav) return;
  const signature = `${atlasState.scale}:${atlasState.graph?.stats.nodes ?? 0}`;
  if (!force && signature === scaleRenderSignature) return;
  scaleRenderSignature = signature;
  nav.replaceChildren(...COSMIC_SCALES.map((scale, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'atlas-scale-button';
    button.dataset.scale = scale.key;
    button.setAttribute('aria-pressed', String(atlasState.scale === scale.key));
    button.innerHTML = '<span class="atlas-scale-index"></span><strong></strong><small></small>';
    button.querySelector('.atlas-scale-index')!.textContent = String(index + 1);
    button.querySelector('strong')!.textContent = scale.label;
    button.querySelector('small')!.textContent = scale.eyebrow;
    button.title = scale.hint;
    button.addEventListener('click', () => focusCosmicScale(scale.key));
    return button;
  }));
}

function renderLegend(): void {
  const legend = document.getElementById('atlas-legend');
  if (!legend) return;
  const rows: Array<[StoryMapNodeKind, string]> = [
    ['library', 'Observable Universe'],
    ['repo', 'Supercluster / filament hub'],
    ['branch', 'Galaxy / local group'],
    ['turn', 'Star / committed turn'],
    ['scene', 'Solar system / current scene'],
    ['entity', 'Planet / entity'],
    ['thread', 'Signal / open thread'],
    ['fact', 'Moon / canon fact']
  ];
  legend.replaceChildren(...rows.map(([kind, label]) => {
    const item = document.createElement('div');
    item.className = 'atlas-legend-row';
    item.dataset.kind = kind;
    const dot = document.createElement('span');
    dot.className = 'atlas-legend-dot';
    const text = document.createElement('span');
    text.textContent = label;
    item.append(dot, text);
    return item;
  }));
}

function handleAtlasKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < COSMIC_SCALES.length) {
    event.preventDefault();
    focusCosmicScale(COSMIC_SCALES[index].key);
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    zoomAtlas(1.22);
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    zoomAtlas(1 / 1.22);
  } else if (event.key.toLowerCase() === 'r') {
    event.preventDefault();
    resetAtlasView();
  }
}

function updateSearchHighlight(): void {
  atlasState.hitSet.clear();
  const graph = atlasState.graph;
  const query = atlasState.query;
  if (!graph || !query) return;
  for (const node of graph.nodes) {
    if (nodeMatches(node, query)) atlasState.hitSet.add(node.id);
  }
}

function setAtlasFilter(key: AtlasFilterKey): void {
  atlasState.filter = key;
  updateFilterHighlight();
  renderFilterNav(true);
  const filter = ATLAS_FILTERS.find(item => item.key === key);
  setAtlasStatus(filter ? `Filter: ${filter.label}. ${filter.hint}` : 'Filter updated.');
}

function updateFilterHighlight(): void {
  atlasState.filterSet.clear();
  const graph = atlasState.graph;
  if (!graph || atlasState.filter === 'all') return;
  const addWithAncestors = (id: string): void => {
    const node = graph.nodes.find(item => item.id === id);
    if (!node) return;
    atlasState.filterSet.add(node.id);
    if (node.parentId) addWithAncestors(node.parentId);
    if (node.branchId) {
      const branch = graph.nodes.find(item => item.kind === 'branch' && item.branchId === node.branchId);
      if (branch) atlasState.filterSet.add(branch.id);
    }
    if (node.repoId) {
      const repo = graph.nodes.find(item => item.kind === 'repo' && item.repoId === node.repoId);
      if (repo) atlasState.filterSet.add(repo.id);
    }
    atlasState.filterSet.add(graph.rootId);
  };

  if (atlasState.filter === 'current-branch') {
    const branchId = activeBranchId(graph);
    for (const node of graph.nodes) {
      if (node.branchId === branchId || (node.kind === 'branch' && node.branchId === branchId)) addWithAncestors(node.id);
    }
    return;
  }

  if (atlasState.filter === 'heads') {
    for (const branch of graph.nodes.filter(node => node.kind === 'branch')) {
      addWithAncestors(branch.id);
      const headTurnId = stringFrom(branch.meta?.headTurnId);
      const head = headTurnId ? graph.nodes.find(node => node.kind === 'turn' && (node.turnId === headTurnId || node.meta?.turnId === headTurnId || node.id === `turn:${headTurnId}` || node.id === headTurnId)) : null;
      if (head) addWithAncestors(head.id);
    }
    return;
  }

  if (atlasState.filter === 'open-threads') {
    for (const node of graph.nodes) {
      if (node.kind === 'thread' && isOpenThread(node)) addWithAncestors(node.id);
    }
    return;
  }

  if (atlasState.filter === 'canon') {
    for (const node of graph.nodes) {
      if (['scene', 'entity', 'thread', 'fact'].includes(node.kind)) addWithAncestors(node.id);
    }
  }
}

function activeBranchId(graph: StoryMapResponse): string | null {
  const selected = atlasState.positioned.get(atlasState.selectedId);
  if (selected?.branchId) return selected.branchId;
  const stored = localStorage.getItem(STORAGE.branchId) ?? sessionStorage.getItem(STORAGE.branchId);
  if (stored && graph.nodes.some(node => node.branchId === stored)) return stored;
  return graph.nodes.find(node => node.kind === 'branch')?.branchId ?? null;
}

function isOpenThread(node: StoryMapNode): boolean {
  const status = `${node.status ?? ''} ${node.tags.join(' ')} ${Object.values(node.meta ?? {}).join(' ')}`.toLowerCase();
  return ['open', 'unresolved', 'active', 'quest', 'mystery', 'danger', 'risk'].some(word => status.includes(word));
}

function renderFilterNav(force = false): void {
  const nav = document.getElementById('atlas-filter-nav');
  if (!nav) return;
  const signature = `${atlasState.filter}:${atlasState.graph?.stats.nodes ?? 0}:${atlasState.selectedId}`;
  if (!force && nav.dataset.signature === signature) return;
  nav.dataset.signature = signature;
  nav.replaceChildren(...ATLAS_FILTERS.map(filter => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = filter.label;
    button.title = filter.hint;
    button.setAttribute('aria-pressed', String(atlasState.filter === filter.key));
    button.addEventListener('click', () => setAtlasFilter(filter.key));
    return button;
  }));
}

function renderA11yLayer(graph: StoryMapResponse | null): void {
  const nav = byId<HTMLElement>('atlas-a11y');
  nav.replaceChildren();
  if (!graph) return;
  for (const node of graph.nodes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${node.kind}: ${node.label}`;
    button.addEventListener('click', () => selectNode(node.id, true));
    button.addEventListener('focus', () => selectNode(node.id, true));
    nav.append(button);
  }
}

function renderAuthActions(): void {
  const els = atlasEls();
  const configured = isFirebaseConfigured() && !atlasState.simulated;
  els.signIn.hidden = !configured;
  els.signIn.textContent = atlasState.user ? 'Sign out' : 'Sign in';
  els.signIn.title = atlasState.user ? 'Sign out of Ariadne Atlas' : 'Sign in to Ariadne Atlas';
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
  const scale = scaleByKey(cosmicScaleForKind(node.kind));
  kicker.textContent = `${scale.label} · ${cosmicNounForKind(node.kind)}`;
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
  body.append(scaleContextCard(node, graph));
  if (node.tags.length) body.append(tagList(node.tags));

  const meta = metaList(node);
  if (meta) body.append(meta);

  const actions = actionList(node, graph);
  if (actions) body.append(actions);

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

function scaleContextCard(node: StoryMapNode, graph: StoryMapResponse): HTMLElement {
  const scale = scaleByKey(cosmicScaleForKind(node.kind));
  const card = document.createElement('div');
  card.className = 'atlas-scale-context';
  const rows: Array<[string, string]> = [
    ['Cosmic scale', scale.label],
    ['Ariadne object', labelize(node.kind)],
    ['Map metaphor', cosmicNounForKind(node.kind)]
  ];
  if (node.repoId) rows.push(['Story world', repoTitle(node.repoId, graph)]);
  if (node.branchId) rows.push(['Local galaxy', branchTitle(node.branchId, graph)]);
  for (const [label, value] of rows) {
    const item = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = label;
    const span = document.createElement('span');
    span.textContent = value;
    item.append(strong, span);
    card.append(item);
  }
  return card;
}

function repoTitle(repoId: string, graph: StoryMapResponse): string {
  return graph.nodes.find(node => node.kind === 'repo' && node.repoId === repoId)?.label ?? repoId;
}

function branchTitle(branchId: string, graph: StoryMapResponse): string {
  return graph.nodes.find(node => node.kind === 'branch' && node.branchId === branchId)?.label ?? branchId;
}

function actionList(node: StoryMapNode, graph: StoryMapResponse): HTMLElement | null {
  const actions = document.createElement('div');
  actions.className = 'atlas-action-stack';

  if (node.kind === 'library') {
    appendAction(actions, 'Start new story', 'atlas-primary-action', () => void startNewStoryFromAtlas());
  }

  const continueTarget = continueTargetFor(node, graph);
  if (continueTarget) {
    appendAction(actions, 'Continue this branch', 'atlas-primary-action', () => continueBranch(continueTarget.repoId, continueTarget.branchId));
  }

  const branchId = branchIdForNode(node, graph);
  if (branchId) {
    appendAction(actions, 'Show timeline route', 'atlas-secondary-action', () => void showTimelineRoute(branchId));
    appendAction(actions, 'Open canon debugger', 'atlas-secondary-action', () => void showCanonDebug(branchId));
    const active = activeBranchId(graph);
    if (active && active !== branchId) {
      appendAction(actions, 'Compare with active branch', 'atlas-secondary-action', () => void showBranchCompare(active, branchId));
    }
  }

  const forkTarget = forkTargetFor(node);
  if (forkTarget) {
    appendAction(
      actions,
      node.kind === 'branch' ? 'Fork from branch head' : 'Fork from this star',
      'atlas-secondary-action atlas-fork-action',
      () => void forkFromTurn(forkTarget.repoId, forkTarget.sourceTurnId, node.label)
    );
  }

  if (node.repoId && (node.kind === 'repo' || node.kind === 'branch')) {
    appendAction(actions, 'Export offline archive', 'atlas-secondary-action', () => void exportRepoArchive(node.repoId!, 'json'));
    appendAction(actions, 'Export readable story', 'atlas-secondary-action', () => void exportRepoArchive(node.repoId!, 'markdown'));
  }

  if (node.kind === 'repo' && node.repoId) {
    appendAction(actions, 'Delete story world', 'atlas-secondary-action atlas-danger-action', () => void deleteRepoFromAtlas(node.repoId!, node.label));
  }

  return actions.childElementCount ? actions : null;
}

function appendAction(parent: HTMLElement, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = className;
  action.textContent = label;
  action.addEventListener('click', onClick);
  parent.append(action);
  return action;
}

function branchIdForNode(node: StoryMapNode, graph: StoryMapResponse): string | null {
  if (node.branchId) return node.branchId;
  if (node.kind === 'repo' && node.repoId) return continueTargetFor(node, graph)?.branchId ?? null;
  return null;
}

function forkTargetFor(node: StoryMapNode): { repoId: string; sourceTurnId: string } | null {
  if (!node.repoId) return null;
  if (node.kind === 'turn') {
    const sourceTurnId = stringFrom(node.turnId ?? node.meta?.turnId ?? node.id);
    return sourceTurnId ? { repoId: node.repoId, sourceTurnId } : null;
  }
  if (node.kind === 'branch') {
    const sourceTurnId = stringFrom(node.meta?.headTurnId);
    return sourceTurnId ? { repoId: node.repoId, sourceTurnId } : null;
  }
  return null;
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

async function startNewStoryFromAtlas(): Promise<void> {
  if (atlasState.simulated) {
    setAtlasStatus('Demo galaxy cannot create persisted stories. Open a real story map to start a story.');
    return;
  }
  setAtlasStatus('Starting a new story from Observable Universe...');
  try {
    const config = await atlasFetch<PublicConfig>('/v1/config');
    const result = await atlasPost<CreateRepoResponse>('/v1/repos', {
      title: config.defaultStoryTitle,
      defaultStyle: config.defaultStoryStyle,
      safetyProfile: 'general'
    });
    persistStoryCursor(result.repo.id, result.branch.id);
    setAtlasStatus('New story created. Opening the main branch.');
    window.location.href = storyEntryUrl(result.repo.id, result.branch.id);
  } catch (error) {
    setAtlasStatus(messageFrom(error));
  }
}

function continueBranch(repoId: string, branchId: string): void {
  persistStoryCursor(repoId, branchId);
  window.location.href = storyEntryUrl(repoId, branchId);
}

function persistStoryCursor(repoId: string, branchId: string): void {
  localStorage.setItem(STORAGE.repoId, repoId);
  localStorage.setItem(STORAGE.branchId, branchId);
  sessionStorage.setItem(STORAGE.repoId, repoId);
  sessionStorage.setItem(STORAGE.branchId, branchId);
}

async function forkFromTurn(repoId: string, sourceTurnId: string, selectedLabel: string): Promise<void> {
  if (atlasState.simulated) {
    setAtlasStatus('Demo galaxy cannot create persisted forks. Open a real story map to fork from a star.');
    return;
  }
  const fallbackName = `fork-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
  const name = window.prompt(`Name the new branch from ${selectedLabel}`, fallbackName)?.trim();
  if (!name) return;
  const forkReason = window.prompt('Optional fork reason', 'Explore this moment differently')?.trim() || undefined;
  setAtlasStatus(`Creating branch ${name}...`);
  try {
    const result = await atlasPost<ForkBranchResponse>('/v1/branches/fork', { repoId, sourceTurnId, name, forkReason });
    persistStoryCursor(result.branch.repoId, result.branch.id);
    setAtlasStatus(`Forked ${result.branch.name}. Opening the new branch.`);
    window.location.href = storyEntryUrl(result.branch.repoId, result.branch.id);
  } catch (error) {
    setAtlasStatus(messageFrom(error));
  }
}

function storyEntryUrl(repoId: string, branchId: string): string {
  const params = new URLSearchParams({ repoId, branchId });
  if (atlasState.apiBase && atlasState.apiBase !== window.location.origin) params.set('api', atlasState.apiBase);
  return `/?${params.toString()}`;
}

async function exportRepoArchive(repoId: string, format: 'json' | 'markdown'): Promise<void> {
  if (atlasState.simulated) {
    setAtlasStatus('Demo galaxy cannot export persisted archives. Open a real story map to download an archive.');
    return;
  }
  setAtlasStatus(format === 'markdown' ? 'Preparing readable story export...' : 'Preparing offline archive...');
  try {
    const { blob, filename } = await atlasDownload(`/v1/repos/${encodeURIComponent(repoId)}/export?format=${format}`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setAtlasStatus('Archive downloaded.');
  } catch (error) {
    setAtlasStatus(messageFrom(error));
  }
}

async function deleteRepoFromAtlas(repoId: string, label: string): Promise<void> {
  if (atlasState.simulated) {
    setAtlasStatus('Demo galaxy cannot delete persisted story worlds.');
    return;
  }
  const confirmation = window.prompt(`Type DELETE to permanently delete ${label}. Export first if you need an archive.`)?.trim();
  if (confirmation !== 'DELETE') return;
  setAtlasStatus(`Deleting ${label}...`);
  try {
    await atlasDelete<{ ok: boolean }>(`/v1/repos/${encodeURIComponent(repoId)}`);
    setAtlasStatus(`${label} deleted.`);
    await loadAtlas();
  } catch (error) {
    setAtlasStatus(messageFrom(error));
  }
}

async function showTimelineRoute(branchId: string): Promise<void> {
  const body = atlasEls().detail.querySelector('.atlas-detail-body');
  if (!body) return;
  body.querySelector('.atlas-timeline-panel')?.remove();
  const panel = document.createElement('section');
  panel.className = 'atlas-timeline-panel';
  panel.innerHTML = '<h3>Timeline route</h3><p>Loading committed turns...</p>';
  body.append(panel);
  try {
    const turns = atlasState.simulated
      ? timelineTurnsFromGraph(branchId)
      : (await atlasFetch<BranchTimelineResponse>(`/v1/branches/${encodeURIComponent(branchId)}/timeline`)).timeline;
    renderTimelinePanel(panel, branchId, turns);
  } catch (error) {
    panel.replaceChildren(timelineHeading(), paragraph(messageFrom(error)));
  }
}

function renderTimelinePanel(panel: HTMLElement, branchId: string, turns: TimelineTurn[]): void {
  const heading = timelineHeading();
  if (!turns.length) {
    panel.replaceChildren(heading, paragraph('No committed turns on this branch yet.'));
    return;
  }
  const controls = document.createElement('div');
  controls.className = 'atlas-timeline-controls';
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.textContent = 'Replay branch';
  replay.addEventListener('click', () => startBranchReplay(branchId, turns));
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = 'Stop replay';
  stop.addEventListener('click', () => stopReplay('Replay stopped.'));
  controls.append(replay, stop);

  const list = document.createElement('ol');
  for (const turn of turns.slice(-24)) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Turn ${turn.turnIndex ?? '?'} · ${clipText(turn.userTranscript || turn.assistantTranscript || turn.id, 96)}`;
    const nodeId = turnNodeIdInGraph(turn.id, branchId);
    if (nodeId) button.addEventListener('click', () => selectNode(nodeId, true));
    else button.disabled = true;
    item.append(button);
    list.append(item);
  }
  panel.replaceChildren(heading, controls, list);
}

function startBranchReplay(branchId: string, turns: TimelineTurn[]): void {
  const replayTurns = turns
    .map(turn => ({ turn, nodeId: turnNodeIdInGraph(turn.id, branchId) }))
    .filter((item): item is { turn: TimelineTurn; nodeId: string } => Boolean(item.nodeId));
  if (!replayTurns.length) {
    setAtlasStatus('No visible timeline stars are available to replay.');
    return;
  }
  stopReplay();
  let index = 0;
  const step = () => {
    const item = replayTurns[index];
    if (!item) {
      stopReplay('Replay complete.');
      return;
    }
    selectNode(item.nodeId, true);
    setAtlasStatus(`Replaying turn ${item.turn.turnIndex ?? index + 1} of ${replayTurns.length}.`);
    index += 1;
    replayTimerId = window.setTimeout(step, 1450);
  };
  step();
}

function stopReplay(status?: string): void {
  if (replayTimerId !== null) {
    window.clearTimeout(replayTimerId);
    replayTimerId = null;
  }
  if (status) setAtlasStatus(status);
}

async function showBranchCompare(leftBranchId: string, rightBranchId: string): Promise<void> {
  const body = atlasEls().detail.querySelector('.atlas-detail-body');
  if (!body) return;
  body.querySelector('.atlas-compare-panel')?.remove();
  const panel = document.createElement('section');
  panel.className = 'atlas-compare-panel';
  panel.innerHTML = '<h3>Branch compare</h3><p>Calculating divergence...</p>';
  body.append(panel);
  try {
    const data = atlasState.simulated
      ? simulatedBranchCompare(leftBranchId, rightBranchId)
      : await atlasFetch<BranchCompareResponse>(`/v1/branches/compare?leftBranchId=${encodeURIComponent(leftBranchId)}&rightBranchId=${encodeURIComponent(rightBranchId)}`);
    renderBranchComparePanel(panel, data);
  } catch (error) {
    panel.replaceChildren(panelHeading('Branch compare'), paragraph(messageFrom(error)));
  }
}

function renderBranchComparePanel(panel: HTMLElement, data: BranchCompareResponse): void {
  const heading = panelHeading('Branch compare');
  const summary = document.createElement('div');
  summary.className = 'atlas-mini-grid';
  summary.append(
    miniStat('Common ancestor', data.commonAncestorTurnIndex ? `Turn ${data.commonAncestorTurnIndex}` : 'Root or none'),
    miniStat(`${data.left.branch.name} unique`, data.left.uniqueTurns.length),
    miniStat(`${data.right.branch.name} unique`, data.right.uniqueTurns.length),
    miniStat('Scene changed', data.stateDiff.sceneChanged ? 'Yes' : 'No')
  );

  const columns = document.createElement('div');
  columns.className = 'atlas-compare-columns';
  columns.append(compareSideBlock('Active branch', data.left, data.left.branch.id), compareSideBlock('Selected branch', data.right, data.right.branch.id));

  const diff = document.createElement('div');
  diff.className = 'atlas-diff-summary';
  diff.append(
    paragraph(`Entities: ${data.stateDiff.entities.leftOnly.length} only on active, ${data.stateDiff.entities.rightOnly.length} only on selected, ${data.stateDiff.entities.changed.length} changed.`),
    paragraph(`Threads: ${data.stateDiff.threads.leftOnly.length} only on active, ${data.stateDiff.threads.rightOnly.length} only on selected, ${data.stateDiff.threads.changed.length} changed.`),
    paragraph(`Facts: ${data.stateDiff.facts.leftOnly.length} only on active, ${data.stateDiff.facts.rightOnly.length} only on selected.`)
  );

  panel.replaceChildren(heading, summary, columns, diff);
}

function compareSideBlock(label: string, side: BranchCompareResponse['left'], branchId: string): HTMLElement {
  const block = document.createElement('section');
  const title = document.createElement('h4');
  title.textContent = `${label}: ${side.branch.name}`;
  const copy = paragraph(`${side.totalTurns} total turns${side.sceneSummary ? ` · ${clipText(side.sceneSummary, 80)}` : ''}`);
  const list = document.createElement('ol');
  for (const turn of side.uniqueTurns.slice(0, 8)) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Turn ${turn.turnIndex}: ${clipText(turn.userTranscript || turn.assistantTranscript || turn.id, 76)}`;
    const nodeId = turnNodeIdInGraph(turn.id, branchId);
    if (nodeId) button.addEventListener('click', () => selectNode(nodeId, true));
    else button.disabled = true;
    item.append(button);
    list.append(item);
  }
  if (!side.uniqueTurns.length) {
    const item = document.createElement('li');
    item.append(paragraph('No unique turns after the common ancestor.'));
    list.append(item);
  }
  block.append(title, copy, list);
  return block;
}

async function showCanonDebug(branchId: string): Promise<void> {
  const body = atlasEls().detail.querySelector('.atlas-detail-body');
  if (!body) return;
  body.querySelector('.atlas-canon-panel')?.remove();
  const panel = document.createElement('section');
  panel.className = 'atlas-canon-panel';
  panel.innerHTML = '<h3>Canon debugger</h3><p>Loading compiled state...</p>';
  body.append(panel);
  try {
    const data = atlasState.simulated
      ? simulatedCanonDebug(branchId)
      : await atlasFetch<CanonDebugResponse>(`/v1/branches/${encodeURIComponent(branchId)}/canon`);
    renderCanonDebugPanel(panel, data);
  } catch (error) {
    panel.replaceChildren(panelHeading('Canon debugger'), paragraph(messageFrom(error)));
  }
}

function renderCanonDebugPanel(panel: HTMLElement, data: CanonDebugResponse): void {
  const heading = panelHeading('Canon debugger');
  const stats = document.createElement('div');
  stats.className = 'atlas-mini-grid';
  stats.append(
    miniStat('Turns', data.stats.turns),
    miniStat('Entities', data.stats.entities),
    miniStat('Open threads', data.stats.openThreads),
    miniStat('Audio assets', data.stats.audioAssets)
  );

  const scene = document.createElement('div');
  scene.className = 'atlas-debug-card';
  const sceneTitle = document.createElement('h4');
  sceneTitle.textContent = 'Scene';
  scene.append(sceneTitle, paragraph(data.state?.scene?.summary || 'No compiled scene summary yet.'));
  if (data.state?.contextBudget) {
    scene.append(paragraph(`Context: ${data.state.contextBudget.mode ?? 'unknown'} · ${data.state.contextBudget.estimatedTokens ?? 0}/${data.state.contextBudget.safeBudgetTokens ?? 0} tokens · ~${data.state.contextBudget.remainingTurnBudget ?? 0} turns left.`));
  }

  const threads = document.createElement('div');
  threads.className = 'atlas-debug-card';
  const threadTitle = document.createElement('h4');
  threadTitle.textContent = 'Open story threads';
  threads.append(threadTitle);
  if (data.openThreads.length) {
    const list = document.createElement('ul');
    for (const thread of data.openThreads.slice(0, 8)) {
      const item = document.createElement('li');
      item.textContent = `${thread.priority ? `P${thread.priority} · ` : ''}${thread.summary ?? thread.threadId ?? 'Open thread'}`;
      list.append(item);
    }
    threads.append(list);
  } else {
    threads.append(paragraph('No open or advanced threads.'));
  }

  const raw = document.createElement('details');
  raw.className = 'atlas-debug-json';
  const rawSummary = document.createElement('summary');
  rawSummary.textContent = 'Compiled state JSON';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(data.state ?? {}, null, 2);
  raw.append(rawSummary, pre);

  panel.replaceChildren(heading, stats, scene, threads, raw);
}

function simulatedBranchCompare(leftBranchId: string, rightBranchId: string): BranchCompareResponse {
  const left = timelineTurnsFromGraph(leftBranchId).map(simulatedTurnSummary);
  const right = timelineTurnsFromGraph(rightBranchId).map(simulatedTurnSummary);
  const common = left.find(turn => right.some(other => other.id === turn.id)) ?? null;
  return {
    generatedAt: new Date().toISOString(),
    repoId: branchRepoId(leftBranchId) ?? 'demo',
    commonAncestorTurnId: common?.id ?? null,
    commonAncestorTurnIndex: common?.turnIndex ?? null,
    left: {
      branch: { id: leftBranchId, name: branchTitle(leftBranchId, atlasState.graph!) },
      totalTurns: left.length,
      uniqueTurns: left,
      sceneSummary: ''
    },
    right: {
      branch: { id: rightBranchId, name: branchTitle(rightBranchId, atlasState.graph!) },
      totalTurns: right.length,
      uniqueTurns: right,
      sceneSummary: ''
    },
    stateDiff: {
      sceneChanged: leftBranchId !== rightBranchId,
      entities: { leftOnly: [], rightOnly: [], changed: [] },
      facts: { leftOnly: [], rightOnly: [] },
      threads: { leftOnly: [], rightOnly: [], changed: [] }
    }
  };
}

function simulatedTurnSummary(turn: TimelineTurn): TimelineTurnSummary {
  return {
    id: turn.id,
    turnIndex: turn.turnIndex ?? 0,
    userTranscript: turn.userTranscript ?? '',
    assistantTranscript: turn.assistantTranscript ?? '',
    stateStatus: turn.stateStatus ?? 'canonized',
    parentTurnId: null,
    createdAt: turn.createdAt ?? new Date().toISOString()
  };
}

function simulatedCanonDebug(branchId: string): CanonDebugResponse {
  const graph = atlasState.graph;
  const nodes = graph?.nodes.filter(node => node.branchId === branchId) ?? [];
  const threads = nodes.filter(node => node.kind === 'thread').map(node => ({ summary: node.summary ?? node.label, status: node.status ?? 'open' }));
  return {
    generatedAt: new Date().toISOString(),
    branch: { id: branchId, name: graph ? branchTitle(branchId, graph) : branchId },
    state: {
      scene: { summary: nodes.find(node => node.kind === 'scene')?.summary ?? 'Simulated scene', presentEntityIds: [] },
      entities: Object.fromEntries(nodes.filter(node => node.kind === 'entity').map(node => [node.id, { label: node.label, status: node.status }])),
      facts: nodes.filter(node => node.kind === 'fact').map(node => ({ label: node.label, summary: node.summary })),
      threads
    },
    latestTurn: timelineTurnsFromGraph(branchId).map(simulatedTurnSummary).at(-1) ?? null,
    stats: {
      turns: nodes.filter(node => node.kind === 'turn').length,
      entities: nodes.filter(node => node.kind === 'entity').length,
      facts: nodes.filter(node => node.kind === 'fact').length,
      threads: threads.length,
      openThreads: threads.filter(thread => thread.status === 'open' || thread.status === 'advanced').length,
      resolvedThreads: threads.filter(thread => thread.status === 'resolved').length,
      audioAssets: 0
    },
    openThreads: threads.filter(thread => thread.status === 'open' || thread.status === 'advanced'),
    audioAssets: []
  };
}

function branchRepoId(branchId: string): string | null {
  return atlasState.graph?.nodes.find(node => node.kind === 'branch' && node.branchId === branchId)?.repoId ?? null;
}

function panelHeading(text: string): HTMLElement {
  const heading = document.createElement('h3');
  heading.textContent = text;
  return heading;
}

function miniStat(label: string, value: string | number): HTMLElement {
  const item = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = String(value);
  const span = document.createElement('span');
  span.textContent = label;
  item.append(strong, span);
  return item;
}

function timelineTurnsFromGraph(branchId: string): TimelineTurn[] {
  const graph = atlasState.graph;
  if (!graph) return [];
  return graph.nodes
    .filter(node => node.kind === 'turn' && node.branchId === branchId)
    .sort((a, b) => numberFrom(a.meta?.turnIndex) - numberFrom(b.meta?.turnIndex))
    .map(node => ({
      id: stringFrom(node.turnId ?? node.meta?.turnId ?? node.id),
      turnIndex: numberFrom(node.meta?.turnIndex),
      userTranscript: node.summary ?? node.label,
      assistantTranscript: '',
      createdAt: node.createdAt ?? undefined
    }));
}

function turnNodeIdInGraph(turnId: string, branchId: string): string | null {
  const graph = atlasState.graph;
  if (!graph) return null;
  return graph.nodes.find(node => (node.turnId === turnId || node.meta?.turnId === turnId || node.id === turnId) && node.branchId === branchId)?.id ?? null;
}

function timelineHeading(): HTMLElement {
  const heading = document.createElement('h3');
  heading.textContent = 'Timeline route';
  return heading;
}

function paragraph(text: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
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
  const query = atlasState.query;
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

async function runTimeMachineSearch(): Promise<void> {
  const els = atlasEls();
  const query = els.search.value.trim();
  if (!query) {
    els.rewindResults.replaceChildren(paragraph('Describe the moment you want to find, like "before the betrayal at the inn."'));
    return;
  }
  setAtlasStatus('Searching story memory...');
  els.rewindResults.replaceChildren(paragraph('Searching committed timelines and canon landmarks...'));
  try {
    const selected = atlasState.graph?.nodes.find(node => node.id === atlasState.selectedId) ?? null;
    const params = new URLSearchParams({ q: query, limit: '12' });
    if (selected?.repoId) params.set('repoId', selected.repoId);
    if (selected?.branchId) params.set('branchId', selected.branchId);
    const response = atlasState.simulated
      ? { query, generatedAt: new Date().toISOString(), results: simulatedStorySearch(query) }
      : await atlasFetch<StorySearchResponse>(`/v1/story-search?${params.toString()}`);
    renderTimeMachineResults(response.results, query);
    setAtlasStatus(response.results.length ? `Found ${response.results.length} rewind candidate${response.results.length === 1 ? '' : 's'}.` : 'No rewind candidates found.');
  } catch (error) {
    els.rewindResults.replaceChildren(paragraph(messageFrom(error)));
    setAtlasStatus(messageFrom(error));
  }
}

function renderTimeMachineResults(results: StorySearchResult[], query: string): void {
  const target = atlasEls().rewindResults;
  if (!results.length) {
    target.replaceChildren(paragraph(`No memory matched “${query}”. Try a character, place, object, or phrase from the scene.`));
    return;
  }
  const list = document.createElement('div');
  list.className = 'atlas-rewind-list';
  for (const result of results.slice(0, 12)) {
    const item = document.createElement('article');
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'atlas-rewind-select';
    title.innerHTML = '<strong></strong><span></span><small></small>';
    title.querySelector('strong')!.textContent = result.label;
    title.querySelector('span')!.textContent = `${result.repoTitle}${result.branchName ? ` / ${result.branchName}` : ''}${result.turnIndex ? ` / turn ${result.turnIndex}` : ''}`;
    title.querySelector('small')!.textContent = clipText(result.excerpt || result.kind, 180);
    title.addEventListener('click', () => selectSearchResult(result));
    item.append(title);

    if (result.forkSourceTurnId && result.repoId) {
      const fork = document.createElement('button');
      fork.type = 'button';
      fork.className = 'atlas-rewind-fork';
      fork.textContent = result.rewindMode === 'before' ? 'Fork before this' : 'Fork here';
      fork.disabled = atlasState.simulated;
      fork.addEventListener('click', () => void forkFromTurn(result.repoId, result.forkSourceTurnId!, result.label));
      item.append(fork);
    }
    list.append(item);
  }
  target.replaceChildren(list);
}

function selectSearchResult(result: StorySearchResult): void {
  const node = nodeForSearchResult(result);
  if (!node) {
    setAtlasStatus('This memory exists in the archive but is outside the current visible graph cap.');
    return;
  }
  selectNode(node.id, true);
}

function nodeForSearchResult(result: StorySearchResult): StoryMapNode | null {
  const graph = atlasState.graph;
  if (!graph) return null;
  if (result.turnId && result.branchId) {
    const turnNode = graph.nodes.find(node => (node.turnId === result.turnId || node.meta?.turnId === result.turnId || node.id === `turn:${result.turnId}`) && node.branchId === result.branchId);
    if (turnNode) return turnNode;
  }
  return graph.nodes.find(node => node.id === result.id)
    ?? graph.nodes.find(node => node.kind === result.kind && node.branchId === result.branchId && node.label === result.label)
    ?? graph.nodes.find(node => node.kind === result.kind && node.repoId === result.repoId && node.label === result.label)
    ?? null;
}

function simulatedStorySearch(query: string): StorySearchResult[] {
  const graph = atlasState.graph;
  if (!graph) return [];
  const terms = simpleQueryTerms(query);
  return graph.nodes
    .filter(node => node.kind !== 'library')
    .map(node => ({ node, score: simpleNodeScore(node, terms, query) }))
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || searchRank(a.node) - searchRank(b.node))
    .slice(0, 12)
    .map(({ node, score }) => {
      const turnId = stringFrom(node.turnId ?? node.meta?.turnId);
      const headTurnId = stringFrom(node.meta?.headTurnId);
      return {
        id: node.id,
        kind: node.kind,
        repoId: node.repoId ?? '',
        repoTitle: node.repoId && graph ? repoTitle(node.repoId, graph) : 'Demo world',
        branchId: node.branchId ?? undefined,
        branchName: node.branchId && graph ? branchTitle(node.branchId, graph) : undefined,
        turnId: turnId || undefined,
        turnIndex: numberFrom(node.meta?.turnIndex) || undefined,
        label: node.label,
        excerpt: node.summary ?? node.tags.join(' · '),
        score,
        matchedTerms: terms.slice(0, 6),
        rewindMode: /\b(before|rewind|back|prior|earlier)\b/i.test(query) ? 'before' as const : 'at' as const,
        forkSourceTurnId: node.kind === 'turn' ? turnId || null : headTurnId || null,
        forkLabel: node.kind === 'turn' ? 'Fork from this demo star' : undefined,
        createdAt: node.createdAt ?? null
      };
    });
}

function simpleQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 2 && !['the', 'and', 'before', 'after', 'back', 'where', 'when'].includes(term));
}

function simpleNodeScore(node: StoryMapNode, terms: string[], query: string): number {
  const haystack = [node.label, node.summary ?? '', node.kind, node.status ?? '', ...node.tags, ...Object.values(node.meta ?? {}).map(String)].join(' ').toLowerCase();
  let score = haystack.includes(query.toLowerCase()) ? 20 : 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += node.label.toLowerCase().includes(term) ? 8 : 3;
  }
  if (node.kind === 'turn') score += 2;
  return score;
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

function emptyAtlasState(message: string): HTMLElement {
  const existing = document.querySelector('.atlas-empty');
  if (existing) existing.remove();
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
  searchForm: HTMLFormElement;
  search: HTMLInputElement;
  rewindResults: HTMLElement;
  status: HTMLElement;
  stats: HTMLElement;
  map: HTMLElement;
  results: HTMLElement;
  detail: HTMLElement;
  scaleNav: HTMLElement;
  filterNav: HTMLElement;
  legend: HTMLElement;
} {
  return {
    signIn: byId<HTMLButtonElement>('atlas-sign-in'),
    searchForm: byId<HTMLFormElement>('atlas-search-form'),
    search: byId<HTMLInputElement>('atlas-search'),
    rewindResults: byId<HTMLElement>('atlas-rewind-results'),
    status: byId<HTMLElement>('atlas-status'),
    stats: byId<HTMLElement>('atlas-stats'),
    map: byId<HTMLElement>('atlas-map'),
    results: byId<HTMLElement>('atlas-results'),
    detail: byId<HTMLElement>('atlas-detail'),
    scaleNav: byId<HTMLElement>('atlas-scale-nav'),
    filterNav: byId<HTMLElement>('atlas-filter-nav'),
    legend: byId<HTMLElement>('atlas-legend')
  };
}

function shouldUseSimulatedAtlas(): boolean {
  const params = new URLSearchParams(window.location.search);
  return ['atlas', '1', 'true'].includes(params.get('mock') ?? '')
    || ['atlas', '1', 'true'].includes(params.get('demo') ?? '')
    || ['atlas', '1', 'true'].includes(params.get('simulate') ?? '');
}

function simulatedStoryMap(): StoryMapResponse {
  type DemoBranch = {
    id: string;
    label: string;
    summary: string;
    tags: string[];
    turns: string[];
    scene: [string, string, string[]];
    entities: Array<[string, string, string, string[]]>;
    threads: Array<[string, string, string[]]>;
    facts: Array<[string, string, string[]]>;
    forkedFromTurnId?: string;
  };
  type DemoWorld = {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    branches: DemoBranch[];
  };

  const worlds: DemoWorld[] = [
    {
      id: 'glass',
      title: 'The Glass Labyrinth',
      summary: 'A mythic city of mirrors, debts, and half-remembered doors.',
      tags: ['mystery', 'city', 'mirror-court'],
      branches: [
        {
          id: 'glass-main',
          label: 'main',
          summary: 'The current path through the labyrinth.',
          tags: ['current', 'main'],
          turns: ['Crossed the silver market', 'Found the backward stair', 'Named the debt collector', 'Opened the black-glass door', 'Woke the observatory mirror'],
          scene: ['Black-glass observatory', 'A locked observatory reflects stars that have not happened yet.', ['scene', 'observatory', 'door']],
          entities: [
            ['player', 'The player', 'active - carrying a brass key', ['player', 'present']],
            ['archivist', 'Mirror Archivist', 'keeper - wary - knows the cost of names', ['npc', 'present']],
            ['lantern', 'Brass Lantern', 'lit - reveals writing in glass', ['tool', 'known']]
          ],
          threads: [['debt', 'Mirror debt', ['unresolved', 'debt']], ['choir', 'Glass choir', ['mystery', 'sound']]],
          facts: [['oath', 'Names bind doors', ['rule', 'magic']], ['silver', 'Silver cannot lie', ['law', 'city']]]
        },
        {
          id: 'glass-mirror',
          label: 'mirror bargain',
          summary: 'A fork where the archivist accepted the mirror debt.',
          tags: ['fork', 'risk'],
          forkedFromTurnId: 'turn:glass-main:2',
          turns: ['Accepted the mirror bargain', 'Lost a reflected name', 'Bought a second shadow'],
          scene: ['Court of Reflections', 'A circular court bargains with copies of everyone who enters.', ['scene', 'court', 'danger']],
          entities: [['double', 'The Reflected Double', 'smiling - owns one true memory', ['npc', 'copy']]],
          threads: [['identity', 'Stolen identity', ['open', 'identity']]],
          facts: [['price', 'Every reflection asks a price', ['rule', 'mirror']]]
        }
      ]
    },
    {
      id: 'nocturne',
      title: 'Nocturne Sea',
      summary: 'A moonlit archipelago where memories surface as weather.',
      tags: ['ocean', 'dreamlike', 'voyage'],
      branches: [
        {
          id: 'nocturne-main',
          label: 'main',
          summary: 'The tide-road toward the singing lighthouse.',
          tags: ['main', 'voyage'],
          turns: ['Raised the lantern sail', 'Heard the reef choir', 'Mapped the moon-current', 'Followed the impossible gull'],
          scene: ['Reef choir', 'Moonlit coral sings beneath the hull.', ['scene', 'sea', 'music']],
          entities: [['captain-vale', 'Captain Vale', 'suspicious - follows impossible currents', ['npc', 'present']], ['reef-child', 'Reef Child', 'curious - speaks in bubbles', ['npc', 'strange']]],
          threads: [['lighthouse', 'Singing lighthouse', ['quest', 'open']], ['mutiny', 'Lantern mutiny', ['risk', 'crew']]],
          facts: [['tide', 'Memory tide', ['world-rule']], ['songs', 'Songs are coordinates', ['navigation', 'magic']]]
        },
        {
          id: 'nocturne-deep',
          label: 'undersea route',
          summary: 'A dive through drowned constellations beneath the Nocturne Sea.',
          tags: ['fork', 'undersea'],
          forkedFromTurnId: 'turn:nocturne-main:3',
          turns: ['Sank below the moonline', 'Met the whale library', 'Borrowed a drowned map'],
          scene: ['Whale library', 'An ancient whale carries shelves of salt-stained memory.', ['scene', 'library', 'deep']],
          entities: [['whale', 'Cathedral Whale', 'patient - remembers extinct ports', ['entity', 'ancient']]],
          threads: [['borrowed-map', 'Borrowed drowned map', ['quest', 'debt']]],
          facts: [['breath', 'Breath can be banked', ['survival', 'rule']]]
        }
      ]
    },
    {
      id: 'orchard',
      title: 'The Iron Orchard',
      summary: 'A frontier of clockwork trees, rust saints, and harvest machines.',
      tags: ['frontier', 'clockwork', 'industrial-fable'],
      branches: [
        {
          id: 'orchard-main',
          label: 'main',
          summary: 'The route into the machine-grown apple grove.',
          tags: ['main', 'frontier'],
          turns: ['Entered the rust gate', 'Bartered with the scarecrow engine', 'Found a ticking seed', 'Ran from the harvesters', 'Planted the impossible apple', 'Heard the saint in the gears'],
          scene: ['Clockwork grove', 'Metal branches grind overhead while fruit ticks like pocket watches.', ['scene', 'orchard', 'machines']],
          entities: [['scarecrow', 'Scarecrow Engine', 'merchant - sells warnings', ['npc', 'machine']], ['seed', 'Ticking Seed', 'warm - counts down to bloom', ['item', 'urgent']]],
          threads: [['harvest', 'Harvester pursuit', ['danger', 'open']], ['saint', 'Rust saint prophecy', ['prophecy', 'mystery']]],
          facts: [['iron-fruit', 'Iron fruit stores time', ['rule', 'time']], ['rain', 'Rain makes machines dream', ['weather', 'magic']]]
        }
      ]
    },
    {
      id: 'violet',
      title: 'Violet Archive',
      summary: 'A floating library where forbidden chapters orbit like moons.',
      tags: ['library', 'cosmic', 'secrets'],
      branches: [
        {
          id: 'violet-main',
          label: 'main',
          summary: 'The search for the missing index star.',
          tags: ['main', 'archive'],
          turns: ['Docked at the quiet shelf', 'Stole a forbidden footnote', 'Chased the index star', 'Read the page that reads back'],
          scene: ['Index atrium', 'Bookshelves curve into orbit around a violet index star.', ['scene', 'archive', 'star']],
          entities: [['librarian', 'Violet Librarian', 'calm - dangerous - catalogues secrets', ['npc', 'keeper']], ['footnote', 'Forbidden Footnote', 'whispers alternate endings', ['item', 'secret']]],
          threads: [['index-star', 'Missing index star', ['quest', 'open']], ['redaction', 'Living redaction', ['threat', 'text']]],
          facts: [['chapters', 'Chapters have gravity', ['world-rule']], ['silence', 'Silence is a library tax', ['custom', 'price']]]
        },
        {
          id: 'violet-redacted',
          label: 'redacted ending',
          summary: 'A dangerous branch where the living redaction escapes its page.',
          tags: ['fork', 'threat'],
          forkedFromTurnId: 'turn:violet-main:2',
          turns: ['Unsealed the redaction', 'Lost the chapter title', 'Followed black ink through space'],
          scene: ['Black ink corridor', 'A corridor of moving ink cuts through the archive like a wound.', ['scene', 'ink', 'escape']],
          entities: [['redaction', 'Living Redaction', 'hungry - eats proper nouns', ['threat', 'present']]],
          threads: [['eaten-title', 'Eaten chapter title', ['mystery', 'identity']]],
          facts: [['black-ink', 'Black ink cuts maps', ['rule', 'archive']]]
        }
      ]
    }
  ];

  const nodes: StoryMapNode[] = [
    node('library:ariadne', 'library', 'Observable Universe', 'Every story world, branch galaxy, timeline star, and canon landmark in the player\'s current Ariadne cosmos.', null, 11, ['observable-universe', 'galaxy-mode'], { owner: 'simulated-player', scale: 'observable' })
  ];
  const links: StoryMapLink[] = [];
  const repos: StoryMapRepoSummary[] = [];

  for (const world of worlds) {
    const repoNodeId = `repo:${world.id}`;
    nodes.push(node(repoNodeId, 'repo', world.title, world.summary, 'library:ariadne', 7 + world.branches.length, ['supercluster', ...world.tags], { repoId: world.id, safety: 'general', scale: 'supercluster' }, world.id));
    links.push(link('library:ariadne', repoNodeId, 'contains', 3));
    let turnCount = 0;
    let entityCount = 0;
    let threadCount = 0;

    for (const branch of world.branches) {
      const branchNodeId = `branch:${branch.id}`;
      const headTurnId = `turn:${branch.id}:${branch.turns.length}`;
      nodes.push(node(branchNodeId, 'branch', branch.label, branch.summary, repoNodeId, 3.2 + branch.turns.length * 0.16, ['galaxy', ...branch.tags], { branchId: branch.id, headTurnId, forkedFromTurnId: branch.forkedFromTurnId ?? null, scale: 'galactic' }, world.id, branch.id));
      links.push(link(repoNodeId, branchNodeId, branch.forkedFromTurnId ? 'fork' : 'contains', 2));
      if (branch.forkedFromTurnId) links.push(link(branch.forkedFromTurnId, branchNodeId, 'fork', 1.7));

      let previousTurnId: string | null = null;
      for (let i = 0; i < branch.turns.length; i += 1) {
        const turnId = `turn:${branch.id}:${i + 1}`;
        nodes.push(turn(turnId, branch.turns[i], world.id, branch.id, i + 1));
        links.push(link(previousTurnId ?? branchNodeId, turnId, 'timeline', 1.2));
        previousTurnId = turnId;
        turnCount += 1;
      }
      links.push(link(branchNodeId, headTurnId, 'head', 1.9));

      const sceneId = `scene:${branch.id}`;
      nodes.push(stateNode(sceneId, 'scene', branch.scene[0], branch.scene[1], world.id, branch.id, branchNodeId, 2.7, branch.scene[2], { locationId: branch.scene[0].toLowerCase().replace(/\s+/g, '-'), scale: 'stellar' }));
      links.push(link(branchNodeId, sceneId, 'state', 2.1));
      for (const [id, label, summary, tags] of branch.entities) {
        const entityId = `entity:${branch.id}:${id}`;
        nodes.push(stateNode(entityId, 'entity', label, summary, world.id, branch.id, sceneId, 1.9, ['planet', ...tags], { present: true, scale: 'landmark' }));
        links.push(link(sceneId, entityId, 'present', 1.4));
        entityCount += 1;
      }
      for (const [id, label, tags] of branch.threads) {
        const threadId = `thread:${branch.id}:${id}`;
        nodes.push(stateNode(threadId, 'thread', label, `Open story thread in ${branch.label}.`, world.id, branch.id, branchNodeId, 1.5, ['signal', ...tags], { status: 'open', scale: 'landmark' }));
        links.push(link(branchNodeId, threadId, 'state', 1.2));
        links.push(link(headTurnId, threadId, 'mentions', 0.9));
        threadCount += 1;
      }
      for (const [id, label, tags] of branch.facts) {
        const factId = `fact:${branch.id}:${id}`;
        nodes.push(stateNode(factId, 'fact', label, `Canon rule remembered by ${branch.label}.`, world.id, branch.id, branchNodeId, 1.1, ['moon', ...tags], { certainty: 'high', scale: 'landmark' }));
        links.push(link(branchNodeId, factId, 'state', 1));
      }
    }

    repos.push({
      id: world.id,
      title: world.title,
      branchCount: world.branches.length,
      turnCount,
      entityCount,
      threadCount,
      updatedAt: '2026-06-17T06:30:00.000Z'
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    rootId: 'library:ariadne',
    nodes,
    links,
    repos,
    stats: {
      repos: repos.length,
      branches: nodes.filter(item => item.kind === 'branch').length,
      turns: nodes.filter(item => item.kind === 'turn').length,
      entities: nodes.filter(item => item.kind === 'entity').length,
      threads: nodes.filter(item => item.kind === 'thread').length,
      facts: nodes.filter(item => item.kind === 'fact').length,
      warnings: 1,
      nodes: nodes.length,
      links: links.length
    },
    warnings: ['Simulated Google Galaxy mode data: not persisted to the story store.']
  };
}

function node(
  id: string,
  kind: StoryMapNodeKind,
  label: string,
  summary: string,
  parentId: string | null,
  weight: number,
  tags: string[],
  meta: Record<string, string | number | boolean | null>,
  repoId?: string,
  branchId?: string
): StoryMapNode {
  return {
    id,
    kind,
    label,
    summary,
    parentId,
    repoId: repoId ?? null,
    branchId: branchId ?? null,
    weight,
    tags,
    status: String(meta.status ?? tags[1] ?? ''),
    createdAt: '2026-06-17T04:00:00.000Z',
    updatedAt: '2026-06-17T06:30:00.000Z',
    meta
  };
}

function turn(id: string, label: string, repoId: string, branchId: string, turnIndex: number): StoryMapNode {
  return node(id, 'turn', label, `Committed turn ${turnIndex}.`, `branch:${branchId}`, 1.2 + turnIndex * 0.2, ['turn', `#${turnIndex}`], { turnIndex, turnId: id }, repoId, branchId);
}

function stateNode(
  id: string,
  kind: Extract<StoryMapNodeKind, 'scene' | 'entity' | 'thread' | 'fact'>,
  label: string,
  summary: string,
  repoId: string,
  branchId: string,
  parentId: string,
  weight: number,
  tags: string[],
  meta: Record<string, string | number | boolean | null>
): StoryMapNode {
  return node(id, kind, label, summary, parentId, weight, tags, meta, repoId, branchId);
}

function link(source: string, target: string, kind: StoryMapLinkKind, weight: number): StoryMapLink {
  return {
    id: `${kind}:${source}->${target}`,
    source,
    target,
    kind,
    weight
  };
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
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

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
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

function copyView(view: ViewState): ViewState {
  return {
    cx: view.cx,
    cy: view.cy,
    cz: view.cz,
    distance: view.distance,
    yaw: view.yaw,
    pitch: view.pitch
  };
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function angleDelta(to: number, from: number): number {
  return normalizeAngle(to - from);
}

function midpoint(a: ActivePointer, b: ActivePointer): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function distanceBetween(a: ActivePointer, b: ActivePointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].replace(/^\"|\"$/g, ''));
    } catch {
      return utfMatch[1].replace(/^\"|\"$/g, '');
    }
  }
  const plainMatch = /filename=\"?([^\";]+)\"?/i.exec(disposition);
  return plainMatch?.[1]?.trim() || null;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message);
  return 'Unexpected error.';
}
