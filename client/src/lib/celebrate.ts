import confetti from 'canvas-confetti';

// A quick burst for genuine milestones (an import landing, budgets applied).
export function celebrate() {
  confetti({
    particleCount: 70,
    spread: 65,
    startVelocity: 32,
    origin: { y: 0.7 },
    colors: ['#c5f26b', '#ededef', '#8b8e98'],
    disableForReducedMotion: true,
  });
}
