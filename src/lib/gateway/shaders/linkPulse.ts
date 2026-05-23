'use client';

/**
 * linkPulse — GLSL shader for the inter-node links.
 *
 * Geometry: a single unit-quad strip in the XY plane (length 1 along +X,
 * thickness along +Y). Each instance gets a per-instance transform that
 * stretches the quad between the two endpoint nodes and orients it to face
 * the camera (cheap billboarding via a screen-space thickness term).
 *
 * Per-instance attributes (set by the Links component each frame):
 *   - aSource (vec3): world-space source endpoint
 *   - aTarget (vec3): world-space target endpoint
 *   - aErrored (float): 0 for healthy, 1 for errored
 *   - aColor (vec3): the link's base color (averaged from endpoints)
 *   - aPulsePhase (float): per-link phase offset so pulses don't sync
 *   - aIntensity (float): 0..1 multiplier on the pulse strength
 *
 * Shared uniforms:
 *   - uTime (float): scene time in seconds (driven by useFrame)
 *   - uViewport (vec2): pixel viewport size (for screen-space thickness)
 *   - uPixelRatio (float): renderer.getPixelRatio() for crisp lines
 *
 * Healthy state: a luminous "pulse" travels source→target on a smooth sine
 * envelope. Background of the ribbon is a low-emissive base of the link's
 * color so even idle links read as filaments.
 *
 * Errored state: high-frequency hash-noise displacement along the ribbon
 * creates a jagged glitch-red lightning pattern. The pulse term is replaced
 * by a chaotic flicker driven by stacked noise frequencies.
 */

export const linkVertexShader = /* glsl */ `
precision highp float;

attribute vec3 aSource;
attribute vec3 aTarget;
attribute float aErrored;
attribute vec3 aColor;
attribute float aPulsePhase;
attribute float aIntensity;

uniform float uTime;
uniform vec2 uViewport;
uniform float uPixelRatio;

varying float vT;            // 0..1 along link length
varying float vSide;         // -1..+1 across thickness
varying float vErrored;
varying vec3 vColor;
varying float vPulsePhase;
varying float vIntensity;

/** Hash for noise displacement on errored links. */
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // The unit quad has positions x in [0, 1], y in [-0.5, 0.5].
  // We interpret x as t along the link, y as side across thickness.
  vT = position.x;
  vSide = position.y * 2.0; // → [-1, 1]
  vErrored = aErrored;
  vColor = aColor;
  vPulsePhase = aPulsePhase;
  vIntensity = aIntensity;

  // Endpoint-to-endpoint vector and its length.
  vec3 axis = aTarget - aSource;
  float linkLen = length(axis);
  if (linkLen < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off-screen sentinel
    return;
  }
  vec3 axisN = axis / linkLen;

  // World-space sample point along the centerline.
  vec3 centerWorld = aSource + axisN * (linkLen * vT);

  // Errored links: jagged perpendicular displacement at high frequency.
  // The displacement vector lives in the plane perpendicular to axisN.
  if (aErrored > 0.5) {
    // Build an orthonormal basis (axisN, perp1, perp2).
    vec3 helper = abs(axisN.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 perp1 = normalize(cross(axisN, helper));
    vec3 perp2 = cross(axisN, perp1);

    // Taper amplitude to zero at the endpoints so the lightning stays
    // anchored to the nodes.
    float taper = sin(vT * 3.14159265);

    // Stacked noise frequencies driven by uTime — chaotic flicker.
    float n1 = hash(floor(uTime * 30.0) + vT * 80.0 + aPulsePhase * 13.0);
    float n2 = hash(floor(uTime * 18.0) * 1.7 + vT * 47.0 + aPulsePhase * 7.3);
    float disp1 = (n1 * 2.0 - 1.0) * 0.55 * taper;
    float disp2 = (n2 * 2.0 - 1.0) * 0.55 * taper;

    centerWorld += perp1 * disp1 + perp2 * disp2;
  }

  // Now compute the across-thickness offset in screen space so the ribbon
  // stays a consistent visual width regardless of camera distance.
  vec4 clipCenter = projectionMatrix * viewMatrix * vec4(centerWorld, 1.0);

  // Pick a perpendicular in view space (use camera up projected to axis-perp).
  vec3 viewAxis = normalize((viewMatrix * vec4(axisN, 0.0)).xyz);
  // Perpendicular in view space — cross with view-forward (+Z toward camera).
  vec3 viewPerp = normalize(cross(viewAxis, vec3(0.0, 0.0, 1.0)));
  // If degenerate (link points toward camera) fall back to up.
  if (length(viewPerp) < 1e-3) viewPerp = vec3(0.0, 1.0, 0.0);

  // Thickness in clip space:
  //   NDC spans [-1, 1] across the full framebuffer (width = 2.0)
  //   Framebuffer pixels = cssPixels * pixelRatio
  //   To get N CSS pixels wide → ndcOffset = N * 2.0 / (cssPixels * pixelRatio)
  // The uViewport here is in CSS pixels (from useThree state.size).
  // Healthy links are ~2 CSS px; errored links are ~3.5 CSS px.
  float thicknessCssPx = aErrored > 0.5 ? 3.5 : 2.0;
  vec2 ndcOffset = (viewPerp.xy / max(uViewport * uPixelRatio, vec2(1.0))) * thicknessCssPx * 2.0;

  clipCenter.xy += ndcOffset * vSide * clipCenter.w;

  gl_Position = clipCenter;
}
`;

