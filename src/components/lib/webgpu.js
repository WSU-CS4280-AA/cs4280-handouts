// GENERATED FILE — do not edit directly.
// Synced from reference/src/lib/webgpu.js by scripts/sync-reference.js
// (runs automatically before dev/build/deploy). Edit the source files in
// reference/src/lib/ and re-run `npm run sync-reference` instead.

export async function initializeWebGPU(canvasId) {
  // 1. Validate canvas presence
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    throw new Error(`Canvas element with ID "${canvasId}" was not found.`);
  }

  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in this browser.");
  }

  let adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
  }

  if (!adapter) {
    throw new Error("No compatible GPU adapter found. Check if hardware acceleration is enabled.");
  }

  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to get WebGPU context from canvas.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  // Canvas pixel dimensions are sized by createAttachmentManager, which
  // also owns resizing — sizing it here too would duplicate that logic
  // and risk skipping the attachment manager's first-run allocation.
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  return { canvas, device, context, format };
}

/**
 * Buffer Helper: Creates and populates a GPUBuffer from typed array data.
 * @param {GPUDevice} device
 * @param {BufferSource} data
 * @param {GPUBufferUsageFlags} usage
 * @returns {GPUBuffer}
 */
export function createBuffer(device, data, usage) {
  // WebGPU requires buffer sizes to be a multiple of 4 bytes.
  const alignedSize = Math.ceil(data.byteLength / 4) * 4;
  const buffer = device.createBuffer({
    size: alignedSize,
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  // writeBuffer also needs a 4-byte-multiple size (e.g. a Uint16Array of
  // 9 indices is 18 bytes), so copy odd-sized data into a padded array.
  if (data.byteLength !== alignedSize) {
    const padded = new Uint8Array(alignedSize);
    padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    device.queue.writeBuffer(buffer, 0, padded);
  } else {
    device.queue.writeBuffer(buffer, 0, data);
  }
  return buffer;
}

/**
 * Mesh Class: Wraps vertex and index buffers, index typing, and draw invocation.
 */
export class Mesh {
  /**
   * @param {GPUDevice} device
   * @param {Object} options
   * @param {Float32Array} options.vertices - Interleaved or single attribute vertex data
   * @param {Uint16Array | Uint32Array} options.indices - Index data array
   */
  constructor(device, { vertices, indices }) {
    this.device = device;
    this.indexCount = indices.length;
    this.indexFormat = indices instanceof Uint32Array ? "uint32" : "uint16";

    this.vertexBuffer = createBuffer(device, vertices, GPUBufferUsage.VERTEX);
    this.indexBuffer = createBuffer(device, indices, GPUBufferUsage.INDEX);
  }

  /**
   * Binds buffers and issues the indexed draw command to the pass encoder.
   * @param {GPURenderPassEncoder} pass
   * @param {number} [slot=0]
   * @param {number} [instanceCount=1] how many instances to draw (instancing)
   * @param {number} [firstInstance=0] first instance index (`@builtin(instance_index)` / per-instance buffer offset)
   */
  draw(pass, slot = 0, instanceCount = 1, firstInstance = 0) {
    pass.setVertexBuffer(slot, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, this.indexFormat);
    pass.drawIndexed(this.indexCount, instanceCount, 0, 0, firstInstance);
  }

  /**
   * Destroys underlying GPU resources.
   */
  destroy() {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
  }
}

/**
 * 3. Render Attachment Manager: Handles High-DPI canvas scaling and depth textures.
 */
export function createAttachmentManager(canvas, device) {
  let depthTexture = null;

  function update() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
    const height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));

    // Also recreate when depthTexture is still null: if the canvas
    // already happened to have these exact pixel dimensions on the first
    // call, the size-changed check alone would never allocate it.
    if (!depthTexture || canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      if (depthTexture) depthTexture.destroy();
      depthTexture = device.createTexture({
        size: [width, height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  update();
  window.addEventListener("resize", update);

  return {
    getDepthView: () => depthTexture.createView(),
    getAspect: () => canvas.width / canvas.height,
  };
}

/**
 * Orbit Controller: Intercepts mouse/touch pointer events to manage view orientation.
 */
export class OrbitController {
  constructor(canvas, initialState = {}) {
    this.canvas = canvas;
    this.distance = initialState.distance ?? 3.5;
    this.rotX = initialState.rotX ?? 0.35;
    this.rotY = initialState.rotY ?? 0.45;
    this.isDragging = false;
    this.lastX = 0;
    this.lastY = 0;

    this._init();
  }

  _init() {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.isDragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.isDragging) return;
      this.rotY += (e.clientX - this.lastX) * 0.01;
      this.rotX += (e.clientY - this.lastY) * 0.01;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    const stopDrag = (e) => {
      this.isDragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {}
    };

    this.canvas.addEventListener("pointerup", stopDrag);
    this.canvas.addEventListener("pointercancel", stopDrag);
  }
}

/**
 * Executes a continuous animation loop, managing canvas sizing,
 * render passes, frame timing, and submission.
 */
export function animate({
  canvas,
  device,
  context,
  fpsElementId = null,
  clearColor = { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
  onFrame,
}) {
  const attachments = createAttachmentManager(canvas, device);
  const fpsLabel = fpsElementId ? document.getElementById(fpsElementId) : null;

  let lastTime = performance.now();
  let frames = 0;
  let lastFpsTime = performance.now();

  function loop(now) {
    const dt = (now - lastTime) * 0.001;
    lastTime = now;

    frames++;
    if (fpsLabel && now - lastFpsTime >= 500) {
      fpsLabel.textContent = `FPS: ${Math.round((frames * 1000) / (now - lastFpsTime))}`;
      frames = 0;
      lastFpsTime = now;
    }

    const commandEncoder = device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: clearColor,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: attachments.getDepthView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    onFrame({
      renderPass,
      dt,
      aspect: attachments.getAspect(),
      time: now * 0.001,
    });

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
