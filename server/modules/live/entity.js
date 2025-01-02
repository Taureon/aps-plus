const { combineStats } = require('../definitions/facilitators');

let EventEmitter = require('events'),
    events,
    init = g => events = g.events;

class Gun extends EventEmitter {
    constructor(body, info) {
        super();
        this.id = entitiesIdLog++;
        this.lastShot = { time: 0, power: 0 };
        this.body = body;
        this.master = body.source;
        this.label = "";
        this.identifier = "";
        this.children = [];
        // Stored Variables
        this.globalStore = {}
        this.store = {}
        // ----------------
        this.color = new Color({
            BASE: "grey",
            HUE_SHIFT: 0,
            SATURATION_SHIFT: 1,
            BRIGHTNESS_SHIFT: 0,
            ALLOW_BRIGHTNESS_INVERT: false,
        });
        this.alpha = 1;
        this.strokeWidth = 1;
        this.canShoot = false;
        this.codeControlOnly = false;
        this.borderless = false;
        this.drawFill = true;
        this.drawAbove = false;
        if (info.PROPERTIES != null) {
            this.autofire = info.PROPERTIES.AUTOFIRE ?? false;
            this.altFire = info.PROPERTIES.ALT_FIRE ?? false;
            this.statCalculator = info.PROPERTIES.STAT_CALCULATOR ?? "default";
            this.waitToCycle = info.PROPERTIES.WAIT_TO_CYCLE ?? false;
            this.delaySpawn = info.PROPERTIES.DELAY_SPAWN ?? this.waitToCycle;
            this.bulletSkills = (info.PROPERTIES.BULLET_STATS == null || info.PROPERTIES.BULLET_STATS == "master") ? "master" : new Skill(info.PROPERTIES.BULLET_STATS);
            this.useMasterSkills = this.bulletSkills === "master";
            this.shootSettings = info.PROPERTIES.SHOOT_SETTINGS == null ? [] : JSON.parse(JSON.stringify(info.PROPERTIES.SHOOT_SETTINGS));
            this.maxChildren = info.PROPERTIES.MAX_CHILDREN ?? false;
            this.syncsSkills = info.PROPERTIES.SYNCS_SKILLS ?? false;
            this.negativeRecoil = info.PROPERTIES.NEGATIVE_RECOIL ? -1 : 1;
            this.independentChildren = info.PROPERTIES.INDEPENDENT_CHILDREN ?? false;
            this.codeControlOnly = info.PROPERTIES.CODE_CONTROLLED ?? false;
            if (info.PROPERTIES.COLOR != null) {
                this.color.interpret(info.PROPERTIES.COLOR);
            }
            if (info.PROPERTIES.ALPHA != null) this.alpha = info.PROPERTIES.ALPHA;
            if (info.PROPERTIES.STROKE_WIDTH != null) this.strokeWidth = info.PROPERTIES.STROKE_WIDTH;
            if (info.PROPERTIES.BORDERLESS != null) this.borderless = info.PROPERTIES.BORDERLESS;
            if (info.PROPERTIES.DRAW_FILL != null) this.drawFill = info.PROPERTIES.DRAW_FILL;
            if (info.PROPERTIES.DRAW_ABOVE) this.drawAbove = info.PROPERTIES.DRAW_ABOVE;
            this.destroyOldestChild = info.PROPERTIES.DESTROY_OLDEST_CHILD ?? false;
            if (this.destroyOldestChild) this.maxChildren++;
            this.shootOnDeath = info.PROPERTIES.SHOOT_ON_DEATH ?? false;
            this.stack = info.PROPERTIES.STACK_GUN ?? true ;
            this.identifier = info.PROPERTIES.IDENTIFIER ?? null;
            if (info.PROPERTIES.TYPE != null) {
                this.canShoot = true;
                this.label = info.PROPERTIES.LABEL ?? "";
                this.setBulletType(info.PROPERTIES.TYPE);
            }
        }
        let position = info.POSITION;
        if (Array.isArray(position)) {
            position = {
                LENGTH: position[0],
                WIDTH: position[1],
                ASPECT: position[2],
                X: position[3],
                Y: position[4],
                ANGLE: position[5],
                DELAY: position[6],
                DRAW_ABOVE: position[7],
            }
        }
        position = {
            LENGTH: position.LENGTH ?? 18,
            WIDTH: position.WIDTH ?? 8,
            ASPECT: position.ASPECT ?? 1,
            X: position.X ?? 0,
            Y: position.Y ?? 0,
            ANGLE: position.ANGLE ?? 0,
            DELAY: position.DELAY ?? 0,
            DRAW_ABOVE: position.DRAW_ABOVE ?? this.drawAbove
        };
        this.length = position.LENGTH / 10;
        this.width = position.WIDTH / 10;
        this.aspect = position.ASPECT;
        let _off = new Vector(position.X, position.Y);
        this.angle = (position.ANGLE * Math.PI) / 180;
        this.offsetDirection = _off.direction;
        this.offset = _off.length / 10;
        this.maxCycleTimer = !this.delaySpawn - position.DELAY;
        this.drawAbove = position.DRAW_ABOVE;
        this.recoilPosition = 0;
        this.recoilVelocity = 0;
        if (this.canShoot) {
            this.cycleTimer = this.maxCycleTimer;
            this.trueRecoil = this.shootSettings.recoil;
            this.facing = 0;
            this.childrenLimitFactor = 1;
        }
    }
    live() {
        if (!this.canShoot || this.body.master.invuln) return;
        
        // Iterate recoil
        this.recoil();

        if (this.codeControlOnly) return;

        // Determine shoot permission based on child counting settings
        let shootPermission = this.checkShootPermission();

        // Cycle up if we should
        if ((shootPermission || !this.waitToCycle) && this.cycleTimer < 1) {
            this.cycleTimer += 1 / (this.shootSettings.reload * this.reloadRateFactor * Config.runSpeed);
        }

        // Firing routine
        let fireCommand = this.autofire || (this.altFire ? this.body.control.alt : this.body.control.fire);
        if (fireCommand) {
            // Loop while allowed to shoot and reloaded enough to shoot
            while (shootPermission && this.cycleTimer >= 1) {
                this.fire();
                this.cycleTimer--;

                // Repeatedly check for shoot permission to prevent ultra low reload guns from exceeding the child limit in 1 tick
                shootPermission = this.checkShootPermission();
            }
        // If we're not shooting, only cycle up to where we'll have the proper firing delay
        } else if (this.cycleTimer > this.maxCycleTimer) {
            this.cycleTimer = this.maxCycleTimer;
        }
    }
    checkShootPermission() {
        let shootPermission = this.maxChildren
        ? this.maxChildren >
            this.children.length * this.childrenLimitFactor
        : this.body.maxChildren
        ? this.body.maxChildren >
            this.body.children.length * this.childrenLimitFactor
        : true;

        // Handle destroying oldest child
        if (this.destroyOldestChild && !shootPermission) {
            shootPermission = true;
            this.destroyOldest();
        }

        return shootPermission;
    }
    fire() {
        // Recoil
        this.lastShot.time = performance.now();
        this.lastShot.power = 3 * Math.log(Math.sqrt(this.bulletSkills.spd) + this.trueRecoil + 1) + 1;
        this.recoilVelocity += this.lastShot.power;
        this.facing = this.body.facing + this.angle;

        // Initialize bullet
        let [spawnX, spawnY] = this.findBulletSpawnPosition();
        let bullet = this.createBullet(spawnX, spawnY);

        // If told to, create an independent entity
        if (this.independentChildren) {
            this.defineIndependentBullet(bullet);
        // Else make a regular bullet
        } else {
            this.defineBullet(bullet);
        }
        // Set confinement
        for (let k in this.master.confinement) {
            bullet.confinement[k] = this.master.confinement[k];
        }
        bullet.life();

        // Emit fire event
        this.master.emit(this.altFire ? 'altFire' : 'fire', {
            body: this.master,
            gun: this,
            child: bullet,
            masterStore: this.master.store,
            globalMasterStore: this.master.globalStore,
            gunStore: this.store,
            globalGunStore: this.globalStore
        });
    }
    findBulletSpawnPosition() {
        // Find out some intermediate values
        let offsetAngle = this.offsetDirection + this.angle + this.body.facing,
            gunlength = this.length + Config.bulletSpawnOffset * this.width * this.shootSettings.size / 2,

        // Calculate offset of gun base and gun end based
            offsetBaseX = this.offset * Math.cos(offsetAngle),
            offsetBaseY = this.offset * Math.sin(offsetAngle),
            offsetEndX = gunlength * Math.cos(this.facing),
            offsetEndY = gunlength * Math.sin(this.facing),

        // Combine offsets to get final values
            offsetFinalX = offsetBaseX + offsetEndX,
            offsetFinalY = offsetBaseY + offsetEndY;
        
        return [offsetFinalX, offsetFinalY]
    }
    createBullet(spawnX, spawnY) {
        // Find inaccuracy
        let shudder = 0, spread = 0;
        if (this.shootSettings.shudder) {
            do {
                shudder = ran.gauss(0, Math.sqrt(this.shootSettings.shudder));
            } while (Math.abs(shudder) >= this.shootSettings.shudder * 2);
        }
        if (this.shootSettings.spray) {
            do {
                spread = ran.gauss(0, this.shootSettings.spray * this.shootSettings.shudder);
            } while (Math.abs(spread) >= this.shootSettings.spray / 2);
        }
        spread *= Math.PI / 180;

        // Find velocity
        let velocityMagnitude = this.negativeRecoil * this.shootSettings.speed * this.bulletSkills.spd * (shudder + 1) * Config.runSpeed,
            velocityDirection = this.angle + this.body.facing + spread,
            velocity = new Vector(velocityMagnitude * Math.cos(velocityDirection), velocityMagnitude * Math.sin(velocityDirection));
        
        // Apply velocity inheritance
        if (this.body.velocity.length) {
            let extraBoost =
                Math.max(0, velocity.x * this.body.velocity.x + velocity.y * this.body.velocity.y) /
                this.body.velocity.length /
                velocity.length;
            if (extraBoost) {
                let len = velocity.length;
                velocity.x += (this.body.velocity.length * extraBoost * velocity.x) / len;
                velocity.y += (this.body.velocity.length * extraBoost * velocity.y) / len;
            }
        }

        // Spawn bullet
        spawnX = this.body.x + this.body.size * spawnX - velocity.x,
        spawnY = this.body.y + this.body.size * spawnY - velocity.y;
        
        // Independent children
        if (this.independentChildren) {
            let bullet = new Entity({x: spawnX, y: spawnY});
            return bullet;
        }

        // Dependent children
        let bullet = new Entity({x: spawnX, y: spawnY}, this.master.master);
        bullet.velocity = velocity;
        return bullet;
    }
    defineIndependentBullet(bullet) {
        bullet.define(this.bulletType);

        // Keep track of it for child counting
        if (this.maxChildren) {
            bullet.parent = this;
            this.children.push(bullet);
        } else if (this.body.maxChildren) {
            bullet.parent = this.body;
            this.body.children.push(bullet);
            this.children.push(bullet);
        }
        bullet.coreSize = bullet.SIZE;
        bullet.team = this.body.team;
    }
    defineBullet(bullet) {
        // Set bullet source
        bullet.source = this.body;
        
        // Define bullet based on natural properties and skills
        this.bulletType.SIZE = (this.body.size * this.width * this.shootSettings.size) / 2;
        bullet.define(this.bulletType);

        // Fix color
        if (bullet.color.base == '-1' || bullet.color.base == 'mirror') {
            bullet.color.base = this.body.master.color.base
        }
        bullet.coreSize = bullet.SIZE;

        // Keep track of it for child counting
        if (this.maxChildren) {
            bullet.parent = this;
            this.children.push(bullet);
        } else if (this.body.maxChildren) {
            bullet.parent = this.body;
            this.body.children.push(bullet);
            this.children.push(bullet);
        }
        bullet.facing = bullet.velocity.direction;

        if (!bullet.settings.necroTypes) {
            return;
        }
        
        // Set all necroType gun references to parent gun
        for (let shape of bullet.settings.necroTypes) {
            bullet.settings.necroDefineGuns[shape] = this;
        }
    }
    recoil() {
        if (this.recoilVelocity || this.recoilPosition) {
            // Simulate recoil
            this.recoilVelocity -= (0.25 * this.recoilPosition) / Config.runSpeed;
            this.recoilPosition += this.recoilVelocity;
            if (this.recoilPosition < 0) {
                // Bouncing off the back
                this.recoilPosition = 0;
                this.recoilVelocity = -this.recoilVelocity;
            }
            if (this.recoilVelocity > 0) {
                this.recoilVelocity *= 0.75;
            }
        }
        // Apply recoil to motion
        if (this.recoilVelocity > 0 && this.body.recoilMultiplier) {
            let recoilForce = -this.recoilPosition * this.trueRecoil * this.body.recoilMultiplier * 1.08 / this.body.size / Config.runSpeed;
            this.body.accel.x += recoilForce * Math.cos(this.facing);
            this.body.accel.y += recoilForce * Math.sin(this.facing);
        }
    }
    setBulletType(type, clearChildren = false) {
        // Pre-flatten bullet types to save on doing the same define() sequence a million times
        this.bulletType = Array.isArray(type) ? type : [type];
        // Preset BODY because not all definitions have BODY defined when flattened
        let flattenedType = {BODY: {}};
        for (let type of this.bulletType) {
            type = ensureIsClass(type);
            util.flattenDefinition(flattenedType, type);
        }
        this.bulletType = flattenedType;
        // Set final label to bullet
        if (!this.independentChildren) {
            this.bulletType.LABEL = this.master.label + (this.label ? " " + this.label : "") + " " + this.bulletType.LABEL;
        }
        // Save a copy of the bullet definition for body stat defining
        this.bulletBodyStats = JSON.parse(JSON.stringify(this.bulletType.BODY));
        this.calculateBulletStats();

        if (!clearChildren) return;
        for (let child of this.children) {
            child.kill();
        }
    }
    syncGunStats() {
        this.calculateBulletStats();
        // Don't bother updating children if we shouldn't
        if (!this.syncsSkills || this.independentChildren) return;

        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            child.define({
                BODY: this.interpretedStats,
                SKILL: this.getSkillRaw(),
            });
            child.refreshBodyAttributes();
        }
    }
    calculateBulletStats() {
        // Skip if unable to shoot or if we shouldn't care about body stats
        if (!this.canShoot) return;

        let sizeFactor = this.master.size / this.master.SIZE;
        let shoot = this.shootSettings;
        if (this.useMasterSkills) {
            this.bulletSkills = this.body.skill;
        }
        // Defaults
        let out = {
            SPEED: shoot.maxSpeed * this.bulletSkills.spd,
            HEALTH: shoot.health * this.bulletSkills.str,
            RESIST: shoot.resist + this.bulletSkills.rst,
            DAMAGE: shoot.damage * this.bulletSkills.dam,
            PENETRATION: Math.max(1, shoot.pen * this.bulletSkills.pen),
            RANGE: shoot.range / Math.sqrt(this.bulletSkills.spd),
            DENSITY: (shoot.density * this.bulletSkills.pen * this.bulletSkills.pen) / sizeFactor,
            PUSHABILITY: 1 / this.bulletSkills.pen,
            HETERO: Math.max(0, 3 - 1.2 * this.bulletSkills.ghost),
        };
        this.reloadRateFactor = this.bulletSkills.rld;
        // Special cases
        switch (this.statCalculator) {
            case "thruster":
                this.trueRecoil = shoot.recoil * Math.sqrt(this.bulletSkills.rld * this.bulletSkills.spd);
                break;
            case "sustained":
                out.RANGE = shoot.range;
                break;
            case "swarm":
                out.PENETRATION = Math.max(1, shoot.pen * (0.5 * (this.bulletSkills.pen - 1) + 1));
                out.HEALTH /= shoot.pen * this.bulletSkills.pen;
                break;
            case "trap":
            case "block":
                out.PUSHABILITY = 1 / Math.pow(this.bulletSkills.pen, 0.5);
                out.RANGE = shoot.range;
                break;
            case "fixedReload":
                this.reloadRateFactor = 1;
                break;
            case "necro":
                this.childrenLimitFactor = this.bulletSkills.rld;
                this.reloadRateFactor = 1;
            case "drone":
                out.PUSHABILITY = 1;
                out.PENETRATION = Math.max(1, shoot.pen * (0.5 * (this.bulletSkills.pen - 1) + 1));
                out.HEALTH = (shoot.health * this.bulletSkills.str + sizeFactor) / Math.pow(this.bulletSkills.pen, 0.8);
                out.DAMAGE = shoot.damage * this.bulletSkills.dam * Math.sqrt(sizeFactor) * Math.sqrt(shoot.pen * this.bulletSkills.pen);
                break;
        }
        if (this.independentChildren) return;
        // Go through and make sure we respect its natural properties
        for (let property in out) {
            if (this.bulletBodyStats[property] == null)
                continue;
            out[property] *= this.bulletBodyStats[property];
        }
        this.interpretedStats = out;

        // Save in this.bulletType to be used for defining dependent bullets
        this.bulletType.SKILL = this.getSkillRaw();
        for (let stat in this.interpretedStats) {
            // Do body stats one-by-one so all are defined properly and none are replaced with undefined
            this.bulletType.BODY[stat] = this.interpretedStats[stat];
        }
    }
    destroyOldest() {
        let oldestChild,
            oldestTime = Infinity;
        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            if (child && child.creationTime < oldestTime) {
                oldestTime = child.creationTime;
                oldestChild = child;
            }
        }
        if (oldestChild) oldestChild.kill();
    }
    getTracking() {
        return {
            speed: Config.runSpeed * this.bulletSkills.spd * this.shootSettings.maxSpeed * this.bulletBodyStats.SPEED,
            range: Math.sqrt(this.bulletSkills.spd) * this.shootSettings.range * this.bulletBodyStats.RANGE
        };
    }
    getSkillRaw() {
        if (this.useMasterSkills) {
            return [
                this.body.skill.raw[0],
                this.body.skill.raw[1],
                this.body.skill.raw[2],
                this.body.skill.raw[3],
                this.body.skill.raw[4],
                0,
                0,
                0,
                0,
                0,
            ];
        }
        return this.bulletSkills.raw;
    }
    getPhotoInfo() {
        return {
            ...this.lastShot, 
            color: this.color.compiled,
            alpha: this.alpha,
            strokeWidth: this.strokeWidth,
            borderless: this.borderless, 
            drawFill: this.drawFill, 
            drawAbove: this.drawAbove,
            length: this.length,
            width: this.width,
            aspect: this.aspect,
            angle: this.angle,
            offsetDirection: this.offsetDirection,
            offset: this.offset,
        };
    }
}

