// Дым как настоящий: симуляция жидкости на видеокарте (WebGL2).
// Метод «stable fluids» (Jos Stam): перенос, давление, завихрённость и плавучесть —
// поэтому дым сам закручивается, поднимается и рассеивается, а не проигрывается роликом.
// Цикл работает только пока идёт показ, потом полностью останавливается.

const VS = `#version 300 es
precision highp float;
in vec2 aPosition;
uniform vec2 texelSize;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
out vec4 outColor;
`;

const FS = {
  clear: `uniform sampler2D uTexture; uniform float value;
    void main () { outColor = value * texture(uTexture, vUv); }`,
  splat: `uniform sampler2D uTarget; uniform float aspect; uniform vec3 color; uniform vec2 point; uniform float radius;
    void main () {
      vec2 p = vUv - point; p.x *= aspect;
      outColor = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.0);
    }`,
  advect: `uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 velTexel; uniform float dt; uniform float dissipation;
    void main () {
      vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velTexel;
      outColor = texture(uSource, coord) / (1.0 + dissipation * dt);
    }`,
  buoyancy: `uniform sampler2D uVelocity; uniform sampler2D uDye; uniform float lift; uniform vec2 wind; uniform float dt;
    void main () {
      vec2 v = texture(uVelocity, vUv).xy;
      float d = texture(uDye, vUv).x;
      float hot = min(d, 1.0);                 // подъём ограничен: густой дым не взлетает рывком
      float present = smoothstep(0.0, 0.08, d); // лёгкий сквозняк одинаков везде, где есть дым
      outColor = vec4(v + (vec2(0.0, lift) * hot + wind * present) * dt, 0.0, 1.0);
    }`,
  divergence: `uniform sampler2D uVelocity;
    void main () {
      float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
      float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
      outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,
  curl: `uniform sampler2D uVelocity;
    void main () {
      float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
      float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
      outColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`,
  vorticity: `uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
    void main () {
      float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
      float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
      float C = texture(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C; force.y *= -1.0;
      vec2 v = clamp(texture(uVelocity, vUv).xy + force * dt, -1000.0, 1000.0);
      outColor = vec4(v, 0.0, 1.0);
    }`,
  pressure: `uniform sampler2D uPressure; uniform sampler2D uDivergence;
    void main () {
      float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
      float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
      outColor = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: `uniform sampler2D uPressure; uniform sampler2D uVelocity;
    void main () {
      float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
      float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
      outColor = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
    }`,
  
  display: `uniform sampler2D uDye; uniform vec2 dyeTexel; uniform float opacity; uniform float density; uniform float shade;
    void main () {
      float c = texture(uDye, vUv).x;
      float dx = texture(uDye, vUv + vec2(dyeTexel.x, 0.0)).x - texture(uDye, vUv - vec2(dyeTexel.x, 0.0)).x;
      float dy = texture(uDye, vUv + vec2(0.0, dyeTexel.y)).x - texture(uDye, vUv - vec2(0.0, dyeTexel.y)).x;
      vec3 n = normalize(vec3(-dx, -dy, length(dyeTexel) * 14.0));
      float light = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
      float a = 1.0 - exp(-c * density);
      vec3 col = mix(vec3(0.8, 0.79, 0.8), vec3(1.0, 0.99, 0.98), 1.0 - shade + shade * light);
      outColor = vec4(col * a, a) * opacity;
    }`,
};

function resolution(gl, base) {
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const ratio = Math.max(w / h, h / w);
  const big = Math.round(base * ratio);
  return w > h ? { w: big, h: base } : { w: base, h: big };
}

export function createSmoke(stage) {
  const canvas = document.createElement('canvas');
  canvas.className = 'smoke-canvas';
  canvas.hidden = true;
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
  });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  stage.append(canvas);

  // на слабом устройстве после первого показа переходим на облегчённый режим
  const coarse = matchMedia('(pointer: coarse)').matches;
  let light = coarse;
  let SIM, DYE, PRESSURE_STEPS;
  const quality = () => {
    SIM = light ? 80 : 128;
    DYE = light ? 320 : 512;
    PRESSURE_STEPS = light ? 10 : 18;
  };
  quality();

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, VS);
  const programs = {};
  for (const [name, body] of Object.entries(FS)) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, HEAD + body));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const { name: uniform } = gl.getActiveUniform(program, i);
      uniforms[uniform] = gl.getUniformLocation(program, uniform);
    }
    programs[name] = { program, uniforms };
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function target(w, h, internal, format) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture, fbo, w, h, tx: 1 / w, ty: 1 / h,
      attach(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); return unit; },
      free() { gl.deleteTexture(texture); gl.deleteFramebuffer(fbo); },
    };
  }
  function double(w, h, internal, format) {
    let read = target(w, h, internal, format);
    let write = target(w, h, internal, format);
    return {
      get read() { return read; }, get write() { return write; }, w, h, tx: 1 / w, ty: 1 / h,
      swap() { [read, write] = [write, read]; },
      free() { read.free(); write.free(); },
    };
  }

  let fields;
  function allocate() {
    fields && Object.values(fields).forEach((f) => f.free());
    const sim = resolution(gl, SIM);
    const dye = resolution(gl, DYE);
    fields = {
      velocity: double(sim.w, sim.h, gl.RG16F, gl.RG),
      dye: double(dye.w, dye.h, gl.R16F, gl.RED),
      pressure: double(sim.w, sim.h, gl.R16F, gl.RED),
      divergence: target(sim.w, sim.h, gl.R16F, gl.RED),
      curl: target(sim.w, sim.h, gl.R16F, gl.RED),
    };
  }

  function use(name) {
    const p = programs[name];
    gl.useProgram(p.program);
    return p.uniforms;
  }
  function blit(dest) {
    if (dest) {
      gl.viewport(0, 0, dest.w, dest.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  const aspect = () => canvas.width / canvas.height;

  // x, y — доли экрана (y сверху вниз), dx, dy — скорость в клетках сетки в секунду
  function splat(x, y, dx, dy, amount, radius) {
    const { velocity, dye } = fields;
    const r = (radius / 100) * Math.max(1, aspect());
    let u = use('splat');
    gl.uniform1f(u.aspect, aspect());
    gl.uniform2f(u.point, x, 1 - y);
    gl.uniform1f(u.radius, r);
    gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
    gl.uniform1i(u.uTarget, velocity.read.attach(0));
    gl.uniform3f(u.color, dx, -dy, 0);
    blit(velocity.write);
    velocity.swap();
    gl.uniform2f(u.texelSize, dye.tx, dye.ty);
    gl.uniform1i(u.uTarget, dye.read.attach(0));
    gl.uniform3f(u.color, amount, 0, 0);
    blit(dye.write);
    dye.swap();
  }

  function step(dt) {
    const { velocity, dye, pressure, divergence, curl } = fields;
    const texel = (u, f) => gl.uniform2f(u.texelSize, f.tx, f.ty);

    let u = use('buoyancy');
    texel(u, velocity);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uDye, dye.read.attach(1));
    gl.uniform1f(u.lift, look.lift);
    gl.uniform2f(u.wind, look.wind[0], look.wind[1]);
    gl.uniform1f(u.dt, dt);
    blit(velocity.write);
    velocity.swap();

    u = use('curl');
    texel(u, velocity);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    blit(curl);

    u = use('vorticity');
    texel(u, velocity);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uCurl, curl.attach(1));
    gl.uniform1f(u.curl, look.curl);
    gl.uniform1f(u.dt, dt);
    blit(velocity.write);
    velocity.swap();

    u = use('divergence');
    texel(u, velocity);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    blit(divergence);

    u = use('clear');
    texel(u, pressure);
    gl.uniform1i(u.uTexture, pressure.read.attach(0));
    gl.uniform1f(u.value, 0.8);
    blit(pressure.write);
    pressure.swap();

    u = use('pressure');
    texel(u, pressure);
    gl.uniform1i(u.uDivergence, divergence.attach(0));
    for (let i = 0; i < PRESSURE_STEPS; i++) {
      gl.uniform1i(u.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    u = use('gradient');
    texel(u, velocity);
    gl.uniform1i(u.uPressure, pressure.read.attach(0));
    gl.uniform1i(u.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    u = use('advect');
    texel(u, velocity);
    gl.uniform2f(u.velTexel, velocity.tx, velocity.ty);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uSource, velocity.read.attach(0));
    gl.uniform1f(u.dt, dt);
    gl.uniform1f(u.dissipation, look.velocityFade);
    blit(velocity.write);
    velocity.swap();

    texel(u, dye);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uSource, dye.read.attach(1));
    gl.uniform1f(u.dissipation, look.fade);
    blit(dye.write);
    dye.swap();
  }

  function render(opacity) {
    const u = use('display');
    gl.uniform2f(u.texelSize, 0, 0);
    gl.uniform2f(u.dyeTexel, fields.dye.tx, fields.dye.ty);
    gl.uniform1i(u.uDye, fields.dye.read.attach(0));
    gl.uniform1f(u.opacity, opacity);
    gl.uniform1f(u.density, look.density);
    gl.uniform1f(u.shade, look.shade);
    blit(null);
  }

  // поведение дыма задаёт тот, кто запускает показ
  let look = { lift: 40, wind: [90, 0], curl: 7, velocityFade: 1.1, fade: 0.55, density: 1.1, shade: 0.55 };
  let raf = 0;
  let stopTimer;

  return {
    // emit(t, splat) вызывается каждый кадр: t — миллисекунды от начала
    play({ duration, fadeFrom, emit, ...options }) {
      look = { ...look, ...options };
      cancelAnimationFrame(raf);
      const box = stage.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio || 1, coarse ? 1 : 1.5);
      const w = Math.max(2, Math.round(box.width * scale));
      const h = Math.max(2, Math.round(box.height * scale));
      if (!fields || canvas.width !== w || canvas.height !== h || fields.light !== light) {
        canvas.width = w;
        canvas.height = h;
        allocate();
        fields.light = light;
      } else {
        for (const f of [fields.velocity, fields.dye, fields.pressure]) {
          for (const side of [f.read, f.write]) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, side.fbo);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
          }
        }
      }
      canvas.hidden = false;
      const start = performance.now();
      let last = start;
      let frames = 0;
      const frame = (now) => {
        const t = now - start;
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        // меньше 30 кадров в секунду — сразу сокращаем расчёт давления, со следующего раза и сетку
        if (++frames === 40 && t / frames > 33 && !light) {
          light = true;
          PRESSURE_STEPS = 8;
        }
        emit(t, splat, dt);
        step(dt);
        render(t < fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (duration - fadeFrom)));
        if (t < duration) raf = requestAnimationFrame(frame);
        else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          canvas.hidden = true;
          quality();
        }
      };
      raf = requestAnimationFrame(frame);
      clearTimeout(stopTimer);
    },
  };
}
