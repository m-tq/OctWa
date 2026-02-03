// Octra Hypergraph Background Shaders
// Dynamic, non-monotonous, fullscreen

export const vertexShader = `
  attribute float seed;
  attribute float clusterId;
  
  uniform float uTime;
  uniform vec2 uResolution;
  
  varying float vSeed;
  varying float vClusterId;
  varying float vDepth;
  
  // Simplex-like noise function
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
    
    // Multi-layered organic movement (non-monotonous)
    float t1 = uTime * 0.3 + seed * 10.0;
    float t2 = uTime * 0.5 + seed * 20.0;
    
    // Cluster-based orbital motion
    float orbitRadius = 0.1 + seed * 0.15;
    float orbitSpeed = 0.3 + clusterId * 0.1;
    pos.x += sin(t1 * orbitSpeed) * orbitRadius;
    pos.y += cos(t1 * orbitSpeed * 1.3) * orbitRadius;
    
    // Noise-based drift (locality simulation)
    float noiseScale = 0.5;
    float nx = noise(vec3(pos.xy * noiseScale, t2 * 0.1)) - 0.5;
    float ny = noise(vec3(pos.yx * noiseScale, t2 * 0.1 + 100.0)) - 0.5;
    pos.x += nx * 0.2;
    pos.y += ny * 0.2;
    
    // Depth variation for parallax feel (static per node)
    vDepth = 0.5 + 0.5 * sin(seed * 6.28);
    
    // Point size - varies by seed only (consistent)
    float baseSize = 2.5 + seed * 3.0;
    float depthScale = 0.7 + vDepth * 0.6;
    gl_PointSize = baseSize * depthScale;
    
    // Aspect ratio correction
    float aspect = uResolution.x / uResolution.y;
    pos.x /= aspect;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const fragmentShader = `
  varying float vSeed;
  varying float vClusterId;
  varying float vDepth;
  
  uniform float uTime;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    // Soft glow with core
    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    float alpha = core * 0.8 + glow * 0.4;
    
    // Dynamic color based on cluster (subtle shift over time)
    float colorShift = sin(uTime * 0.2 + vClusterId * 1.5) * 0.5 + 0.5;
    
    // Octra palette with variation
    vec3 color1 = vec3(0.227, 0.302, 1.0);   // Primary blue #3A4DFF
    vec3 color2 = vec3(0.27, 0.27, 1.0);  // Lighter blue
    vec3 color3 = vec3(0.53, 0.53, 1.0);  // Accent
    vec3 color4 = vec3(0.4, 0.2, 1.0);    // Violet accent
    
    // Mix colors based on seed and cluster
    vec3 baseColor = mix(color1, color2, vSeed);
    baseColor = mix(baseColor, color3, vDepth * 0.3);
    baseColor = mix(baseColor, color4, colorShift * 0.2);
    
    // Consistent brightness
    float brightness = 0.9;
    
    alpha *= brightness * (0.6 + vDepth * 0.4);
    
    if (alpha < 0.01) discard;
    
    gl_FragColor = vec4(baseColor * brightness, alpha);
  }
`;

// Line shader for hyperedge connections
export const lineVertexShader = `
  attribute float opacity;
  
  uniform float uTime;
  uniform vec2 uResolution;
  
  varying float vOpacity;
  
  void main() {
    vOpacity = opacity;
    
    vec3 pos = position;
    
    // Aspect ratio correction
    float aspect = uResolution.x / uResolution.y;
    pos.x /= aspect;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const lineFragmentShader = `
  varying float vOpacity;
  
  void main() {
    vec3 color = vec3(0.227, 0.302, 1.0); // Primary blue
    float alpha = vOpacity * 0.25;
    
    gl_FragColor = vec4(color, alpha);
  }
`;
