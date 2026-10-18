/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static marketing routes — no runtime LMS dependency.
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
};

export default nextConfig;
