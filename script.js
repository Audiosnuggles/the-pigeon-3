/**
 * THE PIGEON - Final v40 (Unbreakable DOM Eraser)
 */

let patternBanks = { A: [null, null, null, null], B: [null, null, null, null], C: [null, null, null, null] };
let isSaveMode = false;
let queuedPattern = null;
let activeNodes = []; 

const chordIntervals = { major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7] };
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

function getDistortionCurve() {
  const n = 22050, curve = new Float32Array(n), amount = 80;
  for (let i = 0; i < n; ++i) { let x = i * 2 / n - 1; curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x)); }
  return curve;
}

// --- BRUSH LOGIC ---
function drawSegmentStandard(ctx, pts, idx1, idx2, size) { ctx.lineWidth = size; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke(); }
function drawSegmentVariable(ctx, pts, idx1, idx2, size) { const dist = Math.hypot(pts[idx2].x - pts[idx1].x, pts[idx2].y - pts[idx1].y); ctx.lineWidth = size * (1 + Math.max(0, (10 - dist) / 5)); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke(); }
function drawSegmentCalligraphy(ctx, pts, idx1, idx2, size) { const angle = -Math.PI / 4, dx = Math.cos(angle) * size, dy = Math.sin(angle) * size; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.moveTo(pts[idx1].x - dx, pts[idx1].y - dy); ctx.lineTo(pts[idx1].x + dx, pts[idx1].y + dy); ctx.lineTo(pts[idx2].x + dx, pts[idx2].y + dy); ctx.lineTo(pts[idx2].x - dx, pts[idx2].y - dy); ctx.fill(); }
function drawSegmentParticles(ctx, pts, idx1, idx2, size) { ctx.fillStyle = "rgba(0,0,0,0.6)"; for(let i=0; i<2; i++) { const ox = (Math.random()-0.5)*size*2, oy = (Math.random()-0.5)*size*2; ctx.beginPath(); ctx.arc(pts[idx2].x+ox, pts[idx2].y+oy, Math.max(1, size/3), 0, Math.PI*2); ctx.fill(); } }
function drawSegmentFractal(ctx, pts, idx1, idx2, size) { ctx.lineWidth = size; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pts[idx1].x + (pts[idx1].jX||0), pts[idx1].y + (pts[idx1].jY||0)); ctx.lineTo(pts[idx2].x + (pts[idx2].jX||0), pts[idx2].y + (pts[idx2].jY||0)); ctx.stroke(); }

