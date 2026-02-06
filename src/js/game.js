import { Ball } from './Ball.js';
import { Wall } from './Wall.js';

let engine, world;
let balls = [];
let staticBallPlaceholders = []; // Visual placeholders that become balls when hit
let bars = [];
let audioCtx;
let focusedBar = null;
let selectedBars = [];
let focusedStaticBall = null;
let dragMode = null; // 'move' or 'rotate', 'spawner'
let spawners = [{ x: -150, y: 100, r: 18, dragging: false, delay: 0 }];
let dragOffset = { x: 0, y: 0 };
let copiedBars = []; // Array to store copied bars with relative positions
let particles = [];
let defaultBarWidth = 160;
let defaultBarShape = 'rect';
let defaultBarNote = 'Auto';
let defaultBarInstrument = 'sine';
let isTemplateReadOnly = false; // Track if current template is read-only

// History / Undo System
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 50;

window.saveHistory = function() {
    const state = {
        gravity: engine ? engine.gravity.y : 1,
        bounce: parseFloat(document.getElementById('bounce-slider')?.value || 0.8),
        instrument: defaultBarInstrument,
        spawners: spawners.map(s => ({ ...s, dragging: false })),
        staticBalls: staticBallPlaceholders.map(s => ({ ...s, isFocused: false })),
        bars: bars.map(b => ({
            x: b.body.position.x,
            y: b.body.position.y,
            w: b.w,
            h: b.h,
            angle: b.body.angle,
            note: b.note,
            shape: b.shape,
            instrument: b.instrument,
            curvatureTop: b.curvatureTop || 0,
            curvatureBottom: b.curvatureBottom || 0,
            maxHits: b.maxHits || 0
        }))
    };
    
    const serialized = JSON.stringify(state);
    // Don't save identical state (multi-stage interactions)
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === serialized) return;
    
    undoStack.push(serialized);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = []; 
};

window.undo = function() {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    const prevState = JSON.parse(undoStack[undoStack.length - 1]);
    applyHistoryState(prevState);
};

window.redo = function() {
    if (redoStack.length === 0) return;
    const nextStateStr = redoStack.pop();
    undoStack.push(nextStateStr);
    const nextState = JSON.parse(nextStateStr);
    applyHistoryState(nextState);
};

function applyHistoryState(state) {
    // Clear physics
    bars.forEach(b => b.destroy());
    bars = [];
    staticBallPlaceholders = [];
    
    // Clear selection
    focusedBar = null;
    selectedBars = [];
    focusedStaticBall = null;
    
    // Rebuild
    state.bars.forEach(b => {
        const wall = new Wall(world, Matter, b.x, b.y, b.w, b.h, b.angle, b.note, b.shape, b.instrument, b.curvatureTop, b.curvatureBottom);
        wall.maxHits = b.maxHits || 0;
        bars.push(wall);
    });
    
    staticBallPlaceholders = state.staticBalls.map(s => ({ ...s }));
    spawners = state.spawners.map(s => ({ ...s }));
    
    if (engine) engine.gravity.y = state.gravity;
    
    // Sync UI
    const gravInput = document.getElementById('gravity-slider');
    const bounceInput = document.getElementById('bounce-slider');
    const instSelect = document.getElementById('instrument-select');
    if (gravInput) gravInput.value = state.gravity;
    if (bounceInput) bounceInput.value = state.bounce;
    if (instSelect) instSelect.value = state.instrument;
    
    defaultBarInstrument = state.instrument;
    
    window.syncTimingUI();
    window.syncControls();
}

// Shape Palette
let shapePaletteOpen = true;
let draggingFromPalette = false;
let paletteShapeData = null;
let shapeGhostCanvas = null;

// Predefined shapes for palette
const shapeLibrary = [
    { name: "Bar", w: 160, h: 22, shape: 'rect', curvatureTop: 0, curvatureBottom: 0 },
    { name: "Wave Bridge", w: 157.27273265996178, h: 10, shape: 'rect', curvatureTop: 0.8, curvatureBottom: 0 },
    { name: "Bowl", w: 242, h: 77, shape: 'rect', curvatureTop: -0.1, curvatureBottom: 0 },
    { name: "Seesaw", w: 180, h: 15, shape: 'seesaw', curvatureTop: 0, curvatureBottom: 0 },
    { name: "Circle", w: 50, h: 50, shape: 'circle', curvatureTop: 0, curvatureBottom: 0 },
    { name: "Triangle", w: 60, h: 60, shape: 'triangle', curvatureTop: 0, curvatureBottom: 0 },
    { name: "Static Ball", w: 32, h: 32, shape: 'static_ball', curvatureTop: 0, curvatureBottom: 0 }
];

const noteFrequencies = {
    'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'G3': 196.00, 'A3': 220.00, 'B3': 246.94,
    'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
    'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'F5': 698.46, 'G5': 783.99, 'A5': 880.00, 'Bb4': 466.16, 'B5': 987.77,
    'C6': 1046.50
};

// Camera & Zoom
let camX = 0;
let camY = 0;
let targetCamX = 500;
let targetCamY = 400;
let zoom = 1.0;
let targetZoom = 1.0;
let isFollowingBall = false;
let panWarningTimer = 0;
let spawnerPressPos = { x: 0, y: 0 };

const { Engine, World, Bodies, Mouse, MouseConstraint, Events, Body } = Matter;

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 6;
        this.vy = (Math.random() - 0.5) * 6;
        this.alpha = 255;
        this.color = color;
        this.size = Math.random() * 4 + 2;
    }

    draw(p) {
        this.updateOnly();
        p.noStroke();
        let c = p.color(this.color);
        c.setAlpha(this.alpha);
        p.fill(c);
        p.circle(this.x, this.y, this.size);
    }

    updateOnly() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= 8;
    }
}

window.setup = function() {
    const canvas = createCanvas(windowWidth, windowHeight);
    
    // Note: We use compound bodies (multiple rectangles) for curved shapes
    // so poly-decomp is not required
    if (typeof decomp !== 'undefined') {
        Matter.Common.setDecomp(decomp);
    }
    
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 1;
    
    // Balanced iterations for performance and stability
    engine.positionIterations = 10; 
    engine.velocityIterations = 8; 
    engine.constraintIterations = 2; 
    
    // Collision detection settings
    engine.enableSleeping = true; // Enable sleeping to save CPU on idle objects
    world.bounds = { min: { x: -5000, y: -5000 }, max: { x: 5000, y: 5000 } };

    // Audio setup
    canvas.mousePressed(() => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    });

    // Initial state: Start with 1 spawner at center
    spawners = [{ x: 400, y: 100, r: 18, dragging: false, delay: 0 }];
    targetCamX = 400;
    targetCamY = 300;

    // Collision detection
    Events.on(engine, 'collisionStart', (event) => {
        event.pairs.forEach(pair => {
            // Get parent bodies (for compound bodies)
            const bodyA = pair.bodyA.parent || pair.bodyA;
            const bodyB = pair.bodyB.parent || pair.bodyB;
            
            // Check for ball objects
            const ballObjA = balls.find(b => b.body === bodyA);
            const ballObjB = balls.find(b => b.body === bodyB);
            
            // Check for ball-to-ball collision first
            if (ballObjA && ballObjB) {
                return; // Ignore ball-to-ball collisions
            }
            
            // Check for ball collision with static ball placeholder (only if one ball, not two)
            if (ballObjA || ballObjB) {
                const activeBall = ballObjA || ballObjB;
                const contact = pair.collision.supports[0] || bodyA.position;
                
                // Check if ball hit any placeholder
                for (let i = staticBallPlaceholders.length - 1; i >= 0; i--) {
                    const placeholder = staticBallPlaceholders[i];
                    const dx = contact.x - placeholder.x;
                    const dy = contact.y - placeholder.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    
                    if (dist < placeholder.radius + activeBall.radius) {
                        // Activate placeholder - create real ball
                        const newBall = new Ball(
                            world,
                            Matter,
                            placeholder.x,
                            placeholder.y,
                            placeholder.radius,
                            parseFloat(document.getElementById('bounce-slider').value),
                            activeBall.color, // Inherit color from hitting ball
                            false // Not static anymore
                        );
                        balls.push(newBall);
                        
                        // Remove placeholder
                        staticBallPlaceholders.splice(i, 1);
                        if (focusedStaticBall === placeholder) {
                            focusedStaticBall = null;
                        }
                        
                        // Particles
                        for (let j = 0; j < 12; j++) {
                            particles.push(new Particle(placeholder.x, placeholder.y, '#00f2fe'));
                        }
                        break;
                    }
                }
            }
            
            // Check if either body is a bar
            const barObjA = bars.find(b => b.body === bodyA);
            const barObjB = bars.find(b => b.body === bodyB);
            
            // Ignore collision between two bars (especially seesaw with other bars)
            if (barObjA && barObjB) {
                return;
            }
            
            const barObj = barObjA || barObjB;
            if (barObj) {
                // Check if the other object is a ball
                const ballObj = ballObjA || ballObjB;
                if (!ballObj) {
                    return; // Not a ball collision, ignore
                }
                
                // Check if seesaw hit any placeholder
                const barContact = pair.collision.supports[0] || bodyA.position;
                for (let i = staticBallPlaceholders.length - 1; i >= 0; i--) {
                    const placeholder = staticBallPlaceholders[i];
                    const dx = barContact.x - placeholder.x;
                    const dy = barContact.y - placeholder.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    
                    if (dist < placeholder.radius + 10) { // Small threshold for bar collision
                        // Activate placeholder
                        const newBall = new Ball(
                            world,
                            Matter,
                            placeholder.x,
                            placeholder.y,
                            placeholder.radius,
                            parseFloat(document.getElementById('bounce-slider').value),
                            barObj.settings.color,
                            false
                        );
                        balls.push(newBall);
                        
                        staticBallPlaceholders.splice(i, 1);
                        if (focusedStaticBall === placeholder) {
                            focusedStaticBall = null;
                        }
                        
                        for (let j = 0; j < 12; j++) {
                            particles.push(new Particle(placeholder.x, placeholder.y, '#00f2fe'));
                        }
                        break;
                    }
                }
                
                barObj.onHit();
                window.playNote(barObj.body.position.y, barObj.note, barObj.instrument);
                
                // Ball changes color to bar's color
                ballObj.color = barObj.settings.color;
                
                // Blast particles at collision point
                const collisionPoint = pair.collision.supports[0] || pair.bodyA.position;
                for (let i = 0; i < 12; i++) {
                    particles.push(new Particle(collisionPoint.x, collisionPoint.y, barObj.settings.color));
                }
            }
        });
    });
    
    window.syncTimingUI();
    window.initShapePalette();
    window.loadTemplateMetadata(); // Load template metadata for badges
    window.saveHistory(); // Save initial state
};