export const linkFragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;

varying float vT;
varying float vSide;
varying float vErrored;
varying vec3 vColor;
varying float vPulsePhase;
varying float vIntensity;

/** Smooth bump centered at \`center\` with falloff \`width\`. */
float bump(float t, float center, float width) {
  float d = abs(t - center);
  return smoothstep(width, 0.0, d);
}

/** Hash for the errored-state glitch flicker. */
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // Cross-section falloff (thicker near centerline, fade at edges).
  float crossFalloff = 1.0 - abs(vSide);
  crossFalloff = pow(crossFalloff, 1.3);

  vec3 col;
  float alpha;

  if (vErrored > 0.5) {
    // ---- Errored: chaotic glitch lightning ----
    // High-frequency segmented flicker — each ~50ms a different cell along
    // vT lights up brightly.
    float cell = floor(vT * 14.0 + uTime * 18.0);
    float cellFlicker = hash(cell + vPulsePhase * 3.0);
    cellFlicker = pow(cellFlicker, 2.0);

    // Bright red core flickering against a darker base red.
    vec3 baseRed = vec3(0.45, 0.04, 0.06);
    vec3 hotRed = vec3(1.6, 0.18, 0.22);
    col = mix(baseRed, hotRed, cellFlicker);

    // Pulse a sweep too — gives the eye motion to track.
    float sweep = bump(vT, fract(uTime * 0.9 + vPulsePhase), 0.18);
    col += hotRed * sweep * 0.6;

    // High alpha and slight cross-section banding for the lightning feel.
    alpha = (0.55 + cellFlicker * 0.45) * crossFalloff;
  } else {
    // ---- Healthy: smooth luminous pulse traveling source → target ----
    // Pulse position cycles 0→1 over 2 seconds, offset by per-link phase
    // so individual links don't all pulse in lock-step.
    float pulsePos = fract(uTime * 0.5 + vPulsePhase);

    // Sine-windowed pulse — wider than a hard bump, softer falloff.
    float pulse = bump(vT, pulsePos, 0.22) * vIntensity;

    // Base filament: low-luminance tint of the link color, present even
    // when no pulse is on this section.
    vec3 base = vColor * 0.55;

    // Pulse core: hot version of the link color (push above 1.0 so bloom
    // catches it nicely).
    vec3 hot = vColor * 2.4;

    col = base + hot * pulse;

    // Subtle secondary back-traveling glimmer — adds richness without
    // being distracting.
    float glimmer = bump(vT, fract(-uTime * 0.32 + vPulsePhase + 0.4), 0.12);
    col += vColor * glimmer * 0.4;

    alpha = (0.5 + pulse * 0.5) * crossFalloff;
  }

  // Premultiply-friendly output with additive blending.
  gl_FragColor = vec4(col * alpha, alpha);
}
`;
