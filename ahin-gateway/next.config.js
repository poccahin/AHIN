/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Three.js ships ESM that Next can occasionally trip over — transpile it.
  transpilePackages: ['three'],
  webpack: (config) => {
    // GLSL imports — useful in later phases when we externalize shader files.
    config.module.rules.push({
      test: /\.(glsl|vs|fs|vert|frag)$/,
      exclude: /node_modules/,
      use: ['raw-loader'],
    });
    return config;
  },
};

module.exports = nextConfig;