// Load template metadata to show readonly badges
window.loadTemplateMetadata = async function() {
    const templateCards = document.querySelectorAll('.template-card[data-template-url]');
    
    for (const card of templateCards) {
        const url = card.dataset.templateUrl;
        if (!url) continue;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            // Add readonly badge if template is readonly
            if (data.readonly === true) {
                // Check if badge already exists
                if (!card.querySelector('.template-readonly-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'template-readonly-badge';
                    badge.textContent = 'READ-ONLY';
                    card.appendChild(badge);
                }
            }
        } catch (err) {
            console.warn(`Failed to load metadata for ${url}:`, err);
        }
    }
};

// Shape Palette Functions
window.initShapePalette = function() {
    const container = document.getElementById('shape-items-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    shapeLibrary.forEach((shapeData, index) => {
        const item = document.createElement('div');
        item.className = 'shape-item';
        item.dataset.shapeIndex = index;
        
        // Create mini canvas for preview
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 60;
        const ctx = canvas.getContext('2d');
        
        // Draw shape preview
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, 120, 60);
        
        ctx.strokeStyle = '#00f2fe';
        ctx.fillStyle = 'rgba(0, 242, 254, 0.1)';
        ctx.lineWidth = 2;
        
        const centerX = 60;
        const centerY = 30;
        const scale = 0.6;
        
        if (shapeData.shape === 'static_ball') {
            // Draw static ball preview
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#666';
            ctx.fillStyle = '#3c3c3c';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, 16 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (shapeData.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(centerX, centerY, (shapeData.w / 2) * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (shapeData.shape === 'triangle') {
            const size = shapeData.w * scale;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - size / 2);
            ctx.lineTo(centerX + size / 2, centerY + size / 2);
            ctx.lineTo(centerX - size / 2, centerY + size / 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            // Rectangle with curvature
            const w = shapeData.w * scale;
            const h = shapeData.h * scale;
            
            if (shapeData.curvatureTop !== 0 || shapeData.curvatureBottom !== 0) {
                const segments = 16;
                ctx.beginPath();
                
                // Top edge
                for (let i = 0; i <= segments; i++) {
                    const f = i / segments;
                    const px = centerX - w/2 + f * w;
                    const bulge = Math.sin(f * Math.PI) * (shapeData.curvatureTop * h * 5.0);
                    const py = centerY - h/2 - bulge;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                
                // Bottom edge
                for (let i = segments; i >= 0; i--) {
                    const f = i / segments;
                    const px = centerX - w/2 + f * w;
                    const bulge = Math.sin(f * Math.PI) * (shapeData.curvatureBottom * h * 5.0);
                    const py = centerY + h/2 + bulge;
                    ctx.lineTo(px, py);
                }
                
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            } else if (shapeData.shape === 'seesaw') {
                // Draw seesaw with pivot
                ctx.fillRect(centerX - w/2, centerY - h/2, w, h);
                ctx.strokeRect(centerX - w/2, centerY - h/2, w, h);
                
                // Draw pivot
                ctx.beginPath();
                ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#0a0a0a';
                ctx.beginPath();
                ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillRect(centerX - w/2, centerY - h/2, w, h);
                ctx.strokeRect(centerX - w/2, centerY - h/2, w, h);
            }
        }
        
        item.appendChild(canvas);
        
        const label = document.createElement('div');
        label.className = 'shape-item-label';
        label.textContent = shapeData.name;
        item.appendChild(label);
        
        // Drag event - use global mouse events instead
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            draggingFromPalette = true;
            paletteShapeData = { ...shapeData };
            
            // Clone canvas for ghost preview
            const ghostDiv = document.getElementById('shape-ghost');
            if (ghostDiv) {
                ghostDiv.innerHTML = '';
                shapeGhostCanvas = canvas.cloneNode(true);
                shapeGhostCanvas.style.width = '100px';
                shapeGhostCanvas.style.height = '50px';
                shapeGhostCanvas.style.borderRadius = '8px';
                ghostDiv.appendChild(shapeGhostCanvas);
                ghostDiv.classList.remove('hidden');
                
                // Position ghost at mouse
                ghostDiv.style.left = e.clientX + 'px';
                ghostDiv.style.top = e.clientY + 'px';
            }
        });
        
        container.appendChild(item);
    });
    
    // Add global mousemove listener for ghost
    document.addEventListener('mousemove', (e) => {
        if (draggingFromPalette) {
            const ghostDiv = document.getElementById('shape-ghost');
            if (ghostDiv && !ghostDiv.classList.contains('hidden')) {
                ghostDiv.style.left = e.clientX + 'px';
                ghostDiv.style.top = e.clientY + 'px';
            }
        }
    });
};


window.toggleShapePalette = function() {
    shapePaletteOpen = !shapePaletteOpen;
    const palette = document.getElementById('shape-palette');
    const chevron = document.getElementById('shape-chevron');
    
    if (shapePaletteOpen) {
        if (palette) palette.classList.remove('collapsed');
        if (chevron) chevron.classList.add('shape-chevron-rotated');
    } else {
        if (palette) palette.classList.add('collapsed');
        if (chevron) chevron.classList.remove('shape-chevron-rotated');
    }
};

