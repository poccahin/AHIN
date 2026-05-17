import type { TargetAndTransition, Transition, Variants } from "framer-motion";

export const matrixEase = [0.16, 1, 0.3, 1] as const;

export const sceneVariants: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(18px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: matrixEase, staggerChildren: 0.12 }
  }
};

export const headerVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.72, ease: matrixEase } }
};

export const agentContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.18,
      staggerChildren: 0.12
    }
  }
};

export const agentVariants: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.84, filter: "blur(16px)" },
  visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.82, ease: matrixEase } }
};

export const inspectorVariants: Variants = {
  hidden: { opacity: 0, x: 18, scale: 0.96, filter: "blur(14px)" },
  visible: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)", transition: { delay: 0.38, duration: 0.64, ease: matrixEase } }
};

export const modalVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.14 } }
};

export const modalPanelVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.96, filter: "blur(12px)" },
  visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.32, ease: matrixEase } },
  exit: { opacity: 0, y: 10, scale: 0.98, filter: "blur(10px)", transition: { duration: 0.18 } }
};

export const agentIdleAnimation = {
  y: [0, -8, 0],
  rotateX: [0, 2, 0],
  rotateY: [-2, 2, -2],
  scale: [1, 1.015, 1]
};

export const agentIdleTransition: Transition = {
  duration: 5.8,
  repeat: Infinity,
  ease: "easeInOut"
};

export const agentHoverAnimation: TargetAndTransition = {
  y: -16,
  scale: 1.08,
  transition: {
    type: "spring" as const,
    stiffness: 180,
    damping: 18,
    mass: 0.7
  }
};
