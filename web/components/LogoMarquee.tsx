"use client";

/**
 * Logo marquee — ported from design/logo-marquee.tsx.
 * Changes for CRASSUS: Tailwind classes → CSS (.marquee*), no `brightness-0 invert`
 * (it would flatten the full-colour NASA insignia into a white disc), configurable logo
 * height, and the logo list is repeated so a short list still fills the strip.
 */
import React, { memo, useEffect, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import useMeasure from "react-use-measure";

export type Logo = { src: string; alt: string; width: number; height: number };

type InfiniteSliderProps = {
  children: React.ReactNode;
  gap?: number;
  duration?: number;
  durationOnHover?: number;
  reverse?: boolean;
};

const InfiniteSlider = memo(function InfiniteSlider({ children, gap = 16, duration = 25, durationOnHover, reverse = false }: InfiniteSliderProps) {
  const [currentDuration, setCurrentDuration] = useState(duration);
  const [ref, { width }] = useMeasure();
  const translation = useMotionValue(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [key, setKey] = useState(0);
  const still = useReducedMotion();

  useEffect(() => {
    if (still) return; // respect prefers-reduced-motion: a static row
    const contentSize = width + gap;
    const from = reverse ? -contentSize / 2 : 0;
    const to = reverse ? 0 : -contentSize / 2;
    const controls = isTransitioning
      ? animate(translation, [translation.get(), to], {
          ease: "linear",
          duration: currentDuration * Math.abs((translation.get() - to) / contentSize),
          onComplete: () => { setIsTransitioning(false); setKey((k) => k + 1); },
        })
      : animate(translation, [from, to], {
          ease: "linear", duration: currentDuration, repeat: Infinity, repeatType: "loop", repeatDelay: 0,
          onRepeat: () => translation.set(from),
        });
    return controls.stop;
  }, [key, translation, currentDuration, width, gap, isTransitioning, reverse, still]);

  const hoverProps = durationOnHover
    ? {
        onHoverStart: () => { setIsTransitioning(true); setCurrentDuration(durationOnHover); },
        onHoverEnd: () => { setIsTransitioning(true); setCurrentDuration(duration); },
      }
    : {};

  return (
    <div style={{ overflow: "hidden" }}>
      <motion.div ref={ref} style={{ x: translation, gap: `${gap}px`, display: "flex", width: "max-content" }} {...hoverProps}>
        {children}
        {children}
      </motion.div>
    </div>
  );
});

const LogoImage = memo(function LogoImage({ logo, height }: { logo: Logo; height: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={logo.alt} src={logo.src} width={logo.width} height={logo.height} loading="lazy" draggable={false}
      className="marquee-logo" style={{ height, width: "auto" }} />
  );
});

export const LogoMarquee = memo(function LogoMarquee({ logos, height = 40, gap = 56, minItems = 10, className = "" }: {
  logos: Logo[];
  height?: number;
  gap?: number;
  /** Repeat the list until it has at least this many items, so a short list still fills the strip. */
  minItems?: number;
  className?: string;
}) {
  const reps = Math.max(1, Math.ceil(minItems / Math.max(1, logos.length)));
  const items = Array.from({ length: reps }, () => logos).flat();
  return (
    <div className={`marquee ${className}`}>
      <InfiniteSlider gap={gap} reverse duration={80} durationOnHover={25}>
        {items.map((logo, i) => <LogoImage key={`${logo.alt}-${i}`} logo={logo} height={height} />)}
      </InfiniteSlider>
    </div>
  );
});

export const PARTNER_LOGOS: Logo[] = [
  { src: "/logos/nasa.png", alt: "NASA", width: 320, height: 265 },
  { src: "/logos/space-apps-light.png", alt: "NASA Space Apps Challenge", width: 358, height: 360 },
];

export default LogoMarquee;
