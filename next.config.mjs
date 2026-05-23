/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Three.js ships ESM that some bundlers trip on. Turbopack generally
  // handles it, but transpiling is a cheap safety belt and matches the
  // prototype's expected build behavior.
  transpilePackages: ["three"],
  images: {
    unoptimized: true
  }
};

export default nextConfig;
