const WHEEL_GESTURE_GAP_MS = 96
const WHEEL_ACCELERATION_GAIN = 1.8
const WHEEL_SMOOTHING_TIME_MS = 42

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const normalizedWheelZoomDelta = (event: {
  deltaMode: number
  deltaY: number
}) => {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002
  return clamp(-event.deltaY * unit, -0.5, 0.5)
}

export const acceleratedWheelZoomTarget = ({
  currentScale,
  pendingTargetScale,
  delta,
  previousDirection,
  previousStreak,
  lastEventAt,
  now,
  minScale,
  maxScale,
}: {
  currentScale: number
  pendingTargetScale: number
  delta: number
  previousDirection: number
  previousStreak: number
  lastEventAt: number
  now: number
  minScale: number
  maxScale: number
}) => {
  const direction = Math.sign(delta)
  const elapsed = now - lastEventAt
  const continuing =
    direction !== 0 &&
    direction === previousDirection &&
    elapsed >= 0 &&
    elapsed <= WHEEL_GESTURE_GAP_MS
  const streak = continuing
    ? Math.min(
        1,
        previousStreak + Math.max(0.08, (1 - elapsed / WHEEL_GESTURE_GAP_MS) * 0.22),
      )
    : 0
  const acceleration = 1 + streak * WHEEL_ACCELERATION_GAIN
  const baseScale = continuing ? pendingTargetScale : currentScale
  return {
    targetScale: clamp(baseScale * 2 ** (delta * acceleration), minScale, maxScale),
    direction,
    streak,
    acceleration,
  }
}

export const wheelZoomSmoothingAlpha = (elapsedMs: number) =>
  1 - Math.exp(-clamp(elapsedMs, 1, 34) / WHEEL_SMOOTHING_TIME_MS)
