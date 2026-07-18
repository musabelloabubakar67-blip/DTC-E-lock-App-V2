/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['*.trycloudflare.com'],
  experimental: {
    useLightningcss: true,
  },
};

export default nextConfig;
