export class Ball {
    constructor(world, Matter, x, y, radius, restitution, color = '#00f2fe', isStatic = false, spawnerIndex = null) {
        this.Matter = Matter;
        this.world = world;
        this.body = Matter.Bodies.circle(x, y, radius, {
            restitution: restitution,
            friction: 0.005,
            frictionAir: 0.001,
            density: 0.01, // Heavy ball to tilt seesaw significantly
            label: 'ball',
            isStatic: isStatic,
            slop: 0.01 // Tighter collision detection
        });
        this.radius = radius;
        this.color = color;
        this.isStatic = isStatic;
        this.wasStatic = isStatic; // Remember if it started as static
        this.isFocused = false; // For selection indicator
        this.spawnerIndex = spawnerIndex; // Track which spawner created this ball
        this.trail = [];
        this.maxTrail = 15;
        Matter.World.add(world, this.body);
    }

    activate() {
        if (this.isStatic) {
            this.Matter.Body.setStatic(this.body, false);
            this.isStatic = false;
        }
    }

    draw(p) {
        const pos = this.body.position;
        const speed = this.body.speed;
        
        // Limit maximum velocity to prevent uncontrollable speeds
        const maxSpeed = 40; // Increased from 30 for high bounce/gravity scenarios
        if (speed > maxSpeed) {
            const velocityScale = maxSpeed / speed;
            this.Matter.Body.setVelocity(this.body, {
                x: this.body.velocity.x * velocityScale,
                y: this.body.velocity.y * velocityScale
            });
        }

        // Update trail only if not static
        if (!this.isStatic) {
            this.trail.push({ x: pos.x, y: pos.y });
            if (this.trail.length > this.maxTrail) {
                this.trail.shift();
            }
        }

        p.push();
        
        // Draw fire trail only for dynamic balls
        if (!this.isStatic) {
            for (let i = 0; i < this.trail.length; i++) {
                const t = this.trail[i];
                const size = p.map(i, 0, this.trail.length, 2, this.radius * 1.5);
                const alpha = p.map(i, 0, this.trail.length, 0, 150);
                
                p.noStroke();
                const col = p.color(this.color);
                col.setAlpha(alpha);
                p.fill(col);
                
                // Add some "flicker"
                const offsetX = (p.random() - 0.5) * speed * 0.5;
                const offsetY = (p.random() - 0.5) * speed * 0.5;
                
                p.circle(t.x + offsetX, t.y + offsetY, size);
            }
        }

        // Draw Main Ball
        p.translate(pos.x, pos.y);
        
        // Static ball: gray with dashed outline
        if (this.isStatic) {
            p.drawingContext.setLineDash([5, 5]);
            p.stroke(this.isFocused ? '#00f2fe' : 100);
            p.strokeWeight(this.isFocused ? 3 : 2);
            p.fill(this.isFocused ? 80 : 60);
            p.circle(0, 0, this.radius * 2);
            p.drawingContext.setLineDash([]);
            
            // Draw selection indicator
            if (this.isFocused) {
                p.noFill();
                p.stroke(0, 242, 254);
                p.strokeWeight(2);
                p.drawingContext.setLineDash([8, 4]);
                p.circle(0, 0, this.radius * 2.5);
                p.drawingContext.setLineDash([]);
            }
        } else {
            // Dynamic ball: glow effect
            // Outer Glow
            p.drawingContext.shadowBlur = 20 + speed * 2;
            p.drawingContext.shadowColor = this.color;
            
            // Core layer 1
            p.fill(this.color);
            p.noStroke();
            p.circle(0, 0, this.radius * 2);
            
            // Core layer 2 (Bright Center)
            p.drawingContext.shadowBlur = 10;
            p.drawingContext.shadowColor = '#ffffff';
            p.fill(255);
            p.circle(0, 0, this.radius * 1.2);
        }
        
        p.pop();
    }

    isOffScreen(limitY) {
        return this.body.position.y > limitY;
    }

    destroy() {
        this.Matter.World.remove(this.world, this.body);
    }
}
