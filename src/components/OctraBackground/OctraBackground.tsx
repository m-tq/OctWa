import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { vertexShader, fragmentShader, lineVertexShader, lineFragmentShader } from './shaders';
import { DEFAULT_CONFIG, CLUSTER_CENTERS } from './config';

export interface OctraBackgroundProps {
  nodeCount?: number;
}

export function OctraBackground({
  nodeCount = DEFAULT_CONFIG.nodeCount,
}: OctraBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    points: THREE.Points;
    lines: THREE.LineSegments;
    uniforms: any;
    lineUniforms: any;
    positions: Float32Array;
    basePositions: Float32Array;
  } | null>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Scene
    const scene = new THREE.Scene();
    
    // Orthographic camera
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Create points geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(nodeCount * 3);
    const basePositions = new Float32Array(nodeCount * 3);
    const seeds = new Float32Array(nodeCount);
    const clusterIds = new Float32Array(nodeCount);

    // Distribute nodes across clusters
    const numClusters = CLUSTER_CENTERS.length;
    
    for (let i = 0; i < nodeCount; i++) {
      const clusterId = i % numClusters;
      const [cx, cy] = CLUSTER_CENTERS[clusterId];
      
      // Spread around cluster center with gaussian-like distribution
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.4 + Math.random() * 0.3;
      
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
      
      basePositions[i * 3] = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = 0;
      
      seeds[i] = Math.random();
      clusterIds[i] = clusterId;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('clusterId', new THREE.BufferAttribute(clusterIds, 1));

    // Uniforms
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
    };

    // Points material
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

    // Create hyperedge lines (connections between nearby nodes in same cluster)
    const linePositions: number[] = [];
    const lineOpacities: number[] = [];
    const connectionThreshold = 0.25;
    
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        // Only connect within same cluster
        if (clusterIds[i] !== clusterIds[j]) continue;
        
        const dx = positions[i * 3] - positions[j * 3];
        const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < connectionThreshold) {
          linePositions.push(
            positions[i * 3], positions[i * 3 + 1], 0,
            positions[j * 3], positions[j * 3 + 1], 0
          );
          // Opacity based on distance
          const opacity = 1.0 - (dist / connectionThreshold);
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

    // Store refs
    sceneRef.current = {
      renderer,
      scene,
      camera,
      points,
      lines,
      uniforms,
      lineUniforms,
      positions,
      basePositions,
    };

    // Animation
    const startTime = performance.now();
    
    const animate = () => {
      if (!sceneRef.current) return;
      
      const elapsed = (performance.now() - startTime) / 1000;
      
      // Update time uniform only
      uniforms.uTime.value = elapsed;
      lineUniforms.uTime.value = elapsed;
      
      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Resize
    const handleResize = () => {
      if (!sceneRef.current) return;
      
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      renderer.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
      lineUniforms.uResolution.value.set(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationRef.current);
      
      geometry.dispose();
      material.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      
      sceneRef.current = null;
    };
  }, [nodeCount]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

export default OctraBackground;
