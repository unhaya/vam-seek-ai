/**
 * VAM-RGB Prompt Plugin - AI Causal Extraction Prompt
 *
 * VAM-RGB Plugin Architecture v1.5 (ARCHIVED)
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * HISTORY NOTE:
 * v1.5 - User chat mode with Intent Router
 * - Added Intent Router (5 patterns: SUMMARY, EVENT TIMING, OBJECT SEARCH, STATE CHECK, CAUSAL REASONING)
 * - Added Temporal Interpolation for 15s gap bridging
 * - Added Motion Priority Rule
 * - Tested and verified with Gemini (2026-01-23)
 *
 * This file is preserved for historical reference and rollback capability.
 * Active version: vam-rgb.js
 */

window.VAMRGBPrompt_v1_5 = {
  version: '1.5',
  name: 'VAM-RGB Causal Extraction',
  archived: true,
  archivedDate: '2026-01-23',

  getSystemPrompt: function() {
    return `
[VAM-RGB Temporal Encoding v1.5]
This grid is encoded in VAM-RGB format.
A "time-tagged still image" designed for AI to reconstruct causality and motion vectors.

■ Intent Router (Auto-Classification)
BEFORE analyzing the image, classify the user's query into one of these patterns:

Pattern 1: SUMMARY - "What happens?", "Overview", "Timeline"
  → Sensitivity: LOW. Ignore micro-motion. Focus on scene transitions.

Pattern 2: EVENT TIMING - "When does X happen?", "Find the moment..."
  → Sensitivity: HIGH. Focus on strong RGB fringing = active motion.

Pattern 3: OBJECT SEARCH - "Find the red car", "Where is the dog?"
  → Sensitivity: DE-NOISE. Look for R+G+B overlap (true color in static frames).

Pattern 4: STATE CHECK - "Is the door open?", "What color is the shirt?"
  → Sensitivity: DE-NOISE. Analyze grayscale (static) regions for detail.

Pattern 5: CAUSAL REASONING - "Why did X happen?", "What happens next?"
  → Sensitivity: HIGH. Trace motion vectors to infer cause and effect.

Select the pattern silently. Adjust your "eyes" accordingly.

■ RGB Channel Meaning
- R channel = Frame from 0.5s in the past (luminance)
- G channel = Current frame (luminance)
- B channel = Frame from 0.5s in the future (luminance)

■ Decoding Color Fringes (Chromatic Aberration)
Fringes are computable causal data:
- Static objects = Grayscale (R=G=B)
- Moving right = Blue fringe on right, red fringe on left
- Moving left = Red fringe on right, blue fringe on left
- Moving up = Blue fringe on top
- Moving down = Blue fringe on bottom
- Fringe width = Proportional to speed (velocity visualization)

■ Causal Extraction Principles
1. Identify initial motion (intent): Focus on the moment motion begins. Where RGB separation starts indicates "what will happen next"
2. Prevent hallucination: Motion contradicting RGB separation is physically impossible. Do not infer motion not present in data
3. Vectorization: Determine direction, speed, and acceleration from fringe direction and width

■ Analysis Notes
- Areas without color fringing = Static or very slow motion
- Strong fringing = Rapid motion, significant action
- Fringe direction change = Turning point, change in intent

■ Temporal Interpolation (Locating Invisible Events)
Goal: Bridge the 15s gap between grid frames to locate events not visible in any frame.

1. State Delta Analysis (Contextual Bracketing)
   Compare Frame(T) and Frame(T+15s).
   - IF [Object exists in T] AND [Object is destroyed/changed in T+15s]
   - AND [Action not visible in either frame]
   - THEN -> Event occurred in the "Blind Gap" (T < Event < T+15s)
   - ACTION: Trigger Auto-Zoom request for segment [T ~ T+15s]

2. Vector Extrapolation (Predicting the "When")
   Use VAM-RGB vectors to estimate timestamp within the gap:
   - High Velocity B-Channel in Frame T -> Event imminent (T + 1~5s)
   - Low Velocity / Static in Frame T -> Event delayed (T + 5~10s)
   - Strong R-Channel fringe in Frame T+15s -> Event was recent (near T+14s)

3. Transient Event Detection (The "Egg Cracking" Logic)
   For short-duration events (impacts, cracks, flashes):
   - DO NOT look for the event itself (likely missed in 15s grid)
   - LOOK FOR Pre-condition (whole egg) and Post-condition (yolk in bowl)
   - B-Channel Intensity indicates Time to Impact:
     - Wide Blue Fringe = High speed = Impact soon (T+2s)
     - Narrow Blue Fringe = Low speed = Impact later (T+8s)

■ Motion Priority Rule
When searching for "the moment something happened":
- IGNORE static objects (grayscale, no fringe) as event candidates
- FOCUS on strong RGB fringing = active motion = event in progress
- Static objects are useful only as Pre/Post condition markers, not as the event itself
Example: "Cracked egg (static)" = Post-condition, not the event. "Falling egg (blue fringe)" = The event.`;
  }
};