window.mousePressed = function(event) {
    const ui = document.getElementById('ui');
    const toggleBtn = document.querySelector('.toggle-btn');
    const palette = document.getElementById('shape-palette');
    const timingUI = document.getElementById('timing-ui');
    
    // Check if target is inside any UI element
    const target = event ? event.target : null;
    const isOverUI = ui && target && ui.contains(target);
    const isOverToggle = toggleBtn && target && toggleBtn.contains(target);
    const isOverPalette = palette && target && palette.contains(target);
    const isOverTiming = timingUI && target && timingUI.contains(target);
    
    // If balls are active, don't allow selecting or dragging bars
    
    // Handle dragging from palette
    if (draggingFromPalette && paletteShapeData) {
        return; // Will be handled in mouseReleased
    }
    
    // Convert screen mouse to world mouse
    const worldMouseX = (mouseX - width/2) / zoom + camX;
    const worldMouseY = (mouseY - height/2) / zoom + camY;

    // Check Spawners first - ALLOW in readonly mode for spawning balls
    if (!isOverUI && !isOverToggle && !isOverPalette && !isOverTiming) {
        for (let s of spawners) {
            let d = dist(worldMouseX, worldMouseY, s.x, s.y);
            if (d < s.r + 15) {
                // In readonly mode, only allow spawning, not dragging
                if (isTemplateReadOnly) {
                    spawnerPressPos = { x: worldMouseX, y: worldMouseY };
                    dragMode = 'spawner-readonly'; // Special mode for readonly
                } else {
                    s.dragging = true;
                    spawnerPressPos = { x: worldMouseX, y: worldMouseY };
                    dragMode = 'spawner';
                }
                return;
            }
        }
    }
    
    // Block all other editing interactions in read-only mode
    if (isTemplateReadOnly) {
        return;
    }

    // If balls are active, don't allow selecting or dragging bars
    const activeBalls = balls.filter(b => !b.wasStatic || !b.isStatic);
    if (activeBalls.length > 0) {
        dragMode = null;
        return;
    }
    
    
    // Block interaction with bars when clicking on any UI element
    if (isOverUI || isOverToggle || isOverPalette || isOverTiming) {
        return;
    }

    let hitSomething = false;
    const isCtrlDown = keyIsDown(CONTROL);
    
    // Check handles first if exactly one bar is focused
    if (focusedBar && selectedBars.length === 1) {
        const resizeType = focusedBar.isNearResizeHandle(worldMouseX, worldMouseY);
        if (resizeType) {
            dragMode = resizeType === 'width' ? 'resizeWidth' : 'resizeHeight';
            hitSomething = true;
        } else if (focusedBar.isNearRotateHandle(worldMouseX, worldMouseY)) {
            dragMode = 'rotate';
            hitSomething = true;
        }
    }

    if (!hitSomething) {
        for (let bar of bars) {
            if (bar.contains(worldMouseX, worldMouseY)) {
                if (isCtrlDown) {
                    // Toggle selection
                    const idx = selectedBars.indexOf(bar);
                    if (idx === -1) {
                        // Add to selection
                        selectedBars.push(bar);
                        bar.isFocused = true;
                    } else {
                        // Remove from selection (deselect)
                        selectedBars.splice(idx, 1);
                        bar.isFocused = false;
                    }
                    
                    // Update focusedBar based on selection
                    if (selectedBars.length === 1) {
                        focusedBar = selectedBars[0];
                    } else if (selectedBars.length === 0) {
                        focusedBar = null;
                    } else {
                        // Multiple bars selected, no single focused bar
                        focusedBar = null;
                    }
                } else {
                    // Normal single selection
                    // Reset all
                    bars.forEach(b => b.isFocused = false);
                    if (focusedStaticBall) focusedStaticBall.isFocused = false;
                    
                    focusedBar = bar;
                    focusedBar.isFocused = true;
                    selectedBars = [bar];
                    focusedStaticBall = null;
                    dragMode = 'move';
                    dragOffset.x = worldMouseX - bar.body.position.x;
                    dragOffset.y = worldMouseY - bar.body.position.y;
                }
                hitSomething = true;
                if (window.syncControls) window.syncControls();
                break;
            }
        }
    }
    
    // Check static ball placeholders
    if (!hitSomething) {
        for (let placeholder of staticBallPlaceholders) {
            const dx = worldMouseX - placeholder.x;
            const dy = worldMouseY - placeholder.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < placeholder.radius) {
                // Multi-select for balls not implemented as per request, just bars
                // Clear bar selection
                bars.forEach(b => b.isFocused = false);
                selectedBars = [];
                focusedBar = null;
                
                if (focusedStaticBall) focusedStaticBall.isFocused = false;
                focusedStaticBall = placeholder;
                placeholder.isFocused = true;
                dragMode = 'move';
                dragOffset.x = worldMouseX - placeholder.x;
                dragOffset.y = worldMouseY - placeholder.y;
                hitSomething = true;
                window.syncControls();
                break;
            }
        }
    }

    if (!hitSomething && !isOverUI && !isOverToggle && !isOverPalette && !isOverTiming) {
        // Clear all selections when clicking empty space (but not if Ctrl is held)
        if (!isCtrlDown) {
            bars.forEach(b => b.isFocused = false);
            selectedBars = [];
            if (focusedBar) focusedBar.isFocused = false;
            if (focusedStaticBall) focusedStaticBall.isFocused = false;
            focusedBar = null;
            focusedStaticBall = null;
            dragMode = null;
            if (window.syncControls) window.syncControls();
        }
    }

    // Sync UI Visibility
    if (window.syncControls) window.syncControls();
};

// Sync controls with selection
window.syncControls = function() {
    window.selectedBars = selectedBars;
    const count = selectedBars.length;
    const isMulti = count > 1;
    
    // 1. Panel chi tiết (Curvature, Note, Instrument...)
    const selectionPanel = document.getElementById('selection-controls');
    if (selectionPanel) {
        selectionPanel.style.display = (count > 0 || focusedBar) ? 'block' : 'none';
        
        // Cập nhật giá trị input dựa trên bar đầu tiên được chọn
        const primary = focusedBar || (count > 0 ? selectedBars[0] : null);
        if (primary && !isMulti) {
            const nInput = document.getElementById('bar-note');
            const sInput = document.getElementById('bar-shape');
            const iInput = document.getElementById('bar-instrument');
            const ctInput = document.getElementById('curvature-top');
            const cbInput = document.getElementById('curvature-bottom');
            const mhInput = document.getElementById('bar-max-hits');
            
            if (nInput) nInput.value = primary.note;
            if (sInput) {
                // Determine if this is a known preset based on its properties
                if (primary.shape === 'rect') {
                    if (Math.abs(primary.curvatureTop - 0.8) < 0.01 && primary.curvatureBottom === 0) {
                        sInput.value = 'wave_bridge';
                    } else if (Math.abs(primary.curvatureTop - (-0.1)) < 0.01 && primary.curvatureBottom === 0) {
                        sInput.value = 'bowl_slope';
                    } else {
                        sInput.value = 'rect';
                    }
                } else {
                    sInput.value = primary.shape;
                }
            }
            if (iInput) iInput.value = primary.instrument || 'sine';
            if (ctInput) ctInput.value = primary.curvatureTop;
            if (cbInput) cbInput.value = primary.curvatureBottom;
            if (mhInput) mhInput.value = primary.maxHits || 0;
            
            // Hiện các control bị ẩn khi multi-select
            const controlsToToggle = [
                nInput, iInput, ctInput, cbInput, mhInput, 
                document.getElementById('btn-copy-shape')
            ];
            controlsToToggle.forEach(el => {
                if (el) {
                    const parent = el.closest('.control');
                    if (parent) parent.style.display = 'block';
                }
            });
        }
        
        // Ẩn các control chi tiết nếu đang chọn nhiều (multi-select)
        if (isMulti) {
            const selectors = ['#bar-note', '#bar-instrument', '#curvature-top', '#curvature-bottom', '#bar-max-hits', '#btn-copy-shape'];
            selectors.forEach(sel => {
                const el = document.querySelector(sel);
                if (el) {
                    const parent = el.closest('.control');
                    if (parent) parent.style.display = 'none';
                }
            });
            // Ẩn luôn cái tip dashed
            const tip = document.querySelector('.control[style*="dashed"]');
            if (tip) tip.style.display = 'none';
        } else {
            const tip = document.querySelector('.control[style*="dashed"]');
            if (tip) tip.style.display = 'block';
        }
        
        // Điều khiển handles trong Wall.js
        bars.forEach(b => b.hideHandles = isMulti);
    }
    
    // 2. Slider Scale (Scale Selected Bars)
    const multiScalePanel = document.getElementById('multi-scale-control');
    const countDisplay = document.getElementById('selected-count');
    
    if (multiScalePanel) {
        // Luôn hiện theo yêu cầu để xử lý sau
        multiScalePanel.style.display = 'block';
        if (countDisplay) countDisplay.textContent = count;
        
        if (isMulti) {
            // Reset baseline khi tập hợp bars thay đổi
            if (!window.originalBarSizes) {
                const slider = document.getElementById('multi-scale-slider');
                if (slider) slider.value = 1.0;
                const scaleDisplay = document.getElementById('scale-value');
                if (scaleDisplay) scaleDisplay.textContent = '100%';
            }
        } else {
            window.originalBarSizes = null;
        }
    }
};

// Scale selected bars
window.scaleSelectedBars = function(scaleValue) {
    const scale = parseFloat(scaleValue);
    const scaleDisplay = document.getElementById('scale-value');
    if (scaleDisplay) {
        scaleDisplay.textContent = Math.round(scale * 100) + '%';
    }
    
    // Use window.selectedBars or local selectedBars (they should be same)
    const currentSelection = window.selectedBars || selectedBars;
    
    if (currentSelection.length === 0) {
        return;
    }
    
    // Store original sizes if not already stored for THIS selection
    if (!window.originalBarSizes) {
        window.originalBarSizes = currentSelection.map(bar => ({
            w: bar.w,
            h: bar.h
        }));
    }
    
    currentSelection.forEach((bar, index) => {
        const original = window.originalBarSizes[index];
        if (original) {
            // Use the built-in resize method that handles physics body recreation
            bar.resize(original.w * scale, original.h * scale);
        }
    });
};

window.doubleClicked = function() {
    const worldMouseX = (mouseX - width/2) / zoom + camX;
    const worldMouseY = (mouseY - height/2) / zoom + camY;

    for (let bar of bars) {
        if (bar.contains(worldMouseX, worldMouseY)) {
            bar.onHit();
            window.playNote(bar.body.position.y, bar.note, bar.instrument);
            break;
        }
    }
};

window.mouseWheel = function(event) {
    // Check if mouse is over any UI element that should handle its own scrolling
    const uiElements = ['ui', 'shape-palette', 'timing-ui', 'template-modal', 'export-modal', 'confirm-modal'];
    let isOverUI = false;
    
    // Check by target first
    for (const id of uiElements) {
        const el = document.getElementById(id);
        if (el && (el.contains(event.target) || event.target === el)) {
            // If it's a modal overlay, check if it's active
            if (el.classList.contains('modal-overlay')) {
                if (el.classList.contains('active')) {
                    isOverUI = true;
                    break;
                }
            } else if (!el.classList.contains('collapsed')) {
                isOverUI = true;
                break;
            }
        }
    }
    
    // Safety check with coordinates if target is ambiguous (e.g. canvas with high z-index)
    if (!isOverUI) {
        for (const id of uiElements) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('collapsed')) {
                // Modals are full screen overlays, so we check the .modal content inside them
                const targetEl = el.classList.contains('modal-overlay') ? el.querySelector('.modal') : el;
                if (!targetEl || (el.classList.contains('modal-overlay') && !el.classList.contains('active'))) continue;
                
                const rect = targetEl.getBoundingClientRect();
                if (mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom) {
                    isOverUI = true;
                    break;
                }
            }
        }
    }

    if (isOverUI) {
        return true; // Allow native scroll
    }

    // Zoom in/out based on wheel delta (support both .delta and .deltaY)
    const delta = event.deltaY || event.delta || 0;
    targetZoom -= delta * 0.001;
    targetZoom = constrain(targetZoom, 0.2, 3.0);
    return false; // Prevent page scroll/zoom for the game area
};

