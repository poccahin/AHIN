import sharp from "sharp";
import { fileURLToPath } from "node:url";

const agents = [
  {
    file: "lifepp-genesis-orange.png",
    color: [255, 87, 34]
  },
  {
    file: "lifepp-rule-purple.png",
    color: [156, 39, 176]
  },
  {
    file: "lifepp-compute-blue.png",
    color: [3, 169, 244]
  },
  {
    file: "lifepp-contract-gold.png",
    color: [255, 193, 7]
  },
  {
    file: "lifepp-eco-green.png",
    color: [139, 195, 74]
  }
];

function offsetFor(x, y, width) {
  return (y * width + x) * 4;
}

function isBackgroundCandidate(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= 44 && max - min <= 10;
}

function hasTransparentNeighbor(data, x, y, width, height, radius) {
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
      if (xx === x && yy === y) {
        continue;
      }
      if (data[offsetFor(xx, yy, width) + 3] === 0) {
        return true;
      }
    }
  }
  return false;
}

function removeEdgeConnectedBackground(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const pixel = y * width + x;
    if (visited[pixel]) {
      return;
    }
    const offset = pixel * 4;
    if (!isBackgroundCandidate(data, offset)) {
      return;
    }
    visited[pixel] = 1;
    queue.push(pixel);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  for (const pixel of queue) {
    data[pixel * 4 + 3] = 0;
  }

  return queue.length;
}

function neutralizeDarkFringe(data, width, height, color) {
  let neutralized = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = offsetFor(x, y, width);
      const alpha = data[offset + 3];
      if (alpha === 0) {
        continue;
      }

      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const darkEdge = max <= 86 && max - min <= 54 && hasTransparentNeighbor(data, x, y, width, height, 2);
      if (!darkEdge) {
        continue;
      }

      data[offset] = Math.round(color[0] * 0.72 + 255 * 0.28);
      data[offset + 1] = Math.round(color[1] * 0.72 + 255 * 0.28);
      data[offset + 2] = Math.round(color[2] * 0.72 + 255 * 0.28);
      data[offset + 3] = Math.max(alpha, 218);
      neutralized += 1;
    }
  }
  return neutralized;
}

for (const agent of agents) {
  const path = fileURLToPath(new URL(`../public/agents/${agent.file}`, import.meta.url));
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const transparent = removeEdgeConnectedBackground(data, info.width, info.height);
  const neutralized = neutralizeDarkFringe(data, info.width, info.height, agent.color);

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  })
    .png({ compressionLevel: 9, palette: false })
    .toFile(path);

  console.log(`${agent.file}: transparent=${transparent}, neutralized=${neutralized}`);
}