class antiNaN {
    constructor(me) {
        this.me = me;
        this.nansInARow = 0;
        this.data = { x: 1, y: 1, vx: 0, vy: 0, ax: 0, ay: 0 };
        this.amNaN = me => [me.x, me.y, me.velocity.x, me.velocity.y, me.accel.x, me.accel.y].some(isNaN);
    }
    update() {
        if (this.amNaN(this.me)) {
            this.nansInARow++;
            if (this.nansInARow > 50) {
                console.log("NaN instance found. (Repeated)\nDebug:", [
                    ["x", isNaN(this.me.x)],
                    ["y", isNaN(this.me.y)],
                    ["velocity.x", isNaN(this.me.velocity.x)],
                    ["velocity.y", isNaN(this.me.velocity.y)],
                    ["accel.x", isNaN(this.me.accel.x)],
                    ["accel.y", isNaN(this.me.accel.y)],
                ].filter(entry => entry[1]).join(', '));
            }
            this.me.x = this.data.x;
            this.me.y = this.data.y;
            this.me.velocity.x = this.data.vx;
            this.me.velocity.y = this.data.vy;
            this.me.accel.x = this.data.ax;
            this.me.accel.y = this.data.ay;
            if (this.amNaN(this.me)) console.log("NaN instance is still NaN.");
        } else {
            this.data.x = this.me.x;
            this.data.y = this.me.y;
            this.data.vx = this.me.velocity.x;
            this.data.vy = this.me.velocity.y;
            this.data.ax = this.me.accel.x;
            this.data.ay = this.me.accel.y;
            if (this.nansInARow > 0) this.nansInARow--;
        }
    }
}

class Activation {
    constructor(body) {
        this.body = body;
        this.active = true;
        this.lastActive = false;
    }
    update() {
        // Force activation conditions
        if (this.body.alwaysActive || this.body.isPlayer || this.body.isBot) {
            return this.active = true;
        }
        if (this.body.skipLife || this.body.isDead()) {
            return this.active = false;
        }

        // Update activity and other properties based on views
        this.active = views.some((v) => v.check(this.body));

        if (!this.active && this.lastActive) {
            this.body.removeFromGrid();
            this.lastActive = false;
            // Save range ticking
            this.deactivationTime = performance.now();
        } else if (this.active && !this.lastActive) {
            this.lastActive = true;
            this.body.addToGrid();
            // Retrieve range ticking
            if (this.body.diesAtRange) {
                // Time since deactivation, converted to number of ticks, factoring in the run speed
                this.body.range -= (performance.now() - this.deactivationTime) / room.cycleSpeed / Config.runSpeed;
            }
        }
    }
}

function getValidated(obj, prop, allowedType, from, optional = true) {
    let type = typeof obj[prop];
    if (allowedType === type || (optional && 'undefined' === type)) {
        return obj[prop];
    }
    throw new TypeError(`${from} property ${prop} is of type ${type} instead of type ${allowedType}`);
}
let labelThing = "StatusEffect's effects argument";
class StatusEffect extends EventEmitter {
    constructor(duration = 0, multipliers = {}, tick = a => a) {
        super();
        this.duration = getValidated({ duration }, 'duration', 'number', labelThing, false);
        this.acceleration = getValidated(multipliers, 'acceleration', 'number', labelThing);
        this.topSpeed = getValidated(multipliers, 'topSpeed', 'number', labelThing);
        this.health = getValidated(multipliers, 'health', 'number', labelThing);
        this.shield = getValidated(multipliers, 'shield', 'number', labelThing);
        this.regen = getValidated(multipliers, 'regen', 'number', labelThing);
        this.damage = getValidated(multipliers, 'damage', 'number', labelThing);
        this.penetration = getValidated(multipliers, 'penetration', 'number', labelThing);
        this.range = getValidated(multipliers, 'range', 'number', labelThing);
        this.fov = getValidated(multipliers, 'fov', 'number', labelThing);
        this.density = getValidated(multipliers, 'density', 'number', labelThing);
        this.stealth = getValidated(multipliers, 'stealth', 'number', labelThing);
        this.pushability = getValidated(multipliers, 'pushability', 'number', labelThing);
        this.recoilReceived = getValidated(multipliers, 'recoilReceived', 'number', labelThing);
        this.size = getValidated(multipliers, 'size', 'number', labelThing);
        this.tick = getValidated({ tick }, 'tick', 'function', "StatusEffect's argument");
    }
}

