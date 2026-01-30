import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';

const screenshots = [
  { src: 'welcome.png', caption: 'Welcome' },
  { src: 'dashboard.png', caption: 'Dashboard' },
  { src: 'private.png', caption: 'Private Mode' },
  { src: 'multiwallet.png', caption: 'Multi-Wallet' },
  { src: 'multisend.png', caption: 'Multi-Send' },
  { src: 'bulksend.png', caption: 'Bulk Send' },
];

const apps = [
  {
    name: 'OctWa-DEX',
    description: 'Intent-based DEX for OCT ⇄ ETH swaps. Preview version using Sepolia testnet.',
    appUrl: 'https://octwa-dex.vercel.app/',
    repoUrl: 'https://github.com/m-tq/OctWa-DEX',
    screenshotUrl: 'octwa-dex.png',
  },
  {
    name: 'OctWa-OTC',
    description: 'Secure P2P OTC trading platform for OCT ⇄ USDC swaps with unique escrow per order.',
    appUrl: 'https://octra-otc.vercel.app/',
    repoUrl: '',
    screenshotUrl: 'octwa-otc.png',
  },
  {
    name: 'Octra Poker',
    description: "Multiplayer Texas Hold'em Poker with OCT token betting, powered by the Octra Network.",
    appUrl: 'https://octra-poker.vercel.app/',
    repoUrl: '',
    screenshotUrl: 'octra-poker.png',
  },
  {
    name: 'OctWa Analyzer',
    description: 'A lightweight web UI for browsing Octra transactions, addresses, and epochs.',
    appUrl: 'https://octlook.vercel.app/',
    repoUrl: 'https://github.com/m-tq/OctWa-Analyzer',
    screenshotUrl: 'octlook.png',
  },
];

const tools = [
  {
    name: 'Octra Tools',
    description: 'Python CLI tool to generate Octra wallet data from seed phrase (mnemonic). Also, you can create vanity octra address by running octra-vanity.js file.',
    repoUrl: 'https://github.com/m-tq/Octra-Tools',
  },
];

const sdkDocsUrl = 'https://github.com/m-tq/OctWa/tree/master/packages/sdk';

const navLabels = [
  'Home',
  'About',
  'Features',
  'How It Works',
  'Security',
  'Screenshots',
  'Open Source',
];

const totalSlides = navLabels.length;

type PageKey = 'main' | 'sdk' | 'apps' | 'tools';

type SlideProps = {
  index: number;
  currentSlide: number;
  children: ReactNode;
};

const Slide = ({ index, currentSlide, children }: SlideProps) => (
  <section className={`slide ${currentSlide === index ? 'active' : ''}`} data-slide={index}>
    {children}
  </section>
);

type SdkSlideProps = {
  index: number;
  currentSlide: number;
  children: ReactNode;
};

const SdkSlide = ({ index, currentSlide, children }: SdkSlideProps) => (
  <section className={`sdk-slide ${currentSlide === index ? 'active' : ''}`} data-slide={index}>
    {children}
  </section>
);

type FeatureCardProps = {
  title: string;
  description: string;
  icon: ReactNode;
};

const FeatureCard = ({ title, description, icon }: FeatureCardProps) => (
  <div className="feature-card">
    {icon}
    <h3 className="feature-title">{title}</h3>
    <p className="feature-desc">{description}</p>
  </div>
);

type ModeCardProps = {
  title: string;
  description: string;
  icon: ReactNode;
  highlight?: boolean;
};

const ModeCard = ({ title, description, icon, highlight }: ModeCardProps) => (
  <div className={`mode-card${highlight ? ' private' : ''}`}>
    <h3 className="mode-title">
      {icon}
      {title}
    </h3>
    <p className="mode-desc">{description}</p>
  </div>
);

type SecurityItemProps = {
  title: string;
  description: string;
  icon: ReactNode;
};

const SecurityItem = ({ title, description, icon }: SecurityItemProps) => (
  <div className="security-item">
    {icon}
    <div className="security-text">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  </div>
);

type AppCardProps = {
  name: string;
  description: string;
  appUrl: string;
  repoUrl: string;
  screenshotUrl: string;
  onClick: () => void;
};

const AppCard = ({ name, description, appUrl, repoUrl, screenshotUrl, onClick }: AppCardProps) => (
  <div
    className="app-card"
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <div className="app-image">
      {screenshotUrl ? (
        <img src={screenshotUrl} alt={name} />
      ) : (
        <div className="app-image-placeholder">Screenshot</div>
      )}
    </div>
    <div className="app-body">
      <h3 className="app-title">{name}</h3>
      <p className="app-desc">{description}</p>
    </div>
  </div>
);

type ToolCardProps = {
  name: string;
  description: string;
  repoUrl: string;
};

