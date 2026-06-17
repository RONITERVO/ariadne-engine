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
  z: number;
  r: number;
  baseR: number;
  labelVisible: boolean;
  angle: number;
  orbitSpeed: number;
};

type OrbitRing = {
  cx: number;
  cy: number;
  cz: number;
  r: number;
  kind: 'library' | 'repo' | 'branch';
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

const STORAGE = {
  repoId: 'ariadne.repoId',
  branchId: 'ariadne.branchId'
} as const;

const DEFAULT_VIEW: ViewState = {
  cx: 0,
  cy: 0,
  cz: 0,
  distance: 980,
  yaw: -0.42,
  pitch: 0.58
};

const CAMERA = {
  minDistance: 120,
  maxDistance: 3400,
  minPitch: -1.18,
  maxPitch: 1.22,
  dragYaw: 0.0052,
  dragPitch: 0.0032,
  pan: 0.0017,
  zoom: 0.0012
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
  hitSet: new Set()
};

let renderer: GalaxyRenderer | null = null;

export function startStoryAtlasApp(options: StoryAtlasOptions): void {
  atlasState.apiBase = options.apiBase.replace(/\/$/, '');
  atlasState.simulated = shouldUseSimulatedAtlas();
  document.title = 'Ariadne Atlas';
  document.body.classList.add('atlas-body');
  document.body.innerHTML = `
    <main class="atlas-shell" aria-label="Ariadne story atlas">
      <section class="atlas-map-panel" aria-label="Interactive story galaxy">
        <div id="atlas-map" class="atlas-map">
          <canvas id="atlas-canvas" aria-hidden="true"></canvas>
          <nav id="atlas-a11y" class="atlas-a11y sr-only" aria-label="Map nodes"></nav>
        </div>
      </section>

      <section class="atlas-ui-layer">
        <header class="atlas-header">
          <div class="atlas-title-block">
            <p class="eyebrow">Ariadne Atlas</p>
            <h1>Story galaxy</h1>
            <p class="atlas-subtitle">Branch timelines and current world state.</p>
          </div>
          <nav class="atlas-actions" aria-label="Atlas actions">
            <a class="atlas-link" href="/">Return</a>
            <button id="atlas-sign-in" type="button">Sign in</button>
            <button id="atlas-sign-out" type="button" hidden>Sign out</button>
            <button id="atlas-refresh" type="button">Refresh</button>
          </nav>
        </header>

        <div class="atlas-controls-left">
          <label class="atlas-search">
            <span>Search atlas</span>
            <input id="atlas-search" type="search" placeholder="Find a story, branch, turn, character, location, fact, or thread" autocomplete="off" />
          </label>
          <div class="atlas-zoom-actions" aria-label="Zoom controls">
            <button id="atlas-zoom-out" type="button" aria-label="Zoom out">-</button>
            <button id="atlas-reset" type="button">Reset</button>
            <button id="atlas-zoom-in" type="button" aria-label="Zoom in">+</button>
          </div>
          <div id="atlas-results" class="atlas-results" aria-live="polite"></div>
        </div>

        <aside id="atlas-detail" class="atlas-detail" aria-label="Selected atlas node"></aside>
      </section>

      <div id="atlas-status" class="atlas-status" role="status">Loading atlas...</div>
      <div id="atlas-stats" class="atlas-stats" aria-label="Atlas summary"></div>
    </main>
  `;

  const els = atlasEls();
  renderer?.destroy();
  renderer = new GalaxyRenderer(byId<HTMLCanvasElement>('atlas-canvas'));

  els.signIn.addEventListener('click', () => void signInWithGoogle().catch(error => setAtlasStatus(messageFrom(error))));
  els.signOut.addEventListener('click', () => void signOutFirebase().catch(error => setAtlasStatus(messageFrom(error))));
  els.refresh.addEventListener('click', () => void loadAtlas());
  els.search.addEventListener('input', () => {
    atlasState.query = els.search.value.trim().toLowerCase();
    updateSearchHighlight();
    renderSearchResults();
  });
  els.zoomIn.addEventListener('click', () => zoomAtlas(1.3));
  els.zoomOut.addEventListener('click', () => zoomAtlas(1 / 1.3));
  els.reset.addEventListener('click', () => resetAtlasView());

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

async function loadAtlas(): Promise<void> {
  setAtlasStatus(atlasState.simulated ? 'Loading simulated cluster...' : 'Loading atlas...');
  try {
    const graph = atlasState.simulated ? simulatedStoryMap() : await atlasFetch<StoryMapResponse>('/v1/story-map');
    const layout = layoutGraph(graph);
    atlasState.graph = graph;
    atlasState.positioned = layout.positioned;
    atlasState.orbits = layout.orbits;
    atlasState.selectedId = graph.rootId;
    atlasState.hoveredId = null;
    atlasState.hitSet.clear();
    atlasState.query = atlasEls().search.value.trim().toLowerCase();
    updateSearchHighlight();
    renderAtlasStats(graph);
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

class GalaxyRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 1, 12000);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
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
    this.renderer.setClearColor(0x020304, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.FogExp2(0x020304, 0.00036);
    this.graphGroup.name = 'story-galaxy';
    this.scene.add(this.graphGroup);
    this.scene.add(new THREE.AmbientLight(0xcad9d4, 0.42));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(420, 620, 760);
    this.scene.add(key);
    this.handleResize = this.handleResize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.initStarfield();
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
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const radius = 1400 + (hashNumber(`star:r:${i}`) % 3800);
      const theta = hashAngle(`star:t:${i}`);
      const phi = Math.acos(((hashNumber(`star:p:${i}`) % 2000) / 1000) - 1);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(phi) * radius * 0.58;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      const warmth = (hashNumber(`star:w:${i}`) % 100) / 100;
      color.setHSL(0.55 + warmth * 0.12, 0.25, 0.58 + warmth * 0.24);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 4.4,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    const stars = new THREE.Points(geometry, material);
    stars.name = 'atlas-starfield';
    this.scene.add(stars);
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
  }

  private updateSceneState(): void {
    const graph = atlasState.graph;
    if (!graph) return;
    const connected = connectedNodeIds();
    const hasInteraction = Boolean(atlasState.hoveredId);
    const isSearching = atlasState.query.length > 0;

    for (const node of atlasState.positioned.values()) {
      const group = this.nodeObjects.get(node.id);
      if (!group) continue;
      const selected = atlasState.selectedId === node.id;
      const hovered = atlasState.hoveredId === node.id;
      const active = selected || hovered || connected.has(node.id);
      const hit = isSearching && atlasState.hitSet.has(node.id);
      const dim = (isSearching && !hit) || (hasInteraction && !active);
      const pulse = 1 + Math.sin(this.time * node.orbitSpeed + node.angle) * 0.035;
      group.scale.setScalar((selected || hovered || hit ? 1.12 : 1) * pulse);

      for (const child of group.children) {
        if (child.userData.role === 'selection') child.visible = selected || hovered || hit;
        if (child.userData.role === 'glow') {
          const material = (child as THREE.Sprite).material as THREE.SpriteMaterial;
          material.opacity = dim ? 0.08 : selected || hovered || hit ? 0.9 : 0.38;
        }
        if (child.userData.role === 'body') {
          const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          material.opacity = dim ? 0.22 : 1;
          material.emissiveIntensity = selected || hovered || hit ? 1.2 : node.kind === 'library' ? 0.9 : 0.34;
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
        const labelHeight = clamp(distanceToCamera * 0.026, 9, selected || hovered || hit ? 22 : 18);
        label.scale.set(labelHeight * aspect, labelHeight, 1);
        label.position.y = node.r + labelHeight * 1.15;
        label.visible = selected
          || hovered
          || hit
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
      material.opacity = (isSearching && !hit) || (hasInteraction && !active && !connected.has(source) && !connected.has(target))
        ? 0.08
        : active || hit
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

  private createOrbit(orbit: OrbitRing): THREE.LineLoop {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i += 1) {
      const angle = (i / 160) * Math.PI * 2;
      points.push(new THREE.Vector3(
        orbit.cx + Math.cos(angle) * orbit.r,
        orbit.cy + Math.sin(angle) * orbit.r,
        orbit.cz + Math.sin(angle * 2) * orbit.r * 0.035
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: orbit.kind === 'library' ? 0x8bb8c7 : orbit.kind === 'repo' ? 0xbad1b9 : 0xa69ac2,
      transparent: true,
      opacity: orbit.kind === 'library' ? 0.16 : 0.1,
      depthWrite: false
    });
    const line = new THREE.LineLoop(geometry, material);
    line.userData.kind = 'orbit';
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
    const geometry = node.kind === 'turn' || node.kind === 'fact'
      ? new THREE.IcosahedronGeometry(node.r, 1)
      : new THREE.SphereGeometry(node.r, 32, 20);
    const material = new THREE.MeshStandardMaterial({
      color: style.fill,
      emissive: style.core,
      emissiveIntensity: node.kind === 'library' ? 0.9 : 0.34,
      roughness: 0.46,
      metalness: node.kind === 'repo' ? 0.18 : 0.08,
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
      opacity: node.kind === 'library' ? 0.76 : 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow.userData.role = 'glow';
    glow.scale.setScalar(node.r * (node.kind === 'library' ? 7.2 : 4.6));
    group.add(glow);

    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints(node.r * 1.65, 96)),
      new THREE.LineBasicMaterial({ color: style.ring, transparent: true, opacity: 0.78, depthWrite: false })
    );
    ring.userData.role = 'selection';
    ring.visible = false;
    group.add(ring);

    if (node.kind === 'library') {
      const light = new THREE.PointLight(0xfff3bf, 2.2, 1600, 1.2);
      light.position.set(0, 0, 0);
      group.add(light);
    }

    if (node.kind === 'repo') {
      const planetRing = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(ringPoints(node.r * 2.15, 128)),
        new THREE.LineBasicMaterial({ color: style.ring, transparent: true, opacity: 0.42, depthWrite: false })
      );
      planetRing.rotation.x = 1.12;
      group.add(planetRing);
    }

    const label = this.createLabel(node);
    this.labels.set(node.id, label);
    group.add(label);
    return group;
  }

  private createLabel(node: PositionedNode): THREE.Sprite {
    const texture = labelTexture(node.label);
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

function labelTexture(text: string): THREE.CanvasTexture {
  const fontSize = 44;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas labels are not available.');
  ctx.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width + 42);
  const height = 78;
  canvas.width = width;
  canvas.height = height;
  ctx.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.88)';
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = '#eef4f2';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
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
  if (maybeMap.map && maybeMap.map !== cachedGlowTexture) maybeMap.map.dispose();
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
    const distance = 260 + Math.sqrt(i + 1) * 115;
    const z = Math.sin(angle * 1.35) * 180 + (i - (repos.length - 1) / 2) * 90;
    orbits.push({ cx: 0, cy: 0, cz: 0, r: distance, kind: 'library' });
    positioned.set(repos[i].id, withPosition(repos[i], Math.cos(angle) * distance, Math.sin(angle) * distance, radiusFor(repos[i]), true, angle, z));
  }

  for (const repo of repos) {
    const repoPos = positioned.get(repo.id);
    if (!repoPos) continue;
    const branches = graph.nodes
      .filter(node => node.kind === 'branch' && node.parentId === repo.id)
      .sort((a, b) => (a.label === 'main' ? -1 : b.label === 'main' ? 1 : sortByUpdatedThenLabel(a, b)));
    const orbitRadius = repoPos.r * 2.6 + 48;
    if (branches.length) orbits.push({ cx: repoPos.x, cy: repoPos.y, cz: repoPos.z, r: orbitRadius, kind: 'repo' });
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
    orbits.push({ cx: branchPos.x, cy: branchPos.y, cz: branchPos.z, r: 112, kind: 'branch' });
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
    const distance = 48 + i * 28;
    const angle = armAngle + (i - (turns.length - 1) / 2) * 0.055;
    const z = branchPos.z + (i - (turns.length - 1) / 2) * 18;
    positioned.set(turns[i].id, withPosition(turns[i], branchPos.x + Math.cos(angle) * distance, branchPos.y + Math.sin(angle) * distance, radiusFor(turns[i]), i === turns.length - 1 || turns.length <= 10, angle, z));
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
    const ringRadius = 104 + Math.floor(i / 8) * 34;
    const angle = armAngle + Math.PI + (i * Math.PI * 2) / Math.min(8, Math.max(1, stateNodes.length));
    const z = branchPos.z + Math.cos(angle * 1.2) * 70 + Math.floor(i / 4) * 24;
    positioned.set(stateNodes[i].id, withPosition(stateNodes[i], branchPos.x + Math.cos(angle) * ringRadius, branchPos.y + Math.sin(angle) * ringRadius, radiusFor(stateNodes[i]), stateNodes.length <= 12, angle, z));
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
    orbitSpeed: 0.5 + (hashNumber(node.id) % 100) / 220
  };
}

function radiusFor(node: StoryMapNode): number {
  const base: Record<StoryMapNodeKind, number> = {
    library: 54,
    repo: 42,
    branch: 20,
    turn: 7,
    scene: 16,
    entity: 12,
    thread: 11,
    fact: 8
  };
  return Math.max(5, base[node.kind] + Math.sqrt(Math.max(1, node.weight)) * 2.2);
}

function selectNode(nodeId: string, center: boolean): void {
  if (!atlasState.graph || !atlasState.positioned.has(nodeId)) return;
  atlasState.selectedId = nodeId;
  renderDetail(nodeId);
  if (center) centerOnNode(nodeId);
}

function centerOnNode(nodeId: string, snap = false): void {
  const node = atlasState.positioned.get(nodeId);
  if (!node) return;
  atlasState.targetView.cx = node.x;
  atlasState.targetView.cy = node.y;
  atlasState.targetView.cz = node.z;
  const desiredDistance = node.kind === 'library' ? 880 : node.kind === 'repo' ? 520 : node.kind === 'branch' ? 340 : 240;
  atlasState.targetView.distance = clamp(Math.min(atlasState.targetView.distance, desiredDistance), CAMERA.minDistance, CAMERA.maxDistance);
  if (snap) {
    atlasState.view = copyView(atlasState.targetView);
  }
}

function zoomAtlas(factor: number): void {
  atlasState.targetView.distance = clamp(atlasState.targetView.distance / factor, CAMERA.minDistance, CAMERA.maxDistance);
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
      distance: clamp(span * 1.35 + 360, 720, CAMERA.maxDistance),
      yaw: DEFAULT_VIEW.yaw,
      pitch: DEFAULT_VIEW.pitch
    };
  }
  if (snap) {
    atlasState.view = copyView(atlasState.targetView);
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

function shouldUseSimulatedAtlas(): boolean {
  const params = new URLSearchParams(window.location.search);
  return ['atlas', '1', 'true'].includes(params.get('mock') ?? '')
    || ['atlas', '1', 'true'].includes(params.get('demo') ?? '')
    || ['atlas', '1', 'true'].includes(params.get('simulate') ?? '');
}

function simulatedStoryMap(): StoryMapResponse {
  const nodes: StoryMapNode[] = [
    node('library:ariadne', 'library', 'Story Library', 'All active story worlds, branches, turns, and current canon landmarks.', null, 9, ['library', 'galaxy'], { owner: 'simulated-player' }),
    node('repo:glass', 'repo', 'The Glass Labyrinth', 'A mythic city of mirrors, debts, and half-remembered doors.', 'library:ariadne', 7, ['repo', 'mystery', 'city'], { repoId: 'glass', safety: 'general' }, 'glass'),
    node('repo:nocturne', 'repo', 'Nocturne Sea', 'A moonlit archipelago where memories surface as weather.', 'library:ariadne', 5, ['repo', 'ocean', 'dreamlike'], { repoId: 'nocturne', safety: 'general' }, 'nocturne'),
    node('branch:glass-main', 'branch', 'main', 'The current path through the labyrinth.', 'repo:glass', 3.4, ['branch', 'current', 'main'], { branchId: 'glass-main', headTurnId: 'turn:glass:4' }, 'glass', 'glass-main'),
    node('branch:glass-mirror', 'branch', 'mirror bargain', 'A fork where the archivist accepted the mirror debt.', 'repo:glass', 2.8, ['branch', 'fork', 'risk'], { branchId: 'glass-mirror', forkedFromTurnId: 'turn:glass:2' }, 'glass', 'glass-mirror'),
    node('branch:nocturne-main', 'branch', 'main', 'The tide-road toward the singing lighthouse.', 'repo:nocturne', 2.9, ['branch', 'main', 'voyage'], { branchId: 'nocturne-main', headTurnId: 'turn:nocturne:2' }, 'nocturne', 'nocturne-main'),
    turn('turn:glass:1', 'Crossed the silver market', 'glass', 'glass-main', 1),
    turn('turn:glass:2', 'Found the backward stair', 'glass', 'glass-main', 2),
    turn('turn:glass:3', 'Named the debt collector', 'glass', 'glass-main', 3),
    turn('turn:glass:4', 'Opened the black-glass door', 'glass', 'glass-main', 4),
    turn('turn:mirror:1', 'Accepted the mirror bargain', 'glass', 'glass-mirror', 1),
    turn('turn:mirror:2', 'Lost a reflected name', 'glass', 'glass-mirror', 2),
    turn('turn:nocturne:1', 'Raised the lantern sail', 'nocturne', 'nocturne-main', 1),
    turn('turn:nocturne:2', 'Heard the reef choir', 'nocturne', 'nocturne-main', 2),
    stateNode('scene:glass-main', 'scene', 'Black-glass door', 'A locked door hums under the old observatory.', 'glass', 'glass-main', 'branch:glass-main', 3.2, ['scene', 'observatory', 'door'], { locationId: 'observatory-door', tone: 'tense' }),
    stateNode('entity:player', 'entity', 'The player', 'player - active - carrying a brass key', 'glass', 'glass-main', 'scene:glass-main', 2.6, ['entity', 'player', 'present'], { kind: 'player', present: true }),
    stateNode('entity:archivist', 'entity', 'Mirror Archivist', 'keeper - wary - knows the cost of names', 'glass', 'glass-main', 'scene:glass-main', 2.2, ['entity', 'npc', 'present'], { kind: 'npc', present: true }),
    stateNode('entity:lantern', 'entity', 'Brass Lantern', 'tool - lit - reveals writing in glass', 'glass', 'glass-main', 'branch:glass-main', 1.6, ['entity', 'tool', 'known'], { kind: 'item', present: false }),
    stateNode('thread:debt', 'thread', 'Mirror debt', 'Unresolved promise owed to the glass court.', 'glass', 'glass-main', 'branch:glass-main', 1.7, ['thread', 'unresolved', 'debt'], { status: 'open', stakes: 'identity' }),
    stateNode('fact:oath', 'fact', 'Names bind doors', 'A spoken true name can lock or open certain mirrored thresholds.', 'glass', 'glass-main', 'branch:glass-main', 1.2, ['fact', 'rule', 'magic'], { certainty: 'high' }),
    stateNode('scene:nocturne-main', 'scene', 'Reef choir', 'Moonlit coral sings beneath the hull.', 'nocturne', 'nocturne-main', 'branch:nocturne-main', 2.5, ['scene', 'sea', 'music'], { locationId: 'reef-choir', tone: 'wonder' }),
    stateNode('entity:captain-vale', 'entity', 'Captain Vale', 'captain - suspicious - follows impossible currents', 'nocturne', 'nocturne-main', 'scene:nocturne-main', 2, ['entity', 'npc', 'present'], { kind: 'npc', present: true }),
    stateNode('thread:lighthouse', 'thread', 'Singing lighthouse', 'The lighthouse answers only to remembered songs.', 'nocturne', 'nocturne-main', 'branch:nocturne-main', 1.6, ['thread', 'quest', 'open'], { status: 'open' }),
    stateNode('fact:tide', 'fact', 'Memory tide', 'At moonrise the sea repeats places the crew has lost.', 'nocturne', 'nocturne-main', 'branch:nocturne-main', 1.1, ['fact', 'world-rule'], { certainty: 'medium' })
  ];

  const links: StoryMapLink[] = [
    link('library:ariadne', 'repo:glass', 'contains', 3),
    link('library:ariadne', 'repo:nocturne', 'contains', 3),
    link('repo:glass', 'branch:glass-main', 'contains', 2),
    link('repo:glass', 'branch:glass-mirror', 'fork', 1.6),
    link('repo:nocturne', 'branch:nocturne-main', 'contains', 2),
    link('branch:glass-main', 'turn:glass:1', 'timeline', 1.2),
    link('turn:glass:1', 'turn:glass:2', 'timeline', 1.2),
    link('turn:glass:2', 'turn:glass:3', 'timeline', 1.2),
    link('turn:glass:3', 'turn:glass:4', 'timeline', 1.2),
    link('branch:glass-main', 'turn:glass:4', 'head', 1.9),
    link('turn:glass:2', 'branch:glass-mirror', 'fork', 1.4),
    link('branch:glass-mirror', 'turn:mirror:1', 'timeline', 1.1),
    link('turn:mirror:1', 'turn:mirror:2', 'timeline', 1.1),
    link('branch:nocturne-main', 'turn:nocturne:1', 'timeline', 1.1),
    link('turn:nocturne:1', 'turn:nocturne:2', 'timeline', 1.1),
    link('branch:nocturne-main', 'turn:nocturne:2', 'head', 1.6),
    link('branch:glass-main', 'scene:glass-main', 'state', 2.1),
    link('scene:glass-main', 'entity:player', 'present', 1.8),
    link('scene:glass-main', 'entity:archivist', 'present', 1.7),
    link('branch:glass-main', 'entity:lantern', 'state', 1.1),
    link('branch:glass-main', 'thread:debt', 'state', 1.2),
    link('turn:glass:4', 'thread:debt', 'mentions', 1),
    link('branch:glass-main', 'fact:oath', 'state', 1),
    link('branch:nocturne-main', 'scene:nocturne-main', 'state', 1.8),
    link('scene:nocturne-main', 'entity:captain-vale', 'present', 1.4),
    link('branch:nocturne-main', 'thread:lighthouse', 'state', 1.2),
    link('branch:nocturne-main', 'fact:tide', 'state', 1)
  ];

  return {
    generatedAt: new Date().toISOString(),
    rootId: 'library:ariadne',
    nodes,
    links,
    repos: [
      { id: 'glass', title: 'The Glass Labyrinth', branchCount: 2, turnCount: 6, entityCount: 3, threadCount: 1, updatedAt: '2026-06-17T06:30:00.000Z' },
      { id: 'nocturne', title: 'Nocturne Sea', branchCount: 1, turnCount: 2, entityCount: 1, threadCount: 1, updatedAt: '2026-06-17T05:20:00.000Z' }
    ],
    stats: {
      repos: 2,
      branches: 3,
      turns: 8,
      entities: 4,
      threads: 2,
      facts: 2,
      warnings: 1,
      nodes: nodes.length,
      links: links.length
    },
    warnings: ['Simulated preview data: not persisted to the story store.']
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

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message);
  return 'Unexpected error.';
}
