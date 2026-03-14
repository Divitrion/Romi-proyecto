AFRAME.registerComponent('smooth-follow', {
  schema: { factor: { default: 0.5 } },
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
    rotIntensity: { default: 10 }
  },

  init() {
    // Guardamos la posición original
    this.basePosition = this.el.object3D.position.clone();
  },

  tick() {
    const cam = this.el.sceneEl.camera;
    if (!cam) return;

    const objPos = new THREE.Vector3();
    const camPos = new THREE.Vector3();

    this.el.object3D.getWorldPosition(objPos);
    cam.getWorldPosition(camPos);

    const dir = objPos.clone().sub(camPos).normalize();

    // Aplicamos offset sobre la posición base
    this.el.object3D.position.x = this.basePosition.x - dir.x * this.data.intensity;
    this.el.object3D.position.y = this.basePosition.y - dir.y * this.data.intensity;
    this.el.object3D.position.z = this.basePosition.z;

    this.el.object3D.rotation.y = dir.x * this.data.rotIntensity;
    this.el.object3D.rotation.x = dir.y * this.data.rotIntensity;
  }
});

AFRAME.registerComponent('fake-shadow', {
  schema: {
    intensity: { default: 0.05 },
    opacity: { default: 0.35 }
  },

  init() {
    this.cam = this.el.sceneEl.camera;

    // guardar posición base
    this.basePos = this.el.object3D.position.clone();
  },

  tick() {
    if (!this.cam) return;

    const rot = this.cam.rotation;

    const offsetX = -rot.y * this.data.intensity;
    const offsetY = -rot.x * this.data.intensity;

    this.el.object3D.position.set(
      this.basePos.x + offsetX,
      this.basePos.y + offsetY,
      this.basePos.z
    );
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

      mat.depthTest = true;
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
    strength: { type: 'number', default: 0.1 }
  },

  init() {
    this.objPos = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
  },

  tick() {
    const cam = this.el.sceneEl.camera;
    if (!cam) return;

    this.el.object3D.getWorldPosition(this.objPos);
    cam.getWorldPosition(this.camPos);

    const dir = this.objPos.clone().sub(this.camPos).normalize();

    this.el.object3D.position.x -= dir.x * this.data.strength;
    this.el.object3D.position.y -= dir.y * this.data.strength;
  }
});