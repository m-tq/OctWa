// Octra Background Configuration
export const DEFAULT_CONFIG = {
  nodeCount: 800,      // Reduced for better performance with lines
  clusterCount: 6,
  pulseInterval: 1.5,
} as const;

// 6 cluster centers spread across screen
export const CLUSTER_CENTERS: [number, number][] = [
  [-0.5, 0.6],    // top-left
  [0.5, 0.6],     // top-right
  [-0.7, 0.0],    // mid-left
  [0.7, 0.0],     // mid-right
  [-0.4, -0.6],   // bottom-left
  [0.4, -0.6],    // bottom-right
];
