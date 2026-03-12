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


AFRAME.registerShader('holofoil-distort', {
  schema: {
    timeMsec: { type: 'time', is: 'uniform' },
    map: { type: 'map', is: 'uniform' }
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

    uniform sampler2D map;
    uniform float timeMsec;

    
    void main() {

      float t = timeMsec / 1000.0;

      vec4 base = texture2D(map, vUv);

      float noise =
        sin(vUv.x * 20.0 + t * 1.2) *
        cos(vUv.y * 25.0 + t * 0.8);

      vec2 uv = vUv + noise * 0.02;

      float wave = sin((uv.x + t * 0.2) * 10.0) * 0.5 + 0.5;

      vec3 c1 = vec3(0.1, 0.9, 1.0);
      vec3 c2 = vec3(1.0, 0.2, 0.9);
      vec3 c3 = vec3(0.9, 1.0, 0.2);

      vec3 holo = mix(c1, c2, wave);
      holo = mix(holo, c3, sin(uv.y * 10.0 + t) * 0.5 + 0.5);

      // intensidad del foil
      float foilStrength = 0.2;

      vec3 finalColor = mix(base.rgb, holo, foilStrength);

      gl_FragColor = vec4(finalColor, base.a);
    }
  `
});

AFRAME.registerShader("tcg-foil", {
  schema: {
    map: { type: "map", is: "uniform" },
    timeMsec: { type: "time", is: "uniform" }
  },

  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main(){

      vUv = uv;

      vec4 worldPos = modelMatrix * vec4(position,1.0);

      vNormal = normalize(normalMatrix * normal);
      vViewDir = normalize(cameraPosition - worldPos.xyz);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,

  fragmentShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    uniform sampler2D map;
    uniform float timeMsec;

    float foilIntensity = 0.35;
    float sparkleIntensity = 0.25;
    float specIntensity = 0.2;

    void main(){

      vec4 base = texture2D(map, vUv);

      float t = timeMsec * 0.001;

      // ángulo cámara-superficie
      float angle = dot(vNormal, vViewDir);

      // arco iris iridiscente
      float hue = angle * 6.0;

      vec3 rainbow = vec3(
        sin(hue) * 0.5 + 0.5,
        sin(hue + 2.0) * 0.5 + 0.5,
        sin(hue + 4.0) * 0.5 + 0.5
      );

      // brillo tipo luz (specular)
      float spec = pow(max(angle,0.0),6.0);

      // patrón diagonal foil
      float foilPattern =
        sin((vUv.x + vUv.y) * 10.0 + angle * 10.0) * 0.5 + 0.5;

      // sparkles raros
      float sparkleNoise = fract(
        sin(dot(floor(vUv * 70.0), vec2(12.9898,78.233))) * 43758.5453
      );

      float sparkle = smoothstep(0.997,1.0,sparkleNoise);

      sparkle *= pow(1.0 - abs(angle), 3.0);

      sparkle *= sin(t * 4.0 + vUv.x * 10.0) * 0.5 + 0.5;

      vec3 sparkleColor = rainbow * sparkle;

      vec3 foilColor =
        rainbow * foilPattern * foilIntensity +
        sparkleColor * sparkleIntensity +
        vec3(spec) * specIntensity;

      vec3 finalColor = base.rgb + foilColor;

      gl_FragColor = vec4(finalColor, base.a);
    }
  `
});


