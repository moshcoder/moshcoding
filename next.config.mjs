/** @type {import('next').NextConfig} */
// NOTE: the CSP frame-ancestors allow-list (parked domains that may frame the
// app, e.g. moshcode.sh) is set at runtime in middleware.ts so FRAME_ANCESTORS
// env changes apply without a rebuild.
const nextConfig = {
  reactStrictMode: true,
  // brand assets are large PNGs served straight from /public
  poweredByHeader: false,
};

export default nextConfig;
