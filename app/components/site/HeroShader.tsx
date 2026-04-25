"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MeshGradient } from "@paper-design/shaders-react";

const DARK_COLORS = ["#0a0a0a", "#1a1410", "#3a1f06", "#7a3f06", "#f59e0b"];
const LIGHT_COLORS = ["#fafaf7", "#fff7e8", "#ffd9a3", "#f6a96b", "#f59e0b"];

export function HeroShader({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const colors = mounted && resolvedTheme === "light" ? LIGHT_COLORS : DARK_COLORS;

  return (
    <div
      aria-hidden
      className={className}
      style={{ pointerEvents: "none" }}
    >
      <MeshGradient
        colors={colors}
        distortion={0.85}
        swirl={0.5}
        speed={0.3}
        grainMixer={0.05}
        grainOverlay={0.0}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