window.mouseReleased = function(event) {
    const worldMouseX = (mouseX - width/2) / zoom + camX;
    const worldMouseY = (mouseY - height/2) / zoom + camY;

    // Handle shape dropped from palette
    if (draggingFromPalette && paletteShapeData) {
        // Hide ghost
        const ghostDiv = document.getElementById('shape-ghost');
        if (ghostDiv) ghostDiv.classList.add('hidden');
        
        // Check if we are releasing over the UI panel
        const ui = document.getElementById('ui');
        const target = event ? event.target : null;
        const isOverUI = ui && target && ui.contains(target);
        const rect = ui ? ui.getBoundingClientRect() : null;
        const mouseIsOverUI = rect && mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom;

        if (!isOverUI && !mouseIsOverUI) {
            // Check if it's a static ball
            if (paletteShapeData.shape === 'static_ball') {
                // Create static ball placeholder (not a physics object yet)
                staticBallPlaceholders.push({
                    x: worldMouseX,
                    y: worldMouseY,
                    radius: 16,
                    isFocused: false
                });
            } else {
                // Create new bar at world position
                const newBar = new Wall(
                    world, 
                    Matter, 
                    worldMouseX, 
                    worldMouseY, 
                    paletteShapeData.w, 
                    paletteShapeData.h, 
                    0, 
                    defaultBarNote, 
                    paletteShapeData.shape, 
                    defaultBarInstrument
                );
                
                if (paletteShapeData.curvatureTop !== 0 || paletteShapeData.curvatureBottom !== 0) {
                    newBar.setCurvature(paletteShapeData.curvatureTop, paletteShapeData.curvatureBottom);
                }
                
                bars.push(newBar);
            }
            
            window.saveHistory(); // Save after dropping from palette
        }
        
        draggingFromPalette = false;
        paletteShapeData = null;
        shapeGhostCanvas = null;
        return;
    }

    for (let s of spawners) {
        if (s.dragging) {
            const moveDist = dist(worldMouseX, worldMouseY, spawnerPressPos.x, spawnerPressPos.y);
            if (moveDist < 5) {
                const spawnerIndex = spawners.indexOf(s);
                window.spawnBall(s.x, s.y, spawnerIndex);
            }
            s.dragging = false;
        }
    }
    
    // Handle readonly spawner click (spawn ball without dragging)
    if (dragMode === 'spawner-readonly') {
        const moveDist = dist(worldMouseX, worldMouseY, spawnerPressPos.x, spawnerPressPos.y);
        if (moveDist < 5) {
            // Find which spawner was clicked
            for (let i = 0; i < spawners.length; i++) {
                const s = spawners[i];
                const d = dist(worldMouseX, worldMouseY, s.x, s.y);
                if (d < s.r + 15) {
                    window.spawnBall(s.x, s.y, i);
                    break;
                }
            }
        }
        dragMode = null;
        return;
    }

    // Check if dropping into trash
    let stateChanged = (dragMode !== null);
    
    if (dragMode === 'move') {
        if (mouseX > width/2 - 60 && mouseX < width/2 + 60 && mouseY > height - 100) {
            if (focusedStaticBall) {
                // Check if it's a placeholder
                const placeholderIndex = staticBallPlaceholders.indexOf(focusedStaticBall);
                if (placeholderIndex !== -1) {
                    staticBallPlaceholders.splice(placeholderIndex, 1);
                } else {
                    // It's a real ball
                    focusedStaticBall.destroy();
                    balls = balls.filter(b => b !== focusedStaticBall);
                }
                focusedStaticBall = null;
            } else if (focusedBar) {
                focusedBar.destroy();
                bars = bars.filter(b => b !== focusedBar);
                focusedBar = null;
                window.syncControls();
            } else if (selectedBars.length > 0) {
                selectedBars.forEach(b => b.destroy());
                bars = bars.filter(b => !selectedBars.includes(b));
                selectedBars = [];
                focusedBar = null;
                window.syncControls();
            }
            stateChanged = true;
        }
    }
    
    if (stateChanged) {
        window.saveHistory();
    }
    
    dragMode = null;
    spawners.forEach(s => s.dragging = false);
};

window.mouseDragged = function() {
    const worldMouseX = (mouseX - width/2) / zoom + camX;
    const worldMouseY = (mouseY - height/2) / zoom + camY;

    // Ghost is handled by global mousemove listener
    if (draggingFromPalette) {
        return;
    }

    for (let s of spawners) {
        if (s.dragging) {
            s.x = worldMouseX;
            s.y = worldMouseY;
            return;
        }
    }

    if (!focusedBar && !focusedStaticBall) {
        // Pan camera if nothing selected
        let anySpawnerDragging = spawners.some(s => s.dragging);
        if (dragMode === null && !anySpawnerDragging) {
            if (isFollowingBall) {
                panWarningTimer = 180; // Show for 3 seconds
            }
            targetCamX -= (mouseX - pmouseX) / zoom;
            targetCamY -= (mouseY - pmouseY) / zoom;
        }
        return;
    }

    if (dragMode === 'move') {
        if (focusedStaticBall) {
            // Move static ball placeholder (just update x,y)
            focusedStaticBall.x = worldMouseX - dragOffset.x;
            focusedStaticBall.y = worldMouseY - dragOffset.y;
        } else if (focusedBar) {
            focusedBar.setPosition(worldMouseX - dragOffset.x, worldMouseY - dragOffset.y);
        }
    } else if (dragMode === 'rotate') {
        const angle = Math.atan2(worldMouseY - focusedBar.body.position.y, worldMouseX - focusedBar.body.position.x);
        focusedBar.setAngle(angle + PI/2); // Offset for the top handle
    } else if (dragMode === 'resizeWidth') {
        // Local X coordinate
        const dx = worldMouseX - focusedBar.body.position.x;
        const dy = worldMouseY - focusedBar.body.position.y;
        const cos = Math.cos(-focusedBar.body.angle);
        const sin = Math.sin(-focusedBar.body.angle);
        const lx = dx * cos - dy * sin;
        focusedBar.resize(lx * 2, focusedBar.h);
    } else if (dragMode === 'resizeHeight') {
        // Local Y coordinate
        const dx = worldMouseX - focusedBar.body.position.x;
        const dy = worldMouseY - focusedBar.body.position.y;
        const cos = Math.cos(-focusedBar.body.angle);
        const sin = Math.sin(-focusedBar.body.angle);
        const ly = dx * sin + dy * cos;
        focusedBar.resize(focusedBar.w, ly * 2);
    }
};

window.updateBarWidth = function(v) {
    const val = parseInt(v);
    defaultBarWidth = val;
    if (focusedBar) {
        focusedBar.resize(val, focusedBar.h);
    }
};

window.updateBarHeight = function(v) {
    const val = parseInt(v);
    if (focusedBar) {
        focusedBar.resize(focusedBar.w, val);
        window.saveHistory();
    }
};

window.updateBarAngle = function(v) {
    const val = parseFloat(v);
    if (focusedBar) {
        focusedBar.setAngle(val * PI / 180);
        window.saveHistory();
    }
};

window.updateBarCurvatureTop = function(v) {
    if (focusedBar) focusedBar.setCurvature(parseFloat(v), focusedBar.curvatureBottom);
};

window.updateBarCurvatureBottom = function(v) {
    if (focusedBar) focusedBar.setCurvature(focusedBar.curvatureTop, parseFloat(v));
};

window.updateBarShape = function(v) {
    const targets = selectedBars.length > 0 ? selectedBars : (focusedBar ? [focusedBar] : []);
    
    if (v === 'wave_bridge') {
        targets.forEach(bar => {
            bar.w = 157.27273265996178;
            bar.h = 10;
            bar.curvatureTop = 0.8;
            bar.curvatureBottom = 0;
            bar.setShape('rect');
        });
        window.syncControls();
        window.saveHistory();
        return;
    }
    if (v === 'bowl_slope') {
        targets.forEach(bar => {
            bar.w = 242;
            bar.h = 77;
            bar.curvatureTop = -0.1;
            bar.curvatureBottom = 0;
            bar.setShape('rect');
        });
        window.syncControls();
        window.saveHistory();
        return;
    }
    
    defaultBarShape = v;
    targets.forEach(bar => {
        // Reset curvature for standard shapes to ensure they are "clean"
        if (v === 'rect' || v === 'circle' || v === 'triangle' || v === 'seesaw') {
            bar.curvatureTop = 0;
            bar.curvatureBottom = 0;
        }
        bar.setShape(v);
    });
    
    window.syncControls(); // Update UI to reflect reset curvatures
    window.saveHistory();
};

window.deleteFocusedBar = function() {
    if (focusedBar) {
        focusedBar.destroy();
        bars = bars.filter(b => b !== focusedBar);
        focusedBar = null;
        window.syncControls();
    }
};

window.clearFocus = function() {
    if (focusedBar) {
        focusedBar.isFocused = false;
        focusedBar = null;
        window.syncControls();
    }
    if (focusedStaticBall) {
        focusedStaticBall.isFocused = false;
        focusedStaticBall = null;
    }
};

