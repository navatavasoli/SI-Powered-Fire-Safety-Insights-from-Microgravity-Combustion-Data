/**
 * WebGL2 volume renderer for the reduced-order flame fields.
 *
 * Each fragment raymarches through an emission field built from the model outputs:
 *   sphere / burner : spherical flame sheet at r_f + inner soot shell, opaque core
 *   jet             : flame sheet on the model's r_f(z) contour above a nozzle
 *   slab            : flame sheet over a solid sample, leading edge advancing at V_f
 * Blue = CH* chemiluminescence (thin reaction zone); orange/yellow = soot, coloured by
 * flame temperature. This is a visualisation of model output, not imagery of data.
 */
import type { RenderState } from "./index";

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uCamPos, uCamR, uCamU, uCamF; uniform float uFov;
uniform int uMode; uniform float uScale;
uniform float uRf, uCore, uLen, uNozzle, uThick, uSpread, uSoot, uTf, uG, uU;
uniform int uExtinct;
uniform float uProfile[32];

const int STEPS = 112;

vec3 sootColor(float tf){
  float t = clamp((tf - 1300.0) / 1400.0, 0.0, 1.0);
  return mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.78, 0.38), t);
}
const vec3 BLUE = vec3(0.22, 0.42, 1.0);

float prof(float s){ // s in [0,1] along the profile
  float x = clamp(s, 0.0, 1.0) * 31.0;
  int i = int(floor(x)); int j = min(i + 1, 31);
  return mix(uProfile[i], uProfile[j], fract(x));
}