class Prop {
    constructor(position, bond) {
        this.guns = [];
        this.color = new Color(16);
        this.borderless = false;
        this.drawFill = true;
        this.strokeWidth = 1;

        // Bind prop
        this.bond = bond;
        this.bond.props.push(this);
        // Get my position.
        if (Array.isArray(position)) {
            position = {
                SIZE: position[0],
                X: position[1],
                Y: position[2],
                ANGLE: position[3],
                LAYER: position[4]
            };
        }
        position.SIZE ??= 10;
        position.X ??= 0;
        position.Y ??= 0;
        position.ANGLE ??= 0;
        position.LAYER ??= 0;
        let _off = new Vector(position.X, position.Y);
        this.bound = {
            size: position.SIZE / 20,
            angle: position.ANGLE * Math.PI / 180,
            direction: _off.direction,
            offset: _off.length / 10,
            layer: position.LAYER
        };
        // Initalize.
        this.facing = 0;
        this.x = 0;
        this.y = 0;
        this.size = 1;
        this.realSize = 1;
        this.settings = {};
        this.settings.mirrorMasterAngle = true;
        this.upgrades = [];
        this.turrets = [];
        this.props = [];
    }
    define(def) {
        let set = ensureIsClass(def);

        if (set.PARENT != null) {
            if (Array.isArray(set.PARENT)) {
                for (let i = 0; i < set.PARENT.length; i++) {
                    this.define(set.PARENT[i], false);
                }
            } else {
                this.define(set.PARENT, false);
            }
        }
        if (set.index != null) this.index = set.index.toString();
        if (set.SHAPE != null) {
            this.shape = typeof set.SHAPE === "number" ? set.SHAPE : 0;
            this.shapeData = set.SHAPE;
        }
        this.imageInterpolation = set.IMAGE_INTERPOLATION != null ? set.IMAGE_INTERPOLATION : 'bilinear'
        if (set.COLOR != null) {
            this.color.interpret(set.COLOR);
        }
        if (set.STROKE_WIDTH != null) this.strokeWidth = set.STROKE_WIDTH
        if (set.BORDERLESS != null) this.borderless = set.BORDERLESS;
        if (set.DRAW_FILL != null) this.drawFill = set.DRAW_FILL;
        if (set.GUNS != null) {
            let newGuns = [];
            for (let i = 0; i < set.GUNS.length; i++) {
                newGuns.push(new Gun(this, set.GUNS[i]));
            }
            this.guns = newGuns;
        }
    }
    camera() {
        return {
            type: 0x01,
            id: this.id,
            index: this.index,
            size: this.size,
            realSize: this.realSize,
            facing: this.facing,
            angle: this.bound.angle,
            direction: this.bound.direction,
            offset: this.bound.offset,
            sizeFactor: this.bound.size,
            mirrorMasterAngle: this.settings.mirrorMasterAngle,
            layer: this.bound.layer,
            color: this.color.compiled,
            strokeWidth: this.strokeWidth,
            borderless: this.borderless,
            drawFill: this.drawFill,
            guns: this.guns.map((gun) => gun.getPhotoInfo()),
            turrets: this.turrets,
        };
    }
}

