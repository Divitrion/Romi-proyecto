AFRAME.registerComponent('smooth-follow', {
  schema: { factor: { default: 0.3 } },
  init() {
    this.targetPos = new THREE.Vector3();
  },
  tick() {
    this.targetPos.copy(this.el.object3D.position);
    this.el.object3D.position.lerp(this.targetPos, this.data.factor);
  }
});

AFRAME.registerComponent('view-parallax', {
  schema: {
    intensity: { default: 0.3 },
    rotIntensity: { default: 10 },
    maxRot: { default: 15 }
  },

  init() {
    this.basePosition = this.el.object3D.position.clone();
    this.objPos = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.lastTick = 0;
  },

  tick(time) {
    if (time - this.lastTick < 32) return;
    this.lastTick = time;

    const camPos = this.el.sceneEl.systems['camera-tracker'].camPos;

    this.el.object3D.getWorldPosition(this.objPos);
    this.dir.copy(this.objPos).sub(camPos).normalize();

    this.el.object3D.position.x = this.basePosition.x - this.dir.x * this.data.intensity;
    this.el.object3D.position.y = this.basePosition.y - this.dir.y * this.data.intensity;
    this.el.object3D.position.z = this.basePosition.z;

    const maxRad = THREE.MathUtils.degToRad(this.data.maxRot);
    this.el.object3D.rotation.y = THREE.MathUtils.clamp(this.dir.x * this.data.rotIntensity, -maxRad, maxRad);
    this.el.object3D.rotation.x = THREE.MathUtils.clamp(this.dir.y * this.data.rotIntensity, -maxRad, maxRad);
  }
});

AFRAME.registerComponent('fake-shadow', {
  schema: {
    intensity: { default: 0.05 },
    opacity: { default: 0.35 }
  },

  init() {
    this.cam = this.el.sceneEl.camera;
    this.basePos = null;
    this.lastTick = 0;

    setTimeout(() => {
      this.basePos = this.el.object3D.position.clone();
    }, 150);
  },

  tick(time) {
    if (time - this.lastTick < 32) return;
    this.lastTick = time;

    if (!this.cam || !this.basePos) return;

    const rot = this.cam.rotation;
    this.el.object3D.position.x += -rot.y * this.data.intensity;
    this.el.object3D.position.y += -rot.x * this.data.intensity;
  }
});


AFRAME.registerShader('holo-card', {
  schema: {
    map:  { type: 'map',   is: 'uniform' },
    time: { type: 'time',  is: 'uniform' },
    rot:  { type: 'vec3',  is: 'uniform', default: {x:0,y:0,z:0} }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix *
                    modelViewMatrix *
                    vec4(position,1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D map;
    uniform float time;
    uniform vec3 rot;
    varying vec2 vUv;

    // shift hue by a given amount (simple RGB↔YIQ conversion)
    vec3 hueShift(vec3 c, float shift) {
      const mat3 toYIQ = mat3(
         0.299, 0.587, 0.114,
         0.596,-0.274,-0.322,
         0.211,-0.523, 0.312
      );
      const mat3 toRGB = inverse(toYIQ);
      vec3 yiq = toYIQ * c;
      float hue   = atan(yiq.z, yiq.y);
      float chrom = length(yiq.yz);
      hue += shift;
      yiq.y = chrom * cos(hue);
      yiq.z = chrom * sin(hue);
      return toRGB * yiq;
    }

    void main() {
      vec4 base = texture2D(map, vUv);
      // use Y‑rotation as the driving parameter
      float angle = rot.y;                 // radians, –π…π
      float shift = sin(angle*2.0 + time*3.0) * 0.5;
      float stripe = sin((vUv.x+vUv.y + time*5.0 + angle)*50.0)
                     * 0.5 + 0.5;
      vec3 holo = mix(base.rgb, hueShift(base.rgb, shift), stripe);
      gl_FragColor = vec4(holo, base.a);
    }
  `
});

// component that keeps the shader uniform up to date
AFRAME.registerComponent('sync-rotation', {
  tick: function () {
    const r = this.el.object3D.rotation;
    // material.rot is the uniform defined above
    this.el.setAttribute('material', 'rot', `${r.x} ${r.y} ${r.z}`);
  }
});

AFRAME.registerShader('lamp-glow', {
  schema: {
    map:          { type: 'map',  is: 'uniform' },
    time:         { type: 'time', is: 'uniform' },
    glowColor:    { type: 'color', is: 'uniform', default: '#ffffee' },
    glowWidth:    { type: 'number', is: 'uniform', default: 0.6 },
    pulseSpeed:   { type: 'number', is: 'uniform', default: 0 },  // 0 = no pulsation
    glowIntensity:{ type: 'number', is: 'uniform', default: 1.0 },// multiplier for brightness
    full:         { type: 'boolean', is: 'uniform', default: false } // ignore radial falloff
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position =
        projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D map;
    uniform float time;
    uniform vec3 glowColor;       // acts as a tint/scale (white = no tint)
    uniform float glowWidth;
    uniform float pulseSpeed;
    uniform float glowIntensity;
    uniform bool full;            // if true, apply glow across entire plane
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(map, vUv);

      float glow;
      if (full) {
        // brighten entire quad uniformly
        glow = 1.0;
      } else {
        float dist = distance(vUv, vec2(0.5));
        // correct ordering: inner half → outer width
        glow = smoothstep(glowWidth * 0.5, glowWidth, dist);
      }

      // use a controllable pulse speed; zero disables animation
      float pulse = 1.0;
      if (pulseSpeed != 0.0) {
        pulse = 1.0 + 0.5 * sin(time * pulseSpeed);
      }
      // only apply glow where the source texture is opaque
      // base.rgb drives the colour; glowColor tints/brightens it
      vec3 add = base.rgb * glowColor * glow * pulse * glowIntensity * base.a;
      // clamp to avoid oversaturation
      add = min(add, vec3(1.0));

      gl_FragColor = vec4(base.rgb + add, base.a);
    }
  `
});

// helper component that attaches a little point‑light to the entity
AFRAME.registerComponent('lamp-light', {
  schema: {
    color:     { type: 'color', default: '#ffffee' },
    intensity: { type: 'number', default: 2 },        // bump default for visibility
    distance:  { type: 'number', default: 2 }
  },
  init: function () {
    const lightEl = document.createElement('a-entity');
    lightEl.setAttribute('light',
      `type: point; color: ${this.data.color};
       intensity: ${this.data.intensity};
       distance: ${this.data.distance}`);
    // position the light slightly in front of the plane so it can
    // illuminate nearby faces instead of being exactly coplanar
    lightEl.setAttribute('position', '0 0 0.1');
    this.el.appendChild(lightEl);
  }
});


window.addEventListener("DOMContentLoaded", () => {

  const scene = document.querySelector("a-scene");

  scene.addEventListener("loaded", () => {
    const maskEl = document.querySelector("#mask");
    const contentEl = document.querySelector("#content");
    const mask = maskEl?.getObject3D("mesh");
    const content = contentEl?.getObject3D("mesh");

    if (mask) {
      mask.material = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp
      });
    }

    if (content) {
      content.material = new THREE.MeshBasicMaterial({
        color: "red",
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.EqualStencilFunc
      });
    }
  });
  
});

