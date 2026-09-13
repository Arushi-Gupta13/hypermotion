# Feature test checklist

Use the Hyper Motion **dev app**. Stay on **Properties** (not Animate) unless a step says otherwise.

**How to know the inspector is on a layer:** the header shows the layer name (for example `Frame 2147225834`). If it says **Untitled Scene**, you are on scene settings (Sequence / Background / Layout). Click the **frame** in Layers, not Scene and not empty canvas.

---

## 1. Layer bend (bitmap is OK)

This is the only feature that should work on a pasted **photo**.

1. Paste or import an image into a frame. Select the **frame**, not the image child.
2. Confirm Properties header is the **frame name**.
3. Set **Layer bend → Top left** to ~150 px and **Top** to ~120 px.
4. **Pass:** the top of the card pinches / curls toward the center. Uncheck **Clip** if the warp is cut off.
5. Optional: orbit the camera slightly — you should also see depth.
6. Turn **Auto Key** on, move the playhead, change a bend slider, play. **Pass:** the bend animates.

**Fail if:** nothing moves with the frame selected and values above ~100. Do not test this by selecting Scene.

---

## 2. Vector point editing (needs a real vector)

A mountain **image** will never show handles. Use a Figma **vector**: star, icon, or pen path.

1. In Figma Desktop: **Plugins → Development → Import from manifest…**
2. Open  
   `~/Library/Application Support/hyper-motion-electron/figma-plugin/manifest.json`  
   (⌘⇧G if Library is hidden).
3. Copy a vector from Figma and paste into Hyper Motion.
4. Select the vector. Properties should show a **Vector** section: **Editable paths**.
5. Double-click the vector, or press **Enter**, or click **Edit points and handles**.
6. Drag an anchor and a Bézier handle.
7. Press **Escape** or **Done editing points**.
8. **Pass:** the shape stays changed. **Preserved SVG** or **Raster fallback** means skip this test on that layer.

---

## 3. Vector fill keyframes

1. Select an **editable** vector. **Auto Key** on.
2. Playhead at 0s. Set fill in **Properties → Vector**.
3. Playhead at 1s. Change fill to a different color.
4. Play the timeline.
5. **Pass:** fill interpolates. Timeline shows a **Vector Fill** track.

---

## 4. Path morph keyframes

1. Same editable vector. **Auto Key** on.
2. At 0s, edit points (Enter) and leave a starting shape. Exit edit.
3. At 1s, enter edit again and move anchors to a new shape. Exit edit.
4. Play.
5. **Pass:** the path morphs between the two shapes. Stagger on several sibling vectors should offset each child’s morph.

---

## 5. Inspector / selection sanity

1. Click **Scene** in Layers → Properties = scene (Untitled Scene).
2. Click the **frame** → Properties = layer (bend, clip, etc.).
3. Click **image 20** → image properties, **not** vector handles.
4. Click empty canvas → back to scene page. This is expected, not a missing panel.

---

## 6. Windows (optional)

Only if you have a Windows build from CI:

1. Install the `.exe`.
2. App launches; open a scene; export a short MP4.
3. SmartScreen may warn on unsigned builds — expected for now.

---

## Quick “what am I looking at?”

| What you selected | Test this | Do not expect |
| --- | --- | --- |
| Frame with a photo | Layer bend, clip, keyframes on bend | Vector handles / morph |
| Figma vector (editable) | Handles, fill, path morph | — |
| Scene / empty canvas | Canvas size, background | Layer bend |
| Preserved / raster vector | Fill maybe | Point editing |