let entitiesIdLog = 0;
const forceTwiggle = ["autospin", "turnWithSpeed", "spin", "fastspin", "veryfastspin", "withMotion", "smoothWithMotion", "looseWithMotion"];
class Entity extends EventEmitter {
    constructor(position, master) {
        super();
        if (!master) master = this;
        this.isGhost = false;
        this.killCount = {
            solo: 0,
            assists: 0,
            bosses: 0,
            polygons: 0,
            killers: [],
        };
        this.creationTime = Date.now();
        // Inheritance
        this.skipLife = false;
        this.master = master;
        this.source = this;
        this.parent = this;
        this.control = {
            target: new Vector(0, 0),
            goal: new Vector(0, 0),
            main: false,
            alt: false,
            fire: false,
            power: 0,
        };
        this.isInGrid = false;
        this.removeFromGrid = () => {
            if (this.isInGrid) {
                grid.removeObject(this);
                this.isInGrid = false;
            }
        };
        this.addToGrid = () => {
            if (!mockupsLoaded) return;
            if (!this.collidingBond && this.bond != null) return;
            if (!this.isInGrid) {
                grid.addObject(this);
                this.isInGrid = true;
            }
        };
        this.activation = new Activation(this);
        this.autoOverride = false;
        this.healer = false;
        this.controllers = [];
        this.definitionEvents = [];
        this.blend = {
            color: "#FFFFFF",
            amount: 0,
        };
        this.reverseTank = 1;
        // Objects
        this.skill = new Skill();
        this.health = new HealthType(1, "static", 0);
        this.shield = new HealthType(0, "dynamic");
        this.guns = [];
        this.turrets = [];
        this.props = [];
        this.upgrades = [];
        this.skippedUpgrades = [];
        this.settings = {};
        this.aiSettings = {};
        this.children = [];
        this.statusEffects = [];
        this.color = new Color(16);
        this.glow = { radius: null, color: new Color(-1).compiled, alpha: 1, recursion: 1 }
        this.invisible = [0, 0];
        this.alphaRange = [0, 1];
        this.confinement = {
            xMin: 0,
            xMax: room.width,
            yMin: 0,
            yMax: room.height,
        },
        // Define it
        this.SIZE = 1;
        this.sizeMultiplier = 1;
        this.define("genericEntity");
        // Initalize physics and collision
        this.alwaysShowOnMinimap = false;
        this.allowedOnMinimap = true;
        this.maxSpeed = 0;
        this.facingLocked = false;
        this.facing = 0;
        this.range = 0;
        this.angle = 0;
        this.damageReceived = 0;
        this.recoilMultiplier = 1;
        this.stepRemaining = 1;
        this.x = position.x;
        this.y = position.y;
        this.cameraOverrideX = null;
        this.cameraOverrideY = null;
        this.velocity = new Vector(0, 0);
        this.accel = new Vector(0, 0);
        this.damp = 0.05;
        this.collisionArray = [];
        this.perceptionAngleIndependence = 1;
        this.firingArc = [0, 360];
        this.invuln = false;
        this.alpha = 1;
        this.strokeWidth = 1;
        this.levelCap = undefined;
        this.autospinBoost = 1;
        this.antiNaN = new antiNaN(this);
        // Get a new unique id
        this.id = entitiesIdLog++;
        this.team = this.id;
        this.team = master.team;
        this.turnAngle = 0;
        // Stored Variables
        this.globalStore = {};
        this.store = {};
        // This is for collisions
        this.AABB_data = {};
        this.AABB_savedSize = 0;
        this.collidingBond = false
        this.updateAABB = (active) => {
            if (!this.collidingBond && this.bond != null) return 0;
            if (!active) {
                this.AABB_data.active = false;
                return 0;
            }
            if (this.isPlayer && !this.isDead()) this.refreshBodyAttributes();
            this.antiNaN.update();
            // Get bounds
            let x1 = Math.min(this.x, this.x + this.velocity.x + this.accel.x) - this.realSize - 5;
            let y1 = Math.min(this.y, this.y + this.velocity.y + this.accel.y) - this.realSize - 5;
            let x2 = Math.max(this.x, this.x + this.velocity.x + this.accel.x) + this.realSize + 5;
            let y2 = Math.max(this.y, this.y + this.velocity.y + this.accel.y) + this.realSize + 5;
            let size = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
            let sizeDiff = this.AABB_savedSize / size;
            // Update data
            this.AABB_data = {
                min: [x1, y1],
                max: [x2, y2],
                active: true,
                size: size,
            };
            // Update grid if needed
            if (sizeDiff > Math.SQRT2 || sizeDiff < Math.SQRT1_2) {
                this.removeFromGrid();
                this.addToGrid();
                this.AABB_savedSize = size;
            }
        };
        this.getAABB = () => this.AABB_data;
        this.updateAABB(true);
        entities.push(this);
        for (let v of views) v.add(this);
        this.activation.update();
        Events.emit('spawn', this);
    }
    addStatusEffect(effect) {
        this.emit('newStatusEffect', effect);
        this.statusEffects.push({ durationLeftover: effect.duration, effect });
        this.refreshBodyAttributes();
    }
    life() {
        // Size
        this.coreSize = this.SIZE;
        // Invisibility
        if (!this.damageReceived && (this.velocity.x ** 2 + this.velocity.y ** 2 <= 0.1)) {
            this.alpha = Math.max(this.alphaRange[0], this.alpha - this.invisible[1]);
        } else {
            this.alpha = Math.min(this.alphaRange[1], this.alpha + this.invisible[0]);
        }

        let lastingEffects = [], needsBodyAttribRefresh = false;
        for (let i = 0; i < this.statusEffects.length; i++) {
            let entry = this.statusEffects[i];
            entry.durationLeftover -= 1 / Config.runSpeed;
            if (entry.durationLeftover > 0) {
                lastingEffects.push(entry);
            } else {
                needsBodyAttribRefresh = true;
                this.emit('expiredStatusEffect', entry.effect);
            }
            if (entry.effect.tick && entry.effect.tick(this, entry.effect, entry.durationLeftover)) {
                needsBodyAttribRefresh = true;
            }
        }
        this.statusEffects = lastingEffects;

        // Think
        let faucet = this.settings.independent || this.source == null || this.source === this ? {} : this.source.control,
            b = {
                target: remapTarget(faucet, this.source, this),
                goal: undefined,
                fire: faucet.fire,
                main: faucet.main,
                alt: faucet.alt,
                power: undefined,
            };
        // Seek attention
        if (this.settings.attentionCraver && !faucet.main && this.range) {
            this.range -= 1;
        }
        // So we start with my master's thoughts and then we filter them down through our control stack
        for (let i = 0; i < this.controllers.length; i++) {
            let AI = this.controllers[i],
                a = AI.think(b);
            if (a != null) {
                if (a.target != null && (b.target == null || AI.acceptsFromTop)) b.target = a.target;
                if (a.goal != null && (b.goal == null || AI.acceptsFromTop)) b.goal = a.goal;
                if (a.fire != null && (b.fire == null || AI.acceptsFromTop)) b.fire = a.fire;
                if (a.main != null && (b.main == null || AI.acceptsFromTop)) b.main = a.main;
                if (a.alt != null && (b.alt == null || AI.acceptsFromTop)) b.alt = a.alt;
                if (a.power != null && (b.power == null || AI.acceptsFromTop)) b.power = a.power;
            }
        }
        this.control.target = b.target == null ? this.control.target : b.target;
        this.control.goal = b.goal ? b.goal : { x: this.x, y: this.y };
        this.control.fire = b.fire ?? false;
        this.control.main = b.main ?? false;
        this.control.alt = b.alt ?? false;
        this.control.power = b.power == null ? 1 : b.power;

        if (this.invuln && (this.control.goal.x !== this.x || this.control.goal.y !== this.y)) {
            this.invuln = false;
        }

        // React
        this.move();
        this.face();
        // Handle guns and turrets if we've got them
        for (let i = 0; i < this.guns.length; i++) this.guns[i].live();
        for (let i = 0; i < this.turrets.length; i++) this.turrets[i].life();
        if (this.skill.maintain()) needsBodyAttribRefresh = true;
        if (needsBodyAttribRefresh) this.refreshBodyAttributes();
    }
    addController(newIO) {
        if (!Array.isArray(newIO)) newIO = [newIO];
        for (let oldId = 0; oldId < this.controllers.length; oldId++) {
            for (let newId = 0; newId < newIO.length; newId++) {
                let oldIO = this.controllers[oldId];
                let io = newIO[newId];

                if (io.constructor === oldIO.constructor) {
                    this.controllers[oldId] = io;
                    newIO.splice(newId, 1);
                }
            }
        }
        this.controllers = this.controllers.concat(newIO);
    }
    become(player, dom = false) {
        this.addController(new ioTypes.listenToPlayer(this, { player, static: dom })); // make it listen.
        this.sendMessage = (content, displayTime = Config.MESSAGE_DISPLAY_TIME) => player.socket.talk("m", displayTime, content); // make sure that it sends messages.
        this.kick = (reason) => player.socket.kick(reason);
    }
    giveUp(player, name = "Mothership") {
        if (!player.body.isMothership) {
            player.body.controllers = [
                new ioTypes.nearestDifferentMaster(player.body),
                new ioTypes.spin(player.body, { onlyWhenIdle: true }),
            ];
        } else {
            player.body.controllers = [
                new ioTypes.nearestDifferentMaster(player.body),
                new ioTypes.wanderAroundMap(player.body, { lookAtGoal: true }),
                new ioTypes.mapTargetToGoal(player.body),
            ];
        }
        player.body.name = player.body.label;
        player.body.underControl = false;
        let fakeBody = new Entity({ x: player.body.x, y: player.body.y });
        fakeBody.passive = true;
        fakeBody.underControl = true;
        player.body = fakeBody;
        player.body.kill();
    }
    define(defs, emitEvent = true) {
        if (!Array.isArray(defs)) defs = [defs];

        // Define all primary stats
        let set = ensureIsClass(defs[0]);
        this.store = {};
        for (let gun of this.guns) gun.store = {};

        if (set.PARENT != null) {
            if (Array.isArray(set.PARENT)) {
                for (let i = 0; i < set.PARENT.length; i++) {
                    this.define(set.PARENT[i], false);
                }
            } else {
                this.define(set.PARENT, false);
            }
        }
        if (set.LAYER != null) this.layerID = set.LAYER;
        if (set.index != null) this.index = set.index.toString();
        if (set.NAME != null) {
            this.name = set.NAME;
            if (this.socket) this.socket.talk("updateName", this.name);
        };
        if (set.LABEL != null) this.label = set.LABEL;
        if (set.ANGLE != null) this.angle = set.ANGLE;
        if (set.UPGRADE_LABEL != null) this.upgradeLabel = set.UPGRADE_LABEL;
        if (set.UPGRADE_TOOLTIP != null) this.upgradeTooltip = set.UPGRADE_TOOLTIP;
        if (set.DISPLAY_NAME != null) this.displayName = set.DISPLAY_NAME;
        if (set.TYPE != null) this.type = set.TYPE;
        if (set.SHAPE != null) {
            this.shape = typeof set.SHAPE === "number" ? set.SHAPE : 0;
            this.shapeData = set.SHAPE;
        }
        this.imageInterpolation = set.IMAGE_INTERPOLATION != null ? set.IMAGE_INTERPOLATION : 'bilinear'
        if (set.COLOR != null) {
            if (this.color === undefined) {
                console.log(this);
            }
            this.color.interpret(set.COLOR);
        }
        if (set.UPGRADE_COLOR) this.upgradeColor = new Color(set.UPGRADE_COLOR).compiled;
        if (set.GLOW != null) {
            this.glow = {
                radius: set.GLOW.RADIUS ?? 0,
                color: new Color(set.GLOW.COLOR).compiled,
                alpha: set.GLOW.ALPHA ?? 1,
                recursion: set.GLOW.RECURSION ?? 1
            };
        }
        if (set.IGNORED_BY_AI != null) this.ignoredByAi = set.IGNORED_BY_AI;
        if (set.MOTION_TYPE != null) {
            this.motionType = set.MOTION_TYPE;
            if (Array.isArray(this.motionType)) {
                this.motionTypeArgs = this.motionType[1];
                this.motionType = this.motionType[0];
            } else {
                this.motionTypeArgs = {};
            }
        }
        if (set.FACING_TYPE != null) {
            this.facingType = set.FACING_TYPE;
            if (Array.isArray(this.facingType)) {
                this.facingTypeArgs = this.facingType[1];
                this.facingType = this.facingType[0];
            } else {
                this.facingTypeArgs = {};
            }
        }
        if (set.CONTROLLERS != null) {
            let toAdd = [];
            for (let i = 0; i < set.CONTROLLERS.length; i++) {
                let io = set.CONTROLLERS[i];
                if ("string" == typeof io) io = [io];
                toAdd.push(new ioTypes[io[0]](this, io[1]));
            }
            this.addController(toAdd);
        }
        if (set.ALWAYS_ACTIVE != null) this.alwaysActive = set.ALWAYS_ACTIVE;
        if (set.MIRROR_MASTER_ANGLE != null) this.settings.mirrorMasterAngle = set.MIRROR_MASTER_ANGLE
        if (set.DRAW_HEALTH != null) this.settings.drawHealth = set.DRAW_HEALTH;
        if (set.DRAW_SELF != null) this.settings.drawShape = set.DRAW_SELF;
        if (set.DAMAGE_EFFECTS != null) this.settings.damageEffects = set.DAMAGE_EFFECTS;
        if (set.RATIO_EFFECTS != null) this.settings.ratioEffects = set.RATIO_EFFECTS;
        if (set.MOTION_EFFECTS != null) this.settings.motionEffects = set.MOTION_EFFECTS;
        if (set.ACCEPTS_SCORE != null) this.settings.acceptsScore = set.ACCEPTS_SCORE;
        if (set.GIVE_KILL_MESSAGE != null) this.settings.givesKillMessage = set.GIVE_KILL_MESSAGE;
        if (set.CAN_GO_OUTSIDE_ROOM != null) this.settings.canGoOutsideRoom = set.CAN_GO_OUTSIDE_ROOM;
        if (set.HITS_OWN_TYPE != null) this.settings.hitsOwnType = set.HITS_OWN_TYPE;
        if (set.DIE_AT_LOW_SPEED != null) this.settings.diesAtLowSpeed = set.DIE_AT_LOW_SPEED;
        if (set.DIE_AT_RANGE != null) this.settings.diesAtRange = set.DIE_AT_RANGE;
        if (set.INDEPENDENT != null) this.settings.independent = set.INDEPENDENT;
        if (set.PERSISTS_AFTER_DEATH != null) this.settings.persistsAfterDeath = set.PERSISTS_AFTER_DEATH;
        if (set.CLEAR_ON_MASTER_UPGRADE != null) this.settings.clearOnMasterUpgrade = set.CLEAR_ON_MASTER_UPGRADE;
        if (set.HEALTH_WITH_LEVEL != null) this.settings.healthWithLevel = set.HEALTH_WITH_LEVEL;
        if (set.ACCEPTS_SCORE != null) this.settings.acceptsScore = set.ACCEPTS_SCORE;
        if (set.OBSTACLE != null) this.settings.obstacle = set.OBSTACLE;
        if (set.HAS_NO_RECOIL) this.RECOIL_MULTIPLIER = 0;
        if (set.CRAVES_ATTENTION != null) this.settings.attentionCraver = set.CRAVES_ATTENTION;
        if (set.KILL_MESSAGE != null) this.settings.killMessage = set.KILL_MESSAGE === "" ? "Killed" : set.KILL_MESSAGE;
        if (set.AUTOSPIN_MULTIPLIER != null) this.autospinBoost = set.AUTOSPIN_MULTIPLIER;
        if (set.BROADCAST_MESSAGE != null) this.settings.broadcastMessage = set.BROADCAST_MESSAGE === "" ? undefined : set.BROADCAST_MESSAGE;
        if (set.DEFEAT_MESSAGE) this.settings.defeatMessage = true;
        if (set.HEALER) this.healer = true;
        if (set.DAMAGE_CLASS != null) this.settings.damageClass = set.DAMAGE_CLASS;
        if (set.BUFF_VS_FOOD != null) this.settings.buffVsFood = set.BUFF_VS_FOOD;
        if (set.CAN_BE_ON_LEADERBOARD != null) this.settings.leaderboardable = set.CAN_BE_ON_LEADERBOARD;
        if (set.INTANGIBLE != null) this.intangibility = set.INTANGIBLE;
        if (set.IS_SMASHER != null) this.settings.reloadToAcceleration = set.IS_SMASHER;
        if (set.STAT_NAMES != null) this.settings.skillNames = {
            body_damage: set.STAT_NAMES?.BODY_DAMAGE ?? 'Body Damage',
            max_health: set.STAT_NAMES?.MAX_HEALTH ?? 'Max Health',
            bullet_speed: set.STAT_NAMES?.BULLET_SPEED ?? 'Bullet Speed',
            bullet_health: set.STAT_NAMES?.BULLET_HEALTH ?? 'Bullet Health',
            bullet_pen: set.STAT_NAMES?.BULLET_PEN ?? 'Bullet Penetration',
            bullet_damage: set.STAT_NAMES?.BULLET_DAMAGE ?? 'Bullet Damage',
            reload: set.STAT_NAMES?.RELOAD ?? 'Reload',
            move_speed: set.STAT_NAMES?.MOVE_SPEED ?? 'Movement Speed',
            shield_regen: set.STAT_NAMES?.SHIELD_REGEN ?? 'Shield Regeneration',
            shield_cap: set.STAT_NAMES?.SHIELD_CAP ?? 'Shield Capacity',
        };
        if (set.AI != null) this.aiSettings = set.AI;
        if (set.INVISIBLE != null) this.invisible = set.INVISIBLE;
        if (set.SYNC_WITH_TANK != null) {
            this.settings.syncWithTank = set.SYNC_WITH_TANK;
            if (this.socket) this.socket.talk("I", !!set.SYNC_WITH_TANK);
        }
        if (set.ALPHA != null) {
            this.alpha = ("number" === typeof set.ALPHA) ? set.ALPHA : set.ALPHA[1];
            this.alphaRange = [
                set.ALPHA[0] || 0,
                set.ALPHA[1] || 1
            ];
        }
        if (set.STROKE_WIDTH != null) this.strokeWidth = set.STROKE_WIDTH
        if (set.DANGER != null) this.dangerValue = set.DANGER;
        if (set.SHOOT_ON_DEATH != null) this.shootOnDeath = set.SHOOT_ON_DEATH;
        if (set.BORDERLESS != null) this.borderless = set.BORDERLESS;
        if (set.DRAW_FILL != null) this.drawFill = set.DRAW_FILL;
        if (set.IS_IMMUNE_TO_TILES) this.immuneToTiles = set.IS_IMMUNE_TO_TILES;
        if (set.TEAM != null) {
            this.team = set.TEAM;
            if (sockets.players.length) {
                for (let i = 0; i < sockets.players.length; i++) {
                    const player = sockets.players[i];
                    if (player.body && player.body.id == this.id) {
                        player.team = this.team;
                    }
                }
            }
            for (let child of this.children) child.team = set.TEAM;
        }
        if (set.VARIES_IN_SIZE != null) {
            this.settings.variesInSize = set.VARIES_IN_SIZE;
            this.squiggle = this.settings.variesInSize ? ran.randomRange(0.8, 1.2) : 1;
        }
        if (set.RESET_UPGRADES || set.RESET_STATS) {
            let caps = this.skill.caps.map(x => x);
            this.skill.setCaps(Array(10).fill(0));
            this.skill.setCaps(caps);
            this.upgrades = [];
            this.isArenaCloser = false;
            this.alpha = 1;
            this.reset();
        }
        if (set.RESET_UPGRADE_MENU) this.upgrades = []
        if (set.ARENA_CLOSER != null) this.isArenaCloser = set.ARENA_CLOSER;
        if (set.BRANCH_LABEL != null) this.branchLabel = set.BRANCH_LABEL;
        if (set.BATCH_UPGRADES != null) this.batchUpgrades = set.BATCH_UPGRADES;
        for (let i = 0; i < Config.MAX_UPGRADE_TIER; i++) {
            let tierProp = 'UPGRADES_TIER_' + i;
            if (set[tierProp] != null && emitEvent) {
                for (let j = 0; j < set[tierProp].length; j++) {
                    let upgrades = set[tierProp][j];
                    let index = "";
                    if (!Array.isArray(upgrades)) upgrades = [upgrades];
                    let redefineAll = upgrades.includes(true);
                    let trueUpgrades = upgrades.slice(0, upgrades.length - redefineAll); // Ignore last element if it's true
                    for (let k of trueUpgrades) {
                        let e = ensureIsClass(k);
                        index += e.index + "-";
                    }
                    this.upgrades.push({
                        class: trueUpgrades,
                        level: Config.TIER_MULTIPLIER * i,
                        index: index.substring(0, index.length - 1),
                        tier: i,
                        branch: 0,
                        branchLabel: this.branchLabel,
                        redefineAll,
                    });
                }
            }
        }
        if (set.SIZE != null) {
            this.SIZE = set.SIZE * this.squiggle;
            if (this.coreSize == null) this.coreSize = this.SIZE;
        }
        if (set.LEVEL_CAP != null) {
            this.levelCap = set.LEVEL_CAP;
        }
        if ("function" === typeof set.LEVEL_SKILL_POINT_FUNCTION) {
            this.skill.LSPF = set.LEVEL_SKILL_POINT_FUNCTION;
        }
        if (set.LEVEL != null) {
            this.skill.reset(false);
            while (this.skill.level < set.LEVEL) {
                this.skill.score += this.skill.levelScore;
                this.skill.maintain();
            }
            this.refreshBodyAttributes();
        }
        if (set.SKILL_CAP != null && set.SKILL_CAP != []) {
            if (set.SKILL_CAP.length != 10) throw "Inappropiate skill cap amount.";
            this.skill.setCaps(set.SKILL_CAP);
        }
        if (set.SKILL != null && set.SKILL != []) {
            if (set.SKILL.length != 10) throw "Inappropiate skill raws.";
            this.skill.set(set.SKILL);
            this.syncSkillsToGuns();
        }
        if (set.VALUE != null) this.skill.score = Math.max(this.skill.score, set.VALUE * this.squiggle);
        if (set.ALT_ABILITIES != null) this.abilities = set.ALT_ABILITIES;
        if (set.GUNS != null) {
            let newGuns = [];
            for (let i = 0; i < set.GUNS.length; i++) {
                newGuns.push(new Gun(this, set.GUNS[i]));
            }
            this.guns = newGuns;
        }
        if (set.GUN_STAT_SCALE) {
            this.gunStatScale = set.GUN_STAT_SCALE;
        }
        if (set.NECRO != null) {
            this.settings.necroTypes = Array.isArray(set.NECRO) ? set.NECRO : set.NECRO ? [this.shape] : [];

            // Necro function for tanks
            this.settings.necroDefineGuns = {};
            for (let shape of this.settings.necroTypes) {
                // Pick the first gun with the right necroType to use for stats and use its defineBullet function
                this.settings.necroDefineGuns[shape] = this.guns.filter((gun) => gun.bulletType.NECRO && (gun.bulletType.NECRO === shape || (gun.bulletType.NECRO === true && gun.bulletType.SHAPE === this.shape) || gun.bulletType.NECRO.includes(shape)))[0];
            }

            this.necro = (host) => {
                let gun = this.settings.necroDefineGuns[host.shape];
                if (!gun || !gun.checkShootPermission()) return false;

                let savedFacing = host.facing;
                let savedSize = host.SIZE;
                
                host.controllers = [];
                host.define("genericEntity");
                gun.defineBullet(host);
                host.team = this.master.master.team;
                host.master = this.master;
                host.color.base = this.color.base;
                host.facing = savedFacing;
                host.SIZE = savedSize;
                host.health.amount = host.health.max;
                return true;
            }
        }
        if (set.MAX_CHILDREN != null) this.maxChildren = set.MAX_CHILDREN;
        if (set.RESET_CHILDREN) this.destroyAllChildren();
        if (set.RECALC_SKILL != null) {
            let score = this.skill.score;
            this.skill.reset();
            this.skill.score = score;
            while (this.skill.maintain()) { }
        }
        if (set.EXTRA_SKILL != null) {
            this.skill.points += set.EXTRA_SKILL;
        }
        if (set.BODY != null) {
            if (set.BODY.ACCELERATION != null) this.ACCELERATION = set.BODY.ACCELERATION;
            if (set.BODY.SPEED != null) this.SPEED = set.BODY.SPEED;
            if (set.BODY.HEALTH != null) this.HEALTH = set.BODY.HEALTH;
            if (set.BODY.RESIST != null) this.RESIST = set.BODY.RESIST;
            if (set.BODY.SHIELD != null) this.SHIELD = set.BODY.SHIELD;
            if (set.BODY.REGEN != null) this.REGEN = set.BODY.REGEN;
            if (set.BODY.DAMAGE != null) this.DAMAGE = set.BODY.DAMAGE;
            if (set.BODY.PENETRATION != null) this.PENETRATION = set.BODY.PENETRATION;
            if (set.BODY.RANGE != null) this.RANGE = set.BODY.RANGE;
            if (set.BODY.FOV != null) this.FOV = set.BODY.FOV;
            if (set.BODY.SHOCK_ABSORB != null) this.SHOCK_ABSORB = set.BODY.SHOCK_ABSORB;
            if (set.BODY.RECOIL_MULTIPLIER != null) this.RECOIL_MULTIPLIER = set.BODY.RECOIL_MULTIPLIER;
            if (set.BODY.DENSITY != null) this.DENSITY = set.BODY.DENSITY;
            if (set.BODY.STEALTH != null) this.STEALTH = set.BODY.STEALTH;
            if (set.BODY.PUSHABILITY != null) this.PUSHABILITY = set.BODY.PUSHABILITY;
            if (set.BODY.HETERO != null) this.heteroMultiplier = set.BODY.HETERO;
            this.refreshBodyAttributes();
        }
        if (set.SPAWN_ON_DEATH) this.spawnOnDeath = set.SPAWN_ON_DEATH;
        if (set.RESET_EVENTS) {
            for (let { event, handler, once } of this.definitionEvents) {
                this.removeListener(event, handler, once);
            }
            this.definitionEvents = [];
        }
        if (set.REROOT_UPGRADE_TREE) this.rerootUpgradeTree = set.REROOT_UPGRADE_TREE;
        if (Array.isArray(this.rerootUpgradeTree)) {
            let finalRoot = "";
            for (let root of this.rerootUpgradeTree) finalRoot += root + "\\/";
            this.rerootUpgradeTree = finalRoot.substring(0, finalRoot.length - 2);
        }
        if (set.ON_MINIMAP != null) this.allowedOnMinimap = set.ON_MINIMAP;
        if (set.TURRETS != null) {
            for (let i = 0; i < this.turrets.length; i++) {
                this.turrets[i].destroy();
            }
            this.turrets = [];
            for (let i = 0; i < set.TURRETS.length; i++) {
                let def = set.TURRETS[i],
                    o = new Entity(this, this.master),
                    turretDanger = false,
                    type = Array.isArray(def.TYPE) ? def.TYPE : [def.TYPE];
                for (let j = 0; j < type.length; j++) {
                    o.define(type[j]);
                    if (type.TURRET_DANGER) turretDanger = true;
                }
                if (!turretDanger) o.define({ DANGER: 0 });
                o.collidingBond = def.VULNERABLE
                o.bindToMaster(def.POSITION, this, def.VULNERABLE);
            }
        }
        if (set.PROPS != null) {
            this.props = [];
            for (let i = 0; i < set.PROPS.length; i++) {
                let def = set.PROPS[i],
                    o = new Prop(def.POSITION, this),
                    type = Array.isArray(def.TYPE) ? def.TYPE : [def.TYPE];
                for (let j = 0; j < type.length; j++) {
                    o.define(type[j]);
                }
            }
        }

        if (set.ON != null) {
            for (let { event, handler, once = false } of set.ON) {
                this.definitionEvents.push({ event, handler, once });
                this.on(event, handler, once);
            }
        }
        this.reverseTargetWithTank = set.REVERSE_TARGET_WITH_TANK ?? false;
        if (set.mockup != null) {
            this.mockup = set.mockup;
        }

        if (emitEvent) {
            this.emit('define', { body: this, set });
        }

        this.defs = [];
        for (let def of defs) this.defs.push(def);

        // Define additional stats for other split upgrades
        for (let branch = 1; branch < defs.length; branch++) {
            set = ensureIsClass(defs[branch]);

            if (set.index != null) this.index += "-" + set.index;
            if (set.PARENT != null) {
                if (Array.isArray(set.PARENT)) {
                    for (let i = 0; i < set.PARENT.length; i++) {
                        this.branchLabel = ensureIsClass(set.PARENT[i]).BRANCH_LABEL;
                    }
                } else {
                    this.branchLabel = ensureIsClass(set.PARENT).BRANCH_LABEL;
                }
            }
            if (set.LABEL != null && set.LABEL.length > 0) this.label = this.label + "-" + set.LABEL;
            if (set.MAX_CHILDREN != null) this.maxChildren += set.MAX_CHILDREN;
            else this.maxChildren = null; // For bullet and drone combos so all parts remain functional
            if (set.BODY != null) {
                if (set.BODY.ACCELERATION != null) this.ACCELERATION *= set.BODY.ACCELERATION;
                if (set.BODY.SPEED != null) this.SPEED *= set.BODY.SPEED;
                if (set.BODY.HEALTH != null) this.HEALTH *= set.BODY.HEALTH;
                if (set.BODY.RESIST != null) this.RESIST *= set.BODY.RESIST;
                if (set.BODY.SHIELD != null) this.SHIELD *= set.BODY.SHIELD;
                if (set.BODY.REGEN != null) this.REGEN *= set.BODY.REGEN;
                if (set.BODY.DAMAGE != null) this.DAMAGE *= set.BODY.DAMAGE;
                if (set.BODY.PENETRATION != null) this.PENETRATION *= set.BODY.PENETRATION;
                if (set.BODY.RANGE != null) this.RANGE *= set.BODY.RANGE;
                if (set.BODY.FOV != null) this.FOV *= set.BODY.FOV;
                if (set.BODY.SHOCK_ABSORB != null) this.SHOCK_ABSORB *= set.BODY.SHOCK_ABSORB;
                if (set.BODY.RECOIL_MULTIPLIER != null) this.RECOIL_MULTIPLIER *= set.BODY.RECOIL_MULTIPLIER;
                if (set.BODY.DENSITY != null) this.DENSITY *= set.BODY.DENSITY;
                if (set.BODY.STEALTH != null) this.STEALTH *= set.BODY.STEALTH;
                if (set.BODY.PUSHABILITY != null) this.PUSHABILITY *= set.BODY.PUSHABILITY;
                if (set.BODY.HETERO != null) this.heteroMultiplier *= set.BODY.HETERO;
                this.refreshBodyAttributes();
            }
            if (set.GUNS != null) {
                let newGuns = [];
                for (let i = 0; i < set.GUNS.length; i++) {
                    newGuns.push(new Gun(this, set.GUNS[i]));
                }
                this.guns.push(...newGuns);
            }
            if (set.TURRETS != null) {
                for (let i = 0; i < set.TURRETS.length; i++) {
                    let def = set.TURRETS[i],
                        o = new Entity(this, this.master),
                        turretDanger = false,
                        type = Array.isArray(def.TYPE) ? def.TYPE : [def.TYPE];
                    for (let j = 0; j < type.length; j++) {
                        o.define(type[j]);
                        if (type.TURRET_DANGER) turretDanger = true;
                        o.isTurret = true;
                    }
                    if (!turretDanger) o.define({ DANGER: 0 });
                    o.bindToMaster(def.POSITION, this);
                }
            }
            if (set.PROPS != null) {
                for (let i = 0; i < set.PROPS.length; i++) {
                    let def = set.PROPS[i],
                        o = new Prop(def.POSITION, this),
                        type = Array.isArray(def.TYPE) ? def.TYPE : [def.TYPE];
                    for (let j = 0; j < type.length; j++) {
                        o.define(type[j]);
                    }
                }
            }
            if (set.SIZE != null) {
                this.SIZE *= set.SIZE * this.squiggle;
                if (this.coreSize == null) this.coreSize = this.SIZE;
            }
            if (set.CONTROLLERS != null) {
                let toAdd = [];
                for (let i = 0; i < set.CONTROLLERS.length; i++) {
                    let io = set.CONTROLLERS[i];
                    if ("string" == typeof io) io = [io];
                    toAdd.push(new ioTypes[io[0]](this, io[1]));
                }
                this.addController(toAdd);
            }
            if (set.BATCH_UPGRADES != null) this.batchUpgrades = set.BATCH_UPGRADES;
            for (let i = 0; i < Config.MAX_UPGRADE_TIER; i++) {
                let tierProp = 'UPGRADES_TIER_' + i;
                if (set[tierProp] != null && emitEvent) {
                    for (let j = 0; j < set[tierProp].length; j++) {
                        let upgrades = set[tierProp][j];
                        let index = "";
                        if (!Array.isArray(upgrades)) upgrades = [upgrades];
                        let redefineAll = upgrades.includes(true);
                        let trueUpgrades = upgrades.slice(0, upgrades.length - redefineAll); // Ignore last element if it's true
                        for (let k of trueUpgrades) {
                            let e = ensureIsClass(k);
                            index += e.index + "-";
                        }
                        this.upgrades.push({
                            class: trueUpgrades,
                            level: Config.TIER_MULTIPLIER * i,
                            index: index.substring(0, index.length - 1),
                            tier: i,
                            branch,
                            branchLabel: this.branchLabel,
                            redefineAll,
                        });
                    }
                }
            }
            if (set.REROOT_UPGRADE_TREE) this.rerootUpgradeTree = set.REROOT_UPGRADE_TREE;
            if (Array.isArray(this.rerootUpgradeTree)) {
                let finalRoot = "";
                for (let root of this.rerootUpgradeTree) finalRoot += root + "\\/";
                this.rerootUpgradeTree += finalRoot.substring(0, finalRoot.length - 2);
            }
        }

        // Batch upgrades
        if (this.batchUpgrades && emitEvent) {
            this.tempUpgrades = [];
            let numBranches = this.defs.length;
            for (let i = 0; i < numBranches; i++) { // Create a 2d array for the upgrades (1st index is branch index)
                this.tempUpgrades.push([]);
            }
            for (let upgrade of this.upgrades) {
                let upgradeBranch = upgrade.branch;
                this.tempUpgrades[upgradeBranch].push(upgrade);
            }

            this.upgrades = [];
            this.selection = JSON.parse(JSON.stringify(this.defs));
            this.chooseUpgradeFromBranch(numBranches); // Recursively build upgrade options
        }
    }
    chooseUpgradeFromBranch(remaining) {
        if (remaining > 0) { // If there's more to select
            let branchUgrades = this.tempUpgrades[this.defs.length - remaining];
            for (let i = 0; i < branchUgrades.length; i++) { // Pick all possible options and continue selecting
                this.selection[this.defs.length - remaining] = branchUgrades[i];
                this.chooseUpgradeFromBranch(remaining - 1);
            }
            if (branchUgrades.length == 0) // For when the branch has no upgrades
                this.chooseUpgradeFromBranch(remaining - 1);
        } else { // If there's nothing more to select
            let upgradeClass = [],
                upgradeTier = 0,
                upgradeIndex = "";
            for (let u of this.selection) {
                upgradeClass.push(u.class);
                upgradeIndex += u.index + '-';
                upgradeTier = Math.max(upgradeTier, u.tier);
            }
            this.upgrades.push({
                class: upgradeClass,
                level: Config.TIER_MULTIPLIER * upgradeTier,
                index: upgradeIndex.substring(0, upgradeIndex.length - 1),
                tier: upgradeTier,
                branch: 0,
                branchLabel: "",
                redefineAll: true,
            });
        }
    }
    refreshBodyAttributes() {
        let accelerationMultiplier = 1,
            topSpeedMultiplier = 1,
            healthMultiplier = 1,
            shieldMultiplier = 1,
            regenMultiplier = 1,
            damageMultiplier = 1,
            penetrationMultiplier = 1,
            rangeMultiplier = 1,
            fovMultiplier = 1,
            densityMultiplier = 1,
            stealthMultiplier = 1,
            pushabilityMultiplier = 1,
            sizeMultiplier = 1,
            recoilReceivedMultiplier = 1;
        for (let i = 0; i < this.statusEffects.length; i++) {
            let effect = this.statusEffects[i].effect;
            if (effect.acceleration != null) accelerationMultiplier *= effect.acceleration;
            if (effect.topSpeed != null) topSpeedMultiplier *= effect.topSpeed;
            if (effect.health != null) healthMultiplier *= effect.health;
            if (effect.shield != null) shieldMultiplier *= effect.shield;
            if (effect.regen != null) regenMultiplier *= effect.regen;
            if (effect.damage != null) damageMultiplier *= effect.damage;
            if (effect.penetration != null) penetrationMultiplier *= effect.penetration;
            if (effect.range != null) rangeMultiplier *= effect.range;
            if (effect.fov != null) fovMultiplier *= effect.fov;
            if (effect.density != null) densityMultiplier *= effect.density;
            if (effect.stealth != null) stealthMultiplier *= effect.stealth;
            if (effect.pushability != null) pushabilityMultiplier *= effect.pushability;
            if (effect.recoilReceived != null) recoilReceivedMultiplier *= effect.recoilReceived;
            if (effect.size != null) sizeMultiplier *= effect.size;
        }

        this.sizeMultiplier = sizeMultiplier;
        let speedReduce = Math.pow(this.size / (this.coreSize || this.SIZE), 1);
        this.acceleration = (accelerationMultiplier * Config.runSpeed * this.ACCELERATION) / speedReduce;
        if (this.settings.reloadToAcceleration) this.acceleration *= this.skill.acl;
        this.topSpeed = (topSpeedMultiplier * Config.runSpeed * this.SPEED * this.skill.mob) / speedReduce;
        if (this.settings.reloadToAcceleration) this.topSpeed /= Math.sqrt(this.skill.acl);
        this.health.set(((this.settings.healthWithLevel ? 2 * this.level : 0) + this.HEALTH) * this.skill.hlt * healthMultiplier);
        this.health.resist = 1 - 1 / Math.max(1, this.RESIST + this.skill.brst);
        this.shield.set(((this.settings.healthWithLevel ? 0.6 * this.level : 0) + this.SHIELD) * this.skill.shi, Math.max(0, ((this.settings.healthWithLevel ? 0.006 * this.level : 0) + 1) * this.REGEN * this.skill.rgn * regenMultiplier));
        this.damage = damageMultiplier * this.DAMAGE * this.skill.atk;
        this.penetration = penetrationMultiplier * (this.PENETRATION + 1.5 * (this.skill.brst + 0.8 * (this.skill.atk - 1)));
        if (!this.settings.dieAtRange || !this.range) this.range = rangeMultiplier * this.RANGE;
        this.fov = fovMultiplier * this.FOV * 275 * Math.sqrt(this.size);
        this.density = densityMultiplier * (1 + 0.08 * this.level) * this.DENSITY;
        this.stealth = stealthMultiplier * this.STEALTH;
        this.pushability = pushabilityMultiplier * this.PUSHABILITY;
        this.recoilMultiplier = this.RECOIL_MULTIPLIER * recoilReceivedMultiplier;
        if (Config.SPACE_PHYSICS) {
            this.maxSpeed = this.topSpeed;
            this.damp = 100;
        }
        this.scaledAcceleration = this.acceleration / Config.runSpeed;
    }
    bindToMaster(position, bond, isInvulnerable) {
        this.bond = bond;
        this.source = bond;
        this.bond.turrets.push(this);
        this.skill = this.bond.skill;
        this.label = this.label.length ? this.bond.label + " " + this.label : this.bond.label;
        // It will not be in collision calculations any more nor shall it be seen or continue to run independently.
        if (!isInvulnerable) {
            this.removeFromGrid();
            this.skipLife = true;
        }
        // TODO: FIX CLIENT MAKING EVERYTHING FLASH WHEN A VULN TURRET DIES, and display health
        if (isInvulnerable) this.on('dead', () => { util.remove(this.master.turrets, this.master.turrets.indexOf(this)) })
        this.settings.drawShape = false;
        // Get my position.
        if (Array.isArray(position)) {
            position = {
                SIZE: position[0],
                X: position[1],
                Y: position[2],
                ANGLE: position[3],
                ARC: position[4],
                LAYER: position[5]
            };
        }
        position.SIZE ??= 10;
        position.X ??= 0;
        position.Y ??= 0;
        position.ANGLE ??= 0;
        position.ARC ??= 360;
        position.LAYER ??= 0;
        let _off = new Vector(position.X, position.Y);
        this.bound = {
            size: position.SIZE / 20,
            angle: position.ANGLE * Math.PI / 180,
            direction: _off.direction,
            offset: _off.length / 10,
            arc: position.ARC * Math.PI / 180,
            layer: position.LAYER
        };
        // Initalize.
        this.activation.update();
        this.facing = this.bond.facing + this.bound.angle;
        if (this.facingType.includes('Target') || this.facingType.includes('Speed')) {
            this.facingType = "bound";
            this.facingTypeArgs = {};
        }
        this.motionType = "bound";
        this.motionTypeArgs = {};
        this.syncSkillsToGuns();
        this.move();
    }
    get level() {
        return Math.min(this.levelCap ?? Config.LEVEL_CAP, this.skill.level);
    }
    get size() {
        return this.bond == null ? (this.coreSize || this.SIZE) * this.sizeMultiplier * (1 + this.level / 45) : this.bond.size * this.bound.size;
    }
    get mass() {
        return this.density * (this.size ** 2 + 1);
    }
    get realSize() {
        return this.size * lazyRealSizes[Math.floor(Math.abs(this.shape))];
    }
    get xMotion() {
        return (this.velocity.x + this.accel.x) / Config.runSpeed;
    }
    get yMotion() {
        return (this.velocity.y + this.accel.y) / Config.runSpeed;
    }
    set gunStatScale(gunStatScale) {
        if (!Array.isArray(gunStatScale)) {
            gunStatScale = [gunStatScale];
        }
        for (let gun of this.guns) {
            if (!gun.shootSettings) {
                continue
            }
            gun.shootSettings = combineStats([gun.shootSettings, ...gunStatScale]);
            gun.trueRecoil = gun.shootSettings.recoil;
            gun.calculateBulletStats();
        }
    }
    camera(tur = false) {
        let turretsAndProps = this.turrets.concat(this.props);
        // Turret layer ordering
        turretsAndProps.sort((a, b) => a.bound.layer - b.bound.layer);
        return {
            type: 0 + tur * 0x01 + this.settings.drawHealth * 0x02 + (this.type === "tank" && this.displayName) * 0x04,
            invuln: this.invuln,
            id: this.id,
            index: this.index,
            label: this.label,
            x: this.x,
            y: this.y,
            vx: this.velocity.x,
            vy: this.velocity.y,
            size: this.size,
            realSize: this.realSize,
            status: 1,
            health: this.health.display(),
            shield: this.shield.display(),
            healthN: this.health.amount,
            maxHealthN: this.health.max,
            alpha: this.alpha,
            facing: this.facing,
            direction: this.bound ? this.bound.direction : 0,
            angle: this.bound ? this.bound.angle : 0,
            offset: this.bound ? this.bound.offset : 0,
            sizeFactor: this.bound ? this.bound.size : 1,
            mirrorMasterAngle: this.settings.mirrorMasterAngle ?? false,
            perceptionAngleIndependence: this.perceptionAngleIndependence,
            defaultAngle: this.firingArc[0],
            twiggle: forceTwiggle.includes(this.facingType) || (this.facingType === "locksFacing" && this.control.alt),
            layer: this.layerID ? this.layerID : this.bond != null ? this.bound.layer : this.type === "wall" ? 11 : this.type === "food" ? 10 : this.type === "tank" ? 5 : this.type === "crasher" ? 1 : 0,
            color: this.color.compiled,
            strokeWidth: this.strokeWidth,
            borderless: this.borderless,
            drawFill: this.drawFill,
            name: (this.nameColor || "#FFFFFF") + this.name,
            score: this.skill.score,
            guns: this.guns.map((gun) => gun.getPhotoInfo()),
            turrets: turretsAndProps.map((turret) => turret.camera(true)),
            glow: this.glow,
        };
    }
    syncTurrets() {
        for (let i = 0; i < this.guns.length; i++) this.guns[i].syncGunStats();
        for (let i = 0; i < this.turrets.length; i++) {
            this.turrets[i].skill = this.skill;
            this.turrets[i].refreshBodyAttributes();
            this.turrets[i].syncTurrets();
        }
    }
    skillUp(stat) {
        let suc = this.skill.upgrade(stat);
        if (suc) {
            this.refreshBodyAttributes();
            this.syncSkillsToGuns();
        }
        return suc;
    }
    syncSkillsToGuns() {
        for (let i = 0; i < this.guns.length; i++) this.guns[i].syncGunStats();
        for (let i = 0; i < this.turrets.length; i++) this.turrets[i].syncTurrets();
    }
    upgrade(number, branchId) {
        // Account for upgrades that are too high level for the player to access
        for (let i = 0; i < branchId; i++) {
            number += this.skippedUpgrades[i] ?? 0;
        }
        if (
            number < this.upgrades.length &&
            this.skill.level >= this.upgrades[number].level
        ) {
            let upgrade = this.upgrades[number],
                upgradeClass = upgrade.class,
                upgradeBranch = upgrade.branch,
                redefineAll = upgrade.redefineAll;
            if (redefineAll) {
                for (let i = 0; i < upgradeClass.length; i++) {
                    upgradeClass[i] = ensureIsClass(...upgradeClass[i]);
                }
                this.upgrades = [];
                this.define(upgradeClass);
            } else {
                this.defs.splice(upgradeBranch, 1, ...upgradeClass);
                this.upgrades = [];
                this.define(this.defs);
            }
            this.emit("upgrade", { body: this });
            if (this.color.base == '-1' || this.color.base == 'mirror') {
                if (Config.GROUPS || (Config.MODE == 'ffa' && !Config.TAG)) {
                    this.color.base = this.isBot ? "darkGrey" : getTeamColor(TEAM_RED);
                } else {
                    this.color.base = getTeamColor(this.team);
                }
            }
            this.sendMessage("You have upgraded to " + this.label + ".");
            for (let def of this.defs) {
                def = ensureIsClass(def);
                if (typeof def.TOOLTIP == 'string' && def.TOOLTIP.length > 0) {
                    let tooltips = Array.isArray(def.TOOLTIP) ? def.TOOLTIP : [def.TOOLTIP];
                    for (let i = tooltips.length; i--;) this.sendMessage(tooltips[i]);
                }
            }
            this.destroyAllChildren();
            this.skill.update();
            this.syncTurrets();
            this.refreshBodyAttributes();
        }
    }
    destroyAllChildren() {
        for (let instance of entities) {
            if (
                instance.settings.clearOnMasterUpgrade &&
                instance.master.id === this.id
            ) {
                instance.kill();
            }
        }
    }
    damageMultiplier() {
        switch (this.type) {
            case "swarm":
                return 0.25 + 1.5 * util.clamp(this.range / (this.RANGE + 1), 0, 1);
            default:
                return 1;
        }
    }
    move() {
        let g = {
            x: this.control.goal.x - this.x,
            y: this.control.goal.y - this.y,
        },
            gactive = g.x !== 0 || g.y !== 0,
            engine = {
                x: 0,
                y: 0,
            };
        switch (this.motionType) {
            case "grow":
                this.SIZE += this.motionTypeArgs.growSpeed ?? 1;
                break;
            case "fastgrow":
                this.SIZE += this.motionTypeArgs.growSpeed ?? 5;
                break;
            case "glide":
                this.maxSpeed = this.topSpeed;
                this.damp = this.motionTypeArgs.damp ?? 0.05;
                break;
            case "motor":
                this.maxSpeed = 0;
                if (this.topSpeed) {
                    this.damp = Math.abs(this.scaledAcceleration) / this.topSpeed;
                }
                if (gactive) {
                    let len = Math.sqrt(g.x ** 2 + g.y ** 2);
                    engine = {
                        x: (this.scaledAcceleration * g.x) / len,
                        y: (this.scaledAcceleration * g.y) / len,
                    };
                }
                break;
            case "spgw":
                this.SIZE += this.motionTypeArgs.growSpeed ?? 0.75;
                this.maxSpeed = this.topSpeed;
                this.damp = this.motionTypeArgs.damp ?? -0.025;
                break;
            case "chonk":
                this.SIZE += this.motionTypeArgs.growSpeed ?? 50;
                this.maxSpeed = this.topSpeed;
                this.damp = this.motionTypeArgs.damp ?? -0.025;
                break;
            case "swarm":
                this.maxSpeed = this.topSpeed;
                let l = Math.sqrt(g.x ** 2 + g.y ** 2) + 1;
                if (gactive && l > this.size) {
                    let XvelDesired = (this.topSpeed * g.x) / l,
                        YvelDesired = (this.topSpeed * g.y) / l,
                        turning = Math.sqrt(
                            (this.topSpeed * Math.max(1, this.range) + 1) / this.scaledAcceleration
                        );
                    engine = {
                        x: (XvelDesired - this.velocity.x) / Math.max(5, turning),
                        y: (YvelDesired - this.velocity.y) / Math.max(5, turning),
                    };
                } else {
                    if (this.velocity.length < this.topSpeed) {
                        engine = {
                            x: (this.velocity.x * this.scaledAcceleration) / 20,
                            y: (this.velocity.y * this.scaledAcceleration) / 20,
                        };
                    }
                }
                break;
            case "chase":
                // No DIV/0 protection because it's already protected against
                let length = Math.sqrt(g.x ** 2 + g.y ** 2);
                if (length > this.size * 2) {
                    this.maxSpeed = this.topSpeed;
                    let XvelDesired = (this.topSpeed * g.x) / length,
                        YvelDesired = (this.topSpeed * g.y) / length;
                    engine = {
                        x: (XvelDesired - this.velocity.x) * this.scaledAcceleration,
                        y: (YvelDesired - this.velocity.y) * this.scaledAcceleration,
                    };
                } else {
                    this.maxSpeed = 0;
                }
                break;
            case "drift":
                this.maxSpeed = 0;
                engine = {
                    x: g.x * this.scaledAcceleration,
                    y: g.y * this.scaledAcceleration,
                };
                break;
            case "bound":
                let bound = this.bound,
                    ref = this.bond;
                this.x = ref.x + ref.size * bound.offset * Math.cos(bound.direction + bound.angle + ref.facing);
                this.y = ref.y + ref.size * bound.offset * Math.sin(bound.direction + bound.angle + ref.facing);
                ref.velocity.x += bound.size * this.accel.x * ref.recoilMultiplier;
                ref.velocity.y += bound.size * this.accel.y * ref.recoilMultiplier;
                this.velocity = ref.velocity;
                this.firingArc = [ref.facing + bound.angle, bound.arc / 2];
                this.accel.null();
                this.blend = ref.blend;
                break;
            case "withMaster":
                this.x = this.source.x;
                this.y = this.source.y;
                this.velocity.x = this.source.velocity.x;
                this.velocity.y = this.source.velocity.y;
                break;
            case 'assembler':
                this.alpha -= 0.02;
                this.SIZE += 0.17;
                if (this.alpha <= 0) {
                    this.kill();
                    if (this.SIZE > 50) {
                        this.destroy();
                    }
                }
                break;
            case "desmos":
                this.damp = 0;
                let save = {
                    x: this.master.x,
                    y: this.master.y,
                };
                let target = {
                    x: this.master.x + this.master.control.target.x,
                    y: this.master.y + this.master.control.target.y,
                };
                let amount = (util.getDistance(target, save) / 100) | 0;
                if (this.waveReversed == null) this.waveReversed = this.master.control.alt ? -1 : 1;
                if (this.waveAngle == null) {
                    this.waveAngle = this.master.facing;
                    this.velocity.x = ((5 + this.velocity.length * (amount + 2)) * Math.cos(this.waveAngle)) / 7;
                    this.velocity.y = ((5 + this.velocity.length * (amount + 2)) * Math.sin(this.waveAngle)) / 7;
                }
                let waveX = this.maxSpeed * 5 * Math.cos((this.RANGE - this.range) / (this.motionTypeArgs.period ?? 4) * 2);
                let waveY = (this.motionTypeArgs.amplitude ?? 15) * Math.cos((this.RANGE - this.range) / (this.motionTypeArgs.period ?? 4)) * this.waveReversed * (this.motionTypeArgs.invert ? -1 : 1);
                this.x += Math.cos(this.waveAngle) * waveX - Math.sin(this.waveAngle) * waveY;
                this.y += Math.sin(this.waveAngle) * waveX + Math.cos(this.waveAngle) * waveY;
                break;
        }
        this.accel.x += engine.x * this.control.power;
        this.accel.y += engine.y * this.control.power;
    }
    reset(keepPlayerController = true) {
        this.controllers = keepPlayerController ? [this.controllers.filter(con => con instanceof ioTypes.listenToPlayer)[0]] : [];
    }
    face() {
        let t = this.control.target,
            oldFacing = this.facing;
        switch (this.facingType) {
            case "turnWithSpeed":
                this.facing += ((this.velocity.length / 90) * Math.PI) / Config.runSpeed;
                break;
            case "autospin":
                this.facing += (this.facingTypeArgs.speed ?? 0.02) / Config.runSpeed;
                break;
            case "spin":
                this.facing += (this.facingTypeArgs.speed ?? 0.05) / Config.runSpeed;
                break;
            case "fastspin":
                this.facing += (this.facingTypeArgs.speed ?? 0.1) / Config.runSpeed;
                break;
            case "veryfastspin":
                this.facing += (this.facingTypeArgs.speed ?? 1) / Config.runSpeed;
                break;
            case "withMotion":
                this.facing = this.velocity.direction;
                break;
            case "smoothWithMotion":
            case "looseWithMotion":
                this.facing = util.interpolateAngle(this.facing, this.velocity.direction, Config.runSpeed / (this.facingTypeArgs.speed ?? 4));
                break;
            case "withTarget":
            case "toTarget":
                let reverse = this.reverseTargetWithTank ? 1 : this.reverseTank;
                this.facing = Math.atan2(t.y * reverse, t.x * reverse);
                break;
            case "locksFacing":
                if (!this.control.alt) this.facing = Math.atan2(t.y, t.x);
                break;
            case "looseWithTarget":
            case "looseToTarget":
            case "smoothToTarget":
                this.facing = util.interpolateAngle(this.facing, Math.atan2(t.y, t.x), Config.runSpeed / (this.facingTypeArgs.speed ?? 4));
                break;
            case "noFacing":
                this.facing = this.facingTypeArgs.angle ?? 0;
                break;
            case "bound":
                let angleToTarget, angleDiff = 3,
                    reduceIndependence = false,
                    slowness = this.settings.mirrorMasterAngle ? 1 : (this.facingTypeArgs.slowness ?? 4) / Config.runSpeed;
                if (this.control.main) {
                    angleToTarget = Math.atan2(t.y, t.x);
                    angleDiff = Math.abs(util.angleDifference(angleToTarget, this.firingArc[0]));
                    if (angleDiff >= this.firingArc[1]) {
                        angleToTarget = this.firingArc[0];
                        reduceIndependence = true;
                    }
                } else {
                    angleToTarget = this.firingArc[0];
                    reduceIndependence = true;
                }
                if (reduceIndependence) {
                    this.perceptionAngleIndependence -= 0.3 / Config.runSpeed;
                    if (this.perceptionAngleIndependence < 0) {
                        this.perceptionAngleIndependence = 0;
                    }
                } else {
                    this.perceptionAngleIndependence += 0.3 / Config.runSpeed;
                    if (this.perceptionAngleIndependence > 1) {
                        this.perceptionAngleIndependence = 1;
                    }
                }
                this.facing = util.interpolateAngle(this.facing, angleToTarget, Math.min(1, 1 / (slowness * Math.min(1, angleDiff))));
                break;
        }
        this.facing += this.turnAngle;
        // Loop
        if (this.facingLocked) {
            this.facing = oldFacing;
        } else {
            // note: double mod is just as expensive as simple add/subtract - it's not that bad
            this.facing = ((this.facing % Math.TAU) + Math.TAU) % Math.TAU;
        }
    }
    takeSelfie() {
        this.flattenedPhoto = null;
        this.photo = this.settings.drawShape ? this.camera() : undefined;
    }
    physics() {
        if (this.accel.x == null || this.velocity.x == null) {
            util.error("Void Error!");
            util.error(this.collisionArray);
            util.error(this.label);
            util.error(this);
            this.accel.null();
            this.velocity.null();
        }
        // Apply acceleration
        this.velocity.x += this.accel.x;
        this.velocity.y += this.accel.y;
        // Reset acceleration
        this.accel.null();
        // Apply motion
        this.x += (this.stepRemaining * this.velocity.x) / Config.runSpeed;
        this.y += (this.stepRemaining * this.velocity.y) / Config.runSpeed;
        this.stepRemaining = 1;
        if (Config.SPACE_PHYSICS) this.stepRemaining = 2;
    }
    friction() {
        var motion = this.velocity.length,
            excess = motion - this.maxSpeed;
        if (excess > 0 && this.damp) {
            var k = this.damp / Config.runSpeed,
                drag = excess / (k + 1),
                finalvelocity = this.maxSpeed + drag;
            if (Config.SPACE_PHYSICS)
                finalvelocity *= this.type === "bullet" ? 1.005 : 1.1;
            this.velocity.x = (finalvelocity * this.velocity.x) / motion;
            this.velocity.y = (finalvelocity * this.velocity.y) / motion;
        }
    }
    confinementToTheseEarthlyShackles() {
        if (this.x == null || this.x == null) {
            util.error("Void Error!");
            util.error(this.collisionArray);
            util.error(this.label);
            util.error(this);
            this.accel.null();
            this.velocity.null();
            return 0;
        }
        if (!this.settings.canGoOutsideRoom) {
            if (Config.ARENA_TYPE === "circle") {
                let centerPoint = {
                    x: room.width / 2,
                    y: room.height / 2,
                }, dist = util.getDistance(this, centerPoint);
                if (dist > room.width / 2) {
                    let strength = (dist - room.width / 2) * Config.ROOM_BOUND_FORCE / (Config.runSpeed * 750);
                    this.x = util.lerp(this.x, centerPoint.x, strength);
                    this.y = util.lerp(this.y, centerPoint.y, strength);
                }
            } else {
                let padding = this.realSize - 50;
                this.accel.x -= Math.max(this.x + padding - this.confinement.xMax, Math.min(this.x - padding - this.confinement.xMin, 0)) * Config.ROOM_BOUND_FORCE / Config.runSpeed;
                this.accel.y -= Math.max(this.y + padding - this.confinement.yMax, Math.min(this.y - padding - this.confinement.yMin, 0)) * Config.ROOM_BOUND_FORCE / Config.runSpeed;
            }
        }
    }
    contemplationOfMortality() {
        if (this.invuln) {
            this.damageReceived = 0;
            return 0;
        }
        if (this.damageReceived > 0) {
            let damageInflictor = []
            let damageTool = []

            for (let i = 0; i < this.collisionArray.length; i++) {
                let instance = this.collisionArray[i];
                if (instance.type === 'wall' || !instance.damage) continue;
                damageInflictor.push(instance.master)
                damageTool.push(instance)
            }
            this.emit('damage', { body: this, damageInflictor, damageTool });
        }
        // Life-limiting effects
        if (this.settings.diesAtRange) {
            this.range -= 1 / Config.runSpeed;
            if (this.range < 0) {
                this.kill();
            }
        }
        if (this.settings.diesAtLowSpeed) {
            if (
                !this.collisionArray.length &&
                this.velocity.length < this.topSpeed / 2
            ) {
                this.health.amount -= this.health.getDamage(1 / Config.runSpeed);
            }
        }
        // Shield regen and damage
        if (this.shield.max) {
            if (this.damageReceived) {
                let shieldDamage = this.shield.getDamage(this.damageReceived);
                this.damageReceived -= shieldDamage;
                this.shield.amount -= shieldDamage;
            }
        }
        // Health damage
        if (this.damageReceived) {
            let healthDamage = this.health.getDamage(this.damageReceived);
            this.blend.amount = 1;
            this.health.amount -= healthDamage;
        }
        this.damageReceived = 0;
        // Check for death
        if (this.isDead()) {

            this.emit('dead');

            //Shoot on death
            for (let i = 0; i < this.guns.length; i++) {
                let gun = this.guns[i];
                if (gun.shootOnDeath && gun.body != null) {
                    gun.fire();
                }
            }

            // MEMORY LEAKS ARE BAD!!!!
            for (let i = 0; i < this.turrets.length; i++) {
                this.turrets[i].kill();
            }

            // Initalize message arrays
            let killers = [],
                killTools = [],
                notJustFood = false;
            // If I'm a tank, call me a nameless player
            let name = this.master.name == ""
                ? this.master.type === "tank"
                    ? "an unnamed " + this.label : this.master.type === "miniboss"
                        ? "a visiting " + this.label : this.label.substring(0, 3) == 'The'
                            ? this.label : util.addArticle(this.label)
                : this.master.name + "'s " + this.label;
            // Calculate the jackpot
            let jackpot = util.getJackpot(this.skill.score) / this.collisionArray.length;
            // Now for each of the things that kill me...
            for (let i = 0; i < this.collisionArray.length; i++) {
                let instance = this.collisionArray[i];
                if (instance.type === 'wall' || !instance.damage) continue;
                if (instance.master.settings.acceptsScore) {
                    // If it's not food, give its master the score
                    if (instance.master.type === "tank" || instance.master.type === "miniboss") {
                        notJustFood = true;
                    }
                    instance.master.skill.score += jackpot;
                    killers.push(instance.master); // And keep track of who killed me
                } else if (instance.settings.acceptsScore) {
                    instance.skill.score += jackpot;
                }
                killTools.push(instance); // Keep track of what actually killed me
            }
            // Remove duplicates
            killers = killers.filter((elem, index, self) => index == self.indexOf(elem));
            this.emit('death', { body: this, killers, killTools });
            killers.forEach((e) => e.emit('kill', { body: e, entity: this }));
            // If there's no valid killers (you were killed by food), change the message to be more passive
            let killText = "You have been killed by ",
                doISendAText = this.settings.givesKillMessage;

            for (let i = 0; i < killers.length; i++) {
                let instance = killers[i];

                switch (this.type) {
                    case "tank":
                        killers.length > 1 ? instance.killCount.assists++ : instance.killCount.solo++;
                        break;

                    case "food":
                    case "crasher":
                        instance.killCount.polygons++;
                        break

                    case "miniboss":
                        instance.killCount.bosses++;
                        break;
                }

                this.killCount.killers.push(instance.index);
            };
            // Add the killers to our death message, also send them a message
            if (notJustFood) {
                for (let i = 0; i < killers.length; i++) {
                    let instance = killers[i];
                    if (instance.master.type !== "food" && instance.master.type !== "crasher") {
                        killText += instance.name == "" ? killText == "" ? "An unnamed player" : "an unnamed player" : instance.name;
                        killText += " and ";
                    }
                    // Only if we give messages
                    if (doISendAText) {
                        instance.sendMessage("You killed " + name + (killers.length > 1 ? " (with some help)." : "."));
                    }
                    if (this.settings.killMessage) {
                        instance.sendMessage("You " + this.settings.killMessage + " " + name + (killers.length > 1 ? " (with some help)." : "."));
                    }
                }
                // Prepare the next part of the next
                killText = killText.slice(0, -4) + "killed you with ";
            }
            // Broadcast
            if (this.settings.broadcastMessage) {
                sockets.broadcast(this.settings.broadcastMessage);
            }
            if (this.settings.defeatMessage) {
                let text = util.addArticle(this.label, true);
                if (notJustFood) {
                    text += " has been defeated by";
                    for (let { name } of killers) {
                        text += " ";
                        text += name === "" ? "an unnamed player" : name;
                        text += " and";
                    }
                    text = text.slice(0, -4);
                    text += "!";
                } else {
                    text += " fought a polygon... and the polygon won.";
                }
                sockets.broadcast(text);
            }

            // instead of "a Machine Gunner Bullet and a Machine Gunner Bullet and a Machine Gunner Bullet",
            // make it say " 3 Machine Gunner Bullets"
            let killCounts = {};
            for (let { label } of killTools) {
                if (!killCounts[label]) killCounts[label] = 0;
                killCounts[label]++;
            }
            let killCountEntries = Object.entries(killCounts).map(([name, count], i) => name);
            for (let i = 0; i < killCountEntries.length; i++) {
                killText += (killCounts[killCountEntries[i]] == 1) ? util.addArticle(killTools[i].label) : killCounts[killCountEntries[i]] + ' ' + killCountEntries[i] + 's';
                killText += i < killCountEntries.length - 2 ? ', ' : ' and ';
            }

            // Prepare it and clear the collision array.
            killText = killText.slice(0, -5);
            if (killText === "You have been kille") {
                killText = "You have died a stupid death";
            }
            if (!this.dontSendDeathMessage) {
                this.sendMessage(killText + ".");
            }
            // If I'm the leader, broadcast it:
            if (this.id === room.topPlayerID) {
                let usurptText = this.name === "" ? "The leader" : this.name;
                if (notJustFood) {
                    usurptText += " has been usurped by";
                    for (let i = 0; i < killers.length; i++) {
                        usurptText += " ";
                        usurptText += killers[i].name === "" ? "an unnamed player" : killers[i].name;
                        usurptText += " and";
                    }
                    usurptText = usurptText.slice(0, -4) + "!";
                } else {
                    usurptText += " fought a polygon... and the polygon won.";
                }
                sockets.broadcast(usurptText);
            }
            this.setKillers(killers);
            // Kill it
            return 1;
        }
        return 0;
    }
    protect() {
        entitiesToAvoid.push(this);
        this.isProtected = true;
    }
    say(message, duration = Config.CHAT_MESSAGE_DURATION) {
        if (!chats[this.id]) {
            chats[this.id] = [];
        }
        chats[this.id].unshift({ message, expires: Date.now() + duration });
    }
    sendMessage(message) { } // Dummy
    setKillers(killers) { } // Dummy
    kill() {
        this.invuln = false;
        this.health.amount = -100;
    }
    destroy() {
        // Remove from the protected entities list
        if (this.isProtected) {
            util.remove(entitiesToAvoid, entitiesToAvoid.indexOf(this));
        }
        // Remove from minimap
        let i = minimap.findIndex(entry => entry[0] === this.id);
        if (i != -1) {
            util.remove(minimap, i);
        }
        // Remove this from views
        for (let view of views) {
            view.remove(this);
        }
        // Remove from parent lists if needed
        if (this.parent != null) {
            util.remove(this.parent.children, this.parent.children.indexOf(this));
        }
        // Kill all of its children
        for (let instance of entities) {
            if (instance.source.id === this.id) {
                if (instance.settings.persistsAfterDeath) {
                    instance.source = instance;
                } else {
                    instance.kill();
                }
            }
            if (instance.parent && instance.parent.id === this.id) {
                instance.parent = null;
            }
            if (instance.master.id === this.id) {
                instance.kill();
                instance.master = instance;
            }
        }
        // Remove everything bound to it
        for (let i = 0; i < this.turrets.length; i++) {
            this.turrets[i].destroy();
        }
        // Remove from the collision grid
        this.removeFromGrid();
        this.isGhost = true;
    }
    isDead() {
        return this.health.amount <= 0;
    }
}
module.exports = { StatusEffect, Gun, Entity };