const ToolCard = ({ name, description, repoUrl }: ToolCardProps) => (
  <div className="tool-card">
    <div className="tool-body">
      <h3 className="tool-title">{name}</h3>
      <p className="tool-desc">{description}</p>
      <div className="tool-links">
        {repoUrl ? (
          <a className="btn btn-secondary" href={repoUrl} target="_blank" rel="noopener">
            Repository
          </a>
        ) : (
          <span className="btn btn-secondary is-disabled">Repository TBD</span>
        )}
      </div>
    </div>
  </div>
);

type CodeSample = {
  title: string;
  code: string;
};

type SdkSection = {
  title: string;
  description: ReactNode;
  bullets?: ReactNode[];
  samples?: CodeSample[];
  actions?: ReactNode;
};

const sdkSections: SdkSection[] = [
  {
    title: 'OctWa SDK',
    description: 'SDK for integrating dApps with OCTWA Wallet browser extension.',
    actions: (
      <div className="cta-group">
        <a className="btn btn-secondary" href={sdkDocsUrl} target="_blank" rel="noopener">
          Open packages/sdk folder
        </a>
      </div>
    ),
  },
  {
    title: 'Installation',
    description: 'Install the package and keep your dApp integrations simple and secure.',
    samples: [
      {
        title: 'Install via npm',
        code: 'npm install @octwa/sdk',
      },
    ],
  },
  {
    title: 'Quick Start',
    description: 'Initialize the SDK, verify the extension, connect a circle, and invoke methods.',
    samples: [
      {
        title: 'Initialize and connect',
        code: `import { OctraSDK } from '@octwa/sdk';

const sdk = await OctraSDK.init();

if (!sdk.isInstalled()) {
  console.log('Please install Octra Wallet extension');
  return;
}

await sdk.connect({
  circle: 'my_dapp_v1',
  appOrigin: window.location.origin,
});

const capability = await sdk.requestCapability({
  circle: 'my_dapp_v1',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 3600,
});

const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'get_balance',
});

if (result.success) {
  const data = JSON.parse(new TextDecoder().decode(result.data));
  console.log('Balance:', data.balance);
}`,
      },
    ],
  },
  {
    title: 'Core Concepts',
    description: 'Circles define isolated contexts, and capabilities authorize what a dApp can do.',
    bullets: [
      <>Circle keeps permissions separated per app context.</>,
      <>Capabilities are signed permissions scoped by methods and time.</>,
      <>
        Invocations require a valid capability and a method name like <code className="sdk-inline-code">send_transaction</code>.
      </>,
    ],
    samples: [
      {
        title: 'Capability shape',
        code: `interface Capability {
  id: string;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  appOrigin: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}`,
      },
      {
        title: 'Invoke with payload',
        code: `const result = await sdk.invoke({
  capabilityId: capability.id,
  method: 'send_transaction',
  payload: new TextEncoder().encode(
    JSON.stringify({ to: 'oct...', amount: 100 })
  ),
});`,
      },
    ],
  },
  {
    title: 'API Reference',
    description: 'Common SDK calls for lifecycle, capabilities, and invocations.',
    bullets: [
      <>
        Initialize with <code className="sdk-inline-code">OctraSDK.init()</code> and optional timeout.
      </>,
      <>
        Check availability via <code className="sdk-inline-code">sdk.isInstalled()</code>.
      </>,
      <>
        Session state is available with <code className="sdk-inline-code">sdk.getSessionState()</code>.
      </>,
    ],
    samples: [
      {
        title: 'Initialize',
        code: `const sdk = await OctraSDK.init({
  timeout: 3000,
});`,
      },
      {
        title: 'Connect and request capability',
        code: `const connection = await sdk.connect({
  circle: 'my_circle',
  appOrigin: window.location.origin,
});

const capability = await sdk.requestCapability({
  circle: 'my_circle',
  methods: ['get_balance', 'send_transaction'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 7200,
});`,
      },
    ],
  },
  {
    title: 'Events',
    description: 'Subscribe to connection, capability, and readiness events.',
    samples: [
      {
        title: 'Event hooks',
        code: `sdk.on('connect', ({ connection }) => { ... });
sdk.on('disconnect', () => { ... });
sdk.on('capabilityGranted', ({ capability }) => { ... });
sdk.on('capabilityRevoked', ({ capabilityId }) => { ... });
sdk.on('extensionReady', () => { ... });`,
      },
    ],
  },
  {
    title: 'Intents Client',
    description: 'Use intents to orchestrate swaps with a dedicated helper client.',
    samples: [
      {
        title: 'Create and submit intent',
        code: `import { OctraSDK, IntentsClient } from '@octwa/sdk';

const sdk = await OctraSDK.init();
const intents = new IntentsClient(sdk, 'http://localhost:3001');

const quote = await intents.getQuote(100);
const payload = await intents.createIntent(quote, '0x...targetAddress');

await intents.signIntent(payload);
const result = await intents.submitIntent(octraTxHash);`,
      },
    ],
  },
  {
    title: 'Error Handling',
    description: 'Handle common error classes for smoother user experience.',
    samples: [
      {
        title: 'Catch common errors',
        code: `import {
  NotInstalledError,
  UserRejectedError,
} from '@octwa/sdk';

try {
  await sdk.connect({ ... });
} catch (error) {
  if (error instanceof NotInstalledError) {
    // Wallet not installed
  } else if (error instanceof UserRejectedError) {
    // User rejected the request
  }
}`,
      },
    ],
  },
  {
    title: 'Types',
    description: 'Bring in SDK types when you need strong typing in your app.',
    samples: [
      {
        title: 'Type imports',
        code: `import type {
  Connection,
  Capability,
  CapabilityRequest,
  InvocationRequest,
  InvocationResult,
  SessionState,
} from '@octwa/sdk';`,
      },
    ],
  },
];