window.updateBarInstrument = function(v) {
    if (focusedBar) {
        focusedBar.instrument = v;
        window.saveHistory();
    }
};

window.updateBarMaxHits = function(v) {
    if (focusedBar) {
        focusedBar.maxHits = parseInt(v) || 0;
        window.saveHistory();
    }
};

window.updateAllBarsInstrument = function(v) {
    defaultBarInstrument = v;
    bars.forEach(b => b.instrument = v);
};

window.draw = function() {
    background(8, 8, 12);

    // Smooth Camera & Zoom Lerp
    zoom = lerp(zoom, targetZoom, 0.1);
    
    if (isFollowingBall && balls.length > 0) {
        // Follow the first ball
        const leadBall = balls[0];
        targetCamX = leadBall.body.position.x;
        targetCamY = leadBall.body.position.y;
    }
    
    camX = lerp(camX, targetCamX, 0.1);
    camY = lerp(camY, targetCamY, 0.1);

    push();
    // Center of screen
    translate(width/2, height/2);
    scale(zoom);
    translate(-camX, -camY);
    
    // Viewport Culling logic
    const margin = 600 / zoom; // Margin for "early loading" of shapes
    const viewW = width / zoom;
    const viewH = height / zoom;
    const vMinX = camX - viewW/2 - margin;
    const vMaxX = camX + viewW/2 + margin;
    const vMinY = camY - viewH/2 - margin;
    const vMaxY = camY + viewH/2 + margin;

    // Performance hint: reduce effects when zoomed out far
    const lodQuality = zoom < 0.4 ? 'low' : (zoom < 0.8 ? 'medium' : 'high');
    window.lodQuality = lodQuality; // Pass to other components
    
    // Draw Animated Grid (Extended for large world) - Optimized to only draw visible lines
    stroke(255, 255, 255, 12);
    strokeWeight(1 / zoom);
    
    // Draw only visible grid lines
    const startX = Math.floor(vMinX / 100) * 100;
    const endX = Math.ceil(vMaxX / 100) * 100;
    const startY = Math.floor(vMinY / 100) * 100;
    const endY = Math.ceil(vMaxY / 100) * 100;
    
    for (let x = startX; x <= endX; x += 100) line(x, vMinY, x, vMaxY);
    for (let y = startY; y <= endY; y += 100) line(vMinX, y, vMaxX, y);

    // Alignment Guide (Vertical Dashed Line)
    if (dragMode && (focusedBar || focusedStaticBall)) {
        const targetX = focusedStaticBall ? focusedStaticBall.x : focusedBar.body.position.x;
        
        // Define "balanced" as being horizontal (angle near zero)
        const isBalanced = focusedBar && Math.abs(focusedBar.body.angle % PI) < 0.01;
        const guideColor = isBalanced ? '#4ade80' : '#00f2fe';
        const guideAlpha = isBalanced ? 180 : 80;
        
        drawingContext.save();
        drawingContext.setLineDash([15, 10]);
        stroke(isBalanced ? color(74, 222, 128, guideAlpha) : color(0, 242, 254, guideAlpha));
        strokeWeight(1.5 / zoom);
        
        // Add a subtle glow
        drawingContext.shadowBlur = 15 / zoom;
        drawingContext.shadowColor = guideColor;
        
        line(targetX, vMinY, targetX, vMaxY);
        drawingContext.restore();
    }

    // Physics Update - Use deltaTime to be frame-rate independent
    // and prevent over-taxing the CPU on high-refresh monitors
    const physicsDelta = Math.min(deltaTime, 32); // Cap at ~30fps equivalent to prevent jumping
    Engine.update(engine, physicsDelta);

    // Keyboard Movement for Selected Bars
    if (document.activeElement.tagName !== 'INPUT' && (selectedBars.length > 0 || focusedStaticBall)) {
        let dx = 0;
        let dy = 0;
        const moveSpeed = keyIsDown(SHIFT) ? 5 : 1;
        
        if (keyIsDown(LEFT_ARROW)) dx -= moveSpeed;
        if (keyIsDown(RIGHT_ARROW)) dx += moveSpeed;
        if (keyIsDown(UP_ARROW)) dy -= moveSpeed;
        if (keyIsDown(DOWN_ARROW)) dy += moveSpeed;
        
        if (dx !== 0 || dy !== 0) {
            selectedBars.forEach(bar => {
                const pos = bar.body.position;
                bar.setPosition(pos.x + dx, pos.y + dy);
            });
            if (focusedStaticBall) {
                focusedStaticBall.x += dx;
                focusedStaticBall.y += dy;
            }
        }
    }

    // Particles Bloom - Capped for performance
    if (particles.length > 100) particles.splice(0, particles.length - 100);
    
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        // Viewport check for particles
        if (p.x > vMinX && p.x < vMaxX && p.y > vMinY && p.y < vMaxY) {
            p.draw(window);
        } else {
            p.updateOnly();
        }
        if (p.alpha <= 0) particles.splice(i, 1);
    }

    // Draw all Spawners
    spawners.forEach((s, index) => {
        // Viewport check
        if (s.x < vMinX - 100 || s.x > vMaxX + 100 || s.y < vMinY - 100 || s.y > vMaxY + 100) {
            return;
        }

        const activeCount = balls.filter(b => b.spawnerIndex === index && !b.wasStatic).length;
        const isMaxed = activeCount >= 3;
        
        push();
        translate(s.x, s.y);
        
        if (!isMaxed && lodQuality !== 'low') {
            drawingContext.shadowBlur = (30 / zoom) * (lodQuality === 'medium' ? 0.5 : 1.0);
            drawingContext.shadowColor = '#00f2fe';
            stroke(0, 242, 254, 100);
            fill(0, 242, 254);
        } else {
            drawingContext.shadowBlur = 0;
            stroke(100, 100, 100, 100);
            fill(80);
        }
        
        noFill();
        strokeWeight(2 / zoom);
        push();
        rotate(frameCount * (isMaxed ? 0.01 : 0.04));
        for(let i=0; i<4; i++) {
            rotate(PI/2);
            arc(0, 0, s.r * 3.5, s.r * 3.5, 0, PI/4);
        }
        pop();
        
        noStroke();
        if (!isMaxed) {
            fill(0, 242, 254);
            const pulse = 1 + sin(frameCount * 0.1 * (index + 1)) * 0.1;
            circle(0, 0, s.r * 1.8 * pulse);
            fill(255, 200);
        } else {
            fill(60);
            circle(0, 0, s.r * 1.8);
            fill(120, 200);
        }
        circle(0, 0, s.r);
        pop();
    });

    bars.forEach((bar, index) => {
        bar.index = index; // Set index for display
        
        // Viewport check
        const pos = bar.body.position;
        const halfSize = Math.max(bar.w, bar.h);
        if (pos.x > vMinX - halfSize && pos.x < vMaxX + halfSize &&
            pos.y > vMinY - halfSize && pos.y < vMaxY + halfSize) {
            bar.draw(window);
        }
    });
    
    // Draw static ball placeholders
    staticBallPlaceholders.forEach(placeholder => {
        // Viewport check
        if (placeholder.x > vMinX - 50 && placeholder.x < vMaxX + 50 &&
            placeholder.y > vMinY - 50 && placeholder.y < vMaxY + 50) {
        push();
        translate(placeholder.x, placeholder.y);
        
        // Draw placeholder as dashed circle
        drawingContext.setLineDash([5, 5]);
        stroke(placeholder.isFocused ? '#00f2fe' : 100);
        strokeWeight((placeholder.isFocused ? 3 : 2) / zoom);
        fill(placeholder.isFocused ? 80 : 60);
        circle(0, 0, placeholder.radius * 2);
        drawingContext.setLineDash([]);
        
        // Draw selection indicator
        if (placeholder.isFocused) {
            noFill();
            stroke(0, 242, 254);
            strokeWeight(2 / zoom);
            drawingContext.setLineDash([8, 4]);
            circle(0, 0, placeholder.radius * 2.5);
            drawingContext.setLineDash([]);
        }
        
        pop();
        }
    });
    
    for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i];
        const pos = ball.body.position;
        
        // Viewport check for balls
        if (pos.x > vMinX - 100 && pos.x < vMaxX + 100 &&
            pos.y > vMinY - 100 && pos.y < vMaxY + 100) {
            ball.draw(window);
        }
        
        if (ball.isOffScreen(camY + (height/2)/zoom + 400)) { // Off screen relative to camera
            balls[i].destroy();
            balls.splice(i, 1);
        }
    }
    pop();

    // Trash Zone at the bottom center (Fixed on screen)
    if (dragMode === 'move') {
        const isOverTrash = (mouseX > width/2 - 60 && mouseX < width/2 + 100 && mouseY > height - 100);
        
        push();
        translate(width/2, height - (isOverTrash ? 60 : 50));
        drawingContext.shadowBlur = isOverTrash ? 60 : 10;
        drawingContext.shadowColor = '#ef4444';
        
        // Animated Trash Can Icon
        push();
        translate(0, -5);
        const lidColor = isOverTrash ? '#ef4444' : '#ffffff';
        const bodyColor = isOverTrash ? '#ef4444' : 'rgba(255,255,255,0.8)';
        
        // Body of the trash can
        stroke(bodyColor);
        strokeWeight(2);
        noFill();
        // A slightly tapered bucket
        beginShape();
        vertex(-10, -5);
        vertex(-8, 15);
        vertex(8, 15);
        vertex(10, -5);
        endShape(CLOSE);
        
        // Vertical ribs on the bucket
        line(-4, -2, -3, 12);
        line(0, -2, 0, 12);
        line(4, -2, 3, 12);
        
        // Animated Lid
        push();
        if (isOverTrash) {
            // Lid Closed - Snap down to the rim
            translate(0, -6);
            stroke('#ef4444');
        } else {
            // Lid Open - Lifted high and floating slightly
            const floatY = -22 + Math.sin(frameCount * 0.1) * 3;
            translate(0, floatY);
            stroke('#ffffff');
        }
        
        // The lid shape (sits at top of its coordinate system)
        line(-12, 0, 12, 0); // Main lid line
        rectMode(CENTER);
        fill(0, 0); // Transparent fill
        rect(0, -3, 6, 4, 1); // Lid handle
        pop();
        pop();
        
        fill(255);
        noStroke();
        textSize(10);
        textAlign(CENTER);
        pop();
    }

    // UI Overlay (Fixed on screen)
    // Following Ball text removed as per user request (moved to button state)
    if (panWarningTimer > 0) {
        panWarningTimer--;
        const alpha = panWarningTimer > 30 ? 255 : map(panWarningTimer, 0, 30, 0, 255);
        fill(255, 204, 0, alpha);
        noStroke();
        textSize(13);
        textStyle(BOLD);
        textAlign(LEFT);
        text("CAMERA FOLLOW ACTIVE", 30, height - 30);
        textStyle(NORMAL);
    }
};

