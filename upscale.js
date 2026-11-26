// Улучшение картинки для видеофайлов и прямых ссылок, прямо на видеокарте (WebGL2):
// 1) апскейл кадра до реального размера экрана бикубическим фильтром Catmull-Rom
//    (чётче, чем растягивает сам браузер);
// 2) адаптивная резкость по методу AMD FidelityFX CAS: подтягивает контуры,
//    не раздувая шум и не давая ореолов. В режиме «аниме» резкость сильнее
//    и контурные линии чуть плотнее — рисованная картинка от этого выигрывает больше всего.
// YouTube так улучшить нельзя: его плеер чужой, браузер не отдаёт оттуда кадры.

const VS = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main () {
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// Catmull-Rom за 9 выборок с аппаратной билинейной фильтрацией
const UPSCALE = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
uniform vec2 uSize;
in vec2 vUv;
out vec4 outColor;
void main () {
  vec2 pos = vUv * uSize;
  vec2 c1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 p0 = (c1 - 1.0) / uSize;
  vec2 p3 = (c1 + 2.0) / uSize;
  vec2 p12 = (c1 + o12) / uSize;
  vec3 r = vec3(0.0);
  r += texture(uFrame, vec2(p0.x, p0.y)).rgb * w0.x * w0.y;
  r += texture(uFrame, vec2(p12.x, p0.y)).rgb * w12.x * w0.y;
  r += texture(uFrame, vec2(p3.x, p0.y)).rgb * w3.x * w0.y;
  r += texture(uFrame, vec2(p0.x, p12.y)).rgb * w0.x * w12.y;
  r += texture(uFrame, vec2(p12.x, p12.y)).rgb * w12.x * w12.y;
  r += texture(uFrame, vec2(p3.x, p12.y)).rgb * w3.x * w12.y;
  r += texture(uFrame, vec2(p0.x, p3.y)).rgb * w0.x * w3.y;
  r += texture(uFrame, vec2(p12.x, p3.y)).rgb * w12.x * w3.y;
  r += texture(uFrame, vec2(p3.x, p3.y)).rgb * w3.x * w3.y;
  outColor = vec4(clamp(r, 0.0, 1.0), 1.0);
}`;

// AMD FidelityFX CAS (MIT) + для аниме лёгкое уплотнение тёмных контуров
const SHARPEN = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uTexel;
uniform float uSharpness;
uniform float uLines;
in vec2 vUv;
out vec4 outColor;
// промежуточная картинка лежит в обычной для WebGL ориентации, снизу вверх
vec3 at(float x, float y) { return texture(uImage, vec2(vUv.x, 1.0 - vUv.y) + vec2(x, -y) * uTexel).rgb; }
void main () {
  vec3 a = at(-1.0, -1.0), b = at(0.0, -1.0), c = at(1.0, -1.0);
  vec3 d = at(-1.0, 0.0), e = at(0.0, 0.0), f = at(1.0, 0.0);
  vec3 g = at(-1.0, 1.0), h = at(0.0, 1.0), i = at(1.0, 1.0);
  vec3 mn = min(min(min(d, e), min(f, b)), h);
  mn += min(mn, min(min(a, c), min(g, i)));
  vec3 mx = max(max(max(d, e), max(f, b)), h);
  mx += max(mx, max(max(a, c), max(g, i)));
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 4.5, uSharpness));
  vec3 color = clamp((b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w), 0.0, 1.0);
  if (uLines > 0.0) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float around = dot((b + d + f + h) * 0.25, vec3(0.299, 0.587, 0.114));
    color *= 1.0 - uLines * clamp((around - luma) * 4.0, 0.0, 0.35);
  }
  outColor = vec4(color, 1.0);
}`;

export const MODES = {
  off: { title: 'Чёткость: выкл' },
  film: { title: 'Чёткость: фильм', sharpness: 0.45, lines: 0 },
  anime: { title: 'Чёткость: аниме', sharpness: 0.85, lines: 0.5 },
};

const MAX_PIXELS = 2560 * 1440;

export function createEnhancer(video, box, { onUnavailable }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'enhance';
  canvas.hidden = true;
  box.append(canvas);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) {
    canvas.remove();
    return null;
  }

  function program(fs) {
    const p = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'aPosition');
    gl.linkProgram(p);
    const u = (name) => gl.getUniformLocation(p, name);
    return { p, u };
  }
  const up = program(UPSCALE);
  const sharp = program(SHARPEN);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  const texture = (filter) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const frame = texture(gl.LINEAR);
  const middle = texture(gl.NEAREST);
  const fbo = gl.createFramebuffer();
  let mode = MODES.off;
  let width = 0;
  let height = 0;
  let broken = false;
  let callback = 0;
  let raf = 0;

  // canvas точно поверх картинки видео (с учётом чёрных полос)
  function layout() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const scale = Math.min(bw / vw, bh / vh);
    const cssW = vw * scale;
    const cssH = vh * scale;
    Object.assign(canvas.style, {
      left: `${(bw - cssW) / 2}px`, top: `${(bh - cssH) / 2}px`, width: `${cssW}px`, height: `${cssH}px`,
    });
    let w = Math.round(cssW * Math.min(devicePixelRatio || 1, 2));
    let h = Math.round(cssH * Math.min(devicePixelRatio || 1, 2));
    const over = Math.sqrt((w * h) / MAX_PIXELS);
    if (over > 1) { w = Math.round(w / over); h = Math.round(h / over); }
    if (w !== width || h !== height) {
      width = canvas.width = w;
      height = canvas.height = h;
      gl.bindTexture(gl.TEXTURE_2D, middle);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, middle, 0);
    }
    return true;
  }

  function draw() {
    if (mode === MODES.off || broken || !layout()) return;
    gl.bindTexture(gl.TEXTURE_2D, frame);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      // видео с чужого сайта без разрешения: браузер не даёт читать кадры
      broken = true;
      canvas.hidden = true;
      onUnavailable?.();
      return;
    }
    gl.useProgram(up.p);
    gl.uniform2f(up.u('uSize'), video.videoWidth, video.videoHeight);
    gl.uniform1i(up.u('uFrame'), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(sharp.p);
    gl.bindTexture(gl.TEXTURE_2D, middle);
    gl.uniform1i(sharp.u('uImage'), 0);
    gl.uniform2f(sharp.u('uTexel'), 1 / width, 1 / height);
    gl.uniform1f(sharp.u('uSharpness'), mode.sharpness);
    gl.uniform1f(sharp.u('uLines'), mode.lines);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    canvas.hidden = false;
  }

  // перерисовываем ровно на каждом новом кадре видео
  function loop() {
    draw();
    if (mode === MODES.off || broken) return;
    if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(loop);
    else raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (callback) video.cancelVideoFrameCallback?.(callback);
    cancelAnimationFrame(raf);
    callback = raf = 0;
  }

  const redraw = () => draw();
  video.addEventListener('seeked', redraw);
  video.addEventListener('loadeddata', redraw);
  const resize = new ResizeObserver(redraw);
  resize.observe(box);

  // поверх видео нельзя нажать на его кнопки, поэтому при движении мыши
  // ненадолго показываем обычную картинку с управлением
  let peekTimer;
  const peek = () => {
    canvas.classList.add('peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => canvas.classList.remove('peek'), 2500);
  };
  box.addEventListener('pointermove', peek);
  box.addEventListener('pointerdown', peek);

  return {
    setMode(name) {
      mode = MODES[name] ?? MODES.off;
      stop();
      if (mode === MODES.off) canvas.hidden = true;
      else loop();
      return !broken;
    },
    get available() { return !broken; },
    destroy() {
      stop();
      resize.disconnect();
      clearTimeout(peekTimer);
      video.removeEventListener('seeked', redraw);
      video.removeEventListener('loadeddata', redraw);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    },
  };
}
