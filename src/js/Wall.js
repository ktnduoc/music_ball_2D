export class Wall {
    constructor(world, Matter, x, y, w, h, angle, note = 'Auto', shape = 'rect', instrument = 'sine', curvatureTop = 0, curvatureBottom = 0) {
        this.Matter = Matter;
        this.world = world;
        this.w = w;
        this.h = h;
        this.note = note;
        this.shape = shape;
        this.instrument = instrument;
        this.curvatureTop = curvatureTop;
        this.curvatureBottom = curvatureBottom;
        this.initialAngle = angle || 0; // Store initial angle for seesaw reset
        this.index = null; // Will be set by game.js
        
        // Universal settings
        this.settings = { 
            restitution: 0.8, 
            color: '#444444', 
            stroke: '#666666' 
        };

        this.createBody(x, y, angle);
        
        this.glow = 0;
        this.activated = false;
        this.isFocused = false;
    }

    createBody(x, y, angle) {
        const options = {
            isStatic: true,
            angle: angle || 0,
            label: 'bar',
            restitution: this.settings.restitution,
            friction: 0.1,
            slop: 0.01 // Reduce collision slop for tighter collision detection
        };

        if (this.shape === 'circle') {
            this.body = this.Matter.Bodies.circle(x, y, this.w / 2, options);
        } else if (this.shape === 'triangle') {
            this.body = this.Matter.Bodies.polygon(x, y, 3, this.w / 1.5, options);
        } else if (this.shape === 'rect' && (this.curvatureTop !== 0 || this.curvatureBottom !== 0)) {
            // Create curved shape using multiple small rectangles following the curve
            const segments = 16;
            const segmentWidth = this.w / segments;
            let vertices = [];
            let bodies = [];
            
            // Calculate all points for visual representation
            for (let i = 0; i <= segments; i++) {
                const f = i / segments;
                const px = -this.w/2 + f * this.w;
                const bulgeTop = Math.sin(f * Math.PI) * (this.curvatureTop * this.h * 5.0);
                const bulgeBottom = Math.sin(f * Math.PI) * (this.curvatureBottom * this.h * 5.0);
                vertices.push({ 
                    x: px, 
                    yTop: -this.h/2 - bulgeTop,
                    yBottom: this.h/2 + bulgeBottom
                });
            }
            
            // Create compound body from small segments
            for (let i = 0; i < segments; i++) {
                const v1 = vertices[i];
                const v2 = vertices[i + 1];
                
                // Calculate segment center and size
                const segX = (v1.x + v2.x) / 2;
                const topY = (v1.yTop + v2.yTop) / 2;
                const bottomY = (v1.yBottom + v2.yBottom) / 2;
                const segY = (topY + bottomY) / 2;
                const segH = Math.abs(bottomY - topY);
                
                // Calculate angle for this segment
                const dx = v2.x - v1.x;
                const dy = (v2.yTop + v2.yBottom)/2 - (v1.yTop + v1.yBottom)/2;
                const segAngle = Math.atan2(dy, dx);
                
                bodies.push(
                    this.Matter.Bodies.rectangle(
                        segX,  // Relative position (will be offset by compound body position)
                        segY, 
                        segmentWidth * 1.1, // Slight overlap to prevent gaps
                        segH, 
                        { ...options, angle: segAngle }
                    )
                );
            }
            
            // Create compound body
            this.body = this.Matter.Body.create({
                parts: bodies,
                isStatic: true,
                label: 'bar',
                restitution: options.restitution,
                friction: options.friction
            });
            
            // CRITICAL: Set position AFTER creating compound body to prevent drift
            this.Matter.Body.setPosition(this.body, { x, y });
            
            // Store vertices for drawing (visual representation)
            this.vertices = [];
            for (let i = 0; i <= segments; i++) {
                const v = vertices[i];
                this.vertices.push({ x: v.x, y: v.yTop });
            }
            for (let i = segments; i >= 0; i--) {
                const v = vertices[i];
                this.vertices.push({ x: v.x, y: v.yBottom });
            }
        } else if (this.shape === 'seesaw') {
            // Seesaw - dynamic body that can rotate around center pivot like a compass needle
            const seesawOptions = {
                isStatic: false,
                angle: angle || 0,
                label: 'seesaw',
                restitution: 0, // No bounce at all
                friction: 1, // Maximum friction to hold the ball
                density: 0.001, // Very light so ball weight matters more
                frictionAir: 0.01, // Minimal air resistance
                slop: 0.05
            };
            
            this.vertices = null;
            this.body = this.Matter.Bodies.rectangle(x, y, this.w, this.h, {
                ...seesawOptions,
                chamfer: { radius: Math.min(this.h/2, 8) }
            });
            
            // Create a pivot constraint at the center
            this.pivot = this.Matter.Bodies.circle(x, y, 5, {
                isStatic: true,
                isSensor: true, // Prevent collision detection
                render: { visible: false }
            });
            
            this.constraint = this.Matter.Constraint.create({
                bodyA: this.pivot,
                bodyB: this.body,
                pointA: { x: 0, y: 0 },
                pointB: { x: 0, y: 0 },
                length: 0,
                stiffness: 1,
                damping: 0 // No damping for free rotation
            });
            
            this.Matter.World.add(this.world, [this.pivot, this.constraint]);
        } else {
            this.vertices = null;
            this.body = this.Matter.Bodies.rectangle(x, y, this.w, this.h, {
                ...options,
                chamfer: { radius: Math.min(this.h/2, 10) }
            });
        }
        
        this.Matter.World.add(this.world, this.body);
    }

    draw(p) {
        p.push();
        p.translate(this.body.position.x, this.body.position.y);
        p.rotate(this.body.angle);
        
        // Apply self-balancing torque for seesaw
        if (this.shape === 'seesaw') {
            const angleDiff = this.initialAngle - this.body.angle;
            const restoreTorque = angleDiff * 0.0002; // Gentle restoration force
            this.Matter.Body.setAngularVelocity(this.body, this.body.angularVelocity + restoreTorque);
        }
        
        this.glow *= 0.95;
        
        // Shadow/Glow - Performance Optimized
        const lod = window.lodQuality || 'high';
        if ((this.activated || this.isFocused) && lod !== 'low') {
            const blurScale = lod === 'medium' ? 0.5 : 1.0;
            p.drawingContext.shadowBlur = (10 + this.glow * 30) * blurScale;
            p.drawingContext.shadowColor = this.isFocused ? 'rgba(0, 255, 100, 0.5)' : this.settings.color;
        } else {
            p.drawingContext.shadowBlur = 0;
        }
        
        // Body
        p.fill(this.activated || this.isFocused ? 35 : 60);
        
        // Highlight border
        if (this.isFocused) {
            p.stroke(0, 255, 100);
            p.strokeWeight(3);
        } else if (this.activated) {
            p.stroke(this.settings.color);
            p.strokeWeight(2 + this.glow * 2);
        } else {
            p.stroke(120);
            p.strokeWeight(2);
        }
        
        if (this.shape === 'circle') {
            p.circle(0, 0, this.w);
        } else if (this.shape === 'triangle') {
            p.beginShape();
            for (let i = 0; i < 3; i++) {
                let ang = i * p.TWO_PI / 3 - p.HALF_PI;
                let vx = p.cos(ang) * (this.w / 1.5);
                let vy = p.sin(ang) * (this.w / 1.5);
                p.vertex(vx, vy);
            }
            p.endShape(p.CLOSE);
        } else if (this.vertices && this.shape === 'rect') {
            // Draw smooth visual representation
            p.beginShape();
            this.vertices.forEach(v => p.vertex(v.x, v.y));
            p.endShape(p.CLOSE);
        } else if (this.shape === 'seesaw') {
            p.rectMode(p.CENTER);
            p.rect(0, 0, this.w, this.h, 8);
            
            // Draw pivot point - matches body darkness
            p.noStroke();
            if (this.activated) {
                p.fill(this.settings.color);
            } else {
                p.fill(80); // Slightly lighter than body (60) but still dark
            }
            p.circle(0, 0, 12);
            p.fill(this.activated || this.isFocused ? 25 : 40); // Inner darker circle
            p.circle(0, 0, 6);
        } else {
            p.rectMode(p.CENTER);
            p.rect(0, 0, this.w, this.h, 10);
        }
        
        // Always show index number (small)
        if (this.index !== null && !this.isFocused) {
            p.push();
            p.noStroke();
            p.fill(150, 150, 150, 180);
            p.textSize(10);
            p.textAlign(p.CENTER);
            const labelY = this.shape === 'rect' ? -this.h/2 - 15 : -this.w/2 - 18;
            p.text(`#${this.index + 1}`, 0, labelY);
            p.pop();
        }

        // Handles and UI
        if (this.isFocused && !this.hideHandles) {
            p.noStroke();
            p.fill(255, 150);
            p.textSize(11);
            p.textAlign(p.CENTER);
            const labelY = this.shape === 'rect' ? -this.h/2 - 40 : -this.w/2 - 45;
            p.text(this.note, 0, labelY);
            
            // Show bar index number
            if (this.index !== null) {
                p.fill(0, 255, 100);
                p.textSize(14);
                p.textAlign(p.CENTER);
                p.text(`#${this.index + 1}`, 0, -labelY + 20);
            }

            // Resize Handles
            p.fill(0, 255, 100);
            
            // Right (Width)
            p.rectMode(p.CENTER);
            p.rect(this.w/2 + 5, 0, 10, 20, 2);
            
            // Bottom (Height)
            if (this.shape === 'rect') {
                p.rect(0, this.h/2 + 5, 20, 10, 2);
            }

            // Rotation Handle (Top) - not for seesaw
            if (this.shape !== 'seesaw') {
                p.stroke(0, 255, 100, 100);
                p.line(0, -this.h/2, 0, -this.h/2 - 30);
                p.noStroke();
                p.circle(0, -this.h/2 - 30, 12);
                p.fill(0);
                p.circle(0, -this.h/2 - 30, 4);
            }
        } else if (this.isFocused && this.hideHandles) {
            // Minimal highlight for multi-select without handles
            p.noStroke();
            p.fill(0, 255, 100, 150);
            p.textSize(10);
            p.textAlign(p.CENTER);
            p.text("SELECTED", 0, -this.h/2 - 10);
        }

        p.pop();
    }

    resize(newW, newH) {
        this.w = Math.max(20, newW);
        this.h = Math.max(10, newH);
        const pos = { x: this.body.position.x, y: this.body.position.y };
        const ang = this.body.angle;
        this.Matter.World.remove(this.world, this.body);
        this.createBody(pos.x, pos.y, ang);
    }

    setShape(shape) {
        this.shape = shape;
        const pos = { x: this.body.position.x, y: this.body.position.y };
        const ang = this.body.angle;
        this.Matter.World.remove(this.world, this.body);
        this.createBody(pos.x, pos.y, ang);
    }

    contains(px, py) {
        if (this.shape === 'circle') {
            const d = Math.sqrt((px - this.body.position.x)**2 + (py - this.body.position.y)**2);
            return d < this.w / 2 + 10;
        }

        const dx = px - this.body.position.x;
        const dy = py - this.body.position.y;
        const cos = Math.cos(-this.body.angle);
        const sin = Math.sin(-this.body.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        
        return (lx > -this.w/2 - 15 && lx < this.w/2 + 15 && ly > -this.h/2 - 15 && ly < this.h/2 + 15);
    }

    isNearResizeHandle(px, py) {
        const dx = px - this.body.position.x;
        const dy = py - this.body.position.y;
        const cos = Math.cos(-this.body.angle);
        const sin = Math.sin(-this.body.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        
        // Right Handle (Width)
        if (Math.abs(lx - (this.w/2 + 5)) < 15 && Math.abs(ly) < 20) return 'width';
        
        // Bottom Handle (Height)
        if (this.shape === 'rect' && Math.abs(lx) < 20 && Math.abs(ly - (this.h/2 + 5)) < 15) return 'height';
        
        return null;
    }

    isNearRotateHandle(px, py) {
        // Seesaw cannot be manually rotated
        if (this.shape === 'seesaw') return false;
        
        const dx = px - this.body.position.x;
        const dy = py - this.body.position.y;
        const cos = Math.cos(-this.body.angle);
        const sin = Math.sin(-this.body.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        
        const d = Math.sqrt(lx*lx + (ly - (-this.h/2 - 30))**2);
        return d < 20;
    }

    setPosition(x, y) {
        this.Matter.Body.setPosition(this.body, { x, y });
        // Also move pivot for seesaw
        if (this.shape === 'seesaw' && this.pivot) {
            this.Matter.Body.setPosition(this.pivot, { x, y });
        }
    }

    setAngle(angle) {
        // Seesaw rotation is controlled by physics, not manual
        if (this.shape === 'seesaw') return;
        this.Matter.Body.setAngle(this.body, angle);
    }

    setCurvature(top, bottom) {
        this.curvatureTop = top;
        this.curvatureBottom = bottom;
        const pos = { x: this.body.position.x, y: this.body.position.y };
        const ang = this.body.angle;
        this.Matter.World.remove(this.world, this.body);
        this.createBody(pos.x, pos.y, ang);
    }

    onHit() {
        this.glow = 1.0;
        // Only set color on first activation
        if (!this.activated) {
            this.activated = true;
            // Random neon color on hit
            const neonColors = ['#FF00CC', '#33FF00', '#00FFFF', '#FF3300', '#FFFF00', '#FF00FF', '#00FF66'];
            this.settings.color = neonColors[Math.floor(Math.random() * neonColors.length)];
        }
    }

    reset() {
        this.activated = false;
        this.settings.color = '#444444';
        this.glow = 0;
    }

    destroy() {
        this.Matter.World.remove(this.world, this.body);
        if (this.shape === 'seesaw' && this.pivot && this.constraint) {
            this.Matter.World.remove(this.world, [this.pivot, this.constraint]);
        }
    }
}