window.toggleFollow = function() {
    isFollowingBall = !isFollowingBall;
    const btn = document.getElementById('toggle-follow-btn');
    
    if (isFollowingBall) {
        if (btn) {
            btn.innerText = "BACK TO START";
            btn.classList.add('btn-active');
        }
    } else {
        if (btn) {
            btn.innerText = "TOGGLE CAMERA FOLLOW";
            btn.classList.remove('btn-active');
        }
        if (spawners.length > 0) {
            // Reset to first spawner
            targetCamX = spawners[0].x;
            targetCamY = height / 4;
        }
    }
};

window.spawnBall = function(x, y, spawnerIndex = null) {
    // Check if spawner already has 3 active balls
    if (spawnerIndex !== null) {
        const activeBallsFromSpawner = balls.filter(b => 
            b.spawnerIndex === spawnerIndex && !b.wasStatic
        ).length;
        
        if (activeBallsFromSpawner >= 3) {
            return; // Don't spawn more than 3 balls per spawner
        }
    }
    
    const res = parseFloat(document.getElementById('bounce-slider').value);
    
    // Deselect any focused bar when spawning
    window.clearFocus();
    
    let spawnX = x !== undefined ? x : (spawners.length > 0 ? spawners[0].x : width/2);
    let spawnY = y !== undefined ? y : (spawners.length > 0 ? spawners[0].y : height/2);
    
    // Standard starting color (white)
    const ball = new Ball(world, Matter, spawnX, spawnY, 14, res, '#ffffff', false, spawnerIndex);
    balls.push(ball);
    
    for (let i = 0; i < 8; i++) {
        particles.push(new Particle(spawnX, spawnY, '#ffffff'));
    }
};

window.addBar = function() {
    let spawnX = width / 2;
    let spawnY = height / 2;

    if (focusedBar) {
        // Use focused bar as reference
        spawnX = focusedBar.body.position.x + 200;
        spawnY = focusedBar.body.position.y;
    } else if (bars.length > 0) {
        // Find rightmost bar
        let rightmost = bars[0];
        for (let b of bars) {
            if (b.body.position.x > rightmost.body.position.x) {
                rightmost = b;
            }
        }
        spawnX = rightmost.body.position.x + 200;
        spawnY = rightmost.body.position.y;
    } else {
        // If no bars, start near first spawner
        if (spawners.length > 0) {
            spawnX = spawners[0].x + 200;
            spawnY = spawners[0].y + 200;
        }
    }

    const bar = new Wall(world, Matter, spawnX, spawnY, defaultBarWidth, 22, random(-0.2, 0.2), defaultBarNote, defaultBarShape, defaultBarInstrument);
    bars.push(bar);
    window.saveHistory();
    
    // Smoothly pan camera to the new bar
    targetCamX = spawnX;
    targetCamY = spawnY;
};

window.updateGravity = function(v) {
    if (engine) engine.gravity.y = parseFloat(v);
};

window.updateBounce = function(v) {
    const val = parseFloat(v);
    if (world) world.restitution = val;
    balls.forEach(b => b.body.restitution = val);
};

// Auto-balance: when one slider reaches max, set the other to mid (0.5)
window.autoBalance = function(slider, value) {
    const numValue = parseFloat(value);
    
    if (slider === 'gravity' && numValue >= 2) {
        // Gravity at max → set bounce to 0.5
        const bounceSlider = document.getElementById('bounce-slider');
        if (bounceSlider) {
            bounceSlider.value = 0.5;
            window.updateBounce(0.5);
        }
    } else if (slider === 'bounce' && numValue >= 1.2) {
        // Bounce at max → set gravity to 0.5
        const gravitySlider = document.getElementById('gravity-slider');
        if (gravitySlider) {
            gravitySlider.value = 0.5;
            window.updateGravity(0.5);
        }
    }
};

window.clearBalls = function() {
    balls.forEach(b => b.destroy());
    balls = [];
    particles = [];
    bars.forEach(bar => bar.reset());
    // Note: Spawners are NOT reset anymore to preserve user arrangements
    window.syncTimingUI();
};

window.updateSpawnerDelay = function(index, value) {
    if (spawners[index]) spawners[index].delay = parseFloat(value) || 0;
};

window.playNote = function(y, specificNote, instrument = 'sine') {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    let freq;
    if (specificNote && noteFrequencies[specificNote]) {
        freq = noteFrequencies[specificNote];
    } else {
        freq = map(y, height, 0, 180, 900);
    }
    
    if (!isFinite(freq)) freq = 440;
    
    // Orchestral Drum Logic
    if (instrument === 'drum') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq / 2, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.15);
        
        // Impact "Punch"
        const noise = audioCtx.createOscillator();
        const noiseGain = audioCtx.createGain();
        noise.type = 'square';
        noise.frequency.setValueAtTime(80, audioCtx.currentTime);
        noiseGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        noise.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);
        noise.start();
        noise.stop(audioCtx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
        osc.connect(gain);
    } else if (instrument === 'bell') {
        // Wind Chimes / Bell sound - metallic and bright
        // Main fundamental with FM synthesis for metallic character
        const modulator = audioCtx.createOscillator();
        const modGain = audioCtx.createGain();
        modulator.frequency.setValueAtTime(freq * 3.5, audioCtx.currentTime);
        modGain.gain.setValueAtTime(freq * 2, audioCtx.currentTime); // Modulation depth
        modGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        modulator.connect(modGain);
        modGain.connect(osc.frequency);
        modulator.start();
        modulator.stop(audioCtx.currentTime + 0.3);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        // Strong harmonics for bell timbre
        const harmonics = [
            { ratio: 2.4, gain: 0.25, decay: 1.0 },
            { ratio: 3.8, gain: 0.18, decay: 0.8 },
            { ratio: 5.2, gain: 0.15, decay: 0.6 },
            { ratio: 6.8, gain: 0.1, decay: 0.5 }
        ];
        
        harmonics.forEach(h => {
            const harmOsc = audioCtx.createOscillator();
            const harmGain = audioCtx.createGain();
            harmOsc.type = 'sine';
            harmOsc.frequency.setValueAtTime(freq * h.ratio, audioCtx.currentTime);
            harmGain.gain.setValueAtTime(h.gain, audioCtx.currentTime);
            harmGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + h.decay);
            harmOsc.connect(harmGain);
            harmGain.connect(audioCtx.destination);
            harmOsc.start();
            harmOsc.stop(audioCtx.currentTime + h.decay);
        });
        
        // Bright metallic filter
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(freq * 4, audioCtx.currentTime);
        filter.Q.value = 3;
        osc.connect(filter);
        filter.connect(gain);
        
        // Sharp attack, long shimmer decay
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.28, audioCtx.currentTime + 0.01); // Quick drop
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.8);
    } else if (instrument === 'glass') {
        // Crystal Glass - pure, gentle, clear resonance
        osc.type = 'sine'; // Pure sine for crystal clarity
        osc.frequency.setValueAtTime(freq * 2.5, audioCtx.currentTime); // Higher for purity
        
        // Gentle, clear harmonics
        const glassHarmonics = [
            { ratio: 2.2, gain: 0.28, decay: 1.4 },
            { ratio: 3.4, gain: 0.22, decay: 1.3 },
            { ratio: 5.1, gain: 0.18, decay: 1.2 },
            { ratio: 6.8, gain: 0.14, decay: 1.1 },
            { ratio: 8.9, gain: 0.10, decay: 1.0 },
            { ratio: 11.2, gain: 0.06, decay: 0.9 }
        ];
        
        glassHarmonics.forEach(h => {
            const gOsc = audioCtx.createOscillator();
            const gGain = audioCtx.createGain();
            gOsc.type = 'sine';
            gOsc.frequency.setValueAtTime(freq * h.ratio * 2.5, audioCtx.currentTime);
            gGain.gain.setValueAtTime(h.gain, audioCtx.currentTime);
            gGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + h.decay);
            gOsc.connect(gGain);
            gGain.connect(audioCtx.destination);
            gOsc.start();
            gOsc.stop(audioCtx.currentTime + h.decay);
        });
        
        // Gentle reverb for spacious clarity
        const delay1 = audioCtx.createDelay();
        const delay2 = audioCtx.createDelay();
        const delay3 = audioCtx.createDelay();
        const delayGain1 = audioCtx.createGain();
        const delayGain2 = audioCtx.createGain();
        const delayGain3 = audioCtx.createGain();
        
        // Lowpass filters for each echo to remove noise/harshness
        const echoFilter1 = audioCtx.createBiquadFilter();
        const echoFilter2 = audioCtx.createBiquadFilter();
        const echoFilter3 = audioCtx.createBiquadFilter();
        echoFilter1.type = 'lowpass';
        echoFilter2.type = 'lowpass';
        echoFilter3.type = 'lowpass';
        echoFilter1.frequency.value = freq * 4; // Keep only pure tones
        echoFilter2.frequency.value = freq * 3.5;
        echoFilter3.frequency.value = freq * 3;
        
        delay1.delayTime.value = 0.1;
        delay2.delayTime.value = 0.2;
        delay3.delayTime.value = 0.3;
        delayGain1.gain.value = 0.18;
        delayGain2.gain.value = 0.1;
        delayGain3.gain.value = 0.05;
        
        // Highpass for pure clarity without harshness
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(freq * 1.5, audioCtx.currentTime);
        filter.Q.value = 0.7; // Gentle slope
        
        osc.connect(filter);
        filter.connect(gain);
        
        // Echo chains with filters to remove noise
        filter.connect(delay1);
        delay1.connect(echoFilter1);
        echoFilter1.connect(delayGain1);
        delayGain1.connect(audioCtx.destination);
        
        filter.connect(delay2);
        delay2.connect(echoFilter2);
        echoFilter2.connect(delayGain2);
        delayGain2.connect(audioCtx.destination);
        
        filter.connect(delay3);
        delay3.connect(echoFilter3);
        echoFilter3.connect(delayGain3);
        delayGain3.connect(audioCtx.destination);
        
        // Gentle attack, smooth long decay
        gain.gain.setValueAtTime(0.32, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.8);
    } else if (instrument === 'sawtooth') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 3, audioCtx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(freq * 1.5, audioCtx.currentTime + 0.5);
        filter.Q.value = 5;
        osc.connect(filter);
        filter.connect(gain);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    } else if (instrument === 'square') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        filter.type = 'lowpass';
        filter.frequency.value = 2000;
        osc.connect(filter);
        filter.connect(gain);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    } else {
        osc.type = instrument === 'triangle' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
        osc.connect(gain);
    }
    
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
};

