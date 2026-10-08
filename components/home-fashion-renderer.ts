/** A small, home-only WebGL scene. The dress is an original parametric mesh,
 * not a catalogue item or a flat photograph. No network assets are required. */
export type FashionRenderOptions = {
  progress: number;
  pointerX: number;
  pointerY: number;
  time: number;
  reducedMotion: boolean;
};

export type FashionScene = {
  render(options: FashionRenderOptions): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

type Vector = [number, number, number];
type Vertex = {
  position: Vector;
  normal: Vector;
  color: Vector;
  alpha: number;
  metal: number;
};
type Mesh = { vertices: number[]; indices: number[] };
type GpuMesh = { vertex: WebGLBuffer; index: WebGLBuffer; count: number };
const TAU = Math.PI * 2;
const IVORY: Vector = [0.89, 0.855, 0.775];
const GOLD: Vector = [0.48, 0.37, 0.19];
const STRIDE = 11;

const vertexSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aMetal;
  uniform mat4 uModel;
  uniform mat4 uProjection;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vMetal;
  void main() {
    vec4 position = uModel * vec4(aPosition, 1.0);
    vPosition = position.xyz;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    vAlpha = aAlpha;
    vMetal = aMetal;
    gl_Position = uProjection * position;
  }
`;

const fragmentSource = `
  precision mediump float;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vMetal;
  uniform float uShadow;
  void main() {
    if (uShadow > 0.5) {
      gl_FragColor = vec4(vColor, vAlpha);
      return;
    }
    vec3 normal = normalize(vNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 view = normalize(-vPosition);
    vec3 key = normalize(vec3(-0.6, 1.1, 1.8));
    vec3 fill = normalize(vec3(1.0, 0.4, 0.9));
    vec3 rim = normalize(vec3(0.0, 0.6, -1.0));
    float diffuse = max(dot(normal, key), 0.0);
    float fillLight = max(dot(normal, fill), 0.0);
    float rimLight = max(dot(normal, rim), 0.0);
    float gloss = mix(26.0, 70.0, vMetal);
    float highlight = pow(max(dot(normal, normalize(key + view)), 0.0), gloss);
    float silk = pow(1.0 - abs(dot(normal, view)), 3.0);
    vec3 color = vColor * (0.43 + 0.56 * diffuse + 0.16 * fillLight);
    color += vec3(1.0, 0.97, 0.88) * highlight * mix(0.23, 0.66, vMetal);
    color += vColor * (rimLight * 0.14 + silk * 0.11);
    gl_FragColor = vec4(color, vAlpha);
  }
`;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function subtract(a: Vector, b: Vector): Vector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vector): Vector {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function addVertex(mesh: Mesh, vertex: Vertex) {
  mesh.vertices.push(
    ...vertex.position,
    ...vertex.normal,
    ...vertex.color,
    vertex.alpha,
    vertex.metal,
  );
}

/** Smooth interpolation keeps the bust, waist and skirt connected naturally. */
function silhouette(u: number, points: [number, number][]) {
  for (let i = 1; i < points.length; i++) {
    if (u <= points[i][0]) {
      const previous = points[i - 1];
      const next = points[i];
      const t = (u - previous[0]) / (next[0] - previous[0]);
      const smooth = t * t * (3 - 2 * t);
      return previous[1] + (next[1] - previous[1]) * smooth;
    }
  }
  return points[points.length - 1][1];
}

function dressPoint(u: number, angle: number): Vector {
  const skirt = clamp((u - 0.35) / 0.65, 0, 1);
  const width = silhouette(u, [
    [0, 0.5],
    [0.16, 0.55],
    [0.35, 0.36],
    [0.53, 0.53],
    [0.76, 0.76],
    [1, 1.02],
  ]);
  const depth = silhouette(u, [
    [0, 0.14],
    [0.16, 0.23],
    [0.35, 0.16],
    [0.53, 0.27],
    [0.76, 0.38],
    [1, 0.48],
  ]);
  const fold =
    (Math.cos(angle * 18 + skirt * 0.85) * 0.055 +
      Math.cos(angle * 9 - 0.5) * 0.018) *
    skirt;
  const front = Math.max(0, Math.cos(angle));
  // A gently curved V at the front; the back has a shallower neckline.
  const neckline =
    1.62 - Math.pow(front, 4) * 0.36 - Math.max(0, -Math.cos(angle)) * 0.09;
  const hem =
    -1.9 + Math.cos(angle * 9 + 0.4) * 0.038 + Math.sin(angle) * 0.025;
  return [
    Math.sin(angle) * (width + fold) + skirt * skirt * 0.035,
    neckline * (1 - u) + hem * u,
    Math.cos(angle) * (depth + fold * 0.8) + Math.sin(u * Math.PI) * 0.035,
  ];
}

function createDress(): Mesh {
  const mesh: Mesh = { vertices: [], indices: [] };
  const rings = 54;
  const segments = 96;
  for (let row = 0; row <= rings; row++) {
    const u = row / rings;
    for (let column = 0; column <= segments; column++) {
      const angle = (column / segments) * TAU;
      const position = dressPoint(u, angle);
      const tangent = subtract(
        dressPoint(u, angle + 0.002),
        dressPoint(u, angle - 0.002),
      );
      const vertical = subtract(
        dressPoint(Math.min(1, u + 0.002), angle),
        dressPoint(Math.max(0, u - 0.002), angle),
      );
      const normal = normalize(cross(vertical, tangent));
      // Very subtle woven variation, never enough to produce noisy texture.
      const warmth = 1 + Math.sin(angle * 18 + u * 7) * 0.008;
      addVertex(mesh, {
        position,
        normal,
        color: IVORY.map((channel) => channel * warmth) as Vector,
        alpha: 1,
        metal: 0,
      });
    }
  }
  for (let row = 0; row < rings; row++) {
    for (let column = 0; column < segments; column++) {
      const a = row * (segments + 1) + column;
      const b = a + segments + 1;
      mesh.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh;
}

/** Small swept tubes supply actual depth to the straps and hanger. */
function appendTube(
  mesh: Mesh,
  path: Vector[],
  radius: number,
  color: Vector,
  metal = 0,
  sides = 8,
) {
  const base = mesh.vertices.length / STRIDE;
  path.forEach((point, index) => {
    const tangent = normalize(
      subtract(
        path[Math.min(index + 1, path.length - 1)],
        path[Math.max(index - 1, 0)],
      ),
    );
    const reference: Vector =
      Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const first = normalize(cross(tangent, reference));
    const second = normalize(cross(tangent, first));
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * TAU;
      const normal = first.map(
        (value, axis) =>
          value * Math.cos(angle) + second[axis] * Math.sin(angle),
      ) as Vector;
      const position = point.map(
        (value, axis) => value + normal[axis] * radius,
      ) as Vector;
      addVertex(mesh, { position, normal, color, alpha: 1, metal });
    }
  });
  for (let index = 0; index < path.length - 1; index++) {
    for (let side = 0; side < sides; side++) {
      const a = base + index * (sides + 1) + side;
      const b = a + sides + 1;
      mesh.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

function createHangerAndStraps(): Mesh {
  const mesh: Mesh = { vertices: [], indices: [] };
  appendTube(
    mesh,
    [
      [-0.72, 1.93, 0],
      [-0.68, 1.99, 0],
      [-0.42, 2.14, 0],
      [0, 2.34, 0],
      [0.42, 2.14, 0],
      [0.68, 1.99, 0],
      [0.72, 1.93, 0],
      [-0.72, 1.93, 0],
    ],
    0.025,
    GOLD,
    1,
    10,
  );
  const hook: Vector[] = [
    [0, 2.34, 0],
    [0, 2.48, 0],
  ];
  for (let step = 0; step <= 28; step++) {
    const angle = Math.PI + (step / 28) * Math.PI * 1.55;
    hook.push([
      0.135 + Math.cos(angle) * 0.135,
      2.6 - Math.sin(angle) * 0.135,
      0,
    ]);
  }
  appendTube(mesh, hook, 0.025, GOLD, 1, 10);
  for (const side of [-1, 1]) {
    // Each shoulder strap travels over the hanger and joins front and back.
    const path: Vector[] = [];
    for (let step = 0; step <= 28; step++) {
      const angle = (step / 28) * Math.PI;
      path.push([
        side * (0.425 + Math.sin(angle) * 0.02),
        1.6 + Math.sin(angle) * 0.58,
        Math.cos(angle) * 0.078,
      ]);
    }
    appendTube(mesh, path, 0.019, IVORY, 0, 8);
  }
  // A narrow rolled hem catches the light and makes the open skirt readable.
  const hem = Array.from({ length: 97 }, (_, index) =>
    dressPoint(1, (index / 96) * TAU),
  );
  appendTube(mesh, hem, 0.009, [0.84, 0.8, 0.72], 0, 6);
  // The neckline is a soft fabric edge, rather than an infinitely thin opening.
  const neckline = Array.from({ length: 97 }, (_, index) =>
    dressPoint(0, (index / 96) * TAU),
  );
  appendTube(mesh, neckline, 0.008, IVORY, 0, 6);
  return mesh;
}

function createShadow(): Mesh {
  const mesh: Mesh = { vertices: [], indices: [] };
  const rings = 8;
  const segments = 48;
  for (let ring = 0; ring <= rings; ring++) {
    const radius = ring / rings;
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * TAU;
      const alpha = Math.pow(1 - radius, 2.1) * 0.15;
      addVertex(mesh, {
        position: [
          Math.sin(angle) * radius * 1.9,
          -2.16,
          Math.cos(angle) * radius * 0.9,
        ],
        normal: [0, 1, 0],
        color: [0.12, 0.17, 0.13],
        alpha,
        metal: 0,
      });
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      mesh.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh;
}

function multiply(a: Float32Array, b: Float32Array) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++)
        result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return result;
}

function rotation(yaw: number, pitch: number, roll: number) {
  const y = new Float32Array([
    Math.cos(yaw),
    0,
    -Math.sin(yaw),
    0,
    0,
    1,
    0,
    0,
    Math.sin(yaw),
    0,
    Math.cos(yaw),
    0,
    0,
    0,
    0,
    1,
  ]);
  const x = new Float32Array([
    1,
    0,
    0,
    0,
    0,
    Math.cos(pitch),
    Math.sin(pitch),
    0,
    0,
    -Math.sin(pitch),
    Math.cos(pitch),
    0,
    0,
    0,
    0,
    1,
  ]);
  const z = new Float32Array([
    Math.cos(roll),
    Math.sin(roll),
    0,
    0,
    -Math.sin(roll),
    Math.cos(roll),
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ]);
  return multiply(multiply(x, y), z);
}

function projection(aspect: number) {
  const f = 1 / Math.tan((38 * Math.PI) / 360);
  const near = 0.1;
  const far = 30;
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ]);
}

export function createFashionScene(
  canvas: HTMLCanvasElement,
): FashionScene | null {
  const gl = (() => {
    try {
      return canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: "low-power",
      });
    } catch {
      return null;
    }
  })();
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const meshes: GpuMesh[] = [];
  let program: WebGLProgram | null = null;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    meshes.forEach((mesh) => {
      gl!.deleteBuffer(mesh.vertex);
      gl!.deleteBuffer(mesh.index);
    });
    shaders.forEach((shader) => gl!.deleteShader(shader));
    if (program) gl!.deleteProgram(program);
  }
  try {
    function compile(type: number, source: string) {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error("Shader allocation failed");
      shaders.push(shader);
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS))
        throw new Error("Shader compilation failed");
      return shader;
    }
    program = gl.createProgram();
    if (!program) throw new Error("Program allocation failed");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Program linking failed");
    gl.useProgram(program);
    const attributes = [
      "aPosition",
      "aNormal",
      "aColor",
      "aAlpha",
      "aMetal",
    ].map((name) => gl.getAttribLocation(program!, name));
    const modelUniform = gl.getUniformLocation(program, "uModel");
    const projectionUniform = gl.getUniformLocation(program, "uProjection");
    const shadowUniform = gl.getUniformLocation(program, "uShadow");
    function upload(mesh: Mesh): GpuMesh {
      const vertex = gl!.createBuffer();
      const index = gl!.createBuffer();
      if (!vertex || !index) {
        if (vertex) gl!.deleteBuffer(vertex);
        if (index) gl!.deleteBuffer(index);
        throw new Error("Buffer allocation failed");
      }
      const gpuMesh = { vertex, index, count: mesh.indices.length };
      meshes.push(gpuMesh);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, vertex);
      gl!.bufferData(
        gl!.ARRAY_BUFFER,
        new Float32Array(mesh.vertices),
        gl!.STATIC_DRAW,
      );
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, index);
      gl!.bufferData(
        gl!.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(mesh.indices),
        gl!.STATIC_DRAW,
      );
      return gpuMesh;
    }
    const shadow = upload(createShadow());
    const dress = upload(createDress());
    const details = upload(createHangerAndStraps());
    let aspect = 1;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // Both sides are lit so the open neckline and hem remain correct in rotation.
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);

    function draw(mesh: GpuMesh) {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, mesh.vertex);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, mesh.index);
      const sizes = [3, 3, 3, 1, 1];
      let offset = 0;
      attributes.forEach((attribute, index) => {
        gl!.enableVertexAttribArray(attribute);
        gl!.vertexAttribPointer(
          attribute,
          sizes[index],
          gl!.FLOAT,
          false,
          STRIDE * 4,
          offset * 4,
        );
        offset += sizes[index];
      });
      gl!.drawElements(gl!.TRIANGLES, mesh.count, gl!.UNSIGNED_SHORT, 0);
    }
    return {
      resize(width, height) {
        if (disposed || gl.isContextLost()) return;
        const dpr = clamp(
          typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
          1,
          1.75,
        );
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        aspect = Math.max(0.1, width / Math.max(1, height));
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      render({ progress, pointerX, pointerY, time, reducedMotion }) {
        if (disposed || gl.isContextLost()) return;
        const position = reducedMotion ? 0 : clamp(progress, 0, 1);
        const seconds = Number.isFinite(time) ? time / 1000 : 0;
        const tilt = reducedMotion
          ? 0
          : (clamp(pointerX, -1, 1) * Math.PI) / 60;
        const pitch = reducedMotion
          ? -0.015
          : -0.015 +
            (clamp(pointerY, -1, 1) * Math.PI) / 90 +
            Math.sin(position * Math.PI) * 0.045;
        const yaw = ((-20 + position * 170) * Math.PI) / 180 + tilt;
        const roll = reducedMotion
          ? -0.025
          : Math.sin(seconds * 0.35) * 0.012 - 0.025;
        const model = rotation(yaw, pitch, roll);
        model[13] =
          -0.38 + (reducedMotion ? 0 : Math.sin(seconds * 0.7) * 0.035);
        model[14] = -8.7;
        // The floor is stationary; a slight camera pitch exposes the soft ellipse.
        const floor = rotation(0, 0.075, 0);
        floor[13] = -0.38;
        floor[14] = -8.7;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniformMatrix4fv(projectionUniform, false, projection(aspect));
        gl.uniformMatrix4fv(modelUniform, false, floor);
        gl.uniform1f(shadowUniform, 1);
        gl.depthMask(false);
        draw(shadow);
        gl.depthMask(true);
        gl.uniformMatrix4fv(modelUniform, false, model);
        gl.uniform1f(shadowUniform, 0);
        draw(dress);
        draw(details);
      },
      dispose,
    };
  } catch {
    dispose();
    return null;
  }
}
