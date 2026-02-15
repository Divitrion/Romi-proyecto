AFRAME.registerComponent('smooth-follow', {
  schema: { factor: { default: 0.15 } },
  init() {
    this.targetPos = new THREE.Vector3();
  },
  tick() {
    this.targetPos.copy(this.el.object3D.position);
    this.el.object3D.position.lerp(this.targetPos, this.data.factor);
  }
});

AFRAME.registerComponent('holo-parallax', {
  schema: {
    posIntensity: { default: 0.05 }, // desplazamiento
    rotIntensity: { default: 5 }     // rotación en grados
  },
  tick: function () {
    const cam = this.el.sceneEl.camera;
    if (!cam) return;

    const rot = cam.rotation;

    // desplazamiento
    this.el.object3D.position.x = rot.y * this.data.posIntensity;
    this.el.object3D.position.y = rot.x * this.data.posIntensity;

    // rotación sutil
    this.el.object3D.rotation.y = rot.y * this.data.rotIntensity;
    this.el.object3D.rotation.x = rot.x * this.data.rotIntensity;
  }
});

AFRAME.registerComponent('fake-shadow', {
  schema: {
    intensity: { default: 0.05 }, // cuánto se desplaza
    opacity: { default: 0.35 }
  },
  init() {
    this.cam = this.el.sceneEl.camera;
  },
  tick() {
    if (!this.cam) return;

    const rot = this.cam.rotation;

    // mover en dirección opuesta
    this.el.object3D.position.x = -rot.y * this.data.intensity;
    this.el.object3D.position.y = -rot.x * this.data.intensity;
  }
});


AFRAME.registerShader('holofoil-distort', {
  schema: {
    timeMsec: { type: 'time', is: 'uniform' }
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,

  fragmentShader: `
    varying vec2 vUv;
    uniform float timeMsec;

    void main() {
      float t = timeMsec / 1000.0;

      // ruido procedural simple
      float noise =
        sin(vUv.x * 20.0 + t * 1.2) *
        cos(vUv.y * 25.0 + t * 0.8);

      // distorsión UV
      vec2 uv = vUv + noise * 0.02;

      // gradiente iridiscente
      float wave = sin((uv.x + t * 0.15) * 12.0) * 0.5 + 0.5;

      vec3 c1 = vec3(0.1, 0.9, 1.0);
      vec3 c2 = vec3(1.0, 0.2, 0.9);
      vec3 c3 = vec3(0.9, 1.0, 0.2);

      vec3 holo = mix(c1, c2, wave);
      holo = mix(holo, c3, sin(uv.y * 12.0 + t) * 0.5 + 0.5);

      // brillo central suave
      float glow = smoothstep(0.8, 0.2, length(uv - 0.5));

      gl_FragColor = vec4(holo + glow * 0.2, 0.35);
    }
  `
});