window.updateInstrument = function(v) {
    defaultBarInstrument = v;
};

window.windowResized = function() {
    resizeCanvas(windowWidth, windowHeight);
};

window.addSpawner = function() {
    if (spawners.length >= 5) return;
    let spawnX = width / 2;
    let spawnY = height / 2;
    
    if (spawners.length > 0) {
        let last = spawners[spawners.length - 1];
        spawnX = last.x + 100;
        spawnY = last.y;
    }
    
    spawners.push({ x: spawnX, y: spawnY, r: 18, dragging: false, delay: 0 });
    targetCamX = spawnX;
    targetCamY = spawnY;
    window.syncTimingUI();
};







window.syncTimingUI = function() {
    const list = document.getElementById('spawner-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    // Disable Add button if at limit
    const addBtn = document.getElementById('add-spawner-btn');
    if (addBtn) {
        if (spawners.length >= 5) {
            addBtn.disabled = true;
            addBtn.style.opacity = '0.3';
            addBtn.style.cursor = 'not-allowed';
            addBtn.title = "MAXIMUM 5 SPAWNERS REACHED";
        } else {
            addBtn.disabled = false;
            addBtn.style.opacity = '1';
            addBtn.style.cursor = 'pointer';
            addBtn.title = "Add Spawner";
        }
    }
    
    const spawnerHeader = document.createElement('div');
    spawnerHeader.style = "margin-bottom: 15px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.1)";
    spawnerHeader.innerHTML = `<label style="font-size: 10px; opacity: 0.6;">SPAWN QUEUE</label>`;
    list.appendChild(spawnerHeader);

    spawners.forEach((s, index) => {
        const item = document.createElement('div');
        item.className = 'timing-item';
        item.style.flexDirection = "column";
        item.style.alignItems = "stretch";
        item.style.gap = "8px";
        
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: bold; font-size: 12px;">BALL ${index + 1}</span>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span style="font-size: 10px; opacity: 0.5;">DELAY (s):</span>
                    <input type="number" step="0.1" min="0" value="${s.delay}" onchange="window.updateSpawnerDelay(${index}, this.value)" style="width: 60px; background: rgba(0,0,0,0.3); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px; font-size: 11px;">
                </div>
            </div>
        `;
        list.appendChild(item);
    });
};

window.runSequence = function() {
    window.clearFocus();
    
    spawners.forEach((s, index) => {
        const totalDelayMs = (s.delay || 0) * 1000;
        
        setTimeout(() => {
            window.spawnBall(s.x, s.y, index);
        }, totalDelayMs);
    });
};

window.keyPressed = function() {
    // Undo (Ctrl + Z)
    if (keyIsDown(CONTROL) && (key === 'z' || key === 'Z')) {
        if (keyIsDown(SHIFT)) {
            window.redo();
        } else {
            window.undo();
        }
        return false;
    }

    // Redo (Ctrl + Y)
    if (keyIsDown(CONTROL) && (key === 'y' || key === 'Y')) {
        window.redo();
        return false;
    }

    // Select All (Ctrl + A)
    if (keyIsDown(CONTROL) && (key === 'a' || key === 'A')) {
        selectedBars = [...bars];
        selectedBars.forEach(b => b.isFocused = true);
        focusedBar = selectedBars.length > 0 ? selectedBars[0] : null;
        if (focusedStaticBall) focusedStaticBall.isFocused = false;
        focusedStaticBall = null;
        window.syncControls();
        return false; // Prevent default browser select all
    }

    // Copy (Ctrl + C)
    if (keyIsDown(CONTROL) && (key === 'c' || key === 'C')) {
        const targets = selectedBars.length > 0 ? selectedBars : (focusedBar ? [focusedBar] : []);
        if (targets.length > 0) {
            // Find group center
            let avgX = 0, avgY = 0;
            targets.forEach(b => {
                avgX += b.body.position.x;
                avgY += b.body.position.y;
            });
            avgX /= targets.length;
            avgY /= targets.length;

            copiedBars = targets.map(b => ({
                w: b.w,
                h: b.h,
                angle: b.body.angle,
                note: b.note,
                shape: b.shape,
                instrument: b.instrument,
                curvatureTop: b.curvatureTop,
                curvatureBottom: b.curvatureBottom,
                maxHits: b.maxHits || 0,
                relX: b.body.position.x - avgX,
                relY: b.body.position.y - avgY
            }));
        }
        return false;
    }

    // Paste (Ctrl + V)
    if (keyIsDown(CONTROL) && (key === 'v' || key === 'V')) {
        if (copiedBars.length > 0) {
            const worldMouseX = (mouseX - width/2) / zoom + camX;
            const worldMouseY = (mouseY - height/2) / zoom + camY;
            
            // Clear current selection
            bars.forEach(b => b.isFocused = false);
            selectedBars = [];

            copiedBars.forEach(cb => {
                const bar = new Wall(world, Matter, worldMouseX + cb.relX, worldMouseY + cb.relY, cb.w, cb.h, cb.angle, cb.note, cb.shape, cb.instrument, cb.curvatureTop, cb.curvatureBottom);
                bar.maxHits = cb.maxHits || 0;
                bars.push(bar);
                bar.isFocused = true;
                selectedBars.push(bar);
            });
            
            focusedBar = selectedBars.length === 1 ? selectedBars[0] : null;
            window.syncControls();
            window.saveHistory();
        }
        return false;
    }

    // Space bar keycode is 32 or ' '
    if (key === ' ' || keyCode === 32) {
        // Run the timed sequence instead of spawning all at once
        window.runSequence();
        return false; // Prevent default scrolling
    }
};

window.exportToJSON = function() {
    const modal = document.getElementById('export-modal');
    if (modal) modal.classList.add('active');
};

window.closeExportModal = function() {
    const modal = document.getElementById('export-modal');
    if (modal) modal.classList.remove('active');
};

window.confirmExport = function() {
    const nameInput = document.getElementById('export-name');
    let rawName = nameInput ? nameInput.value : "my-composition";
    
    // Get readonly mode from checkbox
    const readonlyCheckbox = document.getElementById('readonly-checkbox');
    const isReadOnly = readonlyCheckbox ? readonlyCheckbox.checked : false;
    
    // Slugify: remove accents, lowercase, replace non-alphanumeric with hyphens
    const compName = rawName
        .normalize("NFD")                     // Split accents from characters
        .replace(/[\u0300-\u036f]/g, "")      // Remove accents
        .toLowerCase()                        // To lowercase
        .replace(/[^a-z0-9]+/g, "-")          // Replace invalid chars with -
        .replace(/^-+|-+$/g, "");             // Trim hyphens from ends

    if (!compName) {
        alert("Please enter a valid name (a-z, 0-9, -)");
        return;
    }
    
    const data = {
        name: compName,
        readonly: isReadOnly,
        gravity: engine.gravity.y,
        bounce: parseFloat(document.getElementById('bounce-slider').value),
        instrument: defaultBarInstrument,
        spawners: spawners.map(s => ({ x: s.x, y: s.y, r: s.r, delay: s.delay })),
        bars: bars.map(b => ({
            x: b.body.position.x,
            y: b.body.position.y,
            w: b.w,
            h: b.h,
            angle: b.body.angle,
            note: b.note,
            shape: b.shape,
            instrument: b.instrument,
            curvatureTop: b.curvatureTop || 0,
            curvatureBottom: b.curvatureBottom || 0,
            maxHits: b.maxHits || 0
        }))
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${compName}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    window.closeExportModal();
};

window.copyToClipboard = function() {
    const data = {
        name: "copied-composition",
        readonly: false, // Copied compositions are always editable
        gravity: engine.gravity.y,
        bounce: parseFloat(document.getElementById('bounce-slider').value),
        instrument: defaultBarInstrument,
        spawners: spawners.map(s => ({ x: s.x, y: s.y, r: s.r, delay: s.delay })),
        bars: bars.map(b => ({
            x: b.body.position.x,
            y: b.body.position.y,
            w: b.w,
            h: b.h,
            angle: b.body.angle,
            note: b.note,
            shape: b.shape,
            instrument: b.instrument,
            curvatureTop: b.curvatureTop || 0,
            curvatureBottom: b.curvatureBottom || 0,
            maxHits: b.maxHits || 0
        }))
    };
    
    const json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        // Simple visual feedback
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = "COPIED!";
        btn.style.color = "#4ade80";
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.color = "";
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
};

window.copyShape = function() {
    if (!focusedBar) return;
    const shapeData = {
        w: focusedBar.w,
        h: focusedBar.h,
        shape: focusedBar.shape,
        curvatureTop: focusedBar.curvatureTop,
        curvatureBottom: focusedBar.curvatureBottom
    };
    const json = JSON.stringify(shapeData);
    navigator.clipboard.writeText(json).then(() => {
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = "SHAPE COPIED!";
        setTimeout(() => { btn.innerText = originalText; }, 1500);
    });
};

window.loadProjectData = function(data) {
    if (!data) return;
    
    // VALIDATION: Basic check for expected structure
    if (!data.bars || !Array.isArray(data.bars)) {
        throw new Error("Invalid format: 'bars' array missing.");
    }

    try {
        // Clear existing
        bars.forEach(b => b.destroy());
        bars = [];
        balls.forEach(b => b.destroy());
        balls = [];
        
        // Load spawners
        if (data.spawners && Array.isArray(data.spawners)) {
            spawners = data.spawners.map(s => ({ 
                x: Number(s.x), 
                y: Number(s.y), 
                r: Number(s.r || 18), 
                delay: Number(s.delay || 0), 
                dragging: false 
            }));
        } else if (data.spawner) {
            spawners = [{ ...data.spawner, r: 18, dragging: false, delay: 0 }];
        }
        window.syncTimingUI();
        
        // Load bars
        if (data.bars) {
            data.bars.forEach(b => {
                const bar = new Wall(
                    world, Matter, 
                    Number(b.x), Number(b.y), 
                    Number(b.w), Number(b.h), 
                    Number(b.angle || 0), 
                    b.note || 'Auto', 
                    b.shape || 'rect', 
                    b.instrument || 'sine', 
                    Number(b.curvatureTop || 0), 
                    Number(b.curvatureBottom || 0)
                );
                bar.maxHits = b.maxHits || 0;
                bars.push(bar);
            });
        }
        
        // Center camera on first spawner
        if (spawners.length > 0) {
            targetCamX = spawners[0].x + 400;
            targetCamY = spawners[0].y + 300;
        }
        
        // Load gravity and bounce
        if (data.gravity !== undefined) {
            window.updateGravity(Number(data.gravity));
            const gravInput = document.getElementById('gravity-slider');
            if (gravInput) gravInput.value = data.gravity;
        }
        if (data.bounce !== undefined) {
            window.updateBounce(Number(data.bounce));
            const bounceInput = document.getElementById('bounce-slider');
            if (bounceInput) bounceInput.value = data.bounce;
        }
        if (data.instrument) {
            window.updateInstrument(data.instrument);
            const instSelect = document.getElementById('instrument-select');
            if (instSelect) instSelect.value = data.instrument;
            const bulkSelect = document.getElementById('bulk-instrument-select');
            if (bulkSelect) bulkSelect.value = data.instrument;
        }

        window.saveHistory(); 
        window.clearFocus();
        window.syncControls();
        
        // Handle readonly mode
        isTemplateReadOnly = data.readonly === true;
        window.applyReadOnlyMode();
    } catch (err) {
        throw new Error("Failed to parse project content: " + err.message);
    }
};

window.loadTemplate = async function(url) {
    if (!url) return;
    try {
        const response = await fetch(url);
        const data = await response.json();
        window.loadProjectData(data);
    } catch (e) {
        console.error("Failed to load template:", e);
        alert("Error loading template: " + e.message);
    }
};

window.applyReadOnlyMode = function() {
    const readOnlyBanner = document.getElementById('readonly-banner');
    const uiPanel = document.getElementById('ui');
    const toggleBtn = document.querySelector('.toggle-btn');
    const timingUI = document.getElementById('timing-ui');
    const timingToggleBtn = document.getElementById('timing-toggle-btn');
    
    if (isTemplateReadOnly) {
        // Show banner if it doesn't exist
        if (!readOnlyBanner) {
            const banner = document.createElement('div');
            banner.id = 'readonly-banner';
            banner.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: rgba(20, 20, 20, 0.95);
                backdrop-filter: blur(10px);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.7);
                padding: 6px 20px;
                text-align: center;
                font-size: 11px;
                font-weight: 500;
                z-index: 10000;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                letter-spacing: 0.5px;
            `;
            banner.innerHTML = 'READ-ONLY MODE - This template cannot be modified.';
            document.body.prepend(banner);
        }
        
        // Hide UI panel and toggle button
        if (uiPanel) {
            uiPanel.classList.add('collapsed');
        }
        if (toggleBtn) {
            toggleBtn.style.display = 'none';
        }
        
        // Hide timing UI panel and toggle button
        if (timingUI) {
            timingUI.classList.add('collapsed');
        }
        if (timingToggleBtn) {
            timingToggleBtn.style.display = 'none';
        }
        
        // Disable editing controls (but keep them for when UI is shown)
        const disableIds = [
            'curvature-top', 'curvature-bottom', 'bar-shape', 'bar-note', 
            'bar-instrument', 'bar-max-hits', 'gravity-slider', 'bounce-slider',
            'instrument-select', 'bulk-instrument-select', 'add-spawner-btn'
        ];
        
        disableIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = true;
        });
        
        // Disable shape palette dragging
        draggingFromPalette = false;
    } else {
        // Remove banner if exists
        if (readOnlyBanner) {
            readOnlyBanner.remove();
        }
        
        // Show UI panel and toggle button
        if (toggleBtn) {
            toggleBtn.style.display = 'flex';
        }
        
        // Show timing toggle button
        if (timingToggleBtn) {
            timingToggleBtn.style.display = 'flex';
        }
        
        // Enable all controls
        const enableIds = [
            'curvature-top', 'curvature-bottom', 'bar-shape', 'bar-note', 
            'bar-instrument', 'bar-max-hits', 'gravity-slider', 'bounce-slider',
            'instrument-select', 'bulk-instrument-select', 'add-spawner-btn'
        ];
        
        enableIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = false;
        });
    }
};