AFRAME.registerComponent('stencil-mask', {
  init() {
    const el = this.el;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 512, 512);
    ctx.clearRect(128, 128, 256, 256); // hueco transparente en el centro
    
    const testTex = new THREE.CanvasTexture(canvas);
    this.applied = false;

    const apply = () => {
      const mesh = el.getObject3D('mesh');
      if (!mesh) return;

      const tex = mesh.material.map;
      if (!tex) return;
      

      mesh.material = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          varying vec2 vUv;
          void main() {
            vec4 color = texture2D(map, vUv);
            if (color.a < 0.1) discard;
            gl_FragColor = vec4(0.0);
          }
        `,
        colorWrite: false,
        depthTest: true,
        depthWrite: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp
      });

      mesh.renderOrder = 1;

      mesh.onBeforeRender = (renderer) => {
        const gl = renderer.getContext();
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xFF);
      };

      this.applied = true;
    };

    el.addEventListener('materialtextureloaded', apply);
    if (el.getObject3D('mesh')) apply();
    else el.addEventListener('object3dset', apply);
    
  },
  
  tick() {
    if (!this.applied) return;

    const mesh = this.el.getObject3D('mesh');
    if (!mesh) return;

    // Si A-Frame pisó el material, lo detectamos y lo volvemos a aplicar
    if (mesh.material.stencilWrite !== true) {
      console.warn('A-Frame pisó el material, reaplicando...');
      this.applied = false;
    }
  }
});

AFRAME.registerComponent('stencil-content', {
  init() {
    const el = this.el;

    const apply = () => {
      const mesh = el.getObject3D('mesh');
      if (!mesh) return;

      const mat = mesh.material;

      mat.stencilWrite = true;
      mat.stencilRef = 1;
      mat.stencilFunc = THREE.EqualStencilFunc;
      mat.stencilFail = THREE.KeepStencilOp;
      mat.stencilZFail = THREE.KeepStencilOp;
      mat.stencilZPass = THREE.KeepStencilOp;

      mat.depthTest = false;
      mat.depthWrite = false;

      mat.needsUpdate = true;
      

      const htmlOrder = parseInt(el.getAttribute('render-order')) || 0;
      mesh.renderOrder = 10 + htmlOrder;

      mesh.onBeforeRender = (renderer) => {
        const gl = renderer.getContext();
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xFF);
      };
    };


    if (el.getObject3D('mesh')) apply();
    else el.addEventListener('object3dset', apply);
  }
});

AFRAME.registerComponent('setup-stencil', {
  init() {
    const scene = this.el.sceneEl;
    const apply = () => {
      scene.renderer.autoClearStencil = false;
      console.log('autoClearStencil:', scene.renderer.autoClearStencil); // verificar
    };

    if (scene.renderer) apply();
    else scene.addEventListener('renderstart', apply);
  }
});

AFRAME.registerComponent('stencil-debug', {
  tick() {
    const gl = this.el.sceneEl.renderer.getContext();
    // Fuerza que el stencil test esté habilitado
    gl.enable(gl.STENCIL_TEST);
    console.log('stencil test enabled:', gl.getParameter(gl.STENCIL_TEST));
  }
});

AFRAME.registerComponent('stencil-ignore', {
  init() {
    const el = this.el;

    const apply = () => {
      const mesh = el.getObject3D('mesh');
      if (!mesh) return;

      mesh.renderOrder = 25; // forzar acá directamente

      mesh.onBeforeRender = (renderer) => {
        const gl = renderer.getContext();
        gl.disable(gl.STENCIL_TEST);
      };

      mesh.onAfterRender = (renderer) => {
        const gl = renderer.getContext();
        gl.enable(gl.STENCIL_TEST);
      };
    };

    if (el.getObject3D('mesh')) apply();
    else el.addEventListener('object3dset', apply);
    el.addEventListener('materialtextureloaded', apply);
  }
});

AFRAME.registerComponent('debug-marco', {
  tick() {
    const mesh = this.el.getObject3D('mesh');
    if (!mesh) return;
  }
});

AFRAME.registerComponent('parallax', {
  schema: {
    strength: { type: 'number', default: 0.1 },
    maxOffset: { type: 'number', default: 0.2 },
    smoothing: { type: 'number', default: 0.1 }
  },

  init() {
    this.objPos = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.currentOffset = new THREE.Vector2(0, 0);
    this.basePosition = null;
    this.lastTick = 0;

    setTimeout(() => {
      this.basePosition = this.el.object3D.position.clone();
    }, 100);
  },

  tick(time) {
    if (time - this.lastTick < 32) return; // ~30fps
    this.lastTick = time;

    if (!this.basePosition) return;

    const camPos = this.el.sceneEl.systems['camera-tracker'].camPos;

    this.el.object3D.getWorldPosition(this.objPos);
    this.dir.copy(this.objPos).sub(camPos).normalize();

    const targetOffsetX = THREE.MathUtils.clamp(
      -this.dir.x * this.data.strength,
      -this.data.maxOffset,
      this.data.maxOffset
    );
    const targetOffsetY = THREE.MathUtils.clamp(
      -this.dir.y * this.data.strength,
      -this.data.maxOffset,
      this.data.maxOffset
    );

    this.currentOffset.x += (targetOffsetX - this.currentOffset.x) * this.data.smoothing;
    this.currentOffset.y += (targetOffsetY - this.currentOffset.y) * this.data.smoothing;

    this.el.object3D.position.x = this.basePosition.x + this.currentOffset.x;
    this.el.object3D.position.y = this.basePosition.y + this.currentOffset.y;
  }
});

AFRAME.registerShader('smoke', {
  schema: {
    color: { type: 'color', default: '#272626', is: 'uniform' },
    opacity: { type: 'number', default: 0.6, is: 'uniform' },
    time: { type: 'time', default: 0, is: 'uniform' },
    speed: { type: 'number', default: 0.5, is: 'uniform' },
    scale: { type: 'number', default: 3.0, is: 'uniform' }
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

fragmentShader: `
    uniform float opacity;
    uniform float time;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1,0)), f.x),
        mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
        f.y
      );
    }

    float fbm(vec2 p) {
      float v = 0.0;
      v += 0.5000 * noise(p);
      v += 0.2500 * noise(p * 2.0);
      v += 0.1250 * noise(p * 4.0);
      v += 0.0625 * noise(p * 8.0);
      return v;
    }

    void main() {
      vec2 uv = vUv;
      float t = time * 0.0005;

      vec2 movingUv = vec2(uv.x - t * 0.5, uv.y - t);

      vec2 smokeUv = vec2(
        movingUv.x + fbm(movingUv * 2.0 + t) * 0.5,
        movingUv.y + fbm(movingUv * 2.0 - t) * 0.5
      );

      float smoke = fbm(smokeUv * 2.0) * 1.5;

      float distX = abs(uv.x - 0.5) * 2.0;
      float distY = uv.y;

      float shape = (1.0 - distX * distX) * (1.0 - distY * 0.8);

      float alpha = smoke * shape * opacity;
      alpha = smoothstep(0.05, 0.45, alpha);

      // Negro abajo, color claro arriba
      vec3 black = vec3(0.0, 0.0, 0.0);
      vec3 smokeColor = vec3(0.1, 0.1, 0.1);
      vec3 finalColor = mix(black, smokeColor, smoothstep(0.0, 0.6, uv.y));

      gl_FragColor = vec4(finalColor, alpha);
    }
  `
});

AFRAME.registerSystem('camera-tracker', {
  init() {
    this.camPos = new THREE.Vector3();
    this.camera = null;
  },

  tick() {
    if (!this.camera) {
      this.camera = this.el.camera;
      if (!this.camera) return;
    }
    this.camera.getWorldPosition(this.camPos);
  }
});