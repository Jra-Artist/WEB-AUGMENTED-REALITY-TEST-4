(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const liveText = $('ar-live-text'), stepText = $('ar-step-description'), timerEl = $('ar-timer'), taskEl = $('ar-task'), resultEl = $('ar-result');
    const video = $('webcam'), canvas = $('output_canvas');

    const libsOk = typeof THREE !== 'undefined' && THREE.GLTFLoader && typeof Hands !== 'undefined' && typeof Camera !== 'undefined';
    if (!libsOk) {
        window.launchAR = () => alert('AR libraries failed to load. Check your internet connection and reload.');
        window.exitAR = s => switchScreen(s); window.restartAR = () => {};
        console.error('ARCSS: required libraries (three, GLTFLoader, MediaPipe) are missing.');
        return;
    }

    const PINCH_ON = 0.30, PINCH_OFF = 0.45;   // thumb-index distance / palm size (hysteresis)
    const SNAP_TOL = 0.14, NEAR_TOL = 0.45;    // screen-space tolerances (view units)
    const GRAB_R = 0.55;                       // grab radius around a part

    // ---------- Three.js scene ----------
    const scene = new THREE.Scene();
    const cam3 = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
    cam3.position.z = 5;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(2, 4, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-3, -2, 3); scene.add(fill);

    // tilt (scale + tabletop angle) > boardRoot (level frame) > scene model, parts, slot outlines
    const tilt = new THREE.Group(); scene.add(tilt);
    const boardRoot = new THREE.Group(); tilt.add(boardRoot);

    const fingerMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const thumbDot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), fingerMat);
    const indexDot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), fingerMat);
    thumbDot.visible = indexDot.visible = false; thumbDot.position.z = indexDot.position.z = 0.8;
    scene.add(thumbDot, indexDot);

    // ---------- Levels (parts.json + GLB files) ----------
    let ALL = null, CFG = null, built = -1, loading = null, loadingN = -1, parts = [], props = [], glows = [];
    const gltfLoader = new THREE.GLTFLoader();
    const loadGLB = url => new Promise((res, rej) => gltfLoader.load(url, g => res(g.scene), undefined, () => rej(new Error('could not load ' + url))));

    function loadLevel(n) {
        if (built === n && parts.length) return Promise.resolve();
        if (loading && loadingN === n) return loading;
        loadingN = n;
        const p = (ALL ? Promise.resolve(ALL) : fetch('parts.json').then(r => { if (!r.ok) throw new Error('could not load parts.json (HTTP ' + r.status + ')'); return r.json(); }).then(j => (ALL = j)))
            .then(async all => {
                const cfg = all.levels[n]; if (!cfg) throw new Error('level ' + n + ' is missing in parts.json');
                const pcs = cfg.props || [];
                const files = [cfg.board.file, ...pcs.map(x => x.file), ...cfg.parts.map(x => x.file)];
                const [board, ...rest] = await Promise.all(files.map(f => f ? loadGLB(f) : Promise.resolve(new THREE.Group())));
                const objs = rest.slice(pcs.length);
                boardRoot.clear();
                CFG = cfg; tilt.rotation.x = cfg.tiltDeg * Math.PI / 180; boardRoot.rotation.y = cfg.rotY !== undefined ? cfg.rotY : Math.PI / 2;
                boardRoot.add(board);
                glows = cfg.slots.map(s => {
                    const m = new THREE.Mesh(new THREE.BoxGeometry(s.w + 3, s.h + 3, s.len + 4), new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true, transparent: true, opacity: 0.5 }));
                    m.position.set(s.x, s.h / 2, s.z); m.visible = false; boardRoot.add(m); return m;
                });
                props = pcs.map((pc, i) => { const o = rest[i], box = new THREE.Box3().setFromObject(o); o.position.set(...pc.pos); o.visible = false; boardRoot.add(o); return { cfg: pc, obj: o, box }; });
                parts = cfg.parts.map((p, i) => {
                    const box = new THREE.Box3().setFromObject(objs[i]); objs[i].visible = false; boardRoot.add(objs[i]);
                    const part = { cfg: p, obj: objs[i], box, center: new THREE.Vector3(...p.center), dock: new THREE.Vector3(...(p.dock || [0, 0, 0])) };
                    if (p.kind === 'cable') {   // the plug is the dragged part; the cable is a tube from its fixed end to the plug
                        const pr = p.prop && props.find(x => x.cfg.id === p.prop);
                        part.from = p.from ? new THREE.Vector3(...p.from) : new THREE.Vector3(...pr.cfg.pos).add(new THREE.Vector3(...p.fromPoint));
                        part.tube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: new THREE.Color(p.cableColor || '#d32f2f'), roughness: 0.6 }));
                        part.tube.visible = false; boardRoot.add(part.tube);
                    }
                    return part;
                });
                built = n; layout();
            });
        loading = p; p.catch(() => { if (loading === p) loading = null; });
        return p;
    }

    // ---------- Layout / projection helpers ----------
    let viewW = 1, viewH = 1;
    function layout() {
        renderer.setSize(innerWidth, innerHeight);
        cam3.aspect = innerWidth / innerHeight; cam3.updateProjectionMatrix();
        viewH = 2 * Math.tan(cam3.fov * Math.PI / 360) * cam3.position.z; viewW = viewH * cam3.aspect;
        if (!CFG || !parts.length) return;
        cam3.updateMatrixWorld(); tilt.scale.setScalar(0.006); tilt.position.set(0, 0, 0);
        fit(); setPlane();
    }
    // Scale and centre the scene + parts tray so everything sits between the top bar and the bottom card
    function fit() {
        const pts = [], bw = CFG.board.depth / 2, bd = CFG.board.width / 2;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { pts.push(new THREE.Vector3(a * bw, 0, b * bd), new THREE.Vector3(a * bw, 46, b * bd)); });
        const corners = (box, off) => { if (box.isEmpty()) return; [box.min.x, box.max.x].forEach(x => [box.min.y, box.max.y].forEach(y => [box.min.z, box.max.z].forEach(z => pts.push(off.clone().add(new THREE.Vector3(x, y, z)))))); };
        parts.forEach(p => corners(p.box, p.dock));
        props.forEach(pr => corners(pr.box, new THREE.Vector3(...pr.cfg.pos)));
        const regW = viewW * 0.94, regH = viewH * 0.62, cy = viewH * 0.005;
        const measure = () => { tilt.updateMatrixWorld(true); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
            pts.forEach(p => { const q = screenOf(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }); return { x0, x1, y0, y1 }; };
        for (let k = 0; k < 3; k++) {
            let m = measure(); tilt.scale.multiplyScalar(Math.min(regW / (m.x1 - m.x0), regH / (m.y1 - m.y0)));
            m = measure(); tilt.position.x -= (m.x0 + m.x1) / 2; tilt.position.y += cy - (m.y0 + m.y1) / 2;
        }
    }
    addEventListener('resize', layout);
    addEventListener('orientationchange', () => setTimeout(layout, 150));

    const _v = new THREE.Vector3();
    function screenOf(local) {   // level-local point -> screen position in "view units"
        _v.copy(local); boardRoot.localToWorld(_v); _v.project(cam3);
        return { x: _v.x * viewW / 2, y: _v.y * viewH / 2 };
    }
    function localFromScreen(sx, sy, worldZ) {   // point on the plane z=worldZ that appears at screen (sx, sy)
        const t = (cam3.position.z - worldZ) / cam3.position.z;
        return boardRoot.worldToLocal(new THREE.Vector3(sx * t, sy * t, worldZ));
    }

    // ---------- Hand input (MediaPipe) ----------
    let input = null, handsInstance = null, camUtil = null, running = false, rafId = 0;
    function mapTo3D(nx, ny) {
        const sa = innerWidth / innerHeight, va = (video.videoWidth || innerWidth) / (video.videoHeight || innerHeight);
        let sx = 1, sy = 1, ox = 0, oy = 0;
        if (sa > va) { sy = va / sa; oy = (1 - sy) / 2; } else { sx = sa / va; ox = (1 - sx) / 2; }
        return { x: (((nx - ox) / sx) - 0.5) * viewW, y: -(((ny - oy) / sy) - 0.5) * viewH };
    }
    function onResults(res) {
        if (!running) return;
        const h = res.multiHandLandmarks && res.multiHandLandmarks[0];
        if (!h) return;
        const palm = Math.hypot(h[0].x - h[9].x, h[0].y - h[9].y) || 0.1;
        const ratio = Math.hypot(h[4].x - h[8].x, h[4].y - h[8].y) / palm;
        const t = mapTo3D(h[4].x, h[4].y), i = mapTo3D(h[8].x, h[8].y);
        input = { t, i, mid: { x: (t.x + i.x) / 2, y: (t.y + i.y) / 2 }, ratio, time: performance.now() };
    }

    // ---------- Scenario ----------
    let state = 'wait', idx = 0, holding = false, errors = 0, startTime = 0, seatAt = 0, msgUntil = 0, planeZ = 0, prevDown = false, seatSlotId = null;
    const grabOff = { x: 0, y: 0 }, seatTarget = new THREE.Vector3(), used = new Set();   // used = slots already filled
    const cur = () => parts[idx];
    const accepts = (p, s) => p.cfg.accepts.includes(s.type);
    const snapTol = () => CFG.snapTol || SNAP_TOL;
    const hoverOf = (s, p) => new THREE.Vector3(s.x, p.cfg.seatY + (CFG.hover || 45), s.z);
    const setStep = (txt, color) => { stepText.innerText = txt; stepText.style.color = color || '#3b42c4'; };
    const pickText = () => cur().cfg.pick || `Step ${idx + 2}: Pinch (thumb + index) on the ${cur().cfg.name} to pick it up.`;
    const moveText = () => `Step ${idx + 2}: ${cur().cfg.place}`;
    const flash = txt => { setStep(txt, '#f44336'); msgUntil = performance.now() + 2600; };

    function setPlane() {   // depth plane the held part is dragged on
        const p = cur(); if (!p) return;
        const s = CFG.slots.find(s => accepts(p, s));
        planeZ = boardRoot.localToWorld(hoverOf(s, p)).z;
    }
    function setPart(i) {
        idx = i; holding = false;
        parts.forEach((p, k) => { p.obj.visible = k <= i; if (p.tube) p.tube.visible = k <= i; });
        props.forEach(pr => { pr.obj.visible = pr.cfg.showFrom <= i; });
        cur().obj.position.copy(cur().dock); updateTube(cur());
        taskEl.innerText = `Task: ${cur().cfg.verb || 'Install'} ${cur().cfg.name} (${i + 1}/${parts.length})`;
        setPlane(); setStep(pickText());
    }
    function resetScenario() {
        if (!parts.length) return;
        errors = 0; startTime = 0; input = null; msgUntil = 0; prevDown = false;
        used.clear(); (CFG.preUsed || []).forEach(id => used.add(id));
        boardRoot.traverse(o => { if (o.isMesh && o.userData.led) o.material.color.copy(o.userData.led); });   // LEDs back to "off"
        resultEl.style.display = 'none'; timerEl.innerText = '⏱ 0.0s';
        setPart(0); state = 'wait';
        setStep('Step 1: Show your hand to the camera to start tracking.');
    }
    function updateTube(p) {   // cable between its fixed end and the plug
        if (!p || !p.tube) return;
        const F = p.from, P = p.obj.position, mid = F.clone().add(P).multiplyScalar(0.5);
        mid.y += 14 + 0.12 * F.distanceTo(P);
        const curve = new THREE.CatmullRomCurve3([F.clone(), F.clone().add(new THREE.Vector3(0, 6, 0)), mid, P.clone().add(new THREE.Vector3(0, 5, 0))]);
        p.tube.geometry.dispose(); p.tube.geometry = new THREE.TubeGeometry(curve, 28, CFG.tubeR || 2.2, 6, false);
    }
    function nearestSlot(p) {
        const a = screenOf(p.obj.position); let best = null, bd = 1e9;
        CFG.slots.forEach(s => { if (used.has(s.id)) return; const h = screenOf(hoverOf(s, p)), d = Math.hypot(a.x - h.x, a.y - h.y); if (d < bd) { bd = d; best = s; } });
        return { slot: best, dist: bd };
    }
    function release() {
        holding = false;
        const p = cur(), { slot, dist } = nearestSlot(p);
        if (dist < snapTol() && accepts(p, slot)) {
            seatSlotId = slot.id; seatTarget.set(slot.x, p.cfg.seatY, slot.z); seatAt = performance.now(); state = 'seating';
        } else if (dist < NEAR_TOL) {
            errors++;
            flash(dist < snapTol() ? ((p.cfg.wrong && p.cfg.wrong[slot.type]) || 'Wrong slot. Try again.') : 'Not aligned with the slot. Try again.');
        } else setStep(pickText());
    }
    function press(p, slot) {   // tap a switch
        const fin = p.cfg.finale;
        if (fin) boardRoot.traverse(o => {
            const led = o.isMesh && fin.leds.find(l => l.mesh === o.name);
            if (led) { if (!o.userData.led) o.userData.led = o.material.color.clone(); o.material.color.set(led.color); }
        });
        setStep('Power ON!', '#00c853');
        seatSlotId = slot.id; seatTarget.copy(p.obj.position); seatAt = performance.now(); state = 'seating';
    }
    function finish() {
        state = 'done';
        const sec = (performance.now() - startTime) / 1000, acc = Math.round(100 * parts.length / (parts.length + errors));
        $('res-time').innerText = sec.toFixed(1) + 's'; $('res-acc').innerText = acc + '%'; $('res-err').innerText = errors;
        setStep(CFG.doneText || 'All steps complete! Check your results.', '#00c853');
        saveSession({ task: CFG.sessionName || CFG.name, time: +sec.toFixed(1), errors, accuracy: acc, date: new Date().toISOString() });
        setTimeout(() => { if (state === 'done') resultEl.style.display = 'flex'; }, 700);
    }

    function tick() {
        rafId = requestAnimationFrame(tick);
        if (!running) return;
        const now = performance.now();
        if (!parts.length) { renderer.render(scene, cam3); return; }
        scene.updateMatrixWorld(true);
        const fresh = input && now - input.time < 300;
        const down = !!(fresh && input.ratio < PINCH_ON);

        if (fresh) {
            thumbDot.position.set(input.t.x, input.t.y, 0.8); indexDot.position.set(input.i.x, input.i.y, 0.8);
            thumbDot.visible = indexDot.visible = true; liveText.innerText = '🟢 TRACKING ACTIVE';
        } else { thumbDot.visible = indexDot.visible = false; liveText.innerText = '🔴 SEARCHING FOR HAND...'; }

        const p = state === 'done' ? null : cur();
        let hl = null;
        if (state === 'wait' && fresh) { state = 'play'; setStep(pickText()); }

        if (state === 'play' && p.cfg.kind === 'press') {
            const sl = CFG.slots.find(s => accepts(p, s)), t = screenOf(new THREE.Vector3(sl.x, sl.h, sl.z));
            if (down && !prevDown && Math.hypot(input.mid.x - t.x, input.mid.y - t.y) < 0.4) { if (!startTime) startTime = now; press(p, sl); }
        } else if (state === 'play') {
            const pinching = fresh && input.ratio < (holding ? PINCH_OFF : PINCH_ON);
            if (!holding && pinching) {
                const c = screenOf(p.obj.position.clone().add(p.center));
                if (Math.hypot(input.mid.x - c.x, input.mid.y - c.y) < GRAB_R) {
                    const o = screenOf(p.obj.position);
                    grabOff.x = o.x - input.mid.x; grabOff.y = o.y - input.mid.y;
                    holding = true; if (!startTime) startTime = now; setStep(moveText());
                }
            } else if (holding && !pinching) release();

            if (holding && state === 'play') {
                const ax = Math.max(-viewW / 2, Math.min(viewW / 2, input.mid.x + grabOff.x));
                const ay = Math.max(-viewH / 2, Math.min(viewH / 2, input.mid.y + grabOff.y));
                p.obj.position.lerp(localFromScreen(ax, ay, planeZ), 0.5);
                const n = nearestSlot(p); if (n.dist < NEAR_TOL) hl = n;
                fingerMat.color.setHex(hl && hl.dist < snapTol() && accepts(p, hl.slot) ? 0x00ff66 : 0x00e5ff);
            } else if (state === 'play') {
                fingerMat.color.setHex(0x00e5ff);
                const home = p.dock.clone(); home.y += Math.sin(now / 500) * 2;   // idle bob
                p.obj.position.lerp(home, 0.15);
            }
        } else if (state === 'seating') {
            p.obj.position.lerp(seatTarget, 0.22);
            if (now - seatAt > 500) {
                p.obj.position.copy(seatTarget); updateTube(p); used.add(seatSlotId);
                if (idx < parts.length - 1) { setPart(idx + 1); state = 'play'; } else finish();
            }
        }
        prevDown = down;
        if (p && p.tube) updateTube(p);

        // slot outlines: valid slots for the current part (dim), plus the nearest one while holding
        glows.forEach((g, k) => {
            const s = CFG.slots[k]; let vis = false, col = 0x00e5ff, op = 0.25 + 0.15 * Math.sin(now / 300);
            if (p && state !== 'seating' && accepts(p, s) && !used.has(s.id)) vis = true;
            if (hl && hl.slot === s) { vis = true; op = 0.9; col = (hl.dist < snapTol() && accepts(p, s)) ? 0x00ff66 : 0xff5252; }
            g.visible = vis; g.material.color.setHex(col); g.material.opacity = op;
        });

        if (startTime && state !== 'done') timerEl.innerText = '⏱ ' + ((now - startTime) / 1000).toFixed(1) + 's';
        if (msgUntil && now > msgUntil) { msgUntil = 0; if (state === 'play') setStep(holding ? moveText() : pickText()); }
        renderer.render(scene, cam3);
    }

    // ---------- Records (localStorage) ----------
    function loadSessions() { try { return JSON.parse(localStorage.getItem('arcss_sessions') || '[]'); } catch (e) { return []; } }
    function saveSession(s) {
        try { localStorage.setItem('arcss_sessions', JSON.stringify([s].concat(loadSessions()).slice(0, 10))); } catch (e) { console.warn('Storage unavailable', e); }
        renderRecords();
    }
    function renderRecords() {
        const list = $('recent-list'), s = loadSessions();
        if (!list || !s.length) return;
        list.innerHTML = s.slice(0, 5).map(x => `<div class="recent-item">${x.task}: ${x.time}s · ${x.accuracy}% accuracy · ${x.errors} misplacement${x.errors === 1 ? '' : 's'}</div>`).join('');
    }

    // ---------- Public API ----------
    let currentLevel = 0;
    window.launchAR = function (n) {
        n = Number.isInteger(n) ? n : 0; currentLevel = n;
        switchScreen('screen-ar');
        if (built !== n) { boardRoot.clear(); parts = []; props = []; glows = []; built = -1; }
        layout(); running = true; input = null;
        liveText.innerText = '⏳ LOADING 3D MODELS...';
        resultEl.style.display = 'none';
        cancelAnimationFrame(rafId); tick();
        loadLevel(n).then(resetScenario).catch(err => {
            console.error('Model load failed:', err);
            liveText.innerText = '⚠️ MODELS FAILED TO LOAD';
            setStep('Failed: ' + err.message + '. Make sure parts.json and the models/ folder are uploaded next to index.html.', '#f44336');
        });

        if (!handsInstance) {
            handsInstance = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}` });
            handsInstance.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            handsInstance.onResults(onResults);
        }
        camUtil = new Camera(video, {
            onFrame: async () => { if (running) await handsInstance.send({ image: video }); },
            width: 640, height: 480, facingMode: 'environment'
        });
        camUtil.start().catch(err => {
            console.error('Camera error:', err);
            liveText.innerText = '⚠️ CAMERA BLOCKED';
            setStep('Camera access failed. Allow camera permission and open this page over HTTPS.', '#f44336');
        });
    };
    window.restartAR = function () { resetScenario(); };
    window.exitAR = function (target) {
        running = false; cancelAnimationFrame(rafId);
        try { if (camUtil) camUtil.stop(); } catch (e) { }
        if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null; camUtil = null; input = null;
        resultEl.style.display = 'none';
        switchScreen(target);
    };

    layout(); renderRecords();
})();