window.importFromFile = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;

        // Check file extension/type just to be safe
        if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
            alert("Please select a valid .json file");
            return;
        }

        const reader = new FileReader();
        reader.onload = event => {
            try {
                const data = JSON.parse(event.target.result);
                window.loadProjectData(data);
            } catch (err) {
                console.error("Import error:", err);
                alert("Import failed: " + err.message);
            }
        };
        reader.onerror = () => alert("Error reading file");
        reader.readAsText(file);
    };
    
    input.click();
};

window.closeTemplateModal = function(templatePath) {
    const modal = document.getElementById('template-modal');
    if (modal) modal.classList.remove('active');
    
    if (templatePath && templatePath !== 'blank') {
        window.loadTemplate(templatePath);
    }
};

window.openTemplateModal = function() {
    const modal = document.getElementById('template-modal');
    if (modal) {
        modal.classList.add('active');
        // Reload template metadata to update badges
        window.loadTemplateMetadata();
    }
};

window.pendingTemplateUrl = null;

window.askLoadTemplate = function(url) {
    if (!url) return;
    window.pendingTemplateUrl = url;
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('active');
};

window.closeConfirmModal = function() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('active');
    window.pendingTemplateUrl = null;
    
    // Reset the select box in the UI
    const selects = document.querySelectorAll('select');
    selects.forEach(s => {
        if (s.options && s.options[0] && s.options[0].value === "") {
            s.selectedIndex = 0;
        }
    });
};

window.confirmLoadTemplate = function() {
    if (window.pendingTemplateUrl) {
        window.loadTemplate(window.pendingTemplateUrl);
    }
    window.closeConfirmModal();
};
