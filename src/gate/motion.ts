import type { TargetAndTransition, Transition, Variants } from "framer-motion";

export const visionEase = [0.16, 1, 0.3, 1] as const;

export const gateExitTransition: Transition = {
  duration: 0.82,
  ease: visionEase
};

export const matrixEntranceTransition: Transition = {
  duration: 1.05,
  delay: 0.45,
  ease: visionEase
};

export const gateCardVariants: Variants = {
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: "blur(0px)"
  },
  exit: {
    opacity: 0,
    scale: 0.94,
    y: -12,
    filter: "blur(22px)",
    transition: gateExitTransition
  }
};

export const matrixRevealVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 1.08,
    filter: "blur(28px)"
  },
  visible: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: matrixEntranceTransition
  }
};

export const agentContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.62,
      staggerChildren: 0.12
    }
  }
};

export const agentEntityVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 24,
    scale: 0.82,
    filter: "blur(16px)"
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      duration: 0.78,
      ease: visionEase
    }
  }
};

export const agentIdleAnimation = {
  y: [0, -8, 0],
  rotateX: [0, 2.5, 0],
  rotateY: [-2, 2, -2],
  scale: [1, 1.018, 1]
};

export const agentIdleTransition: Transition = {
  duration: 5.8,
  repeat: Infinity,
  ease: "easeInOut"
};

export const agentHoverAnimation: TargetAndTransition = {
  y: -18,
  scale: 1.075,
  rotateX: 4,
  rotateY: -6,
  transition: {
    type: "spring" as const,
    stiffness: 180,
    damping: 17,
    mass: 0.7
  }
};

export const agentTapAnimation: TargetAndTransition = {
  scale: 0.955,
  transition: {
    type: "spring" as const,
    stiffness: 420,
    damping: 26,
    mass: 0.55
  }
};