type CodeBlockProps = {
  sample: CodeSample;
  blockId: string;
  isCopied: boolean;
  onCopy: (text: string, blockId: string) => void;
};

const CodeBlock = ({ sample, blockId, isCopied, onCopy }: CodeBlockProps) => (
  <div className="sdk-code-block">
    <div className="sdk-code-header">
      <span className="sdk-code-title">{sample.title}</span>
      <button
        type="button"
        className={`sdk-copy-btn${isCopied ? ' is-copied' : ''}`}
        onClick={() => onCopy(sample.code, blockId)}
        aria-label="Copy code"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H10V7h9v14z"
          />
        </svg>
        <span className="sdk-copy-text">{isCopied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
    <pre className="sdk-code">
      <code>{sample.code}</code>
    </pre>
  </div>
);

const useOctraBackground = (containerRef: RefObject<HTMLDivElement>) => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const NODE_COUNT = 800;
    const CLUSTER_CENTERS: [number, number][] = [
      [-0.5, 0.6],
      [0.5, 0.6],
      [-0.7, 0.0],
      [0.7, 0.0],
      [-0.4, -0.6],
      [0.4, -0.6],
    ];

    const vertexShader = `
      attribute float seed;
      attribute float clusterId;
      uniform float uTime;
      uniform vec2 uResolution;
      varying float vSeed;
      varying float vClusterId;
      varying float vDepth;
      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }
      float noise(vec3 x) {
        vec3 p = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n = p.x + p.y * 57.0 + 113.0 * p.z;
        return mix(
          mix(mix(hash(n), hash(n + 1.0), f.x),
              mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
          mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
              mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
      }
      void main() {
        vSeed = seed;
        vClusterId = clusterId;
        vec3 pos = position;
        float t1 = uTime * 0.3 + seed * 10.0;
        float t2 = uTime * 0.5 + seed * 20.0;
        float orbitRadius = 0.1 + seed * 0.15;
        float orbitSpeed = 0.3 + clusterId * 0.1;
        pos.x += sin(t1 * orbitSpeed) * orbitRadius;
        pos.y += cos(t1 * orbitSpeed * 1.3) * orbitRadius;
        float noiseScale = 0.5;
        float nx = noise(vec3(pos.xy * noiseScale, t2 * 0.1)) - 0.5;
        float ny = noise(vec3(pos.yx * noiseScale, t2 * 0.1 + 100.0)) - 0.5;
        pos.x += nx * 0.2;
        pos.y += ny * 0.2;
        vDepth = 0.5 + 0.5 * sin(seed * 6.28);
        float baseSize = 2.5 + seed * 3.0;
        float depthScale = 0.7 + vDepth * 0.6;
        gl_PointSize = baseSize * depthScale;
        float aspect = uResolution.x / uResolution.y;
        pos.x /= aspect;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;

    const fragmentShader = `
      varying float vSeed;
      varying float vClusterId;
      varying float vDepth;
      uniform float uTime;
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        float core = 1.0 - smoothstep(0.0, 0.15, dist);
        float glow = 1.0 - smoothstep(0.0, 0.5, dist);
        float alpha = core * 0.8 + glow * 0.4;
        float colorShift = sin(uTime * 0.2 + vClusterId * 1.5) * 0.5 + 0.5;
        vec3 color1 = vec3(0.0, 0.0, 0.86);
        vec3 color2 = vec3(0.27, 0.27, 1.0);
        vec3 color3 = vec3(0.53, 0.53, 1.0);
        vec3 color4 = vec3(0.4, 0.2, 1.0);
        vec3 baseColor = mix(color1, color2, vSeed);
        baseColor = mix(baseColor, color3, vDepth * 0.3);
        baseColor = mix(baseColor, color4, colorShift * 0.2);
        float brightness = 0.9;
        alpha *= brightness * (0.6 + vDepth * 0.4);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(baseColor * brightness, alpha);
      }
    `;

    const lineVertexShader = `
      attribute float opacity;
      uniform vec2 uResolution;
      varying float vOpacity;
      void main() {
        vOpacity = opacity;
        vec3 pos = position;
        float aspect = uResolution.x / uResolution.y;
        pos.x /= aspect;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;

    const lineFragmentShader = `
      varying float vOpacity;
      void main() {
        vec3 color = vec3(0.0, 0.0, 0.86);
        float alpha = vOpacity * 0.25;
        gl_FragColor = vec4(color, alpha);
      }
    `;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NODE_COUNT * 3);
    const seeds = new Float32Array(NODE_COUNT);
    const clusterIds = new Float32Array(NODE_COUNT);
    const numClusters = CLUSTER_CENTERS.length;

    for (let i = 0; i < NODE_COUNT; i++) {
      const clusterId = i % numClusters;
      const [cx, cy] = CLUSTER_CENTERS[clusterId];
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.4 + Math.random() * 0.3;
      positions[i * 3] = cx + Math.cos(angle) * radius;
      positions[i * 3 + 1] = cy + Math.sin(angle) * radius;
      positions[i * 3 + 2] = 0;
      seeds[i] = Math.random();
      clusterIds[i] = clusterId;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('clusterId', new THREE.BufferAttribute(clusterIds, 1));

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const linePositions: number[] = [];
    const lineOpacities: number[] = [];
    const connectionThreshold = 0.25;

    for (let i = 0; i < NODE_COUNT; i++) {
      for (let j = i + 1; j < NODE_COUNT; j++) {
        if (clusterIds[i] !== clusterIds[j]) continue;
        const dx = positions[i * 3] - positions[j * 3];
        const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < connectionThreshold) {
          linePositions.push(
            positions[i * 3],
            positions[i * 3 + 1],
            0,
            positions[j * 3],
            positions[j * 3 + 1],
            0
          );
          const opacity = 1.0 - dist / connectionThreshold;
          lineOpacities.push(opacity, opacity);
        }
      }
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('opacity', new THREE.Float32BufferAttribute(lineOpacities, 1));

    const lineUniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
    };

    const lineMaterial = new THREE.ShaderMaterial({
      uniforms: lineUniforms,
      vertexShader: lineVertexShader,
      fragmentShader: lineFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    const startTime = performance.now();
    let frameId = 0;

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      uniforms.uTime.value = elapsed;
      lineUniforms.uTime.value = elapsed;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
      lineUniforms.uResolution.value.set(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      geometry.dispose();
      material.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [containerRef]);
};

export default function App() {
  const backgroundRef = useRef<HTMLDivElement>(null);
  useOctraBackground(backgroundRef);

  const [currentPage, setCurrentPage] = useState<PageKey>('main');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentSdkSlide, setCurrentSdkSlide] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeAppIndex, setActiveAppIndex] = useState<number | null>(null);

  const handleOpenAppModal = useCallback((index: number) => {
    setActiveAppIndex(index);
  }, []);

  const handleCloseAppModal = useCallback(() => {
    setActiveAppIndex(null);
  }, []);

  const [activeSdkSection, setActiveSdkSection] = useState<number | null>(null);
  const visibleSdkSections = useMemo(
    () =>
      sdkSections.filter(
        (section) =>
          Boolean(
            section.title &&
              (section.description || section.bullets?.length || section.samples?.length || section.actions)
          )
      ),
    []
  );
  const isAnimatingRef = useRef(false);
  const currentSlideRef = useRef(0);
  const currentSdkSlideRef = useRef(0);
  const isMobileRef = useRef(isMobile);
  const wheelTimeoutRef = useRef<number | null>(null);
  const touchStartRef = useRef(0);
  const touchEndRef = useRef(0);
  const copyTimeoutRef = useRef<number | null>(null);

  const handleCopy = useCallback((text: string, blockId: string) => {
    const applyCopiedState = () => {
      setCopiedId(blockId);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedId(null);
      }, 1600);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(applyCopiedState).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        applyCopiedState();
      });
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    applyCopiedState();
  }, []);

  useEffect(() => {
    currentSlideRef.current = currentSlide;
  }, [currentSlide]);

  useEffect(() => {
    currentSdkSlideRef.current = currentSdkSlide;
  }, [currentSdkSlide]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  const goToSlide = useCallback((index: number) => {
    if (isMobileRef.current) return;
    if (isAnimatingRef.current || index === currentSlideRef.current) return;
    if (index < 0 || index >= totalSlides) return;
    isAnimatingRef.current = true;
    setCurrentSlide(index);
    window.setTimeout(() => {
      isAnimatingRef.current = false;
    }, 800);
  }, []);

  const goToSdkSlide = useCallback((index: number) => {
    if (isMobileRef.current) return;
    if (isAnimatingRef.current || index === currentSdkSlideRef.current) return;
    if (index < 0 || index >= visibleSdkSections.length) return;
    isAnimatingRef.current = true;
    setCurrentSdkSlide(index);
    window.setTimeout(() => {
      isAnimatingRef.current = false;
    }, 800);
  }, [visibleSdkSections.length]);

  const handleOpenSdkSection = useCallback(
    (index: number, event?: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
      const target = event?.target as HTMLElement | null;
      if (target?.closest('.sdk-copy-btn')) return;
      setActiveSdkSection(index);
    },
    []
  );

  const handleCloseSdkSection = useCallback(() => {
    setActiveSdkSection(null);
  }, []);

  useEffect(() => {
    if (currentPage !== 'main' && currentPage !== 'sdk') {
      return;
    }
    const isSdkPage = currentPage === 'sdk';
    const activeGoTo = isSdkPage ? goToSdkSlide : goToSlide;
    const activeRef = isSdkPage ? currentSdkSlideRef : currentSlideRef;
    const activeMax = isSdkPage ? visibleSdkSections.length : totalSlides;

    const handleWheel = (event: WheelEvent) => {
      if (isMobileRef.current) return;
      if (wheelTimeoutRef.current) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
      wheelTimeoutRef.current = window.setTimeout(() => {
        if (event.deltaY > 0) {
          activeGoTo(activeRef.current + 1);
        } else {
          activeGoTo(activeRef.current - 1);
        }
      }, 50);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (isMobileRef.current) return;
      touchStartRef.current = event.changedTouches[0].screenY;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (isMobileRef.current) return;
      touchEndRef.current = event.changedTouches[0].screenY;
      const diff = touchStartRef.current - touchEndRef.current;
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          activeGoTo(activeRef.current + 1);
        } else {
          activeGoTo(activeRef.current - 1);
        }
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (isMobileRef.current) return;
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        activeGoTo(activeRef.current + 1);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        activeGoTo(activeRef.current - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        activeGoTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        activeGoTo(activeMax - 1);
      }
    };

    document.addEventListener('wheel', handleWheel, { passive: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [currentPage, goToSdkSlide, goToSlide, visibleSdkSections.length]);

  useEffect(() => {
    const handleResize = () => {
      const nowMobile = window.innerWidth <= 768;
      if (nowMobile !== isMobileRef.current) {
        setIsMobile(nowMobile);
        if (!nowMobile) {
          setCurrentSlide(0);
          setCurrentSdkSlide(0);
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const openLightbox = useCallback((index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  const nextImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev + 1) % screenshots.length);
  }, []);

  const prevImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev - 1 + screenshots.length) % screenshots.length);
  }, []);

  useEffect(() => {
    const shouldLock =
      lightboxOpen || currentPage === 'main' || currentPage === 'sdk' || currentPage === 'apps' || currentPage === 'tools';
    document.documentElement.style.overflow = shouldLock ? 'hidden' : 'auto';
    document.body.style.overflow = shouldLock ? 'hidden' : 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [lightboxOpen, currentPage]);

  useEffect(() => {
    if (currentPage !== 'main' && lightboxOpen) {
      setLightboxOpen(false);
    }
  }, [currentPage, lightboxOpen]);

  useEffect(() => {
    if (activeSdkSection === null) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseSdkSection();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [activeSdkSection, handleCloseSdkSection]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!lightboxOpen) return;
      if (event.key === 'Escape') {
        closeLightbox();
      } else if (event.key === 'ArrowRight') {
        nextImage();
      } else if (event.key === 'ArrowLeft') {
        prevImage();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [closeLightbox, lightboxOpen, nextImage, prevImage]);

  const currentLightbox = useMemo(() => screenshots[currentImageIndex], [currentImageIndex]);

  const renderSdkSectionContent = (section: SdkSection, sectionIndex: number) => (
    <>
      <div className="sdk-card-header">
        <h2 className="sdk-card-title">{section.title}</h2>
        <p className="sdk-card-desc">{section.description}</p>
      </div>
      {section.actions && <div className="sdk-actions">{section.actions}</div>}
      {section.bullets && (
        <ul className="sdk-list">
          {section.bullets.map((bullet, bulletIndex) => (
            <li key={`${section.title}-bullet-${bulletIndex}`}>{bullet}</li>
          ))}
        </ul>
      )}
      {section.samples?.map((sample, sampleIndex) => {
        const blockId = `${sectionIndex}-${sampleIndex}`;
        return (
          <CodeBlock
            key={`${section.title}-${sample.title}`}
            sample={sample}
            blockId={blockId}
            isCopied={copiedId === blockId}
            onCopy={handleCopy}
          />
        );
      })}
    </>
  );

  return (
    <>
      <div id="octraBackground" ref={backgroundRef} className="octra-background" />

      <header className="top-nav">
        <div className="top-nav-inner">
          <nav className="top-nav-links">
            <button
              type="button"
              className="top-nav-link"
              onClick={() => {
                setCurrentPage('main');
                goToSlide(0);
              }}
            >
              OctWa
            </button>
            <button
              type="button"
              className="top-nav-link"
              onClick={() => {
                setCurrentPage('sdk');
                setCurrentSdkSlide(0);
              }}
            >
              SDK
            </button>
            <button type="button" className="top-nav-link" onClick={() => setCurrentPage('apps')}>
              Apps
            </button>
            <button type="button" className="top-nav-link" onClick={() => setCurrentPage('tools')}>
              Tools
            </button>
          </nav>
        </div>
      </header>

      {currentPage === 'main' ? (
        <div className="slides-container">
          <div
            className="slides-wrapper"
            id="slidesWrapper"
            style={
              {
                '--slides-offset': isMobile ? '0vh' : `-${currentSlide * 100}vh`,
              } as CSSProperties
            }
          >
            <Slide index={0} currentSlide={currentSlide}>
              <div className="slide-content">
                <h1 className="slide-title">OctWa</h1>
                <p className="slide-subtitle">
                  The Octra wallet for public and fully encrypted transactions.
                  <br />
                  Encrypted by Default.
                </p>
                <div className="cta-group">
                  <a
                    href="https://chromewebstore.google.com/detail/octwa-octra-wallet/celnpgbeekcppnfbhbkcdaajdbibpdai"
                    className="btn btn-primary"
                    target="_blank"
                    rel="noopener"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="4" />
                      <line x1="21.17" y1="8" x2="12" y2="8" />
                      <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                      <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
                    </svg>
                    Install from Chrome Web Store
                  </a>
                  <a href="https://github.com/m-tq/OctWa" className="btn btn-secondary" target="_blank" rel="noopener">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    View on GitHub
                  </a>
                </div>
              </div>
            </Slide>

          <Slide index={1} currentSlide={currentSlide}>
            <div className="slide-content">
              <h2 className="slide-title">What is OctWa?</h2>
              <p className="slide-subtitle">
                A secure browser-based wallet for the Octra blockchain network. Available as both a web application and
                Chrome/Edge browser extension.
              </p>
              <p className="slide-description">
                OctWa supports two operation modes: <strong>Public Mode</strong> for standard on-chain transactions, and{' '}
                <strong>Private Mode</strong> for fully encrypted transactions powered by Octra HFHE. You control when
                your data is public or encrypted.
              </p>
            </div>
          </Slide>

          <Slide index={2} currentSlide={currentSlide}>
            <div className="slide-content">
              <h2 className="slide-title">Key Features</h2>
              <p className="slide-subtitle">Everything you need for public and private transactions.</p>
              <div className="features-grid">
                <FeatureCard
                  title="Public Transactions"
                  description="Send OCT tokens with standard on-chain visibility."
                  icon={
                    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  }
                />
                <FeatureCard
                  title="Private Transactions"
                  description="Confidential transactions with FHE encryption."
                  icon={
                    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  }
                />
                <FeatureCard
                  title="State Control"
                  description="Encrypt or decrypt your balance on demand."
                  icon={
                    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  }
                />
                <FeatureCard
                  title="Multi-Wallet"
                  description="Manage multiple wallets in a single interface."
                  icon={
                    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" />
                      <path d="M12 12h.01" />
                      <path d="M17 12h.01" />
                      <path d="M7 12h.01" />
                    </svg>
                  }
                />
                <FeatureCard
                  title="Multi-Send"
                  description="Send to multiple recipients. Bulk send via TXT/CSV."
                  icon={
                    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  }
                />
                <FeatureCard
                  title="dApp Integration"
                  description="Web3 provider for dApp connectivity."
                  icon={
                    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  }
                />
              </div>
            </div>
          </Slide>

          <Slide index={3} currentSlide={currentSlide}>
            <div className="slide-content">
              <h2 className="slide-title">How It Works</h2>
              <p className="slide-subtitle">Two modes. One wallet. You control the visibility.</p>
              <div className="modes-grid">
                <ModeCard
                  title="Public Mode"
                  description="Standard blockchain transactions. Balances and transfer amounts are visible on-chain. Use for everyday transactions where transparency is acceptable or required."
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  }
                />
                <ModeCard
                  title="Private Mode"
                  description="Encrypted execution using Fully Homomorphic Encryption (FHE). Balances and amounts remain confidential. Transactions are processed without revealing sensitive data."
                  highlight
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  }
                />
              </div>
            </div>
          </Slide>

          <Slide index={4} currentSlide={currentSlide}>
            <div className="slide-content">
              <h2 className="slide-title">Security & Philosophy</h2>
              <p className="slide-subtitle">Your keys. Your control. Always encrypted.</p>
              <div className="security-grid">
                <SecurityItem
                  title="Keys Stay Local"
                  description="Private keys never leave your device. All encryption happens locally."
                  icon={
                    <svg className="security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  }
                />
                <SecurityItem
                  title="Encrypted-First Design"
                  description="AES-256-GCM encryption. PBKDF2 with 310,000 iterations. Zero unencrypted storage."
                  icon={
                    <svg className="security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  }
                />
                <SecurityItem
                  title="User-Controlled State"
                  description="You decide what's public or private. Encrypt or decrypt on demand."
                  icon={
                    <svg className="security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                  }
                />
                <SecurityItem
                  title="Session Security"
                  description="Auto-lock after 15 min. Session encryption. Memory cleared on lock."
                  icon={
                    <svg className="security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  }
                />
              </div>
            </div>
          </Slide>

          <Slide index={5} currentSlide={currentSlide}>
            <div className="slide-content">
              <h2 className="slide-title">Screenshots</h2>
              <p className="slide-subtitle">See OctWa in action. Click to view full size.</p>
              <div className="screenshots-grid">
                {screenshots.map((shot, index) => (
                  <div
                    key={shot.caption}
                    className="screenshot-item"
                    onClick={() => openLightbox(index)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openLightbox(index);
                      }
                    }}
                  >
                    <img src={shot.src} alt={shot.caption} loading="lazy" />
                    <span>{shot.caption}</span>
                  </div>
                ))}
              </div>
            </div>
          </Slide>

          <Slide index={6} currentSlide={currentSlide}>
            <div className="slide-content">
              <a href="https://github.com/m-tq/OctWa" target="_blank" rel="noopener">
                <svg className="opensource-icon" viewBox="0 0 24 24" fill="var(--foreground)">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
              <h2 className="slide-title">Open Source</h2>
              <p className="slide-subtitle">
                Community-built and open source. Verify the code, contribute, or build on top of it.
              </p>
              <div className="footer-links">
                <a href="https://github.com/m-tq/OctWa" className="footer-link" target="_blank" rel="noopener">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  GitHub
                </a>
                <a
                  href="https://chromewebstore.google.com/detail/octwa-octra-wallet/celnpgbeekcppnfbhbkcdaajdbibpdai"
                  className="footer-link"
                  target="_blank"
                  rel="noopener"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="4" />
                    <line x1="21.17" y1="8" x2="12" y2="8" />
                    <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                    <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
                  </svg>
                  Chrome Web Store
                </a>
              </div>
              <p className="tagline">OctWa — Encrypted by Default. Verifiable by Design.</p>
            </div>
          </Slide>
        </div>
      </div>
      ) : (
        <main className={`page ${currentPage}-page`}>
          <div className="page-content">
            {currentPage === 'sdk' && (
              <>
                <div className="sdk-slides-container">
                  <div
                    className="sdk-slides-wrapper"
                    style={
                      {
                        '--sdk-offset': isMobile ? '0vh' : `-${currentSdkSlide * 100}vh`,
                      } as CSSProperties
                    }
                  >
                    {visibleSdkSections.map((section, sectionIndex) => (
                      <SdkSlide key={section.title} index={sectionIndex} currentSlide={currentSdkSlide}>
                        <div className="sdk-slide-content">
                          <div
                            className="sdk-card"
                            role="button"
                            tabIndex={0}
                            onClick={(event) => handleOpenSdkSection(sectionIndex, event)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleOpenSdkSection(sectionIndex, event);
                              }
                            }}
                          >
                            {renderSdkSectionContent(section, sectionIndex)}
                          </div>
                        </div>
                      </SdkSlide>
                    ))}
                  </div>
                </div>
                <nav className="nav-dots">
                  {visibleSdkSections.map((section, index) => (
                    <button
                      key={section.title}
                      className={`nav-dot ${currentSdkSlide === index ? 'active' : ''}`}
                      data-slide={index}
                      data-label={section.title}
                      aria-label={`Go to SDK section ${index + 1}`}
                      onClick={() => goToSdkSlide(index)}
                    />
                  ))}
                </nav>
                {activeSdkSection !== null && (
                  <div className="sdk-modal" role="dialog" aria-modal="true">
                    <div className="sdk-modal-backdrop" onClick={handleCloseSdkSection} />
                    <div className="sdk-modal-content">
                      <button
                        type="button"
                        className="sdk-modal-close"
                        aria-label="Close"
                        onClick={handleCloseSdkSection}
                      >
                        &times;
                      </button>
                      <div className="sdk-modal-body">
                        {renderSdkSectionContent(visibleSdkSections[activeSdkSection], activeSdkSection)}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {currentPage === 'apps' && (
              <>
                <h1 className="slide-title">Apps</h1>
                <p className="slide-subtitle">Apps already built in the ecosystem.</p>
                <div className="apps-grid">
                  {apps.map((app, index) => (
                    <AppCard
                      key={app.name}
                      name={app.name}
                      description={app.description}
                      appUrl={app.appUrl}
                      repoUrl={app.repoUrl}
                      screenshotUrl={app.screenshotUrl}
                      onClick={() => handleOpenAppModal(index)}
                    />
                  ))}
                </div>
                {activeAppIndex !== null && (
                  <div className="sdk-modal" role="dialog" aria-modal="true">
                    <div className="sdk-modal-backdrop" onClick={handleCloseAppModal} />
                    <div className="sdk-modal-content">
                      <button
                        type="button"
                        className="sdk-modal-close"
                        aria-label="Close"
                        onClick={handleCloseAppModal}
                      >
                        &times;
                      </button>
                      <div className="sdk-modal-body">
                        <div className="sdk-card-header">
                          <h2 className="sdk-card-title" style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                            {apps[activeAppIndex].name}
                          </h2>
                          <p className="sdk-card-desc" style={{ fontSize: '1rem' }}>
                            {apps[activeAppIndex].description}
                          </p>
                        </div>
                        <div className="app-links" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                          {apps[activeAppIndex].appUrl ? (
                            <a className="btn btn-primary" href={apps[activeAppIndex].appUrl} target="_blank" rel="noopener">
                              Open App
                            </a>
                          ) : (
                            <span className="btn btn-secondary is-disabled">App link TBD</span>
                          )}
                          {apps[activeAppIndex].repoUrl ? (
                            <a className="btn btn-secondary" href={apps[activeAppIndex].repoUrl} target="_blank" rel="noopener">
                              Repository
                            </a>
                          ) : (
                            <span className="btn btn-secondary is-disabled">Repository TBD</span>
                          )}
                        </div>
                        {apps[activeAppIndex].screenshotUrl ? (
                          <div
                            style={{
                              width: '100%',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              overflow: 'hidden',
                            }}
                          >
                            <img
                              src={apps[activeAppIndex].screenshotUrl}
                              alt={apps[activeAppIndex].name}
                              style={{ width: '100%', display: 'block' }}
                            />
                          </div>
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '300px',
                              background: '#111',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              color: 'var(--muted-foreground)',
                            }}
                          >
                            No Preview Available
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {currentPage === 'tools' && (
              <>
                <h1 className="slide-title">Tools</h1>
                <p className="slide-subtitle">Developer tools already available.</p>
                <div className="tools-grid">
                  {tools.map((tool) => (
                    <ToolCard key={tool.name} name={tool.name} description={tool.description} repoUrl={tool.repoUrl} />
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      )}

      {currentPage === 'main' && (
        <>
          <nav className="nav-dots" id="navDots">
            {navLabels.map((label, index) => (
              <button
                key={label}
                className={`nav-dot ${currentSlide === index ? 'active' : ''}`}
                data-slide={index}
                data-label={label}
                aria-label={`Go to slide ${index + 1}`}
                onClick={() => goToSlide(index)}
              />
            ))}
          </nav>

          <div className={`scroll-indicator ${currentSlide === 0 ? 'is-visible' : ''}`} id="scrollIndicator">
            <span>Scroll</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </div>

          <div className="slide-counter" id="slideCounter">
            {currentSlide + 1} / {totalSlides}
          </div>

          <div
            className={`lightbox ${lightboxOpen ? 'active' : ''}`}
            id="lightbox"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeLightbox();
              }
            }}
          >
            <div className="lightbox-content">
              <button className="lightbox-close" onClick={closeLightbox}>
                &times;
              </button>
              <button className="lightbox-nav lightbox-prev" onClick={prevImage}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <img className="lightbox-img" id="lightboxImg" src={currentLightbox.src} alt={currentLightbox.caption} />
              <button className="lightbox-nav lightbox-next" onClick={nextImage}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
              <div className="lightbox-caption" id="lightboxCaption">
                {currentLightbox.caption}
              </div>
              <div className="lightbox-counter" id="lightboxCounter">
                {currentImageIndex + 1} / {screenshots.length}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