// Analytic opaque objects: returns hit distance (or 1e9) and shades into col.
float hitSphere(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c; float b = dot(oc, rd); float h = b*b - dot(oc,oc) + r*r;
  if (h < 0.0) return 1e9; float t = -b - sqrt(h); return t > 0.0 ? t : 1e9;
}
float hitCylY(vec3 ro, vec3 rd, float r, float y0, float y1){
  float a = dot(rd.xz, rd.xz); if (a < 1e-6) return 1e9;
  float b = dot(ro.xz, rd.xz); float c = dot(ro.xz, ro.xz) - r*r; float h = b*b - a*c;
  if (h < 0.0) return 1e9; float t = (-b - sqrt(h)) / a; float y = ro.y + t*rd.y;
  return (t > 0.0 && y > y0 && y < y1) ? t : 1e9;
}
float hitBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out vec3 n){
  vec3 inv = 1.0 / rd; vec3 t0 = (bmin - ro) * inv; vec3 t1 = (bmax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
  if (b < max(a, 0.0)) return 1e9;
  n = -sign(rd) * step(tn.yzx, tn.xyz) * step(tn.zxy, tn.xyz);
  return a > 0.0 ? a : 1e9;
}

// Emission at point q (mm). Returns rgb emission density per mm.
vec3 emission(vec3 q){
  if (uMode == 0 || uMode == 1) {
    vec3 p = q;
    // Buoyancy: stretch upward and lift the sheet (illustrative for g > 0).
    float k = 1.0 + 1.3 * sqrt(uG);
    if (p.y > 0.0) p.y /= k;
    p.y -= 0.15 * uRf * sqrt(uG);
    float d = length(p);
    float w = 0.05 * uRf + 0.12;
    float sheet = exp(-pow((d - uRf) / w, 2.0));
    float rs = uRf * 0.72;
    float shell = exp(-pow((d - rs) / (w * 1.8), 2.0));
    // In µg the soot shell is uniform; with gravity soot collects in the upper lobe.
    float bias = mix(1.0, smoothstep(-0.6, 0.8, p.y / max(uRf, 1e-3)), clamp(sqrt(uG) * 2.0, 0.0, 1.0));
    return BLUE * sheet * 0.9 + sootColor(uTf) * shell * uSoot * 1.6 * bias;
  }
  if (uMode == 2) {
    float z = q.y; if (z < 0.0 || z > uLen * 1.02) return vec3(0.0);
    float s = z / max(uLen, 1e-3);
    float r = length(q.xz);
    float flick = uG > 0.01 ? 1.0 + 0.04 * sqrt(uG) * sin(uTime * 9.0 - s * 7.0) : 1.0;
    float rf = prof(s) * flick;
    float w = 0.22 + 0.04 * rf;
    float sheet = exp(-pow((r - rf) / w, 2.0)) * smoothstep(1.02, 0.94, s);
    float base = smoothstep(0.55, 0.05, s);           // blue near the nozzle
    float sootZone = smoothstep(0.25, 0.65, s) * smoothstep(1.02, 0.8, s);
    float inner = exp(-pow((r - rf * 0.7) / (w * 2.0 + 0.1 * rf), 2.0));
    return BLUE * sheet * (0.35 + 0.9 * base) + sootColor(uTf) * inner * sootZone * uSoot * 1.4;
  }
  if (uMode == 3 && uExtinct == 0) {
    float halfLen = 28.0;
    float travel = mod(uTime * max(uSpread, 0.0), 2.0 * halfLen - uLen);
    float x0 = halfLen - travel - uLen;          // leading edge (spread toward −x, opposed flow from −x)
    float s = (q.x - x0) / max(uLen, 1e-3);
    if (s < -0.05 || s > 1.05 || abs(q.z) > 9.0 || q.y < 0.0) return vec3(0.0);
    float h = prof(s);
    float w = 0.18 + 0.12 * h;
    float sheet = exp(-pow((q.y - h) / w, 2.0)) * smoothstep(-0.05, 0.05, s) * smoothstep(1.05, 0.85, s);
    float edge = smoothstep(9.0, 7.5, abs(q.z));
    float lead = exp(-pow(s / 0.12, 2.0));
    // ×3: the sheet is a few mm thick against a 56 mm sample, so it needs more gain to read.
    return (BLUE * (0.4 + 1.2 * lead) + sootColor(uTf) * uSoot * smoothstep(0.1, 0.5, s) * 1.3) * sheet * edge * 3.0;
  }
  return vec3(0.0);
}

void main(){
  vec2 uv = vUv * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uCamF + uv.x * uFov * uCamR + uv.y * uFov * uCamU);
  vec3 ro = uCamPos;

  // Background: deep navy with a soft vignette.
  vec3 bg = mix(vec3(0.027, 0.086, 0.161), vec3(0.047, 0.118, 0.204), 1.0 - length(vUv) * 0.6);

  // Opaque geometry (scene units = mm / uScale).
  float tHit = 1e9; vec3 surf = vec3(0.0); vec3 n = vec3(0.0, 1.0, 0.0);
  float S = uScale;
  if (uMode == 0) {
    float t = hitSphere(ro, rd, vec3(0.0), uCore / S);
    if (t < tHit) { tHit = t; vec3 p = ro + t*rd; n = normalize(p); surf = vec3(0.55, 0.62, 0.7) * (0.25 + 0.6 * max(dot(n, normalize(vec3(0.3,0.8,0.5))), 0.0)); }
    float tf = hitCylY(ro, rd, 0.006, -2.0, -uCore / S); // thin support fibre (scene units)
    if (tf < tHit) { tHit = tf; surf = vec3(0.35); }
  } else if (uMode == 1) {
    float t = hitSphere(ro, rd, vec3(0.0), uCore / S);
    if (t < tHit) { tHit = t; vec3 p = ro + t*rd; n = normalize(p); surf = vec3(0.32, 0.34, 0.38) * (0.3 + 0.6 * max(dot(n, normalize(vec3(0.3,0.8,0.5))), 0.0)); }
    float tc = hitCylY(ro, rd, 0.9 / S, -3.0, -uCore / S * 0.8);
    if (tc < tHit) { tHit = tc; surf = vec3(0.26, 0.28, 0.32); }
  } else if (uMode == 2) {
    float tc = hitCylY(ro, rd, (uNozzle + 0.35) / S, -3.0, 0.0);
    if (tc < tHit) { tHit = tc; vec3 p = ro + tc*rd; n = normalize(vec3(p.x, 0.0, p.z)); surf = vec3(0.45, 0.48, 0.52) * (0.3 + 0.6 * max(dot(n, normalize(vec3(0.4,0.5,0.7))), 0.0)); }
  } else if (uMode == 3) {
    vec3 bn;
    float th = max(uThick, 0.15) / S;
    float tb = hitBox(ro, rd, vec3(-28.0/S, -th, -9.0/S), vec3(28.0/S, 0.0, 9.0/S), bn);
    if (tb < tHit) {
      tHit = tb; n = bn; vec3 p = (ro + tb*rd) * S;
      float halfLen = 28.0;
      float travel = mod(uTime * max(uSpread, 0.0), 2.0 * halfLen - uLen);
      float x0 = uExtinct == 1 ? halfLen : halfLen - travel - uLen;
      float burnt = smoothstep(x0 + uLen * 0.6, x0 + uLen, p.x);
      float pyro = exp(-pow((p.x - x0 - uLen * 0.3) / (uLen * 0.45), 2.0));
      vec3 fresh = vec3(0.62, 0.58, 0.5), charred = vec3(0.08, 0.07, 0.07);
      surf = mix(fresh, charred, burnt) * (0.3 + 0.6 * max(dot(n, normalize(vec3(0.3,0.9,0.4))), 0.0));
      surf += vec3(1.0, 0.35, 0.08) * pyro * 0.35 * (uExtinct == 1 ? 0.0 : 1.0);
    }
  }

  // Raymarch emission inside the bounding sphere of radius 2.2 (scene units).
  vec3 acc = vec3(0.0);
  float b = dot(ro, rd); float h = b*b - dot(ro, ro) + 2.2*2.2;
  if (h > 0.0) {
    float t0 = max(-b - sqrt(h), 0.0), t1 = min(-b + sqrt(h), tHit);
    float dt = (t1 - t0) / float(STEPS);
    for (int i = 0; i < STEPS; i++) {
      float t = t0 + (float(i) + 0.5) * dt;
      if (t > t1) break;
      // Integrate in scene units so brightness doesn't scale with flame size in mm.
      acc += emission((ro + t * rd) * S) * dt;
    }
  }
  vec3 base = tHit < 1e8 ? surf : bg;
  vec3 col = base + (1.0 - exp(-acc * 4.0));
  outColor = vec4(pow(col, vec3(0.95)), 1.0);
}`;

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
}

export class FlameRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private state: RenderState | null = null;
  cam: Camera = { yaw: -0.55, pitch: 0.32, zoom: 1 };
  private basis = { pos: [0, 0, 3], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1], fov: 0.55, target: [0, 0, 0] };

  static supported(canvas: HTMLCanvasElement) {
    return !!canvas.getContext("webgl2");
  }

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    this.prog = this.link(VERT, FRAG);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(this.prog, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uTime", "uCamPos", "uCamR", "uCamU", "uCamF", "uFov", "uMode", "uScale", "uRf", "uCore", "uLen",
      "uNozzle", "uThick", "uSpread", "uSoot", "uTf", "uG", "uU", "uExtinct", "uProfile"]) {
      this.loc[n] = gl.getUniformLocation(this.prog, n);
    }
  }

  private link(vs: string, fs: string) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    return p;
  }

  setState(s: RenderState | null) {
    this.state = s;
  }

  /** Vertical centre of interest in scene units, per mode. */
  private targetY() {
    const s = this.state;
    if (!s) return 0;
    if (s.mode === "jet") return (s.length ?? 10) / s.scale * 0.45;
    if (s.mode === "slab") return 0.15;
    return 0;
  }

  private updateBasis() {
    const { yaw, pitch, zoom } = this.cam;
    const d = 3.4 / zoom;
    const ty = this.targetY();
    const pos = [d * Math.cos(pitch) * Math.sin(yaw), ty + d * Math.sin(pitch), d * Math.cos(pitch) * Math.cos(yaw)];
    const f = norm([-pos[0], ty - pos[1], -pos[2]]);
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    this.basis = { pos, r, u, f, fov: 0.55, target: [0, ty, 0] };
  }

  /** Project a point in mm to canvas CSS pixels (for the 2D overlay). */
  project(pmm: [number, number, number]): [number, number] | null {
    const s = this.state;
    if (!s) return null;
    const p = pmm.map((v) => v / s.scale);
    const { pos, r, u, f, fov } = this.basis;
    const v = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
    const z = dot(v, f);
    if (z <= 0.01) return null;
    const x = dot(v, r) / z / fov, y = dot(v, u) / z / fov;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [w / 2 + (x * h) / 2, h / 2 - (y * h) / 2];
  }

  render(time: number) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // raymarching is fill-rate bound
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.updateBasis();
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    const s = this.state;
    const L = this.loc;
    const mode = !s ? -1 : { sphere: 0, burner: 1, jet: 2, slab: 3, none: -1 }[s.mode];
    gl.uniform2f(L.uRes, w, h);
    gl.uniform1f(L.uTime, time);
    gl.uniform3fv(L.uCamPos, this.basis.pos);
    gl.uniform3fv(L.uCamR, this.basis.r);
    gl.uniform3fv(L.uCamU, this.basis.u);
    gl.uniform3fv(L.uCamF, this.basis.f);
    gl.uniform1f(L.uFov, this.basis.fov);
    gl.uniform1i(L.uMode, mode);
    gl.uniform1f(L.uScale, s?.scale ?? 1);
    gl.uniform1f(L.uRf, s?.rf ?? 0);
    gl.uniform1f(L.uCore, s?.rCore ?? 0);
    gl.uniform1f(L.uLen, s?.length ?? 0);
    gl.uniform1f(L.uNozzle, s?.nozzleR ?? 0.8);
    gl.uniform1f(L.uThick, s?.thickness ?? 0.3);
    gl.uniform1f(L.uSpread, s?.spread ?? 0);
    gl.uniform1f(L.uSoot, s?.soot ?? 0);
    gl.uniform1f(L.uTf, s?.tf ?? 2000);
    gl.uniform1f(L.uG, s?.g ?? 0);
    gl.uniform1f(L.uU, s?.u ?? 0);
    gl.uniform1i(L.uExtinct, s?.extinct ? 1 : 0);
    const prof = new Float32Array(32);
    if (s?.profile) prof.set(s.profile.slice(0, 32));
    gl.uniform1fv(L.uProfile, prof);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** PNG data URL of the current frame (for export). */
  snapshot(time: number) {
    this.render(time);
    return this.canvas.toDataURL("image/png");
  }

  /**
   * Free GPU objects but keep the context: React dev mode re-mounts effects on the same
   * canvas, and a force-lost context can't be reacquired. The browser frees the context
   * itself when the canvas is removed.
   */
  dispose() {
    this.gl.deleteProgram(this.prog);
  }
}

function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: number[]) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