document.addEventListener("DOMContentLoaded", function() {
  let audioCtx, masterGain, analyser, isPlaying=false;
  let playbackStartTime=0, playbackDuration=0, animationFrameId;
  let undoStack=[], liveNodes=[], liveGainNode=null, liveFilterNode=null;
  let dataArray, lastAvg = 0;

  const toolSelect = document.getElementById("toolSelect"), brushSelect = document.getElementById("brushSelect"), sizeSlider = document.getElementById("brushSizeSlider"), chordSelect = document.getElementById("chordSelect"), harmonizeCheckbox = document.getElementById("harmonizeCheckbox"), pigeonImg = document.getElementById("pigeon");
  const tracks = Array.from(document.querySelectorAll(".track-container")).map((c, i) => ({ index: i, canvas: c.querySelector("canvas"), ctx: c.querySelector("canvas").getContext("2d"), segments: [], wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null }));

  // STORAGE
  const savedBanks = localStorage.getItem("pigeonBanks");
  if (savedBanks) { try { patternBanks = JSON.parse(savedBanks); updatePadUI(); } catch(e) { localStorage.removeItem("pigeonBanks"); loadDefaultSet(); } } else { loadDefaultSet(); }

  function loadDefaultSet() { fetch('default_set.json').then(res => res.json()).then(data => { if(data.banks) { patternBanks = data.banks; updatePadUI(); } if(data.current) loadPatternData(data.current); }).catch(err => console.log("Kein default_set.json")); }
  function updatePadUI() { document.querySelectorAll(".pad").forEach(pad => { const b = pad.dataset.bank, i = parseInt(pad.dataset.idx); pad.classList.toggle("filled", !!(patternBanks[b] && patternBanks[b][i])); }); }

  document.getElementById("saveModeBtn").addEventListener("click", (e) => { isSaveMode = !isSaveMode; e.target.classList.toggle("active", isSaveMode); });

  document.querySelectorAll(".pad").forEach(pad => {
    pad.addEventListener("click", () => {
      const b = pad.dataset.bank, i = parseInt(pad.dataset.idx);
      if (isSaveMode) {
        const state = { settings: { bpm: document.getElementById("bpmInput").value, loop: document.getElementById("loopCheckbox").checked, scale: document.getElementById("scaleSelect").value, harmonize: document.getElementById("harmonizeCheckbox").checked }, tracks: tracks.map(t => ({ segments: t.segments, vol: t.vol, mute: t.mute, wave: t.wave, snap: t.snap })) };
        patternBanks[b][i] = JSON.parse(JSON.stringify(state));
        localStorage.setItem("pigeonBanks", JSON.stringify(patternBanks)); 
        isSaveMode = false; document.getElementById("saveModeBtn").classList.remove("active"); updatePadUI();
        document.querySelectorAll(".pad").forEach(p => p.classList.remove("active", "queued")); pad.classList.add("active");
      } else if (patternBanks[b] && patternBanks[b][i]) {
        if (isPlaying) { queuedPattern = { data: patternBanks[b][i], pad: pad }; document.querySelectorAll(".pad").forEach(p => p.classList.remove("queued")); pad.classList.add("queued"); }
        else { loadPatternData(patternBanks[b][i]); document.querySelectorAll(".pad").forEach(p => { p.classList.remove("active"); p.classList.remove("queued"); }); pad.classList.add("active"); }
      }
    });
  });

  function loadPatternData(d) {
    if(d.settings) { 
        document.getElementById("bpmInput").value = d.settings.bpm; 
        document.getElementById("loopCheckbox").checked = d.settings.loop; 
        document.getElementById("scaleSelect").value = d.settings.scale; 
        document.getElementById("harmonizeCheckbox").checked = d.settings.harmonize; 
        document.getElementById("scaleSelectContainer").style.display = d.settings.harmonize ? "inline" : "none";
        const bpmVal = parseFloat(d.settings.bpm) || 120;
        playbackDuration = (60 / bpmVal) * 32;
    }
    const tData = d.tracks || d;
    if(Array.isArray(tData)) {
      tData.forEach((td, idx) => {
        if(!tracks[idx]) return; let t = tracks[idx];
        t.segments = JSON.parse(JSON.stringify(td.segments || td || [])); 
        if(!Array.isArray(td)) { t.vol = td.vol ?? 0.8; t.mute = td.mute ?? false; t.wave = td.wave ?? "sine"; t.snap = td.snap ?? false; }
        const cont = t.canvas.parentElement; cont.querySelector(".volume-slider").value = t.vol; cont.querySelector(".mute-btn").style.backgroundColor = t.mute ? "#ff4444" : ""; cont.querySelector(".snap-checkbox").checked = t.snap;
        cont.querySelectorAll(".wave-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.wave === t.wave));
        redrawTrack(t);
      });
    }
  }

  harmonizeCheckbox.addEventListener("change", () => {
    document.getElementById("scaleSelectContainer").style.display = harmonizeCheckbox.checked ? "inline" : "none";
  });


  // ==========================================
  // --- BULLETPROOF CURSOR LOGIC ---
  // ==========================================
  let isEraserMode = false;
  const customEraser = document.getElementById("custom-eraser");

  toolSelect.addEventListener("change", (e) => {
    isEraserMode = e.target.value === "erase";
    if (isEraserMode) {
      document.body.classList.add("eraser-mode");
      // Sichert das Canvas nochmal hart gegen Chrome-Bugs ab
      tracks.forEach(t => t.canvas.style.setProperty("cursor", "none", "important"));
      const tp = document.getElementById("trace-pad");
      if (tp) tp.style.setProperty("cursor", "none", "important");
    } else {
      document.body.classList.remove("eraser-mode");
      tracks.forEach(t => t.canvas.style.setProperty("cursor", "crosshair", "important"));
      const tp = document.getElementById("trace-pad");
      if (tp) tp.style.setProperty("cursor", "crosshair", "important");
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (isEraserMode && customEraser) {
      customEraser.style.left = e.clientX + "px";
      customEraser.style.top = e.clientY + "px";
    }
  });
  // ==========================================


  // --- INTERACTION MAIN CANVAS ---
  tracks.forEach(track => {
    drawGrid(track);
    const cont = track.canvas.parentElement;
    cont.querySelectorAll(".wave-btn").forEach(b => b.addEventListener("click", () => { track.wave = b.dataset.wave; cont.querySelectorAll(".wave-btn").forEach(btn => btn.classList.remove("active")); b.classList.add("active"); }));
    cont.querySelector(".mute-btn").addEventListener("click", e => { track.mute = !track.mute; e.target.style.backgroundColor = track.mute ? "#ff4444" : ""; updateTrackVolume(track); });
    cont.querySelector(".volume-slider").addEventListener("input", e => { track.vol = parseFloat(e.target.value); updateTrackVolume(track); });
    cont.querySelector(".snap-checkbox").addEventListener("change", e => track.snap = e.target.checked);

    let drawing = false, curSeg = null;
    const start = e => {
      e.preventDefault(); if(!audioCtx) initAudio(); if(audioCtx.state === "suspended") audioCtx.resume();
      const pos = getPos(e, track.canvas); const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
      if(toolSelect.value === "draw") {
        drawing = true; let jX=0, jY=0; if(brushSelect.value==="fractal"){ jX=Math.random()*20-10; jY=Math.random()*40-20; }
        curSeg = { points: [{x, y:pos.y, jX, jY}], brush: brushSelect.value, thickness: parseInt(sizeSlider.value), chordType: chordSelect.value };
        track.segments.push(curSeg); redrawTrack(track);
        if(brushSelect.value === "particles") triggerParticleGrain(track, pos.y); else startLiveSynth(track, pos.y);
      } else erase(track, x, pos.y);
    };
    const move = e => {
      if(!drawing && toolSelect.value!=="erase") return; e.preventDefault();
      const pos = getPos(e, track.canvas); const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
      if(drawing) {
        let jX=0, jY=0; if(brushSelect.value==="fractal"){ jX=Math.random()*20-10; jY=Math.random()*40-20; }
        curSeg.points.push({x, y:pos.y, jX, jY}); redrawTrack(track); 
        if(brushSelect.value === "particles") triggerParticleGrain(track, pos.y);
        else updateLiveSynth(track, pos.y+jY);
      } else if(toolSelect.value==="erase" && (e.buttons===1 || e.type==="touchmove")) erase(track, x, pos.y);
    };
    const stopDraw = () => { 
      if(drawing) { 
        if(curSeg && curSeg.points.length === 1) {
          curSeg.points.push({x: curSeg.points[0].x + 0.5, y: curSeg.points[0].y, jX: curSeg.points[0].jX, jY: curSeg.points[0].jY});
        }
        undoStack.push({trackIdx:track.index, segment:curSeg}); 
        stopLiveSynth(); 
        redrawTrack(track);
      } 
      drawing = false; 
    };
    
    track.canvas.addEventListener("mousedown", start); track.canvas.addEventListener("mousemove", move); track.canvas.addEventListener("mouseup", stopDraw); track.canvas.addEventListener("mouseleave", stopDraw);
    track.canvas.addEventListener("touchstart", start, {passive:false}); track.canvas.addEventListener("touchmove", move, {passive:false}); track.canvas.addEventListener("touchend", stopDraw);
  });

  // --- AUDIO ---
  function initAudio() { 
    if(audioCtx) return; audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
    masterGain = audioCtx.createGain(); masterGain.gain.value = 0.5; 
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 64; 
    dataArray = new Uint8Array(analyser.frequencyBinCount); 
    
    const compressor = audioCtx.createDynamicsCompressor(); 
    masterGain.connect(compressor).connect(analyser).connect(audioCtx.destination); 
  }
  
  function startLiveSynth(track, y) { 
    if(track.mute || track.vol < 0.01) return; 
    liveNodes = []; liveGainNode = audioCtx.createGain(); 
    liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime); 
    liveGainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime+0.01); 

    liveFilterNode = audioCtx.createBiquadFilter(); 
    liveFilterNode.type = "lowpass"; liveFilterNode.Q.value = 10; liveFilterNode.frequency.value = 20000;

    let freq = mapY(y, track.canvas.height); if(harmonizeCheckbox.checked) freq = quantize(freq); 
    const ivs = (brushSelect.value==="chord") ? chordIntervals[chordSelect.value] : [0]; 
    ivs.forEach(iv => { 
        const osc = audioCtx.createOscillator(); osc.type = track.wave; 
        osc.frequency.setValueAtTime(freq * Math.pow(2, iv/12), audioCtx.currentTime); 
        if(brushSelect.value === "fractal") {
            const sh = audioCtx.createWaveShaper(); sh.curve = getDistortionCurve();
            osc.connect(sh).connect(liveGainNode);
        } else { osc.connect(liveGainNode); }
        osc.start(); liveNodes.push(osc); 
    }); 
    const trackG = audioCtx.createGain(); trackG.gain.value = track.vol;
    liveGainNode.connect(liveFilterNode).connect(trackG).connect(masterGain); 
    liveGainNode.out = trackG;
  }

  function updateLiveSynth(track, y) { if(!liveGainNode) return; let freq = mapY(y, track.canvas.height); if(harmonizeCheckbox.checked) freq = quantize(freq); liveNodes.forEach((n, i) => { const ivs = (brushSelect.value==="chord") ? chordIntervals[chordSelect.value] : [0]; n.frequency.setTargetAtTime(freq * Math.pow(2, (ivs[i]||0)/12), audioCtx.currentTime, 0.02); }); }
  
  function stopLiveSynth() { 
    if(!liveGainNode) return; const gn = liveGainNode, ns = liveNodes; 
    const isChord = (brushSelect.value === "chord");
    gn.gain.setTargetAtTime(0, audioCtx.currentTime, isChord ? 0.005 : 0.05); 
    setTimeout(() => { ns.forEach(n=>n.stop()); if(gn.out) gn.out.disconnect(); if(liveFilterNode) liveFilterNode.disconnect(); gn.disconnect(); }, 100); 
    liveNodes = []; liveGainNode = null; liveFilterNode = null;
  }
  
  function triggerParticleGrain(track, y) { 
    if(track.mute || track.vol < 0.01) return; 
    let freq = mapY(y, track.canvas.height); if(harmonizeCheckbox.checked) freq = quantize(freq); 
    const osc = audioCtx.createOscillator(); osc.type = track.wave; osc.frequency.value = freq; 
    const env = audioCtx.createGain(); const now = audioCtx.currentTime;
    env.gain.setValueAtTime(0, now); env.gain.linearRampToValueAtTime(0.4, now + 0.01); env.gain.exponentialRampToValueAtTime(0.01, now + 0.15); 
    const trackG = audioCtx.createGain(); trackG.gain.value = track.vol;
    osc.connect(env).connect(trackG).connect(masterGain); 
    osc.start(now); osc.stop(now + 0.2); 
    activeNodes.push(osc);
  }

  function scheduleTracks(start, targetCtx = audioCtx, targetDest = masterGain) {
    tracks.forEach(track => {
      const trkG = targetCtx.createGain(); trkG.connect(targetDest); trkG.gain.value = track.mute ? 0 : track.vol;
      if (targetCtx === audioCtx) track.gainNode = trkG;

      track.segments.forEach(seg => {
        const brush = seg.brush || "standard";
        if(brush==="particles") { 
          seg.points.forEach(p => { 
            const t = Math.max(0, start + (p.x/track.canvas.width)*playbackDuration); 
            const osc = targetCtx.createOscillator(); osc.type = track.wave; 
            let f = mapY(p.y, 100); if(harmonizeCheckbox.checked) f = quantize(f);
            osc.frequency.value = f;
            const env = targetCtx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.4, t+0.01); env.gain.exponentialRampToValueAtTime(0.01, t+0.15); 
            osc.connect(env).connect(trkG); osc.start(t); osc.stop(t+0.2); 
            if (targetCtx === audioCtx) activeNodes.push(osc); 
          }); return; 
        }
        const sorted = seg.points.slice().sort((a,b)=>a.x-b.x); if(sorted.length<2) return;
        let sT = Math.max(0, start + (sorted[0].x/track.canvas.width)*playbackDuration), eT = Math.max(0, start + (sorted[sorted.length-1].x/track.canvas.width)*playbackDuration);
        if(brush==="chord") { 
          chordIntervals[seg.chordType||"major"].forEach(iv => { 
            const osc = targetCtx.createOscillator(); osc.type=track.wave; const g=targetCtx.createGain(); g.gain.setValueAtTime(0, sT); g.gain.linearRampToValueAtTime(0.2, sT+0.005); g.gain.setValueAtTime(0.2, eT); g.gain.linearRampToValueAtTime(0, eT+0.05); 
            osc.connect(g).connect(trkG); sorted.forEach(p=>{ const t = Math.max(0, start + (p.x/track.canvas.width)*playbackDuration); let f = mapY(p.y, 100); if(harmonizeCheckbox.checked) f = quantize(f); osc.frequency.linearRampToValueAtTime(f * Math.pow(2, iv/12), t); }); 
            osc.start(sT); osc.stop(eT+0.1); 
            if (targetCtx === audioCtx) activeNodes.push(osc); 
          }); return; 
        }
        const osc = targetCtx.createOscillator(); osc.type=track.wave; const g=targetCtx.createGain(); g.gain.setValueAtTime(0, sT); g.gain.linearRampToValueAtTime(0.3, sT+0.02); g.gain.setValueAtTime(0.3, eT); g.gain.linearRampToValueAtTime(0, eT+0.1); if(brush==="fractal"){ const sh = targetCtx.createWaveShaper(); sh.curve=getDistortionCurve(); osc.connect(sh).connect(g); } else { osc.connect(g); } g.connect(trkG); sorted.forEach(p=>{ const t = Math.max(0, start + (p.x/track.canvas.width)*playbackDuration); let f = mapY(p.y, 100); if(harmonizeCheckbox.checked) f = quantize(f); osc.frequency.linearRampToValueAtTime(f, t); }); 
        osc.start(sT); osc.stop(eT+0.2); 
        if (targetCtx === audioCtx) activeNodes.push(osc); 
      });
    });
  }

  function loop() {
    if(!isPlaying) return; const elapsed = audioCtx.currentTime - playbackStartTime;
    if(elapsed >= playbackDuration) { 
      activeNodes = activeNodes.filter(n => n.playbackState !== 'finished'); 
      if (queuedPattern) { loadPatternData(queuedPattern.data); document.querySelectorAll(".pad").forEach(p=>p.classList.remove("active", "queued")); queuedPattern.pad.classList.add("active"); queuedPattern = null; } 
      if(document.getElementById("loopCheckbox").checked) { playbackStartTime = audioCtx.currentTime; scheduleTracks(playbackStartTime); } 
      else { isPlaying=false; return; } 
    }
    const x = (elapsed/playbackDuration) * 750; 
    tracks.forEach(t => redrawTrack(t, x)); 
    updateViz(x);
    animationFrameId = requestAnimationFrame(loop);
  }

  function updateViz(currentX) { 
    analyser.getByteFrequencyData(dataArray); let avg = dataArray.reduce((a,b)=>a+b)/dataArray.length; let d = avg - lastAvg; lastAvg = avg; 
    let isFractalActive = false;
    if (currentX !== undefined) {
        tracks.forEach(t => { 
            if(t.mute) return; 
            t.segments.forEach(seg => { 
                if (seg.brush === "fractal") {
                    const xs = seg.points.map(p => p.x);
                    if (currentX >= Math.min(...xs) && currentX <= Math.max(...xs)) isFractalActive = true;
                }
            });
        });
    }
    let filterStr = "";
    if (isFractalActive && avg > 10) {
        const rOff = (avg/10) * (Math.random()>0.5?1:-1);
        filterStr = `drop-shadow(${rOff}px 0px 0px rgba(255,0,0,0.7)) drop-shadow(${-rOff}px 0px 0px rgba(0,255,255,0.7))`;
    }
    pigeonImg.style.filter = filterStr;
    pigeonImg.style.transform = `scale(${1+Math.min(0.2, d/100)}, ${1-Math.min(0.5, d/50)})`; 
  }

  function getPos(e, c) { const r=c.getBoundingClientRect(); const cx=e.touches?e.touches[0].clientX:e.clientX, cy=e.touches?e.touches[0].clientY:e.clientY; return {x:(cx-r.left)*(c.width/r.width), y:(cy-r.top)*(c.height/r.height)}; }
  function snap(x, w) { return Math.round(x/(w/32))*(w/32); }
  function mapY(y, h) { return Math.max(20, Math.min(1000-(y/h)*920, 20000)); }
  function quantize(f) { const s=document.getElementById("scaleSelect").value; let m=Math.round(69+12*Math.log2(f/440)), pat=(s==="major")?[0,2,4,5,7,9,11]:(s==="minor")?[0,2,3,5,7,8,10]:[0,3,5,7,10], mod=m%12, b=pat[0], md=99; pat.forEach(p=>{if(Math.abs(p-mod)<md){md=Math.abs(p-mod);b=p;}}); return 440*Math.pow(2,(m-mod+b-69)/12); }
  
  function updateTrackVolume(t) { if(t.gainNode && audioCtx) { t.gainNode.gain.setTargetAtTime(t.mute ? 0 : t.vol, audioCtx.currentTime, 0.05); } }

  function drawGrid(t) { 
    t.ctx.save(); t.ctx.clearRect(0,0,t.canvas.width,t.canvas.height); t.ctx.strokeStyle="#eee"; 
    for(let i=0;i<=32;i++){ 
        t.ctx.beginPath(); let x = i*(t.canvas.width/32); t.ctx.moveTo(x,0); t.ctx.lineTo(x,t.canvas.height); 
        t.ctx.lineWidth = (i % 4 === 0) ? 2 : 1; 
        t.ctx.stroke(); 
    } 
    t.ctx.restore(); 
  }

  function erase(t,x,y) { t.segments=t.segments.filter(s=>!s.points.some(p=>Math.hypot(p.x-x,p.y-y)<20)); redrawTrack(t); }

  function redrawTrack(t, hx) {
    drawGrid(t);
    t.segments.forEach(seg => {
      const pts=seg.points; if (pts.length < 1) return;
      const brush=seg.brush||"standard", size=seg.thickness||5;
      t.ctx.beginPath(); t.ctx.strokeStyle="#000"; t.ctx.lineWidth=size;
      if(brush==="chord"){ chordIntervals[seg.chordType||"major"].forEach((iv,i)=>{ t.ctx.save(); t.ctx.beginPath(); t.ctx.strokeStyle=chordColors[i%3]; t.ctx.lineWidth=size; t.ctx.moveTo(pts[0].x, pts[0].y-iv*5); for(let k=1;k<pts.length;k++) t.ctx.lineTo(pts[k].x,pts[k].y-iv*5); t.ctx.stroke(); t.ctx.restore(); }); } 
      else if(brush==="particles"){ for(let i=1;i<pts.length;i++) drawSegmentParticles(t.ctx, pts, i-1, i, size); } 
      else { t.ctx.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++){ switch(brush){ case"variable": drawSegmentVariable(t.ctx, pts, i-1, i, size); break; case"calligraphy": drawSegmentCalligraphy(t.ctx, pts, i-1, i, size); break; case"fractal": drawSegmentFractal(t.ctx, pts, i-1, i, size); break; default: drawSegmentStandard(t.ctx, pts, i-1, i, size); } } t.ctx.stroke(); } 
    });
    if(hx!==undefined){ t.ctx.save(); t.ctx.beginPath(); t.ctx.strokeStyle="red"; t.ctx.lineWidth=2; t.ctx.moveTo(hx,0); t.ctx.lineTo(hx,100); t.ctx.stroke(); t.ctx.restore(); }
  }

  document.getElementById("playButton").addEventListener("click", () => { if(isPlaying) return; initAudio(); if(audioCtx.state==="suspended")audioCtx.resume(); playbackDuration=(60/(parseFloat(document.getElementById("bpmInput").value)||120))*32; playbackStartTime=audioCtx.currentTime+0.1; isPlaying=true; scheduleTracks(playbackStartTime); loop(); });
  document.getElementById("stopButton").addEventListener("click", () => { isPlaying = false; cancelAnimationFrame(animationFrameId); activeNodes.forEach(node => { try { node.stop(); node.disconnect(); } catch (e) {} }); activeNodes = []; tracks.forEach(t => { if(t.gainNode) t.gainNode.disconnect(); redrawTrack(t); }); if(pigeonImg) { pigeonImg.style.transform = "scale(1)"; pigeonImg.style.filter = ""; } document.querySelectorAll(".pad").forEach(p => p.classList.remove("queued")); });
  document.getElementById("clearButton").addEventListener("click", () => { tracks.forEach(t=>{t.segments=[]; redrawTrack(t);}); });
  document.getElementById("undoButton").addEventListener("click", () => { if(undoStack.length){const o=undoStack.pop(); tracks[o.trackIdx].segments.pop(); redrawTrack(tracks[o.trackIdx]);} });
  document.getElementById("exportButton").addEventListener("click", () => { const blob=new Blob([JSON.stringify({current:{settings:{bpm:document.getElementById("bpmInput").value,loop:document.getElementById("loopCheckbox").checked,scale:document.getElementById("scaleSelect").value,harmonize:document.getElementById("harmonizeCheckbox").checked},tracks:tracks.map(t=>({segments:t.segments,vol:t.vol,mute:t.mute,wave:t.wave,snap:t.snap}))},banks:patternBanks})],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="pigeon_live_set.json"; a.click(); });
  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", e => { const r=new FileReader(); r.onload=evt=>{ try{ const d=JSON.parse(evt.target.result); if(d.banks){patternBanks=d.banks; localStorage.setItem("pigeonBanks",JSON.stringify(patternBanks)); updatePadUI();} loadPatternData(d.current||d); }catch(e){alert("Fehler!");} }; r.readAsText(e.target.files[0]); });
  document.getElementById("fullscreenBtn").addEventListener("click", () => { if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(e=>alert("Fullscreen nicht möglich")); else document.exitFullscreen(); });

  // WAV EXPORT
  document.getElementById("exportWavButton").addEventListener("click", () => {
    const btn=document.getElementById("exportWavButton"); btn.innerText="Rendering...";
    setTimeout(() => {
      const bpm = parseFloat(document.getElementById("bpmInput").value) || 120;
      const dur=(60/bpm)*32;
      const offCtx=new OfflineAudioContext(2, 44100*dur, 44100);
      const master=offCtx.createGain(); master.gain.value=0.5; master.connect(offCtx.destination);
      const oldD = playbackDuration; playbackDuration = dur;
      scheduleTracks(0, offCtx, master);
      offCtx.startRendering().then(buf => {
        const wav=audioBufferToWav(buf); const a=document.createElement("a"); a.href=URL.createObjectURL(wav); a.download="pigeon_loop.wav"; a.click();
        btn.innerText="Export WAV"; playbackDuration = oldD;
      });
    }, 50);
  });

  function audioBufferToWav(buffer) {
    let n=buffer.numberOfChannels, len=buffer.length*n*2+44, arr=new ArrayBuffer(len), view=new DataView(arr);
    const s32 = (v,o) => view.setUint32(o,v,true);
    s32(0x46464952,0); s32(len-8,4); s32(0x45564157,8); s32(0x20746d66,12); s32(16,16); view.setUint16(20,1,true); view.setUint16(22,n,true); s32(buffer.sampleRate,24); s32(buffer.sampleRate*n*2,28); view.setUint16(32,n*2,true); view.setUint16(34,16,true); s32(0x61746164,36); s32(len-44,40);
    let offset=44; for(let i=0;i<buffer.length;i++) for(let c=0;c<n;c++) { let s=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i])); view.setInt16(offset,(s<0?s*32768:s*32767),true); offset+=2; }
    return new Blob([arr],{type:"audio/wav"});
  }

  // ==========================================
  // --- TRACE PAD PERFORMANCE LOGIC ---
  // ==========================================
  let isTracing = false;
  let traceCurrentSeg = null;
  let currentTargetTrack = 0;
  const tracePad = document.getElementById("trace-pad");

  if (tracePad) {
    const getPadPos = (e) => {
      const r = tracePad.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (cx - r.left) * (750 / r.width), y: (cy - r.top) * (100 / r.height) }; 
    };

    const startTrace = (e) => {
      e.preventDefault();
      if (!isPlaying) return;
      if (!audioCtx) initAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();
      
      isTracing = true;
      const pos = getPadPos(e);
      const elapsed = audioCtx.currentTime - playbackStartTime;
      const currentX = (elapsed / playbackDuration) * 750;
      
      let jX = 0, jY = 0;
      if (brushSelect.value === "fractal") { jX = Math.random() * 20 - 10; jY = Math.random() * 40 - 20; }
      
      traceCurrentSeg = { 
          points: [{x: currentX, y: pos.y, jX, jY}], 
          brush: brushSelect.value, 
          thickness: parseInt(sizeSlider.value), 
          chordType: chordSelect.value 
      };
      tracks[currentTargetTrack].segments.push(traceCurrentSeg);
      
      if (brushSelect.value === "particles") triggerParticleGrain(tracks[currentTargetTrack], pos.y);
      else startLiveSynth(tracks[currentTargetTrack], pos.y);
    };

    const moveTrace = (e) => {
      if (!isTracing || !isPlaying) return;
      e.preventDefault();
      const pos = getPadPos(e);
      const elapsed = audioCtx.currentTime - playbackStartTime;
      const currentX = (elapsed / playbackDuration) * 750;
      
      let jX = 0, jY = 0;
      if (brushSelect.value === "fractal") { jX = Math.random() * 20 - 10; jY = Math.random() * 40 - 20; }
      
      traceCurrentSeg.points.push({x: currentX, y: pos.y, jX, jY});
      redrawTrack(tracks[currentTargetTrack]); 
      
      if (brushSelect.value === "particles") triggerParticleGrain(tracks[currentTargetTrack], pos.y);
      else updateLiveSynth(tracks[currentTargetTrack], pos.y + jY);
    };

    const stopTrace = () => {
      if (isTracing) {
        if(traceCurrentSeg && traceCurrentSeg.points.length === 1) {
            let p = traceCurrentSeg.points[0];
            traceCurrentSeg.points.push({x: p.x + 0.5, y: p.y, jX: p.jX, jY: p.jY});
        }
        redrawTrack(tracks[currentTargetTrack]);
        undoStack.push({trackIdx: currentTargetTrack, segment: traceCurrentSeg});
        stopLiveSynth();
        isTracing = false;
        traceCurrentSeg = null;
      }
    };

    tracePad.addEventListener("mousedown", startTrace);
    tracePad.addEventListener("mousemove", moveTrace);
    tracePad.addEventListener("mouseup", stopTrace);
    tracePad.addEventListener("mouseleave", stopTrace);
    
    tracePad.addEventListener("touchstart", startTrace, {passive: false});
    tracePad.addEventListener("touchmove", moveTrace, {passive: false});
    tracePad.addEventListener("touchend", stopTrace);
    
    document.querySelectorAll(".picker-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".picker-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTargetTrack = parseInt(btn.dataset.target);
      });
    });
    
    document.getElementById("traceClearBtn").addEventListener("click", () => {
      tracks[currentTargetTrack].segments = [];
      redrawTrack(tracks[currentTargetTrack]);
    });
  }
});