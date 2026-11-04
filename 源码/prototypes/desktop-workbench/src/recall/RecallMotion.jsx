import React, { forwardRef } from 'react';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';

// Local React Bits adaptations, using the host's existing Motion dependency:
// Starter Animated List: stable keys, AnimatePresence/popLayout and row layout.
// Starter Modal Cards: short enter/exit opacity and displacement transitions.
// Pro ai-chat-1: reveal actual new answer text, without its English word streamer.
// Source inventory and scope are recorded in workbench-20261025/design-brief.md.
// Business state stays in RecallWorkbench; no demo timers or cloned list items.
const ease = [0.22, 1, 0.36, 1];

export const RecallMotionRow = forwardRef(function RecallMotionRow({ children, ...props }, ref) {
  const present = useIsPresent(),
    reduce = useReducedMotion();
  return (
    <motion.article
      {...props}
      ref={ref}
      layout={reduce ? false : 'position'}
      data-motion="recall-row"
      data-presence={present ? 'present' : 'exiting'}
      inert={!present ? true : undefined}
      aria-hidden={!present || undefined}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 1 } : { opacity: 0, y: -5 }}
      transition={{ duration: reduce ? 0 : 0.2, ease, layout: { duration: reduce ? 0 : 0.22, ease } }}
    >
      {children}
    </motion.article>
  );
});

export const RecallMotionReader = forwardRef(function RecallMotionReader({ children, ...props }, ref) {
  const present = useIsPresent(),
    reduce = useReducedMotion();
  return (
    <motion.aside
      {...props}
      ref={ref}
      data-motion="recall-reader"
      inert={!present ? true : undefined}
      aria-hidden={!present || undefined}
      initial={reduce ? false : { opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 1 } : { opacity: 0, x: 8 }}
      transition={{ duration: reduce ? 0 : 0.22, ease }}
    >
      {children}
    </motion.aside>
  );
});

export function RecallMotionMessage({ fresh = false, onReveal, children, ...props }) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      {...props}
      data-motion={fresh ? 'new-reply' : 'message'}
      initial={fresh && !reduce ? { opacity: 0, y: 5 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22, ease }}
      onAnimationComplete={fresh ? onReveal : undefined}
    >
      {children}
    </motion.article>
  );
}
