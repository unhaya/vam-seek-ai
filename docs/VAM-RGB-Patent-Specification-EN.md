# VAM-RGB Patent Specification (Defensive Publication)

**Date:** January 23, 2026
**Inventor:** Susumu Takahashi (haasiy / unhaya)
**Title:** Temporal RGB Composition Method and System for Time-Axis Compression of Video

> **Note:** This document is published for defensive purposes to establish prior art. The technical concept described herein, metaphorically referred to as "Causal Teleportation," is formally defined below as "Temporal RGB Composition."

---

## Abstract
The present invention provides a technology for visualizing temporal changes in video content within a single static image. By acquiring frames from a reference time $T_0$ and offset times $T_0 \pm \Delta t$, converting them into luminance or monochromatic components, and mapping them to R (Red), G (Green), and B (Blue) channels respectively, temporal causality is encoded into color space. This "VAM-RGB" format allows AI models to perceive motion direction, speed, and sequence from a single image input, significantly reducing token consumption for video understanding tasks. The invention utilizes chromatic aberration (ghosting) not as noise, but as a signal representing temporal displacement.

---

## Claims

### 1. [Method]
A method for generating a time-axis compressed image from video content, comprising:
* (a) setting a reference time $T_0$;
* (b) acquiring a first frame from a time ($T_0 - \Delta t$) preceding the reference time by a predetermined time offset $\Delta t$;
* (c) acquiring a second frame from the reference time $T_0$;
* (d) acquiring a third frame from a time ($T_0 + \Delta t$) succeeding the reference time by the predetermined time offset $\Delta t$;
* (e) converting each of the first, second, and third frames into luminance information or specific monochromatic components; and
* (f) assigning the values of the converted frames to the R (Red), G (Green), and B (Blue) channels of an output image, respectively, to synthesize a single RGB image.

### 2. [System]
A system for generating a time-axis compressed image from video content, comprising:
* (a) frame acquisition means for seeking to an arbitrary time in the video and acquiring a frame at that time;
* (b) monochromatic conversion means for converting the acquired frame into luminance information or specific monochromatic components;
* (c) RGB composition means for assigning monochromatic values from three different times to R, G, and B channels, respectively, to generate a single RGB image; and
* (d) time offset setting means for setting a time offset value relative to a reference time.

### 3. [Channel Mapping]
The method or system according to Claim 1 or 2, wherein the channel assignment is configured as:
* **R (Red) Channel:** Past frame ($T_0 - \Delta t$)
* **G (Green) Channel:** Current frame ($T_0$)
* **B (Blue) Channel:** Future frame ($T_0 + \Delta t$)

### 4. [AI Optimization]
The method or system according to any one of Claims 1 to 3, further comprising:
using the generated image as input for an Artificial Intelligence (AI) model; and providing a prompt to said AI model instructing it to interpret RGB color separation patterns (chromatic aberration) as indicators of motion vector and temporal causality.

### 5. [Signal Utilization of Ghosting]
The method or system according to any one of Claims 1 to 4, wherein:
RGB separation patterns (chromatic aberration) occurring in moving objects are utilized actively as signals encoding temporal information into spatial information, rather than being treated as noise or artifacts to be removed.

---

## Detailed Description

### Technical Field
The present invention relates to visual time-axis representation of video content, specifically to a technique for expressing temporal changes in a single static image by separating and synthesizing frames from multiple timestamps into RGB channels.

### Background Art
Conventionally, methods such as thumbnail grids, optical flow, and difference images have been used to grasp video outlines. However, these face challenges: thumbnail grids lose temporal resolution, optical flow has high computational costs, and difference images lose the directionality of time. Furthermore, in traditional imaging, "ghosting" or afterimages are treated as noise to be removed.

### Summary of Invention
The present invention solves these problems by "teleporting" causality into color space.
The method extracts frames at $T_0$, $T_0 - \Delta t$, and $T_0 + \Delta t$, converts them to grayscale (e.g., using Rec.709 coefficients), and maps them to R, G, and B channels.

This results in:
* **Static objects:** Appears as grayscale ($R \approx G \approx B$).
* **Moving objects:** Appears as chromatic aberration.
    * Red fringe on left / Blue on right → Moving Right.
    * Wide color separation → Fast motion.

This allows Large Language Models (LLMs) to understand "movement," "speed," and "causality" from a single static image without expensive video processing.

---

## Implementation Example

```javascript
// VAM-RGB: Temporal RGB Composition
async function createVAMRGB(video, T0, deltaT = 0.5) {
    // Step 1: Acquire three temporal frames
    const pastFrame    = await captureFrame(video, T0 - deltaT);
    const presentFrame = await captureFrame(video, T0);
    const futureFrame  = await captureFrame(video, T0 + deltaT);

    // Step 2: Convert to luminance (Rec.709)
    const R = toLuminance(pastFrame);    // Past → Red
    const G = toLuminance(presentFrame); // Present → Green
    const B = toLuminance(futureFrame);  // Future → Blue

    // Step 3: Compose RGB image
    return mergeChannels(R, G, B);
}

function toLuminance(frame) {
    // Rec.709 coefficients
    return frame.map(pixel =>
        0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b
    );
}
```

---

## Motion Pattern Interpretation

| Visual Pattern | Motion State | Signal Meaning |
|----------------|--------------|----------------|
| Grayscale (R ≈ G ≈ B) | Static object | No temporal displacement |
| Red fringe on left | Moving right | Past position trails behind |
| Blue fringe on left | Moving left | Future position leads ahead |
| Wide color separation | Fast motion | Large displacement per Δt |
| Narrow color separation | Slow motion | Small displacement per Δt |

---

## Effects of the Invention

1. **Data Compression:** 3 temporal moments encoded in 1 image (3:1 compression ratio)
2. **Motion Visualization:** Chromatic aberration reveals motion direction and speed
3. **Temporal Directionality:** R→G→B order preserves past→present→future causality
4. **Computational Efficiency:** Simple pixel mapping, no complex optical flow calculation
5. **AI Compatibility:** LLMs can infer motion vectors from single image input
6. **Paradigm Shift:** Ghosting/artifacts are repurposed as information signals

---

## Industrial Applicability

- Video streaming platforms (enhanced thumbnail grids)
- AI video understanding (reduced API token consumption)
- Surveillance systems (motion event summarization)
- Sports analytics (player movement visualization)
- Medical imaging (dynamic process analysis)
- Autonomous vehicles (temporal sensor fusion)

---

## License

This defensive publication establishes prior art as of January 23, 2026.

- **Non-commercial use:** CC BY 4.0 International
- **Commercial use:** Contact haasiy@gmail.com for licensing

---

## References

- Implementation: [VAM Seek AI](https://github.com/unhaya/vam-seek-ai)
- Library: [VAM Seek](https://github.com/unhaya/vam-seek)
- ITU-R BT.709-6: Parameter values for HDTV standards
