# ARCSS-WebAR

Browser-based AR review prototype for CSS NC II. A phone camera feed is overlaid with a 3D motherboard that you assemble with your hand (MediaPipe Hands + Three.js). No install, no build step.

## Levels
**00: PC Assembly** (6 steps): CPU into the socket, RAM into a DIMM slot, GPU into the long PCIe x16 slot, PSU 24-pin power cable to the board, then the HDD and SSD SATA cables to blue SATA ports.

**01: Connecting Peripherals** (8 steps), a desk view of the back of the PC:
1. VGA cable (blue plug) to the VGA port, 2. HDMI cable to the HDMI port, 3. keyboard plug to a USB port, 4. mouse plug to a free USB port,
5. monitor power cord to an AVR outlet, 6. PC power cord to the PC power inlet, 7. AVR power cord to the wall socket, 8. press the AVR power switch (the LED turns green).
Decoy ports (DVI, LAN, audio) give "wrong port" hints.

How to play: show your hand, pinch (thumb + index) on the part, drag it over a matching slot (outline turns green when it will snap, red if wrong), release to place it. Wrong drops count as misplacements. Results (time, accuracy, misplacements) are saved on the device and shown in the Records tab.

## Run it
Camera access needs **HTTPS** (or `localhost`); the 3D models can't load from `file://`.
- Local: `python3 -m http.server 8000` in this folder, then open `http://localhost:8000`.
- Phone: host the folder on HTTPS (GitHub Pages, Netlify) and open the link.

## Files
- `index.html`, `ui.js`, `style.css`: screens, router, simulated login (any non-empty values pass)
- `ar.js`: hand tracking, scene, assembly logic, scoring, local records
- `parts.json`: the levels: each has its scene model, slot map, props and the ordered list of steps
- `models/`: `motherboard.glb`, `ram.glb`, `gpu.glb` (converted from your Blender FBX files); everything else (CPU, PSU, HDD, SSD, the desk scene and all plugs) was modelled for this project and can be replaced

## Adding a step or part
1. Send/convert the model (parts are merged by colour, origin at the bottom-centre of the connector edge).
2. Add a slot for it in `parts.json` -> `slots` (type, x, z, length). Cables use `"kind": "cable"` with a `prop` + `fromPoint`, or an absolute `from` point; a tap-a-switch step uses `"kind": "press"`.
3. Add an entry in `parts` (name, file, which slot types it `accepts`, `seatY`, `dock`, instruction text, and `wrong` messages).
No change to `ar.js` is needed.

Libraries load from CDNs with pinned versions (Three r128, MediaPipe Hands 0.4.1675469240).
